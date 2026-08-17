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
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assetClasses, assets, wallets } from "@/db/schema";
import { postEntry } from "@/features/ledger/service";
import { recordAuditEvent } from "@/lib/audit";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";

export const WALLET_KINDS = ["bank", "cash", "exchange", "hot", "cold", "fund"] as const;
export type WalletKind = (typeof WALLET_KINDS)[number];

/** Account code of the opening-equity account that balances opening entries. */
export const OPENING_EQUITY_CODE = "3010";

/** Asset classes that are tracked as FIFO lots when an opening balance is set. */
const LOT_TRACKED_CLASSES = new Set(["crypto", "gold", "fund"]);

export type RegisterMoneyAccountInput = {
  name: string;
  kind: WalletKind;
  assetId: string;
  /** Opening balance in the asset's own unit (toman for IRT, coins for BTC, …). */
  openingQty?: string;
  /** USD price per unit. Falls back to the asset's latest price when omitted. */
  openingUnitPriceUsd?: string;
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
  if (!input.assetId) throw new Error("ارز / دارایی حساب را انتخاب کنید.");

  const run = async (tx: any) => {
    // 1. Asset must exist and be active (shared reference data).
    const assetRows = await tx
      .select({
        id: assets.id,
        symbol: assets.symbol,
        name: assets.name,
        classCode: assetClasses.code,
      })
      .from(assets)
      .leftJoin(assetClasses, eq(assetClasses.id, assets.classId))
      .where(and(eq(assets.id, input.assetId), isNull(assets.deletedAt), eq(assets.isActive, true)))
      .limit(1);
    const asset = assetRows[0];
    if (!asset) throw new Error("دارایی انتخاب‌شده معتبر یا فعال نیست.");

    // 2. Unit price (USD) — explicit input, else latest recorded price, else 1.
    let unitPriceUsd = input.openingUnitPriceUsd ? D(input.openingUnitPriceUsd) : D("0");
    if (unitPriceUsd.lte(0)) {
      const priceRes = await tx.execute(
        sql`select price_base::text as p from prices where asset_id = ${input.assetId} order by as_of desc limit 1`,
      );
      unitPriceUsd = D((priceRes.rows[0] as { p?: string } | undefined)?.p ?? "1");
    }
    if (unitPriceUsd.lte(0)) unitPriceUsd = D("1");

    // 3. Opening quantity (optional → zero-balance account, no opening entry).
    const openingQty = input.openingQty ? D(input.openingQty) : D("0");
    if (openingQty.isNegative()) throw new Error("موجودی اولیه نمی‌تواند منفی باشد.");
    const baseValue = openingQty.mul(unitPriceUsd);

    // 4. Wallet (user-owned container; shared `institutions` is NOT touched).
    const [wallet] = await tx
      .insert(wallets)
      .values({
        userId: input.userId ?? null,
        name,
        kind: input.kind,
        institutionId: null,
        networkId: null,
        address: null,
        note: input.note?.trim() || null,
      })
      .returning();

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
      const isLotTracked = LOT_TRACKED_CLASSES.has(asset.classCode ?? "");

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
          openLots: isLotTracked
            ? [{ accountId: account.id, assetId: input.assetId, quantity: qtyStr, costBase: baseStr }]
            : undefined,
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
