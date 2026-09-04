import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
  assets,
  auditLog,
  currencies,
  prices,
  settings,
  userSetupState,
  users,
} from "@/db/schema";
import { postEntry } from "@/features/ledger/service";
import { ensureCategoryCatalog } from "@/features/categories/service";
import { D, Decimal } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { rootCauseOf } from "@/db/init-schema";
import { requireSupportedCryptoBySymbol } from "@/features/pricing/supportedAssets";

/** Native units a cash/bank account may hold. Book currency stays USD. */
export const SETUP_MONEY_SYMBOLS = ["IRT", "USD", "USDT"] as const;
export type SetupMoneySymbol = (typeof SETUP_MONEY_SYMBOLS)[number];
const SETUP_MONEY_SYMBOL_SET = new Set<string>(SETUP_MONEY_SYMBOLS);
const SETUP_USDT = requireSupportedCryptoBySymbol("USDT");
const SETUP_BTC = requireSupportedCryptoBySymbol("BTC");
const SETUP_ETH = requireSupportedCryptoBySymbol("ETH");

export type SetupInput = {
  userName: string;
  baseCurrency: string; // Accounting currency (e.g. USD, EUR, IRR)
  displayCurrency: string; // User display currency (e.g. USD, IRT, EUR)
  dateCalendar: "jalali" | "gregorian";
  digitStyle: "fa" | "en";
  bankAccountName?: string;
  cashWalletName?: string;
  /** Native denomination of the bank account (IRT | USD | USDT). */
  bankAssetSymbol?: string;
  /** Native denomination of the cash wallet (IRT | USD | USDT). */
  cashAssetSymbol?: string;
  /** Native quantity in the bank account's own unit — never book USD. */
  bankOpeningBalance?: string;
  /** Native quantity in the cash account's own unit — never book USD. */
  cashOpeningBalance?: string;
  cryptoOpeningQty?: string;
  cryptoUnitPrice?: string; // Price in base currency
  goldOpeningQty?: string; // in grams
  goldUnitPrice?: string; // Price per gram in base currency
};

/**
 * Translate the two known Chart-of-Accounts insert failures into an
 * operator-facing message. The accounting core is not involved — this is
 * only the setup write of header/leaf account *metadata*.
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

function resolveMoneyDenomination(explicit: string | undefined, fallback: string): SetupMoneySymbol {
  const candidate = (explicit || fallback || "USD").toUpperCase();
  if (SETUP_MONEY_SYMBOL_SET.has(candidate)) return candidate as SetupMoneySymbol;
  return "USD";
}

/**
 * Server-authoritative conversion: read the persisted account's assetId,
 * interpret `nativeQty` in that unit, and compute USD `base_value`.
 * Client labels / claimed book values are ignored.
 * Mirrors `registerMoneyAccount` for opening book value (IRT ÷ current
 * USD→IRT rate; USD/USDT = 1). Live USDT valuation remains CoinGecko-based.
 */
async function bookUsdFromAccountNative(
  tx: any,
  accountId: string,
  nativeQtyInput: string,
  userId: string | undefined,
): Promise<{ assetId: string; quantity: string; baseValue: string; symbol: string }> {
  const qty = D(nativeQtyInput);
  if (qty.isNegative()) throw new Error("موجودی اولیه نمی‌تواند منفی باشد.");

  const [row] = await tx
    .select({
      assetId: accounts.assetId,
      symbol: assets.symbol,
    })
    .from(accounts)
    .innerJoin(assets, eq(assets.id, accounts.assetId))
    .where(eq(accounts.id, accountId))
    .limit(1);

  if (!row?.assetId || !row.symbol) {
    throw new Error("حساب انتخاب‌شده واحد بومی (assetId) ندارد.");
  }

  let unitPriceUsd = D("1");
  if (row.symbol === "IRT") {
    const fx = await getLatestUsdIrtRateForUser(userId, tx);
    const usdIrtRate = D(fx.rate);
    if (usdIrtRate.lte(0)) throw new Error("نرخ تبدیل دلار به تومان معتبر نیست.");
    unitPriceUsd = D("1").div(usdIrtRate);
  }

  return {
    assetId: row.assetId,
    symbol: row.symbol,
    quantity: qty.toString(),
    baseValue: qty.mul(unitPriceUsd).toString(),
  };
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

/**
 * Setup Wizard Orchestrator
 *
 * Enforces:
 * - Duplicate prevention (throws if setup is already completed).
 * - All financial mutations go strictly through postEntry() — never direct SQL inserts to ledger.
 * - Accounting Currency and Display Currency remain separate.
 * - Clean onboarding without demo transactions.
 */
export async function completeSetup(
  input: SetupInput,
  /** When supplied, setup is isolated to this existing authenticated tenant. */
  userId?: string,
): Promise<{ ok: boolean; message: string }> {
  // 1. Prevent duplicate setup in the relevant tenant scope.
  const existingState = await getSetupState(userId);
  if (existingState.completed) {
    throw new Error("راه‌اندازی اولیه قبلاً انجام شده است.");
  }

  return db.transaction(async (tx) => {
    const today = todayIso();

    // 2. Configure shared reference data idempotently. Per-user onboarding may
    // run after another tenant has already populated part of these catalogs;
    // inserting only when an entire table is empty would leave required rows
    // (for example IRR or GOLD18) missing.
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

    // 3. Configure Reference Asset Classes
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

    // 4. Configure Reference Assets
    const requiredAssets = new Map(
      [
        {
          symbol: input.baseCurrency,
          name: `${input.baseCurrency} (ارز پایه)`,
          classId: clsMap.cash,
          currencyId: curMap[input.baseCurrency] ?? curMap.USD,
          decimals: input.baseCurrency === "IRT" || input.baseCurrency === "IRR" ? 0 : 2,
        },
        // Account/wallet denominations are always available, regardless of the
        // accounting base currency selected above.
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
        { symbol: "GOLD18", name: "طلای ۱۸ عیار (گرم)", classId: clsMap.gold, decimals: 3 },
      ].map((asset) => [asset.symbol, asset]),
    );
    await tx.insert(assets).values([...requiredAssets.values()]).onConflictDoNothing();

    // Older setup/runtime paths could leave these shared asset identities with
    // default manual pricing. Reconcile pricing metadata only; never touch an
    // account, journal, posting, quantity, lot, cost basis or snapshot.
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

    // 5. User resolution & settings storage. Authenticated setup configures
    // the existing session tenant; legacy single-tenant setup keeps the
    // original bootstrap behavior of creating its first owner.
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

    const configItems = [
      { key: "base_currency", value: input.baseCurrency },
      { key: "display_currency", value: input.displayCurrency },
      { key: "date_calendar", value: input.dateCalendar },
      { key: "digit_style", value: input.digitStyle },
    ];

    // `settings` is a legacy global table. Never let one authenticated tenant
    // overwrite another tenant's presentation preferences. The legacy
    // single-owner bootstrap still persists these values as before.
    if (!userId) {
      for (const cfg of configItems) {
        await tx
          .insert(settings)
          .values(cfg)
          .onConflictDoUpdate({ target: settings.key, set: { value: cfg.value } });
      }
    }

    // 6. Chart of Accounts Creation
    const baseAssetId = assetMap[input.baseCurrency] ?? assetMap.USD;
    // Book / functional currency is always USD. Account denomination
    // (native holding unit) is independent and lives on accounts.assetId.
    const bookAssetId = assetMap.USD ?? baseAssetId;
    const bankDenom = resolveMoneyDenomination(input.bankAssetSymbol, input.baseCurrency);
    const cashDenom = resolveMoneyDenomination(input.cashAssetSymbol, input.baseCurrency);
    const bankAssetId = assetMap[bankDenom] ?? bookAssetId;
    const cashAssetId = assetMap[cashDenom] ?? bookAssetId;
    // Only the bank account is mandatory during onboarding. A cash box is
    // provisioned only when the user explicitly names it or funds it; otherwise
    // they can add one later from the Accounts module. The ETH / gold accounts
    // stay as zero-balance containers because the buy/sell asset flows need a
    // destination account — they are invisible until actually funded.
    const wantsCashWallet = Boolean(
      input.cashWalletName?.trim() || (input.cashOpeningBalance && D(input.cashOpeningBalance).gt(0)),
    );
    const acctRows = [
      { code: "1000", name: "دارایی‌ها", type: "asset" },
      { code: "1010", name: input.bankAccountName?.trim() || "حساب بانکی اصلی", type: "asset", assetId: bankAssetId },
      ...(wantsCashWallet
        ? [{ code: "1020", name: input.cashWalletName?.trim() || "صندوق نقد", type: "asset", assetId: cashAssetId }]
        : []),
      { code: "1200", name: "کیف رمزارز (ETH)", type: "asset", assetId: assetMap.ETH },
      { code: "1300", name: "طلای ۱۸ عیار", type: "asset", assetId: assetMap.GOLD18 },
      { code: "2000", name: "بدهی‌ها", type: "liability" },
      { code: "2010", name: "وام / بدهی عمومی", type: "liability", assetId: baseAssetId },
      { code: "3000", name: "سرمایه", type: "equity" },
      { code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: bookAssetId },
      // Non-cash reserve: counter account of depreciation / reserve expense
      // entries (nature = non_cash) so no cash account ever moves.
      { code: "3200", name: "ذخیره استهلاک و تعمیرات آتی", type: "equity", assetId: baseAssetId },
      { code: "4000", name: "درآمدها", type: "income" },
      { code: "4010", name: "حقوق و درآمد", type: "income", assetId: baseAssetId },
      { code: "4100", name: "سود سرمایه‌ای تحقق‌یافته", type: "income", assetId: baseAssetId },
      { code: "4900", name: "درآمد متفرقه", type: "income", assetId: baseAssetId },
      { code: "5000", name: "هزینه‌ها", type: "expense" },
      { code: "5010", name: "خوراک و خانه", type: "expense", assetId: baseAssetId },
      { code: "5020", name: "مسکن و اجاره", type: "expense", assetId: baseAssetId },
      { code: "5030", name: "حمل‌ونقل", type: "expense", assetId: baseAssetId },
      // FEE ACCOUNT — NOT optional. The buy/sell entry builders debit the
      // commission here; when the row is absent the entry cannot balance and
      // the whole transaction fails («سند تراز نیست» — audit F-02). It must
      // therefore be part of the chart created at setup, for every tenant.
      { code: "5040", name: "کارمزد و بانک", type: "expense", assetId: baseAssetId },
      { code: "5050", name: "سفر و رویداد", type: "expense", assetId: baseAssetId },
      { code: "5900", name: "هزینه متفرقه", type: "expense", assetId: baseAssetId },
    ];

    const ownedAcctRows = acctRows.map((row) => ({ ...row, userId: userId ?? null }));
    let insertedAccounts: Array<typeof accounts.$inferSelect>;
    if (userId) {
      // A user may have added a wallet before opening this now-visible wizard.
      // Keep any existing baseline code (notably lazily provisioned 3010) and
      // fill only the missing chart rows. Look up first so we do not depend
      // on ON CONFLICT (user_id, code) — that target is missing on some
      // legacy databases and produces the same "Failed query: insert into
      // accounts" wrapper as a NOT NULL violation on header rows.
      for (const row of ownedAcctRows) {
        const [existing] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.userId, userId), eq(accounts.code, row.code)))
          .limit(1);
        if (existing) continue;
        // Wrap each insert in a SAVEPOINT (drizzle nested tx.transaction).
        // A duplicate-key failure (23505) must NOT abort the whole setup
        // transaction: continuing to run the next statement on an aborted
        // transaction would surface the misleading "current transaction is
        // aborted" error and hide the real cause (the duplicate). Rolling back
        // to the savepoint leaves the outer transaction fully usable, so the
        // subsequent account rows and the opening entry still commit.
        try {
          await tx.transaction(async (sp) => {
            await sp.insert(accounts).values(row);
          });
        } catch (err) {
          const root = rootCauseOf(err);
          if (root.code === "23505") {
            // Savepoint already rolled back; the outer transaction is usable.
            // A duplicate only legitimately means this tenant already owns the
            // row (e.g. a concurrent provisioning race). Re-check — if it is
            // really present for this user, skip; otherwise it is a real
            // cross-tenant conflict (legacy global UNIQUE(code)) and must not
            // be silently ignored.
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

    // Standard hierarchical expense category catalog (reporting dimension).
    // Idempotent; runs inside the setup transaction.
    await ensureCategoryCatalog(tx);

    // 7. Physical gold is a manually valued real asset. The crypto unit price
    // entered above is purchase/cost information only (used by the opening
    // journal/FIFO lot below) and is deliberately NOT stored as a current
    // crypto price. Current ETH price comes only from CoinGecko.
    if (!userId && input.goldUnitPrice && D(input.goldUnitPrice).gt(0) && assetMap.GOLD18) {
      await tx
        .insert(prices)
        .values({
          assetId: assetMap.GOLD18,
          asOf: today,
          priceBase: D(input.goldUnitPrice).toString(),
          source: "manual",
        })
        .onConflictDoNothing();
    }

    // 8. Opening Balances Entry Creation
    // Cash/bank quantities are native units of accounts.assetId. Server
    // computes USD base_value. Do not trust client currency labels.
    // Cash/bank openings never open FIFO lots.
    const draftPostings = [];
    let totalOpeningEquityBase = Decimal.zero();

    // Bank Opening Balance — interpret in the persisted account denomination.
    if (input.bankOpeningBalance && D(input.bankOpeningBalance).gt(0)) {
      const bank = await bookUsdFromAccountNative(tx, acctMap["1010"], input.bankOpeningBalance, user.id);
      draftPostings.push({
        accountId: acctMap["1010"],
        assetId: bank.assetId,
        quantity: bank.quantity,
        baseValue: bank.baseValue,
        memo: "موجودی اولیه بانک",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(bank.baseValue);
    }

    // Cash Opening Balance — interpret in the persisted account denomination.
    if (input.cashOpeningBalance && D(input.cashOpeningBalance).gt(0)) {
      if (!acctMap["1020"]) throw new Error("حساب صندوق نقد برای ثبت موجودی اولیه ایجاد نشده است.");
      const cash = await bookUsdFromAccountNative(tx, acctMap["1020"], input.cashOpeningBalance, user.id);
      draftPostings.push({
        accountId: acctMap["1020"],
        assetId: cash.assetId,
        quantity: cash.quantity,
        baseValue: cash.baseValue,
        memo: "موجودی اولیه نقد",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(cash.baseValue);
    }

    // Crypto Opening Balance
    let ethLotInfo: { accountId: string; assetId: string; quantity: string; costBase: string } | undefined;
    if (input.cryptoOpeningQty && D(input.cryptoOpeningQty).gt(0)) {
      const ethQty = D(input.cryptoOpeningQty);
      const ethPrice = D(input.cryptoUnitPrice || "0");
      const ethValue = ethQty.mul(ethPrice);
      draftPostings.push({
        accountId: acctMap["1200"],
        assetId: assetMap.ETH,
        quantity: ethQty.toString(),
        baseValue: ethValue.toString(),
        memo: "موجودی اولیه اتریوم",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(ethValue);
      ethLotInfo = {
        accountId: acctMap["1200"],
        assetId: assetMap.ETH,
        quantity: ethQty.toString(),
        costBase: ethValue.toString(),
      };
    }

    // Gold Opening Balance
    let goldLotInfo: { accountId: string; assetId: string; quantity: string; costBase: string } | undefined;
    if (input.goldOpeningQty && D(input.goldOpeningQty).gt(0)) {
      const goldQty = D(input.goldOpeningQty);
      const goldPrice = D(input.goldUnitPrice || "0");
      const goldValue = goldQty.mul(goldPrice);
      draftPostings.push({
        accountId: acctMap["1300"],
        assetId: assetMap.GOLD18,
        quantity: goldQty.toString(),
        baseValue: goldValue.toString(),
        memo: "موجودی اولیه طلای ۱۸ عیار",
      });
      totalOpeningEquityBase = totalOpeningEquityBase.add(goldValue);
      goldLotInfo = {
        accountId: acctMap["1300"],
        assetId: assetMap.GOLD18,
        quantity: goldQty.toString(),
        costBase: goldValue.toString(),
      };
    }

    // Balance against Opening Balance Equity (3010) in book USD.
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

      const lotsToOpen = [];
      if (ethLotInfo) lotsToOpen.push(ethLotInfo);
      if (goldLotInfo) lotsToOpen.push(goldLotInfo);

      // Post single atomic opening entry strictly via postEntry()
      await postEntry(
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
    }

    // 9. Mark setup as completed in user_setup_state
    await tx.insert(userSetupState).values({
      userId: user.id,
      completed: true,
      currentStep: 4,
    });

    // 10. Audit Log
    await tx.insert(auditLog).values({
      action: "complete_setup",
      entityType: "system",
      userId: user.id,
      payload: JSON.stringify({
        baseCurrency: input.baseCurrency,
        displayCurrency: input.displayCurrency,
        openingPostingsCount: draftPostings.length,
      }),
    });

    return { ok: true, message: "راه‌اندازی اولیه سیستم با موفقیت ثبت شد." };
  });
}
