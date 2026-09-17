import { validateSetupBankIdentifiers, type SetupBankIdentifier } from "./bankConnection";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  bankSmsIdentifiers,
  assetClasses,
  assets,
  auditLog,
  currencies,
  entryFxSnapshots,
  prices,
  settings,
  userSetupState,
  users,
  wallets,
} from "@/db/schema";
import {
  canonicalWalletName,
  holdingAccountName,
  holdingKeyOf,
  isBrokerage,
  isIranianExchange,
  walletKeyOf,
  walletKindOf,
} from "@/features/setup/holdingWallets";
import { postEntry } from "@/features/ledger/service";
import { ensureCategoryCatalog } from "@/features/categories/service";
import { D, Decimal } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { invalidateTenantStateCache } from "@/lib/tenantState";
import { rootCauseOf } from "@/db/init-schema";
import { registerInstrument } from "@/features/funds/service";
import { registerWallexAsset } from "@/features/pricing/wallexRegistration";
import { createUserVehicle } from "@/features/rwa/vehicle/service";
import { createRealEstateAsset } from "@/features/rwa/realEstate/service";
import {
  SUPPORTED_CRYPTO_ASSETS,
  getSupportedCryptoBySymbol,
  requireSupportedCryptoBySymbol,
  type SupportedCryptoAsset,
} from "@/features/pricing/supportedAssets";

/**
 * CURRENCY MODEL OF THE SETUP (the answer to «دلار، تتر یا تومان؟»)
 *
 *   BOOK (functional) currency — USD, fixed, never a user choice.
 *     `postings.base_value`, FIFO `unit_cost_base` and realized P&L are in USD
 *     (docs/DESIGN-ACCOUNT-DENOMINATION-AND-FX.md). It is the stable yardstick
 *     that lets a flat, a gold fund and a bitcoin be compared and lets a gain
 *     be told apart from inflation. The app's live rate is the Toman/Tether
 *     market rate, so «USD» in the book is the Tether-market dollar.
 *
 *   TRANSACTION currency — what the user actually paid, per holding:
 *     Toman only    bank accounts, debts, property, vehicles, physical gold,
 *                   TSE funds (incl. gold funds) and TSE stocks
 *     USDT or Toman crypto, US stocks, indices and commodities
 *
 *   Every Toman amount of one setup converts at ONE rate — the rate the user
 *   confirmed on the wizard — and that rate is frozen on the opening entry
 *   (`entry_fx_snapshots`). The portfolio derives each position's historical
 *   Toman cost from exactly that snapshot, so a Toman price typed here comes
 *   back as the same Toman cost later.
 *
 *   USDT is an ASSET, not a unit of account: it has its own price and can
 *   depeg. It is booked at face (1 USDT = 1 USD), the same rule a USDT cash
 *   account already uses, and its market value comes from its price feed.
 */

/**
 * Coins that are a claim on a fiat unit rather than a volatile asset. They are
 * classed «استیبل‌کوین», which the portfolio's liquidity filter counts as
 * نقدینگی — dry powder in a wallet reads as liquidity, not crypto exposure.
 */
const STABLECOIN_SYMBOLS = new Set(["USDT", "USDC", "USDS", "USDE", "USDG", "PYUSD"]);

/** Native units a cash/bank account may hold. Book currency stays USD. */
export const SETUP_MONEY_SYMBOLS = ["IRT", "USD", "USDT"] as const;
export type SetupMoneySymbol = (typeof SETUP_MONEY_SYMBOLS)[number];
const SETUP_MONEY_SYMBOL_SET = new Set<string>(SETUP_MONEY_SYMBOLS);

/** Currency an opening PRICE was entered in. Absent means USD (the original API contract). */
export type SetupPriceCurrency = "USD" | "USDT" | "IRT";

const SETUP_USDT = requireSupportedCryptoBySymbol("USDT");
const SETUP_BTC = requireSupportedCryptoBySymbol("BTC");
const SETUP_ETH = requireSupportedCryptoBySymbol("ETH");

/** Sanity band for a USD→IRT rate, the same band the rate settings enforce. */
const RATE_MIN = "1000";
const RATE_MAX = "10000000";
/** Chart codes 1200–1299 hold the crypto wallets opened by the setup. */
const CRYPTO_CODE_BASE = 1200;
const MAX_CRYPTO_WALLETS = 100;

export type SetupInput = {
  userName: string;
  /**
   * Kept for API compatibility only. The book currency is USD for every tenant;
   * a different value no longer creates a pseudo «ارز پایه» asset or re-points
   * income/expense accounts at it.
   */
  baseCurrency: string;
  displayCurrency: string;
  dateCalendar: "jalali" | "gregorian";
  digitStyle: "fa" | "en";
  /** USD→IRT rate the user confirmed. Out of range or absent → the user's latest rate. */
  fxRate?: string;
  bankAccountName?: string;
  bankName?: string;
  bankIdentifiers?: SetupBankIdentifier[];
  cashWalletName?: string;
  /** Native denomination of the bank account (IRT | USD | USDT). */
  bankAssetSymbol?: string;
  /** Native denomination of the cash wallet (IRT | USD | USDT). */
  cashAssetSymbol?: string;
  /** Native quantity in the bank account's own unit — never book USD. */
  bankOpeningBalance?: string;
  /** Native quantity in the cash account's own unit — never book USD. */
  cashOpeningBalance?: string;
  /**
   * Toman held at an Iranian exchange or a brokerage, one account per place —
   * «تومان - نوبیتکس», «تومان - کارگزاری مفید». Foreign exchanges hold no Toman.
   */
  tomanPlaces?: Array<{ walletName: string; balance?: string }>;
  /**
   * Every coin the user holds, per place. Each line is its own account named
   * after the coin; lines naming the same `walletName` share one wallet. With
   * a quantity, a line also gets a posting and a FIFO lot in the opening entry.
   */
  cryptoHoldings?: Array<{
    symbol: string;
    quantity?: string;
    unitPrice?: string;
    priceCurrency?: SetupPriceCurrency;
    /** Exchange or wallet holding the coin. Blank = no wallet container. */
    walletName?: string;
  }>;
  /** Legacy single-coin fields — merged into `cryptoHoldings`. */
  cryptoSymbol?: string;
  cryptoOpeningQty?: string;
  cryptoUnitPrice?: string;
  cryptoPriceCurrency?: SetupPriceCurrency;
  /** Physical gold, in grams of 18 karat. */
  goldOpeningQty?: string;
  goldUnitPrice?: string;
  goldPriceCurrency?: SetupPriceCurrency;
  /**
   * صندوق‌ها، سهام and والکس assets the user already owns. Each row is registered
   * (identity + tenant-owned asset account) and, with a quantity, opens a
   * position in the same opening entry. A row with no quantity is registered
   * only — no lot is fabricated.
   */
  instruments?: Array<{
    /** «wallex» = a US stock / commodity / index token from the والکس catalogue. */
    kind: "fund" | "stock" | "wallex";
    symbol: string;
    name?: string;
    quantity?: string;
    /** Purchase price per unit — opening cost basis only. */
    unitPrice?: string;
    priceCurrency?: SetupPriceCurrency;
  }>;
  /**
   * خودرو و ملک — REGISTRY assets, written by the registry's own services after
   * the opening transaction commits (see the note at the end of `completeSetup`).
   */
  vehicles?: Array<{
    catalogId: string;
    manufacturingYear: string;
    ownershipDate: string;
    purchasePriceToman: string;
    currentValueToman?: string;
  }>;
  properties?: Array<{
    cityId: string;
    neighborhoodId: string;
    propertyTypeId: string;
    acquisitionDate: string;
    purchasePriceToman: string;
    /** Blank → the purchase price, valued on the purchase day. */
    currentValueToman?: string;
    sizeSqm?: string;
  }>;
};

/**
 * Translate the known Chart-of-Accounts insert failures into an
 * operator-facing message. Only the setup write of account metadata is involved.
 */
function rethrowChartInsertError(err: unknown): never {
  const root = rootCauseOf(err);
  if (root.code === "23502" && /asset_id|wallet_id/.test(root.message)) {
    throw new Error(
      "حساب‌های سرفصل (مثل ۱۰۰۰ دارایی‌ها) باید بدون asset_id/wallet_id ذخیره شوند. " +
        "ستون مربوطه در پایگاه‌داده به اشتباه NOT NULL است. migration را اجرا کنید: npm run db:migrate",
    );
  }
  if (root.code === "42P10") {
    throw new Error(
      "ایندکس یکتای (user_id, code) روی جدول accounts یافت نشد. migration را اجرا کنید: npm run db:migrate",
    );
  }
  if (root.code === "23505" && /accounts_code_unique|accounts_code_key/.test(root.message)) {
    const wrapped = new Error(
      "قید یکتای سراسری روی accounts.code (accounts_code_unique) با معماری چندکاربره سازگار نیست. " +
        "هر کاربر باید بتواند کد ۱۰۰۰ را داشته باشد. migration را اجرا کنید: npm run db:migrate",
    );
    (wrapped as Error & { cause?: unknown }).cause = err;
    throw wrapped;
  }
  throw err instanceof Error ? err : new Error(root.message);
}

function resolveMoneyDenomination(explicit: string | undefined): SetupMoneySymbol {
  const candidate = (explicit || "USD").toUpperCase();
  if (SETUP_MONEY_SYMBOL_SET.has(candidate)) return candidate as SetupMoneySymbol;
  return "USD";
}

/** A user-entered decimal, or zero when blank. Malformed input fails loudly. */
function amountOf(value: string | undefined): Decimal {
  const text = (value ?? "").trim();
  if (!text) return Decimal.zero();
  const amount = D(text);
  if (amount.isNegative()) throw new Error("مبالغ راه‌اندازی نمی‌توانند منفی باشند.");
  return amount;
}

/** The confirmed rate when it is inside the sanity band; otherwise null. */
function confirmedRateOf(value: string | undefined): Decimal | null {
  try {
    const rate = D((value ?? "").trim());
    return rate.gte(RATE_MIN) && rate.lte(RATE_MAX) ? rate : null;
  } catch {
    return null;
  }
}

/** Opening price → USD book value. USD and USDT at face; Toman ÷ the setup rate. */
function priceToBookUsd(price: Decimal, currency: SetupPriceCurrency | undefined, rate: Decimal): Decimal {
  if ((currency ?? "USD") !== "IRT") return price;
  if (!rate.gt(0)) throw new Error("نرخ تبدیل دلار به تومان معتبر نیست.");
  return price.div(rate);
}

/**
 * Server-authoritative conversion of a cash opening balance: read the persisted
 * account's denomination, interpret the quantity in that unit, and compute its
 * USD `base_value` at the setup rate. Client labels are never trusted.
 */
async function bookUsdFromAccountNative(
  tx: any,
  accountId: string,
  nativeQtyInput: string,
  rate: Decimal,
): Promise<{ assetId: string; quantity: string; baseValue: string; symbol: string }> {
  const qty = amountOf(nativeQtyInput);

  const [row] = await tx
    .select({ assetId: accounts.assetId, symbol: assets.symbol })
    .from(accounts)
    .innerJoin(assets, eq(assets.id, accounts.assetId))
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!row?.assetId || !row.symbol) {
    throw new Error("حساب انتخاب‌شده واحد بومی (assetId) ندارد.");
  }

  let baseValue = qty;
  if (row.symbol === "IRT") {
    if (!rate.gt(0)) throw new Error("نرخ تبدیل دلار به تومان معتبر نیست.");
    baseValue = qty.div(rate);
  }

  return { assetId: row.assetId, symbol: row.symbol, quantity: qty.toString(), baseValue: baseValue.toString() };
}

export async function getSetupState(userId?: string) {
  const rows = await db
    .select()
    .from(userSetupState)
    .where(userId ? eq(userSetupState.userId, userId) : sql`1=1`)
    .limit(1);
  if (!rows.length) return { completed: false, currentStep: 1 };
  return { completed: rows[0].completed, currentStep: rows[0].currentStep };
}

type OpenLot = { accountId: string; assetId: string; quantity: string; costBase: string };

/**
 * Setup Wizard Orchestrator
 *
 * - Duplicate prevention (throws if setup is already completed).
 * - All financial mutations go through postEntry() — never direct ledger inserts.
 * - One opening entry for every ledger balance, balanced against 3010 in USD,
 *   with the setup rate frozen on it.
 * - No demo transactions.
 */
export async function completeSetup(
  input: SetupInput,
  /** When supplied, setup is isolated to this existing authenticated tenant. */
  userId?: string,
): Promise<{ ok: boolean; message: string }> {
  const bankIdentifiers = validateSetupBankIdentifiers(input.bankIdentifiers, input.bankAccountName?.trim() || "حساب بانکی اصلی", input.bankName || "", input.bankAssetSymbol || "IRT");
  if (bankIdentifiers.length && !userId) throw new Error("اتصال بانک نیازمند کاربر واردشده است.");
  const existingState = await getSetupState(userId);
  if (existingState.completed) {
    throw new Error("راه‌اندازی اولیه قبلاً انجام شده است.");
  }

  const setupResult = await db.transaction(async (tx) => {
    const today = todayIso();

    // Shared reference data, idempotent: another tenant may already have
    // populated part of these catalogs.
    await tx
      .insert(currencies)
      .values([
        { code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true },
        { code: "IRT", name: "تومان", symbol: "تومان", decimals: 0, isFiat: true },
        { code: "EUR", name: "یورو", symbol: "€", decimals: 2, isFiat: true },
        { code: "IRR", name: "ریال ایران", symbol: "ریال", decimals: 0, isFiat: true },
      ])
      .onConflictDoNothing();
    const curList = await tx.select().from(currencies);
    const curMap = Object.fromEntries(curList.map((c) => [c.code, c.id]));

    await tx
      .insert(assetClasses)
      .values([
        { code: "cash", name: "نقد و بانک", color: "#6e6ff0", sortOrder: 1 },
        { code: "stable", name: "استیبل‌کوین", color: "#9ea1f6", sortOrder: 2 },
        { code: "crypto", name: "رمزارز", color: "#c9cafa", sortOrder: 3 },
        { code: "gold", name: "طلا", color: "#363850", sortOrder: 4 },
      ])
      .onConflictDoNothing();
    const clsList = await tx.select().from(assetClasses);
    const clsMap = Object.fromEntries(clsList.map((c) => [c.code, c.id]));

    const requiredAssets = new Map(
      [
        // Money denominations are always available. There is no separate
        // «ارز پایه» asset any more — the book currency is USD.
        { symbol: "IRT", name: "تومان", classId: clsMap.cash, currencyId: curMap.IRT, decimals: 0 },
        { symbol: "USD", name: "دلار آمریکا", classId: clsMap.cash, currencyId: curMap.USD, decimals: 2 },
        {
          symbol: SETUP_USDT.symbol,
          name: "تتر",
          classId: clsMap.stable,
          decimals: 6,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: SETUP_USDT.coingeckoId,
          logoUrl: SETUP_USDT.logoUrl,
        },
        {
          symbol: SETUP_BTC.symbol,
          name: "بیت‌کوین",
          classId: clsMap.crypto,
          decimals: 8,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: SETUP_BTC.coingeckoId,
          logoUrl: SETUP_BTC.logoUrl,
        },
        {
          symbol: SETUP_ETH.symbol,
          name: "اتریوم",
          classId: clsMap.crypto,
          decimals: 8,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: SETUP_ETH.coingeckoId,
          logoUrl: SETUP_ETH.logoUrl,
        },
        // Every coin the picker offers needs an identity to post against.
        ...SUPPORTED_CRYPTO_ASSETS.filter((c) => !["BTC", "ETH", "USDT"].includes(c.symbol)).map((c) => ({
          symbol: c.symbol,
          name: c.displayName,
          classId: STABLECOIN_SYMBOLS.has(c.symbol) ? clsMap.stable : clsMap.crypto,
          decimals: 8,
          pricingMethod: "coingecko" as const,
          priceSource: "coingecko" as const,
          coingeckoId: c.coingeckoId,
          logoUrl: c.logoUrl,
        })),
        { symbol: "GOLD18", name: "طلای ۱۸ عیار (گرم)", classId: clsMap.gold, decimals: 3 },
      ].map((asset) => [asset.symbol, asset]),
    );
    await tx.insert(assets).values([...requiredAssets.values()]).onConflictDoNothing();

    // Older paths could leave these identities with manual pricing. Reconcile
    // pricing metadata only; never touch an account, posting, lot or snapshot.
    for (const identity of [SETUP_USDT, SETUP_BTC, SETUP_ETH]) {
      await tx
        .update(assets)
        .set({
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: identity.coingeckoId,
          logoUrl: identity.logoUrl,
          isActive: true,
          deletedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(assets.symbol, identity.symbol));
    }

    const astList = await tx.select().from(assets);
    const assetMap = Object.fromEntries(astList.map((a) => [a.symbol, a.id]));

    // User resolution. Authenticated setup configures the existing tenant; the
    // legacy single-tenant path creates its first owner.
    let user: typeof users.$inferSelect | undefined;
    if (userId) {
      [user] = await tx.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!user) throw new Error("کاربر راه‌اندازی یافت نشد.");
      [user] = await tx
        .update(users)
        .set({ name: input.userName.trim() || user.name, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
    } else {
      [user] = await tx
        .insert(users)
        .values({ name: input.userName.trim() || "مالک خانواده", role: "owner" })
        .returning();
    }
    if (!user) throw new Error("ایجاد کاربر راه‌اندازی ناموفق بود.");
    invalidateTenantStateCache();

    // ONE rate for the whole setup: the user's confirmed rate, else their latest.
    const latestFx = await getLatestUsdIrtRateForUser(user.id, tx);
    const confirmedRate = confirmedRateOf(input.fxRate);
    const setupRate = confirmedRate ?? (confirmedRateOf(latestFx.rate) ?? Decimal.zero());
    const rateSource = confirmedRate ? "setup_confirmed" : latestFx.source;

    // `settings` is a legacy global table: authenticated tenants never write it.
    if (!userId) {
      const configItems = [
        { key: "base_currency", value: "USD" },
        { key: "display_currency", value: input.displayCurrency },
        { key: "date_calendar", value: input.dateCalendar },
        { key: "digit_style", value: input.digitStyle },
      ];
      for (const cfg of configItems) {
        await tx
          .insert(settings)
          .values(cfg)
          .onConflictDoUpdate({ target: settings.key, set: { value: cfg.value } });
      }
    }

    // Chart of accounts. Book / functional currency is USD for every row that
    // is not a holding; a holding's asset is its denomination.
    const bookAssetId = assetMap.USD;
    const bankAssetId = assetMap[resolveMoneyDenomination(input.bankAssetSymbol)] ?? bookAssetId;
    const cashAssetId = assetMap[resolveMoneyDenomination(input.cashAssetSymbol)] ?? bookAssetId;
    // Only the bank account is mandatory. A cash box exists only when the user
    // named or funded one.
    const wantsCashWallet = Boolean(
      input.cashWalletName?.trim() || amountOf(input.cashOpeningBalance).gt(0),
    );

    // The coins the user picked, one line per (coin, place), each with its own
    // chart code. An unknown symbol is skipped — never a silent fallback to
    // another coin. The same coin twice in the SAME place is refused rather
    // than silently dropping one of the two quantities.
    const cryptoPicks: Array<{
      chosenCrypto: SupportedCryptoAsset;
      code: string;
      quantity?: string;
      unitPrice?: string;
      priceCurrency?: SetupPriceCurrency;
      walletName: string;
    }> = [];
    const legacyCrypto = input.cryptoSymbol
      ? [{ symbol: input.cryptoSymbol, quantity: input.cryptoOpeningQty, unitPrice: input.cryptoUnitPrice, priceCurrency: input.cryptoPriceCurrency }]
      : [];
    const holdingSeen = new Set<string>();
    for (const holding of [...(input.cryptoHoldings ?? []), ...legacyCrypto]) {
      const chosenCrypto = getSupportedCryptoBySymbol(holding.symbol);
      if (!chosenCrypto || !assetMap[chosenCrypto.symbol]) continue;
      // «metamask» and «متامسک» are one place, stored under its Persian name.
      const walletName = canonicalWalletName("walletName" in holding ? holding.walletName : "");
      const key = holdingKeyOf(chosenCrypto.symbol, walletName);
      if (holdingSeen.has(key)) {
        throw new Error(
          `${chosenCrypto.displayName}${walletName ? ` در «${walletName}»` : " بدون محل نگهداری"} دو بار وارد شده است؛ مقدارها را در یک ردیف جمع کنید.`,
        );
      }
      holdingSeen.add(key);
      if (cryptoPicks.length >= MAX_CRYPTO_WALLETS) break;
      cryptoPicks.push({
        chosenCrypto,
        code: String(CRYPTO_CODE_BASE + cryptoPicks.length),
        quantity: holding.quantity,
        unitPrice: holding.unitPrice,
        priceCurrency: holding.priceCurrency,
        walletName,
      });
    }

    // Toman at an Iranian exchange (for crypto) or a brokerage (for the Tehran
    // market). Any other place holds no Toman and is refused, not dropped.
    const tomanPlacePicks: Array<{ code: string; walletName: string; balance?: string }> = [];
    const tomanSeen = new Set<string>();
    for (const place of input.tomanPlaces ?? []) {
      const walletName = canonicalWalletName(place.walletName);
      if (!walletName) continue;
      if (!isIranianExchange(walletName) && !isBrokerage(walletName)) {
        throw new Error(`«${walletName}» حساب تومانی ندارد؛ تومان فقط در صرافی داخلی یا کارگزاری نگهداری می‌شود.`);
      }
      const key = walletKeyOf(walletName);
      if (tomanSeen.has(key)) continue;
      tomanSeen.add(key);
      if (tomanPlacePicks.length >= 50) break;
      tomanPlacePicks.push({ code: String(1500 + tomanPlacePicks.length), walletName, balance: place.balance });
    }

    // One wallet per distinct place (first spelling wins); an existing wallet
    // of this user with the same name is reused, never duplicated.
    const walletIdByKey = new Map<string, string>();
    const ownedWallets = await tx
      .select({ id: wallets.id, name: wallets.name })
      .from(wallets)
      .where(and(sql`${wallets.deletedAt} is null`, eq(wallets.userId, user.id)));
    for (const w of ownedWallets) {
      if (!walletIdByKey.has(walletKeyOf(w.name))) walletIdByKey.set(walletKeyOf(w.name), w.id);
    }
    for (const pick of [...cryptoPicks, ...tomanPlacePicks]) {
      const key = walletKeyOf(pick.walletName);
      if (!key || walletIdByKey.has(key)) continue;
      const [created] = await tx
        .insert(wallets)
        .values({ userId: user.id, name: pick.walletName, kind: walletKindOf(pick.walletName) })
        .returning({ id: wallets.id });
      walletIdByKey.set(key, created.id);
    }

    const acctRows = [
      { code: "1000", name: "دارایی‌ها", type: "asset" },
      { code: "1010", name: input.bankAccountName?.trim() || "حساب بانکی اصلی", type: "asset", assetId: bankAssetId },
      ...(wantsCashWallet
        ? [{ code: "1020", name: input.cashWalletName?.trim() || "صندوق نقد", type: "asset", assetId: cashAssetId }]
        : []),
      // One account per coin per place, named «<ارز> - <محل>» (e.g. «تتر -
      // بیت‌پین») — a coin is not a wallet. The place is also the wallet the
      // account is linked to, so the money page groups by it.
      ...cryptoPicks.map(({ chosenCrypto, code, walletName }) => ({
        code,
        name: holdingAccountName(chosenCrypto.displayName, walletName),
        type: "asset" as const,
        assetId: assetMap[chosenCrypto.symbol],
        walletId: walletIdByKey.get(walletKeyOf(walletName)) ?? null,
      })),
      ...tomanPlacePicks.map(({ code, walletName }) => ({
        code,
        name: holdingAccountName("تومان", walletName),
        type: "asset" as const,
        assetId: assetMap.IRT,
        walletId: walletIdByKey.get(walletKeyOf(walletName)) ?? null,
      })),
      { code: "1300", name: "طلای ۱۸ عیار", type: "asset", assetId: assetMap.GOLD18 },
      { code: "2000", name: "بدهی‌ها", type: "liability" },
      { code: "2010", name: "وام / بدهی عمومی", type: "liability", assetId: bookAssetId },
      { code: "3000", name: "سرمایه", type: "equity" },
      { code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: bookAssetId },
      // Non-cash reserve: counter account of depreciation / reserve entries.
      { code: "3200", name: "ذخیره استهلاک و تعمیرات آتی", type: "equity", assetId: bookAssetId },
      { code: "4000", name: "درآمدها", type: "income" },
      { code: "4010", name: "حقوق و درآمد", type: "income", assetId: bookAssetId },
      { code: "4100", name: "سود سرمایه‌ای تحقق‌یافته", type: "income", assetId: bookAssetId },
      { code: "4900", name: "درآمد متفرقه", type: "income", assetId: bookAssetId },
      { code: "5000", name: "هزینه‌ها", type: "expense" },
      { code: "5010", name: "خوراک و خانه", type: "expense", assetId: bookAssetId },
      { code: "5020", name: "مسکن و اجاره", type: "expense", assetId: bookAssetId },
      { code: "5030", name: "حمل‌ونقل", type: "expense", assetId: bookAssetId },
      // FEE ACCOUNT — required: buy/sell entries debit the commission here
      // («سند تراز نیست» without it — audit F-02).
      { code: "5040", name: "کارمزد و بانک", type: "expense", assetId: bookAssetId },
      { code: "5050", name: "سفر و رویداد", type: "expense", assetId: bookAssetId },
      { code: "5900", name: "هزینه متفرقه", type: "expense", assetId: bookAssetId },
      // INSTALLMENT-PAYMENT BUCKET — required, and not «هزینه متفرقه» (audit F-3).
      { code: "5960", name: "پرداخت اقساط", type: "expense", assetId: bookAssetId },
    ];

    const ownedAcctRows = acctRows.map((row) => ({ ...row, userId: userId ?? null }));
    let insertedAccounts: Array<typeof accounts.$inferSelect>;
    if (userId) {
      // A user may already own part of the chart (e.g. a lazily provisioned
      // 3010). Fill only the missing rows; each insert runs in a SAVEPOINT so a
      // duplicate never aborts the whole setup transaction.
      for (const row of ownedAcctRows) {
        const [existing] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.userId, userId), eq(accounts.code, row.code)))
          .limit(1);
        if (existing) continue;
        try {
          await tx.transaction(async (sp) => {
            await sp.insert(accounts).values(row);
          });
        } catch (err) {
          const root = rootCauseOf(err);
          if (root.code === "23505") {
            const [now] = await tx
              .select({ id: accounts.id })
              .from(accounts)
              .where(and(eq(accounts.userId, userId), eq(accounts.code, row.code)))
              .limit(1);
            if (now) continue;
            rethrowChartInsertError(err);
          }
          rethrowChartInsertError(err);
        }
      }
      insertedAccounts = await tx
        .select()
        .from(accounts)
        .where(and(eq(accounts.userId, userId), inArray(accounts.code, acctRows.map((row) => row.code))));
    } else {
      try {
        insertedAccounts = await tx.insert(accounts).values(ownedAcctRows).returning();
      } catch (err) {
        rethrowChartInsertError(err);
      }
    }
    const acctMap = Object.fromEntries(insertedAccounts.map((a) => [a.code, a.id]));
    if (!acctMap["3010"] || !acctMap["1010"]) {
      throw new Error("ایجاد نمودار حساب‌های اولیه کامل نشد.");
    }

    await ensureCategoryCatalog(tx);

    // Physical gold is manually valued. Legacy single-owner setup seeds a first
    // price (in USD, the price table's unit); tenants value it later.
    const goldPriceUsd = priceToBookUsd(amountOf(input.goldUnitPrice), input.goldPriceCurrency, setupRate);
    if (!userId && goldPriceUsd.gt(0) && assetMap.GOLD18) {
      await tx
        .insert(prices)
        .values({ assetId: assetMap.GOLD18, asOf: today, priceBase: goldPriceUsd.toString(), source: "manual" })
        .onConflictDoNothing();
    }

    // Opening balances — native quantities, USD base values computed here.
    const draftPostings: Array<{ accountId: string; assetId: string; quantity: string; baseValue: string; memo: string }> = [];
    const lotsToOpen: OpenLot[] = [];
    let totalOpeningEquityBase = Decimal.zero();

    if (amountOf(input.bankOpeningBalance).gt(0)) {
      const bank = await bookUsdFromAccountNative(tx, acctMap["1010"], input.bankOpeningBalance!, setupRate);
      draftPostings.push({ accountId: acctMap["1010"], assetId: bank.assetId, quantity: bank.quantity, baseValue: bank.baseValue, memo: "موجودی اولیه بانک" });
      totalOpeningEquityBase = totalOpeningEquityBase.add(bank.baseValue);
    }

    if (amountOf(input.cashOpeningBalance).gt(0)) {
      if (!acctMap["1020"]) throw new Error("حساب صندوق نقد برای ثبت موجودی اولیه ایجاد نشده است.");
      const cash = await bookUsdFromAccountNative(tx, acctMap["1020"], input.cashOpeningBalance!, setupRate);
      draftPostings.push({ accountId: acctMap["1020"], assetId: cash.assetId, quantity: cash.quantity, baseValue: cash.baseValue, memo: "موجودی اولیه نقد" });
      totalOpeningEquityBase = totalOpeningEquityBase.add(cash.baseValue);
    }

    for (const pick of tomanPlacePicks) {
      const accountId = acctMap[pick.code];
      if (!accountId || !amountOf(pick.balance).gt(0)) continue;
      const toman = await bookUsdFromAccountNative(tx, accountId, pick.balance!, setupRate);
      draftPostings.push({
        accountId,
        assetId: toman.assetId,
        quantity: toman.quantity,
        baseValue: toman.baseValue,
        memo: `موجودی اولیه ${holdingAccountName("تومان", pick.walletName)}`,
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(toman.baseValue);
    }

    for (const pick of cryptoPicks) {
      const accountId = acctMap[pick.code];
      const assetId = assetMap[pick.chosenCrypto.symbol];
      const qty = amountOf(pick.quantity);
      if (!accountId || !assetId || !qty.gt(0)) continue;
      const value = qty.mul(priceToBookUsd(amountOf(pick.unitPrice), pick.priceCurrency, setupRate));
      draftPostings.push({ accountId, assetId, quantity: qty.toString(), baseValue: value.toString(), memo: `موجودی اولیه ${pick.chosenCrypto.displayName}` });
      totalOpeningEquityBase = totalOpeningEquityBase.add(value);
      lotsToOpen.push({ accountId, assetId, quantity: qty.toString(), costBase: value.toString() });
    }

    const goldQty = amountOf(input.goldOpeningQty);
    if (goldQty.gt(0)) {
      const goldValue = goldQty.mul(goldPriceUsd);
      draftPostings.push({ accountId: acctMap["1300"], assetId: assetMap.GOLD18, quantity: goldQty.toString(), baseValue: goldValue.toString(), memo: "موجودی اولیه طلای ۱۸ عیار" });
      totalOpeningEquityBase = totalOpeningEquityBase.add(goldValue);
      lotsToOpen.push({ accountId: acctMap["1300"], assetId: assetMap.GOLD18, quantity: goldQty.toString(), costBase: goldValue.toString() });
    }

    /*
     * صندوق، سهام و والکس. Registration is DELEGATED to the same functions the
     * /funds registrar uses (catalogue name, asset class, tenant account), inside
     * this transaction. The money side stays in the single opening entry.
     */
    for (const instrument of input.instruments ?? []) {
      const symbol = instrument.symbol?.trim();
      if (!symbol) continue;

      const registered =
        instrument.kind === "wallex"
          ? await registerWallexAsset({ symbol, userId: user.id, tx: tx as unknown as typeof db })
          : await registerInstrument({
              kind: instrument.kind,
              symbol,
              name: instrument.name,
              userId: user.id,
              tx: tx as unknown as typeof db,
            });
      if (!registered.accountId) continue;

      const qty = amountOf(instrument.quantity);
      if (!qty.gt(0)) continue;

      const value = qty.mul(priceToBookUsd(amountOf(instrument.unitPrice), instrument.priceCurrency, setupRate));
      draftPostings.push({ accountId: registered.accountId, assetId: registered.assetId, quantity: qty.toString(), baseValue: value.toString(), memo: `موجودی اولیه ${registered.name}` });
      totalOpeningEquityBase = totalOpeningEquityBase.add(value);
      lotsToOpen.push({ accountId: registered.accountId, assetId: registered.assetId, quantity: qty.toString(), costBase: value.toString() });
    }

    if (draftPostings.length > 0) {
      const [equity] = await tx
        .select({ assetId: accounts.assetId })
        .from(accounts)
        .where(eq(accounts.id, acctMap["3010"]))
        .limit(1);
      draftPostings.push({
        accountId: acctMap["3010"],
        assetId: equity?.assetId ?? bookAssetId,
        quantity: totalOpeningEquityBase.neg().toString(),
        baseValue: totalOpeningEquityBase.neg().toString(),
        memo: "موازنه سرمایه افتتاحیه",
      });

      const opening = await postEntry(
        {
          entryDate: today,
          type: "opening",
          description: "افتتاحیه — ثبت موجودی اولیه حساب‌ها",
          source: "manual",
          userId: user.id,
          postings: draftPostings,
          openLots: lotsToOpen,
        },
        tx,
      );

      // Freeze the setup rate on the opening entry. The portfolio derives each
      // opening position's historical Toman cost from THIS snapshot; without it
      // every position opened here had no Toman cost at all.
      if (opening?.id && setupRate.gt(0)) {
        await tx
          .insert(entryFxSnapshots)
          .values({
            entryId: opening.id,
            irtAmount: totalOpeningEquityBase.mul(setupRate).toFixed(0),
            usdAmount: totalOpeningEquityBase.toString(),
            fxRate: setupRate.toString(),
            rateSource,
            rateDate: today,
          })
          .onConflictDoNothing();
      }
    }

    if (bankIdentifiers.length) {
      const bankAccount = insertedAccounts.find((account) => account.code === "1010");
      if (!bankAccount || bankAccount.userId !== user.id || bankAccount.name !== (input.bankAccountName?.trim() || "حساب بانکی اصلی") || bankAccount.assetId !== bankAssetId) throw new Error("حساب ثبت‌شده با حساب اتصال یکسان نیست.");
      await tx.insert(bankSmsIdentifiers).values(bankIdentifiers.map((identifier) => ({ userId: user.id, accountId: bankAccount.id, bankName: identifier.bankName, kind: identifier.kind, suffix: identifier.suffix }))).onConflictDoNothing();
    }
    await tx.insert(userSetupState).values({ userId: user.id, completed: true, currentStep: 7 });

    await tx.insert(auditLog).values({
      action: "complete_setup",
      entityType: "system",
      userId: user.id,
      payload: JSON.stringify({
        bookCurrency: "USD",
        displayCurrency: input.displayCurrency,
        fxRate: setupRate.toString(),
        rateSource,
        openingPostingsCount: draftPostings.length,
      }),
    });

    return {
      ok: true,
      message: "راه‌اندازی اولیه سیستم با موفقیت ثبت شد.",
      userId: user.id,
      today,
    };
  });

  /*
   * خودرو و ملک — registered AFTER the opening transaction has committed.
   *
   * `createUserVehicle` and `createRealEstateAsset` open their own transactions
   * and take no external handle; running them inside the wizard's transaction
   * would deadlock a single-connection driver. The accounts and opening balance
   * are already durable here, so a failed row is reported by name and added
   * later from «دارایی‌های واقعی» instead of failing the whole wizard.
   */
  const realAssetErrors: string[] = [];

  for (const vehicle of input.vehicles ?? []) {
    if (!vehicle.catalogId) continue;
    try {
      await createUserVehicle({
        userId: setupResult.userId,
        catalogId: vehicle.catalogId,
        manufacturingYear: Number(vehicle.manufacturingYear),
        ownershipDate: vehicle.ownershipDate,
        purchasePriceToman: vehicle.purchasePriceToman,
        initialValuation:
          vehicle.currentValueToman && D(vehicle.currentValueToman).gt(0)
            ? { valueToman: vehicle.currentValueToman, snapshotDate: setupResult.today, note: "ثبت اولیه در راه‌اندازی" }
            : undefined,
      });
    } catch (error) {
      realAssetErrors.push(`خودرو: ${error instanceof Error ? error.message : "ثبت ناموفق بود"}`);
    }
  }

  for (const property of input.properties ?? []) {
    if (!property.cityId || !property.neighborhoodId || !property.propertyTypeId) continue;
    // No current value given: the purchase price is a real valuation — of the
    // purchase day, so it is dated that day (never presented as today's value).
    const hasCurrentValue = Boolean(property.currentValueToman && D(property.currentValueToman).gt(0));
    try {
      await createRealEstateAsset({
        userId: setupResult.userId,
        cityId: property.cityId,
        neighborhoodId: property.neighborhoodId,
        propertyTypeId: property.propertyTypeId,
        acquisitionDate: property.acquisitionDate,
        valuationDate: hasCurrentValue ? setupResult.today : property.acquisitionDate,
        purchasePriceToman: property.purchasePriceToman,
        currentValueToman: hasCurrentValue ? (property.currentValueToman as string) : property.purchasePriceToman,
        sizeSqm: property.sizeSqm || null,
      });
    } catch (error) {
      realAssetErrors.push(`ملک: ${error instanceof Error ? error.message : "ثبت ناموفق بود"}`);
    }
  }

  if (realAssetErrors.length > 0) {
    return {
      ok: true,
      message: `${setupResult.message} اما ثبت ${realAssetErrors.length} مورد از خودرو/ملک ناموفق بود: ${realAssetErrors.join(" · ")} — می‌توانید آن‌ها را از «دارایی‌های واقعی» اضافه کنید.`,
    };
  }

  return { ok: setupResult.ok, message: setupResult.message };
}
