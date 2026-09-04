/**
 * System chart-of-accounts resolution — TENANT-SCOPED.
 *
 * WHY THIS MODULE EXISTS (audit findings F-02 / F-03)
 * ---------------------------------------------------
 * Several counter-legs of a journal entry are NOT chosen by the user; the
 * server resolves them by account CODE:
 *   • 5040  «کارمزد و بانک»            — the fee leg of a buy/sell
 *   • 4100  «سود سرمایه‌ای تحقق‌یافته» — the realized P&L leg of a sell
 *   • 3200  «ذخیره استهلاک …»          — the counter of a non-cash expense
 *   • 5xxx  «اولین حساب هزینه»          — the ledger counterpart of an expense
 * Historically those lookups were `where code = ? limit 1` with NO tenant
 * filter and NO ordering, which meant (a) an arbitrary OTHER tenant's account
 * could receive the posting, and (b) on a fresh install (whose chart comes from
 * `completeSetup()` and has no 5040 at all) a buy with a fee silently produced
 * an unbalanced entry that crashed the transaction.
 *
 * THE RULE ENFORCED HERE
 * ----------------------
 *   1. the tenant's OWN account row for that code, else
 *   2. the shared GLOBAL row (`user_id IS NULL`) — the legacy single-tenant
 *      chart and the seeded demo chart,
 *   3. never another tenant's row.
 * If the code is required by an in-flight entry and neither exists, it is
 * provisioned for the CURRENT tenant (idempotent, conflict-tolerant) — never
 * silently skipped, because skipping is what breaks Σ = 0.
 *
 * This module is a leaf: it imports only `db` + `schema`, so the accounting
 * core (`src/features/ledger`) and the action boundary can both use it without
 * an import cycle. It performs NO journal/posting/lot writes.
 */
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";

/** Fee expense account (transaction commissions). */
export const FEE_EXPENSE_CODE = "5040";
export const FEE_EXPENSE_NAME = "کارمزد و بانک";
/** Realized investment gain/loss (credit) account. */
export const REALIZED_PNL_CODE = "4100";
/** Non-cash depreciation / reserve (equity) account. */
export const RESERVE_ACCOUNT_CODE = "3200";
/** Opening equity account. */
export const OPENING_EQUITY_CODE = "3010";
/** Miscellaneous expense account (legacy fallback counterpart). */
export const MISC_EXPENSE_CODE = "5900";

export type SystemAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  assetId: string | null;
  userId: string | null;
};

const SELECT_COLUMNS = {
  id: accounts.id,
  code: accounts.code,
  name: accounts.name,
  type: accounts.type,
  assetId: accounts.assetId,
  userId: accounts.userId,
};

/** Never hand out an archived/soft-deleted system row. */
const alive = sql`${accounts.deletedAt} is null`;

/**
 * Resolve a chart-of-accounts row by code for ONE tenant.
 *
 * Own row first (deterministic `order by created_at`), then the shared global
 * row. A row owned by ANOTHER tenant is never a candidate — that was F-03.
 */
export async function resolveSystemAccount(
  code: string,
  userId?: string | null,
  client: any = db,
): Promise<SystemAccount | null> {
  if (userId) {
    const own = await client
      .select(SELECT_COLUMNS)
      .from(accounts)
      .where(and(eq(accounts.code, code), eq(accounts.userId, userId), alive))
      .orderBy(asc(accounts.createdAt))
      .limit(1);
    if (own[0]) return own[0] as SystemAccount;
  }

  const shared = await client
    .select(SELECT_COLUMNS)
    .from(accounts)
    .where(and(eq(accounts.code, code), isNull(accounts.userId), alive))
    .orderBy(asc(accounts.createdAt))
    .limit(1);
  return (shared[0] as SystemAccount) ?? null;
}

/**
 * Same scope rule applied to an account ALREADY chosen by the caller (a fee or
 * P&L account picked in the form): the id is honoured only when it belongs to
 * this tenant or is a shared global row. Returns null otherwise, so the caller
 * falls back to provisioning instead of posting into a foreign account.
 */
export async function resolveSystemAccountById(
  accountId: string,
  userId?: string | null,
  client: any = db,
): Promise<SystemAccount | null> {
  const scope = userId
    ? or(eq(accounts.userId, userId), isNull(accounts.userId))
    : isNull(accounts.userId);
  const found = await client
    .select(SELECT_COLUMNS)
    .from(accounts)
    .where(and(eq(accounts.id, accountId), scope, alive))
    .limit(1);
  return (found[0] as SystemAccount) ?? null;
}

/**
 * The first expense-type account of THIS tenant (global rows only as a legacy
 * fallback). Replaces the previous `where type='expense' limit 1` which was
 * unordered, tenant-blind and — on a fresh install — resolved to an arbitrary
 * account, so the ledger counterpart of every expense landed on the same row.
 */
export async function resolveExpenseCounterAccount(
  userId: string | null | undefined,
  client: any = db,
): Promise<SystemAccount | null> {
  const preferred = await resolveSystemAccount(MISC_EXPENSE_CODE, userId, client);
  if (preferred?.type === "expense") return preferred;

  const scope = userId
    ? or(eq(accounts.userId, userId), isNull(accounts.userId))
    : sql`1=1`;
  const rowsFound = await client
    .select(SELECT_COLUMNS)
    .from(accounts)
    .where(and(eq(accounts.type, "expense"), scope, alive))
    .orderBy(asc(accounts.code))
    .limit(1);
  return (rowsFound[0] as SystemAccount) ?? null;
}

/** Base (USD, else IRT) asset id used to provision a missing system row. */
async function findBaseAssetId(client: any): Promise<string | null> {
  for (const symbol of ["USD", "IRT"]) {
    const [row] = await client
      .select({ id: assets.id })
      .from(assets)
      .where(and(eq(assets.symbol, symbol), isNull(assets.deletedAt)))
      .limit(1);
    if (row?.id) return row.id;
  }
  const [any] = await client
    .select({ id: assets.id })
    .from(assets)
    .where(isNull(assets.deletedAt))
    .limit(1);
  return any?.id ?? null;
}

/**
 * Idempotently provision a tenant-owned chart row (used for 5040 on fresh
 * installs — F-02). Writes a single `accounts` row only: no journal entry, no
 * posting, no balance. Concurrent first-time writers are resolved by the
 * (user_id, code) unique index, then re-read.
 */
export async function ensureSystemAccount(
  input: {
    code: string;
    name: string;
    type: "expense" | "income" | "equity" | "liability" | "asset";
    userId?: string | null;
    client?: any;
  },
): Promise<SystemAccount | null> {
  const client = input.client ?? db;

  const existing = await resolveSystemAccount(input.code, input.userId, client);
  if (existing) return existing;

  const baseAssetId = await findBaseAssetId(client);
  const [created] = await client
    .insert(accounts)
    .values({
      userId: input.userId ?? null,
      code: input.code,
      name: input.name,
      type: input.type,
      assetId: baseAssetId,
      isActive: true,
    })
    .onConflictDoNothing({ target: [accounts.userId, accounts.code] })
    .returning(SELECT_COLUMNS);
  if (created) return created as SystemAccount;

  return await resolveSystemAccount(input.code, input.userId, client);
}

/** The fee-expense account (5040) for a tenant, provisioned on demand. */
export async function ensureFeeExpenseAccount(
  userId?: string | null,
  client: any = db,
): Promise<SystemAccount | null> {
  return ensureSystemAccount({
    code: FEE_EXPENSE_CODE,
    name: FEE_EXPENSE_NAME,
    type: "expense",
    userId,
    client,
  });
}

/** The realized P&L account (4100) for a tenant, provisioned on demand. */
export async function ensureRealizedPnlAccount(
  userId?: string | null,
  client: any = db,
): Promise<SystemAccount | null> {
  const found = await resolveSystemAccount(REALIZED_PNL_CODE, userId, client);
  if (found) {
    if (found.type !== "income" && found.type !== "equity") return found;
    return found;
  }
  return ensureSystemAccount({
    code: REALIZED_PNL_CODE,
    name: "سود سرمایه‌ای تحقق‌یافته",
    type: "income",
    userId,
    client,
  });
}

/**
 * Hard assertion used by the buy/sell entry builders: when a commission leg is
 * part of the entry, the counter account MUST exist — otherwise the entry would
 * be posted unbalanced (F-02's crash). The error is actionable, in the user's
 * language, and aborts before anything is written.
 */
export function assertSystemAccount(
  account: SystemAccount | null,
  code: string,
  label: string,
): SystemAccount {
  if (!account) {
    const err: any = new Error(
      `حساب سیستمی «${label}» (${code}) در دفتر این کاربر موجود نیست و ساخت آن ناموفق بود.`,
    );
    err.code = "SYSTEM_ACCOUNT_MISSING";
    err.status = 500;
    throw err;
  }
  return account;
}
