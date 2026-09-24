/**
 * Money Account Registration Service
 *
 * Registers a user-defined bank account / cash box / wallet together with its
 * opening balance, as ONE atomic operation:
 *
 *   1. a `wallets` row (the user-facing container/label, always user-owned);
 *   2. an `accounts` row of type "asset" linked to that wallet (the ledger
 *      account that actually appears in "پرداخت از حساب" and the chart of
 *      accounts);
 *   3. when an opening balance is supplied, a single double-entry `opening`
 *      journal entry posted through the SAME `postEntry` write path used by the
 *      setup wizard and the demo seed — balanced against the opening-equity
 *      account (code 3010), so the ledger control sum stays zero.
 *
 * INVARIANTS (never violated by this module):
 *   - The accounting core (`postEntry`, FIFO, `assertBalanced`) is invoked
 *     unchanged. This service only PREPARES inputs for it.
 *   - No balance column is ever written; balances remain derived from postings.
 *   - Every row is scoped to the session user (`userId`) so no other tenant can
 *     see or use these accounts (matching the existing multi-user isolation).
 *   - The shared `institutions` reference table is deliberately NOT touched —
 *     a user's bank name lives only in `wallets.name` / `accounts.name`, which
 *     are user-scoped. (This is the isolated interpretation of "don't store the
 *     bank name globally".)
 */
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  funds,
  goals,
  journalEntries,
  plannedTransactions,
  postings,
  wallets,
} from "@/db/schema";
import { postEntry, reverseEntry } from "@/features/ledger/service";
import { recordAuditEvent } from "@/lib/audit";
import { assertRealUsdIrtRate, getLatestUsdIrtRateForUser } from "@/lib/fx";
import { D } from "@/domain/decimal";
import { formatMoney, todayIso } from "@/lib/format";
import { requireSupportedCryptoBySymbol } from "@/features/pricing/supportedAssets";
import { canonicalWalletName, moneyPlaceError } from "@/features/setup/holdingWallets";

/** `insurance`: the savings (اندوخته) of a life policy — opened only by «بیمه‌نامه‌ها», never offered in the account forms. */
export const WALLET_KINDS = ["bank", "cash", "exchange", "broker", "hot", "cold", "fund", "insurance"] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

/**
 * The account-registration module is for monetary containers only. Real
 * estate, vehicles, gold, shares and volatile crypto are registered through
 * their dedicated modules / transaction asset picker, never as the currency
 * denomination of a bank account or cash box.
 */
export const MONEY_ACCOUNT_CURRENCY_SYMBOLS = ["IRT", "USD", "USDT"] as const;
export type MoneyAccountCurrencySymbol = (typeof MONEY_ACCOUNT_CURRENCY_SYMBOLS)[number];
const MONEY_ACCOUNT_USDT = requireSupportedCryptoBySymbol("USDT");
const MONEY_ACCOUNT_CURRENCY_SET = new Set<string>(MONEY_ACCOUNT_CURRENCY_SYMBOLS);

/** Account code of the opening-equity account that balances opening entries. */
export const OPENING_EQUITY_CODE = "3010";

export type RegisterMoneyAccountInput = {
  name: string;
  kind: WalletKind;
  /** Reference id of exactly one supported currency: IRT, USD or USDT. */
  assetId: string;
  /**
   * The exchange, brokerage or wallet the money is held at, from the place
   * catalogue («بیت‌پین», «کارگزاری مفید»). One place is one wallet.
   */
  placeName?: string;
  /** Opening balance in the selected currency's own unit. */
  openingQty?: string;
  /** ISO date of the opening entry; defaults to today. */
  openingDate?: string;
  note?: string;
  /** Tenant owner — always taken from the session at the action boundary. */
  userId?: string;
};

export type RegisterMoneyAccountResult = {
  ok: boolean;
  message: string;
  walletId?: string;
  accountId?: string;
  accountCode?: string;
  entryId?: string;
  baseValue?: string;
};

export type MoneyAccountCurrencyOption = {
  id: string;
  symbol: MoneyAccountCurrencySymbol;
  name: string;
  decimals: number;
};

/**
 * Idempotent reference-data repair for old installations that have a currency
 * row for IRT but no corresponding IRT asset row. It writes catalog metadata
 * only — never accounts, journals, postings, balances, prices or FIFO lots.
 */
export async function ensureMoneyAccountCurrencyCatalog(txClient?: any): Promise<void> {
  const run = async (tx: any) => {
    await tx
      .insert(currencies)
      .values([
        { code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true },
        { code: "IRT", name: "تومان", symbol: "تومان", decimals: 0, isFiat: true },
      ])
      .onConflictDoNothing();
    await tx
      .insert(assetClasses)
      .values([
        { code: "cash", name: "نقد و بانک", color: "#6e6ff0", sortOrder: 1 },
        { code: "stable", name: "استیبل‌کوین", color: "#9ea1f6", sortOrder: 2 },
      ])
      .onConflictDoNothing();

    const [currencyRows, classRows] = await Promise.all([
      tx.select({ id: currencies.id, code: currencies.code }).from(currencies),
      tx.select({ id: assetClasses.id, code: assetClasses.code }).from(assetClasses),
    ]);
    const currencyByCode = Object.fromEntries(currencyRows.map((row: { id: string; code: string }) => [row.code, row.id]));
    const classByCode = Object.fromEntries(classRows.map((row: { id: string; code: string }) => [row.code, row.id]));
    if (!currencyByCode.USD || !currencyByCode.IRT || !classByCode.cash || !classByCode.stable) {
      throw new Error("کاتالوگ ارزهای حساب کامل نیست.");
    }

    await tx
      .insert(assets)
      .values([
        {
          symbol: "IRT",
          name: "تومان",
          classId: classByCode.cash,
          currencyId: currencyByCode.IRT,
          decimals: 0,
          pricingMethod: "manual",
        },
        {
          symbol: "USD",
          name: "دلار آمریکا",
          classId: classByCode.cash,
          currencyId: currencyByCode.USD,
          decimals: 2,
          pricingMethod: "face_value",
        },
        {
          symbol: MONEY_ACCOUNT_USDT.symbol,
          name: "تتر",
          classId: classByCode.stable,
          decimals: 6,
          pricingMethod: "coingecko",
          priceSource: "coingecko",
          coingeckoId: MONEY_ACCOUNT_USDT.coingeckoId,
          logoUrl: MONEY_ACCOUNT_USDT.logoUrl,
        },
      ])
      .onConflictDoUpdate({
        target: assets.symbol,
        // Migration 0013 replaced the plain unique constraint on `symbol` with
        // a PARTIAL unique index (`where deleted_at is null`). PostgreSQL only
        // matches a conflict target to a partial index when the statement
        // repeats the predicate, so a bare `ON CONFLICT (symbol)` raised
        // "no unique or exclusion constraint matching the ON CONFLICT
        // specification" and every account-catalog bootstrap threw — which is
        // why the accounts module failed to render.
        // This aligns the query with the index that actually exists; the
        // uniqueness rule, the rows and every accounting value are unchanged.
        targetWhere: isNull(assets.deletedAt),
        set: {
          isActive: true,
          deletedAt: null,
          updatedAt: new Date(),
          // Reconcile pricing identity only; quantities, accounts, postings,
          // FIFO lots and all accounting values remain untouched.
          pricingMethod: sql`excluded.pricing_method`,
          priceSource: sql`excluded.price_source`,
          coingeckoId: sql`excluded.coingecko_id`,
          logoUrl: sql`coalesce(excluded.logo_url, ${assets.logoUrl})`,
        },
      });
  };

  if (txClient) return run(txClient);
  await db.transaction(run);
}

/** The exact three currency options allowed in the account form. */
export async function listMoneyAccountCurrencies(): Promise<MoneyAccountCurrencyOption[]> {
  await ensureMoneyAccountCurrencyCatalog();
  const rows = await db
    .select({ id: assets.id, symbol: assets.symbol, name: assets.name, decimals: assets.decimals })
    .from(assets)
    .where(
      and(
        inArray(assets.symbol, [...MONEY_ACCOUNT_CURRENCY_SYMBOLS]),
        isNull(assets.deletedAt),
        eq(assets.isActive, true),
      ),
    )
    .orderBy(sql`case ${assets.symbol} when 'IRT' then 1 when 'USD' then 2 when 'USDT' then 3 else 4 end`);
  if (rows.length !== MONEY_ACCOUNT_CURRENCY_SYMBOLS.length) {
    throw new Error("فهرست ارزهای حساب باید شامل تومان، دلار و تتر باشد.");
  }
  const displayNames: Record<MoneyAccountCurrencySymbol, string> = {
    IRT: "تومان",
    USD: "دلار آمریکا",
    USDT: "تتر",
  };
  return rows.map((row) => ({
    ...row,
    symbol: row.symbol as MoneyAccountCurrencySymbol,
    name: displayNames[row.symbol as MoneyAccountCurrencySymbol],
  }));
}

/** Finds a base (USD) asset id for the equity leg of the opening entry. */
async function findBaseAssetId(tx: any): Promise<string> {
  for (const symbol of ["USD", "IRT"]) {
    const [row] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.symbol, symbol), isNull(assets.deletedAt)))
      .limit(1);
    if (row?.id) return row.id;
  }
  const [any] = await tx.select({ id: assets.id }).from(assets).where(isNull(assets.deletedAt)).limit(1);
  if (!any?.id) throw new Error("هیچ دارایی پایه‌ای یافت نشد؛ ابتدا راه‌اندازی اولیه را کامل کنید.");
  return any.id;
}

/**
 * Finds or provisions the bookkeeping prerequisite used to balance an opening
 * balance. Provisioning this chart-of-accounts row does not write a journal,
 * posting, balance, or FIFO lot; it merely removes the circular requirement
 * that a user must already have completed a hidden setup wizard before adding
 * their first bank account.
 *
 * Authenticated tenants receive their own 3010 so opening balances can never
 * collide across users. A legacy shared 3010 remains valid only in the
 * original unauthenticated single-tenant mode.
 */
async function ensureOpeningEquityAccount(
  tx: any,
  userId?: string,
): Promise<{ id: string; assetId: string | null }> {
  const ownership = userId
    ? eq(accounts.userId, userId)
    : isNull(accounts.userId);

  const lookup = async () =>
    tx
      .select({
        id: accounts.id,
        type: accounts.type,
        assetId: accounts.assetId,
        userId: accounts.userId,
        isActive: accounts.isActive,
        deletedAt: accounts.deletedAt,
      })
      .from(accounts)
      .where(and(eq(accounts.code, OPENING_EQUITY_CODE), ownership))
      .limit(1);

  let [equity] = await lookup();
  if (equity) {
    if (equity.type !== "equity") {
      throw new Error("کد 3010 قبلاً برای حسابی غیر از سرمایه افتتاحیه استفاده شده است.");
    }
    if (!equity.isActive || equity.deletedAt) {
      [equity] = await tx
        .update(accounts)
        .set({ isActive: true, deletedAt: null, updatedAt: new Date() })
        .where(eq(accounts.id, equity.id))
        .returning({ id: accounts.id, assetId: accounts.assetId });
    }
    return { id: equity.id, assetId: equity.assetId };
  }

  const baseAssetId = await findBaseAssetId(tx);
  const [created] = await tx
    .insert(accounts)
    .values({
      userId: userId ?? null,
      code: OPENING_EQUITY_CODE,
      name: "سرمایه افتتاحیه",
      type: "equity",
      assetId: baseAssetId,
      isActive: true,
    })
    // For authenticated tenants this resolves a concurrent first-account
    // registration through accounts_user_code_uq without aborting the TX.
    .onConflictDoNothing()
    .returning({ id: accounts.id, assetId: accounts.assetId });

  if (created) return created;
  [equity] = await lookup();
  if (!equity || equity.type !== "equity") {
    throw new Error("ایجاد حساب «سرمایه افتتاحیه» (3010) ناموفق بود.");
  }
  return { id: equity.id, assetId: equity.assetId };
}

/**
 * Generates a numeric, tenant-unique asset account code (1xxx range) by taking
 * the highest existing numeric asset code visible to the user (their own plus
 * shared/global rows) and incrementing. Uniqueness is per (userId, code), which
 * the schema's `accounts_user_code_uq` index enforces.
 */
async function nextAssetCode(tx: any, userId?: string): Promise<string> {
  const res = await tx.execute(sql`
    select coalesce(max(case when code ~ '^[0-9]+$' then code::bigint else 0 end), 0)::bigint as m
    from accounts
    where type = 'asset' and deleted_at is null
      and (user_id is null or user_id = ${userId ?? null})
  `);
  const m = Number((res.rows[0] as { m?: string | number } | undefined)?.m ?? 0);
  return String(Math.max(m, 1600) + 10);
}

export async function registerMoneyAccount(
  input: RegisterMoneyAccountInput,
  txClient?: any,
): Promise<RegisterMoneyAccountResult> {
  const name = input.name?.trim();
  if (!name || name.length < 2) throw new Error("نام حساب را وارد کنید (حداقل ۲ حرف).");
  if (!WALLET_KINDS.includes(input.kind)) throw new Error("نوع حساب معتبر نیست.");
  if (!input.assetId) throw new Error("ارز حساب را انتخاب کنید.");

  const run = async (tx: any) => {
    // 1. The denomination must be exactly IRT, USD or USDT. Filtering only in
    // the browser would be bypassable, so the service boundary enforces it too.
    const [asset] = await tx
      .select({ id: assets.id, symbol: assets.symbol, name: assets.name })
      .from(assets)
      .where(and(eq(assets.id, input.assetId), isNull(assets.deletedAt), eq(assets.isActive, true)))
      .limit(1);
    if (!asset || !MONEY_ACCOUNT_CURRENCY_SET.has(asset.symbol)) {
      throw new Error("ارز حساب فقط می‌تواند تومان (IRT)، دلار (USD) یا تتر (USDT) باشد.");
    }
    const placeError = moneyPlaceError(input.kind, asset.symbol, input.placeName);
    if (placeError) throw new Error(placeError);

    // 2. Historical USD value is deterministic and not client-editable:
    // Opening book value: USD/USDT = 1 USD; IRT uses the tenant FX rate.
    // This accounting input does not replace USDT's live CoinGecko valuation.
    let unitPriceUsd = D("1");
    const hasOpening = !!input.openingQty && !D(input.openingQty).isZero();
    if (asset.symbol === "IRT" && hasOpening) {
      // The opening balance freezes this rate: never the placeholder. An
      // account opened at zero freezes nothing and needs no rate.
      const fx = assertRealUsdIrtRate(await getLatestUsdIrtRateForUser(input.userId, tx));
      const usdIrtRate = D(fx.rate);
      if (usdIrtRate.lte(0)) throw new Error("نرخ تبدیل دلار به تومان معتبر نیست.");
      unitPriceUsd = D("1").div(usdIrtRate);
    }

    // 3. Opening quantity (optional → zero-balance account, no opening entry).
    const openingQty = input.openingQty ? D(input.openingQty) : D("0");
    if (openingQty.isNegative()) throw new Error("موجودی اولیه نمی‌تواند منفی باشد.");
    const baseValue = openingQty.mul(unitPriceUsd);

    // 4. Wallet (user-owned container; shared `institutions` is NOT touched).
    // A picked place is stored under its catalogue name, so the trade rules
    // recognise «تومان - بیت‌پین» as Toman at an Iranian exchange, and the same
    // place is one wallet holding several currencies.
    const placeName = input.placeName ? canonicalWalletName(input.placeName) : "";
    let wallet: typeof wallets.$inferSelect | undefined;
    if (placeName) {
      [wallet] = await tx
        .select()
        .from(wallets)
        .where(
          and(
            input.userId ? eq(wallets.userId, input.userId) : isNull(wallets.userId),
            eq(wallets.name, placeName),
            isNull(wallets.deletedAt),
          ),
        )
        .limit(1);
      if (wallet) {
        const [taken] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.walletId, wallet.id), eq(accounts.assetId, input.assetId), isNull(accounts.deletedAt)))
          .limit(1);
        if (taken) throw new Error(`حساب ${asset.name} در «${placeName}» از قبل ثبت شده است.`);
      }
    }
    if (!wallet) {
      [wallet] = await tx
        .insert(wallets)
        .values({
          userId: input.userId ?? null,
          name: placeName || name,
          kind: input.kind,
          institutionId: null,
          networkId: null,
          address: null,
          note: input.note?.trim() || null,
        })
        .returning();
    }
    if (!wallet) throw new Error("ایجاد کیف پول ناموفق بود.");

    // 5. Ledger account (asset type) linked to the wallet. The insert is
    // conflict-tolerant so two simultaneous registrations for the same tenant
    // cannot accidentally receive the same code. The loser recomputes after
    // the winner commits; every wallet therefore remains a distinct account.
    let account: typeof accounts.$inferSelect | undefined;
    let code = "";
    for (let attempt = 0; attempt < 8 && !account; attempt++) {
      code = await nextAssetCode(tx, input.userId);
      [account] = await tx
        .insert(accounts)
        .values({
          userId: input.userId ?? null,
          code,
          name,
          type: "asset",
          assetId: input.assetId,
          walletId: wallet.id,
          isActive: true,
        })
        .onConflictDoNothing()
        .returning();
    }
    if (!account) throw new Error("ایجاد کد یکتای حساب ناموفق بود؛ دوباره تلاش کنید.");

    // 6. Opening entry — strictly through postEntry (core write path).
    let entryId: string | undefined;
    if (baseValue.gt(0)) {
      // The chart prerequisite is safe to provision lazily: it creates only
      // account metadata. The actual opening balance still goes exclusively
      // through the unchanged postEntry/FIFO path below.
      const equity = await ensureOpeningEquityAccount(tx, input.userId);
      const equityAssetId = equity.assetId ?? (await findBaseAssetId(tx));
      const qtyStr = openingQty.toString();
      const baseStr = baseValue.toString();

      const result = await postEntry(
        {
          entryDate: input.openingDate || todayIso(),
          type: "opening",
          description: `افتتاحیه — ${name}`,
          source: "manual",
          userId: input.userId,
          postings: [
            {
              accountId: account.id,
              assetId: input.assetId,
              quantity: qtyStr,
              baseValue: baseStr,
              memo: "موجودی اولیه",
            },
            {
              accountId: equity.id,
              assetId: equityAssetId,
              quantity: D(baseStr).neg().toString(),
              baseValue: D(baseStr).neg().toString(),
              memo: "موازنه سرمایه افتتاحیه",
            },
          ],
          // Monetary balances do not create FIFO lots. FIFO remains exclusively
          // on the existing buy/sell asset flow and is not modified here.
          openLots: undefined,
        },
        tx,
      );
      entryId = result.id;
    }

    await recordAuditEvent(
      {
        action: "CREATE_MONEY_ACCOUNT",
        entityType: "money_account",
        entityId: account.id,
        userId: input.userId ?? null,
        result: "SUCCESS",
        payload: {
          kind: input.kind,
          code,
          assetSymbol: asset.symbol,
          openingQty: openingQty.toString(),
          baseValue: baseValue.toString(),
        },
      },
      tx,
    );

    return {
      ok: true,
      message: baseValue.gt(0)
        ? `حساب «${name}» با موجودی اولیه ایجاد شد و به دفترکل متصل شد.`
        : `حساب «${name}» (بدون موجودی اولیه) ایجاد شد و آماده‌ی ثبت تراکنش است.`,
      walletId: wallet.id,
      accountId: account.id,
      accountCode: code,
      entryId,
      baseValue: baseValue.toString(),
    };
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}

/* ------------------------------------------------------------------ */
/* Money-account DELETION                                              */
/*                                                                     */
/* A user registers an account by mistake, or their bank suspends /    */
/* blocks it, and they want it gone. The ledger is immutable, so       */
/* "delete" here means exactly one of two honest outcomes, decided by  */
/* the account's own history — never a silent rewrite of the books:    */
/*                                                                     */
/*   • «full»    — the ONLY posted entry touching the account is the   */
/*                 standalone opening entry `registerMoneyAccount`     */
/*                 wrote for it. That entry is REVERSED through the    */
/*                 unchanged `reverseEntry` core path, which returns   */
/*                 both legs (the account and opening equity) to zero, */
/*                 and the account disappears with no trace in net     */
/*                 worth. This is the "created by mistake" case.       */
/*                                                                     */
/*   • «archive» — the account carries real history, but its balance   */
/*                 is already zero. The account row is soft-deleted;   */
/*                 every journal entry, posting and lot stays exactly  */
/*                 as it was, so past reports are unchanged. This is   */
/*                 the "the bank closed it, I moved the money out"     */
/*                 case.                                               */
/*                                                                     */
/* Anything else is REFUSED with the reason, because the alternative   */
/* is money vanishing from net worth: `getAccountBalances` filters     */
/* `deleted_at is null`, so hiding an account that still holds a       */
/* balance would both lose the balance and break the Σ = 0 control     */
/* sum the accounts page asserts.                                      */
/* ------------------------------------------------------------------ */

/**
 * Chart rows the app itself resolves by CODE (fee, P&L, opening equity,
 * depreciation reserve, the RWA containers and every header row). They are
 * infrastructure, not a user's bank account, and deleting one would break the
 * next entry that looks it up. Non-asset accounts are already out of scope.
 */
const PROTECTED_ACCOUNT_CODES: ReadonlySet<string> = new Set([
  "1000", // header «دارایی‌ها»
  "1300", // طلای ۱۸ عیار — an investment position, owned by the assets module
  "1400", // reserved asset container
  "1600", // املاک و مستغلات (real-estate container)
  // 1610 and upwards are deliberately NOT here: `nextAssetCode` hands those
  // out to the very accounts this feature deletes (its floor is max(…,1600)+10).
  "2000",
  "2010",
  "3000",
  OPENING_EQUITY_CODE,
  "3015",
  "3200",
  "4000",
  "4010",
  "4100",
  "4900",
  "4960",
  "5000",
  "5010",
  "5020",
  "5030",
  "5040",
  "5050",
  "5900",
  "5960",
]);

export type MoneyAccountDeletionMode = "full" | "archive";

export type MoneyAccountDeletionPreview = {
  accountId: string;
  /** Account display name, as the money list shows it. */
  name: string;
  /** Wallet/container the account lives in, when it has one. */
  walletName: string | null;
  walletKind: string | null;
  /** Denomination of the account (IRT / USD / USDT / …). */
  symbol: string | null;
  assetName: string | null;
  assetDecimals: number;
  /** Balance in the account's OWN unit (canonical), from posted entries only. */
  quantity: string;
  /** Same balance as USD book value. */
  baseValue: string;
  /** Posted journal entries that touch this account. */
  entryCount: number;
  /** How many of those are the account's own standalone opening entry (0 or 1). */
  reversesOpeningEntry: boolean;
  /** Pending planned transactions that would be cancelled by the deletion. */
  plannedTransactions: number;
  /** Goals / funds whose link to this account would be detached. */
  linkedGoals: number;
  linkedFunds: number;
  /** True when the wallet row is removed together with the account. */
  removesWallet: boolean;
  /** What the deletion would do — only meaningful when `canDelete`. */
  mode: MoneyAccountDeletionMode;
  canDelete: boolean;
  /** Why not, in Persian, when `canDelete` is false. */
  blockedReason: string | null;
};

export type DeleteMoneyAccountResult = {
  ok: boolean;
  message: string;
  mode?: MoneyAccountDeletionMode;
  /** Id of the reversal entry, when the opening entry was reversed. */
  reversalEntryId?: string;
};

type LoadedMoneyAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  userId: string | null;
  walletId: string | null;
  assetId: string | null;
  walletName: string | null;
  walletKind: string | null;
  symbol: string | null;
  assetName: string | null;
  assetDecimals: number;
};

/**
 * Loads ONE deletable money account, tenant-scoped and fail-closed.
 *
 * Ownership is matched the same way the rest of the module scopes rows: an
 * authenticated tenant may only reach their OWN account; the legacy
 * single-tenant (no-auth) deployment may only reach unowned rows. A shared
 * chart row can therefore never be deleted by a tenant, and one tenant can
 * never reach another's account by guessing an id.
 */
async function loadDeletableAccount(tx: any, accountId: string, userId?: string | null): Promise<LoadedMoneyAccount> {
  if (!accountId) throw new Error("شناسه حساب الزامی است.");
  const ownership = userId ? eq(accounts.userId, userId) : isNull(accounts.userId);
  const [row] = await tx
    .select({
      id: accounts.id,
      code: accounts.code,
      name: accounts.name,
      type: accounts.type,
      userId: accounts.userId,
      walletId: accounts.walletId,
      assetId: accounts.assetId,
      walletName: wallets.name,
      walletKind: wallets.kind,
      symbol: assets.symbol,
      assetName: assets.name,
      assetDecimals: assets.decimals,
    })
    .from(accounts)
    .leftJoin(wallets, eq(wallets.id, accounts.walletId))
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .where(and(eq(accounts.id, accountId), ownership, isNull(accounts.deletedAt)))
    .limit(1);

  if (!row) throw new Error("حساب یافت نشد یا متعلق به شما نیست.");
  if (row.type !== "asset") {
    throw new Error("تنها حساب‌های دارایی (بانک، صندوق و کیف پول) از این مسیر حذف می‌شوند.");
  }
  if (PROTECTED_ACCOUNT_CODES.has(row.code)) {
    throw new Error("این حساب بخشی از ساختار پایه‌ی دفترکل است و حذف نمی‌شود.");
  }
  return { ...row, assetDecimals: row.assetDecimals ?? 2 };
}

/**
 * The posted entries that touch this account, its balance, and whether its
 * whole history is the ONE standalone opening entry that registering it wrote.
 *
 * The opening entry is only reversible when it touches nothing but this
 * account and an equity leg. The setup wizard posts a SINGLE opening entry
 * covering the bank account, the cash box, every crypto holding and gold at
 * once — reversing that from here would wipe out unrelated opening balances,
 * so a shared opening entry is deliberately not treated as reversible.
 */
async function summarizeAccountHistory(
  tx: any,
  accountId: string,
): Promise<{ entryCount: number; quantity: string; baseValue: string; reversibleOpeningEntryId: string | null }> {
  const entries = await tx
    .select({ id: journalEntries.id, type: journalEntries.type })
    .from(journalEntries)
    .innerJoin(postings, eq(postings.entryId, journalEntries.id))
    .where(and(eq(postings.accountId, accountId), eq(journalEntries.status, "posted")))
    .groupBy(journalEntries.id, journalEntries.type);

  const totals = await tx
    .select({
      quantity: sql<string>`coalesce(sum(${postings.quantity}), 0)::text`,
      baseValue: sql<string>`coalesce(sum(${postings.baseValue}), 0)::text`,
    })
    .from(postings)
    .innerJoin(journalEntries, eq(journalEntries.id, postings.entryId))
    .where(and(eq(postings.accountId, accountId), eq(journalEntries.status, "posted")));

  let reversibleOpeningEntryId: string | null = null;
  if (entries.length === 1 && entries[0].type === "opening") {
    const legs = await tx
      .select({ accountId: postings.accountId, accountType: accounts.type })
      .from(postings)
      .innerJoin(accounts, eq(accounts.id, postings.accountId))
      .where(eq(postings.entryId, entries[0].id));
    const foreign = legs.filter((leg: { accountId: string }) => leg.accountId !== accountId);
    const onlyEquityCounterparts =
      foreign.length > 0 && foreign.every((leg: { accountType: string }) => leg.accountType === "equity");
    if (onlyEquityCounterparts) reversibleOpeningEntryId = entries[0].id;
  }

  return {
    entryCount: entries.length,
    quantity: totals[0]?.quantity ?? "0",
    baseValue: totals[0]?.baseValue ?? "0",
    reversibleOpeningEntryId,
  };
}

/** Planning rows bound to the account — disclosed BEFORE the user confirms. */
async function summarizeAccountLinks(
  tx: any,
  accountId: string,
): Promise<{ plannedTransactions: number; linkedGoals: number; linkedFunds: number }> {
  const [planned, goalRows, fundRows] = await Promise.all([
    tx
      .select({ id: plannedTransactions.id })
      .from(plannedTransactions)
      .where(
        and(
          eq(plannedTransactions.status, "pending"),
          isNull(plannedTransactions.deletedAt),
          or(eq(plannedTransactions.fromAccountId, accountId), eq(plannedTransactions.toAccountId, accountId)),
        ),
      ),
    tx.select({ id: goals.id }).from(goals).where(and(eq(goals.fundAccountId, accountId), isNull(goals.deletedAt))),
    tx.select({ id: funds.id }).from(funds).where(and(eq(funds.accountId, accountId), isNull(funds.deletedAt))),
  ]);
  return { plannedTransactions: planned.length, linkedGoals: goalRows.length, linkedFunds: fundRows.length };
}

/** Would the wallet be left with no live account once this one is deleted? */
async function walletBecomesEmpty(tx: any, walletId: string | null, accountId: string): Promise<boolean> {
  if (!walletId) return false;
  const siblings = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.walletId, walletId), isNull(accounts.deletedAt), ne(accounts.id, accountId)))
    .limit(1);
  return siblings.length === 0;
}

/**
 * Everything the confirmation box needs to state the consequence BEFORE the
 * user commits: the balance at stake, how much history exists, what is
 * attached to the account, and whether the deletion is even possible.
 *
 * READ-ONLY. It writes nothing, and its answer is never trusted by the
 * deletion itself — `deleteMoneyAccount` re-derives every check inside its own
 * transaction, so a stale preview cannot authorise a write.
 */
export async function previewMoneyAccountDeletion(input: {
  accountId: string;
  userId?: string | null;
}): Promise<MoneyAccountDeletionPreview> {
  const account = await loadDeletableAccount(db, input.accountId, input.userId);
  const [history, links, removesWallet] = await Promise.all([
    summarizeAccountHistory(db, account.id),
    summarizeAccountLinks(db, account.id),
    walletBecomesEmpty(db, account.walletId, account.id),
  ]);

  const mode: MoneyAccountDeletionMode = history.reversibleOpeningEntryId ? "full" : "archive";
  const balance = D(history.quantity);
  const blockedReason =
    mode === "archive" && !balance.isZero()
      ? `این حساب هنوز موجودی دارد (${formatMoney(
          balance.toFixed(account.symbol === "IRT" ? 0 : Math.min(account.assetDecimals, 8)),
          account.symbol ?? "USD",
        )}). ابتدا موجودی را به حساب دیگری منتقل کنید، سپس حساب را حذف کنید.`
      : null;

  return {
    accountId: account.id,
    name: account.name,
    walletName: account.walletName,
    walletKind: account.walletKind,
    symbol: account.symbol,
    assetName: account.assetName,
    assetDecimals: account.assetDecimals,
    quantity: history.quantity,
    baseValue: history.baseValue,
    entryCount: history.entryCount,
    reversesOpeningEntry: !!history.reversibleOpeningEntryId,
    plannedTransactions: links.plannedTransactions,
    linkedGoals: links.linkedGoals,
    linkedFunds: links.linkedFunds,
    removesWallet,
    mode,
    canDelete: !blockedReason,
    blockedReason,
  };
}

/**
 * Deletes a user-registered money account.
 *
 * ACCOUNTING INVARIANTS (never violated):
 *   - No posting, lot or balance column is rewritten. The only ledger write is
 *     a reversal produced by the unchanged `reverseEntry` core path, and only
 *     for an opening entry that belongs to this account alone.
 *   - Σ(base_value) over live accounts stays zero: either the opening entry is
 *     reversed (both legs return to zero) or the account's balance is already
 *     zero before it is hidden.
 *   - The account and its wallet are SOFT-deleted; history stays readable in
 *     the ledger, and every flow report keeps its past figures.
 */
export async function deleteMoneyAccount(
  input: { accountId: string; userId?: string | null },
  txClient?: any,
): Promise<DeleteMoneyAccountResult> {
  const run = async (tx: any): Promise<DeleteMoneyAccountResult> => {
    const account = await loadDeletableAccount(tx, input.accountId, input.userId);
    // Re-derived inside the transaction: the preview is a display, never an
    // authorisation. A transaction posted between preview and confirm is seen
    // here and stops the deletion.
    const history = await summarizeAccountHistory(tx, account.id);
    const mode: MoneyAccountDeletionMode = history.reversibleOpeningEntryId ? "full" : "archive";
    const balance = D(history.quantity);

    if (mode === "archive" && !balance.isZero()) {
      throw new Error(
        `این حساب هنوز موجودی دارد (${formatMoney(
          balance.toFixed(account.symbol === "IRT" ? 0 : Math.min(account.assetDecimals, 8)),
          account.symbol ?? "USD",
        )}). ابتدا موجودی را به حساب دیگری منتقل کنید، سپس حساب را حذف کنید.`,
      );
    }

    let reversalEntryId: string | undefined;
    if (history.reversibleOpeningEntryId) {
      const reversal = await reverseEntry(history.reversibleOpeningEntryId, tx);
      reversalEntryId = reversal.id;
    }

    // Detach planning links so nothing is left pointing at a hidden account.
    // Every column below is nullable; a pending plan whose account is gone can
    // no longer be executed, so it is cancelled rather than left to fail.
    const links = await summarizeAccountLinks(tx, account.id);
    if (links.linkedGoals > 0) {
      await tx.update(goals).set({ fundAccountId: null, updatedAt: new Date() }).where(eq(goals.fundAccountId, account.id));
    }
    if (links.linkedFunds > 0) {
      await tx.update(funds).set({ accountId: null, updatedAt: new Date() }).where(eq(funds.accountId, account.id));
    }
    if (links.plannedTransactions > 0) {
      await tx
        .update(plannedTransactions)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(plannedTransactions.status, "pending"),
            isNull(plannedTransactions.deletedAt),
            or(eq(plannedTransactions.fromAccountId, account.id), eq(plannedTransactions.toAccountId, account.id)),
          ),
        );
    }

    const now = new Date();
    await tx.update(accounts).set({ isActive: false, deletedAt: now, updatedAt: now }).where(eq(accounts.id, account.id));

    // The wallet is the user-facing container. It only goes when this was its
    // last live account — a shared wallet (e.g. one exchange holding several
    // coins) keeps its remaining accounts.
    const walletRemoved = await walletBecomesEmpty(tx, account.walletId, account.id);
    if (walletRemoved && account.walletId) {
      await tx.update(wallets).set({ deletedAt: now, updatedAt: now }).where(eq(wallets.id, account.walletId));
    }

    await recordAuditEvent(
      {
        action: "DELETE_MONEY_ACCOUNT",
        entityType: "money_account",
        entityId: account.id,
        userId: input.userId ?? null,
        result: "SUCCESS",
        payload: {
          mode,
          code: account.code,
          name: account.name,
          assetSymbol: account.symbol,
          entryCount: history.entryCount,
          reversalEntryId: reversalEntryId ?? null,
          walletRemoved,
          detachedGoals: links.linkedGoals,
          detachedFunds: links.linkedFunds,
          cancelledPlans: links.plannedTransactions,
        },
      },
      tx,
    );

    const tail =
      mode === "full"
        ? "سند افتتاحیه‌ی آن ابطال شد و اثری در دارایی خالص باقی نماند."
        : "سوابق دفترکل آن دست‌نخورده باقی ماند و گزارش‌های گذشته تغییر نکرد.";
    return {
      ok: true,
      message: `حساب «${account.name}» حذف شد. ${tail}`,
      mode,
      reversalEntryId,
    };
  };

  if (txClient) return run(txClient);
  return db.transaction(run);
}
