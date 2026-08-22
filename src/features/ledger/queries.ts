import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, journalEntries, postings } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import type { AccountType } from "@/domain/accounting";

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as T[];
}

async function resolveQueryUserId(explicitUserId?: string): Promise<string | undefined> {
  if (explicitUserId) return explicitUserId;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    if (user?.id) return user.id;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) {
      throw e;
    }
    // Other errors: treat as unauthenticated (fallback below)
  }

  // Fallback for standalone unit test environments without web session cookies
  // Single-user legacy mode: return undefined (global view) so that existing
  // null-owned legacy rows remain visible until migrated. This keeps the
  // accounting preservation guarantee (netWorth 1456) while multi-user
  // isolation is enforced via explicit userId or authenticated session.
  try {
    const res = await db.execute(sql`select id from users limit 2`);
    if (res.rows.length === 1) {
      return undefined;
    }
  } catch (e: any) {
    // DB error in isolation check -> fail-closed DENY
    if (e?.message?.includes("Authentication/Database error")) throw e;
    throw new Error("Authentication/Database error: Access denied");
  }
  return undefined;
}

/**
 * True when the database holds more than one identity (real multi-tenant
 * deployment). Used only to keep tenant-scoped reads fail-closed; it never
 * influences ledger, FIFO or valuation logic.
 *
 * Exported so other read services (analytics, planning) apply the SAME
 * fail-closed rule: in a multi-tenant database an unresolved identity must
 * never degrade to a global (tenant-blending) read.
 */
export async function hasMultipleUsers(): Promise<boolean> {
  try {
    const res = await db.execute(sql`select id from users limit 2`);
    return res.rows.length > 1;
  } catch {
    // Unknown state -> assume multi-tenant and stay fail-closed.
    return true;
  }
}

export type AccountBalance = {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  assetId: string | null;
  symbol: string | null;
  assetName: string | null;
  assetDecimals: number;
  walletName: string | null;
  className: string | null;
  classColor: string | null;
  quantity: string;
  baseValue: string;
};

/** Balances are ALWAYS derived from the immutable ledger — never stored. */
export async function getAccountBalances(userId?: string): Promise<AccountBalance[]> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: in a multi-tenant database an unresolved identity must not
  // read every tenant's balances.
  if (!u && (await hasMultipleUsers())) return [];
  return rows<AccountBalance>(sql`
    select a.id            as "accountId",
           a.code          as "code",
           a.name          as "name",
           a.type          as "type",
           ast.id          as "assetId",
           ast.symbol      as "symbol",
           ast.name        as "assetName",
           coalesce(ast.decimals, 2) as "assetDecimals",
           w.name          as "walletName",
           ac.name         as "className",
           ac.color        as "classColor",
           coalesce(sum(case when je.status = 'posted' then p.quantity else 0 end), 0)::text  as "quantity",
           coalesce(sum(case when je.status = 'posted' then p.base_value else 0 end), 0)::text as "baseValue"
    from accounts a
      left join postings p on p.account_id = a.id
      left join journal_entries je on je.id = p.entry_id
      left join assets ast on ast.id = coalesce(p.asset_id, a.asset_id)
      left join wallets w on w.id = a.wallet_id
      left join asset_classes ac on ac.id = ast.class_id
    where a.deleted_at is null ${u ? sql`and (a.user_id = ${u} or (a.user_id is null and a.code in ('1000','1300','1400','1600','1610','1620','2000','3000','3010','3015','3200','4000','4010','4100','4900','5000','5010','5020','5030','5040','5050','5900')))` : sql``}
    group by a.id, a.code, a.name, a.type, ast.id, ast.symbol, ast.name, ast.decimals, w.name, ac.name, ac.color
    order by a.code
  `);
}

export type Holding = {
  assetId: string;
  symbol: string;
  name: string;
  decimals: number;
  className: string;
  classColor: string;
  quantity: string;
  costBase: string;
  price: string | null;
};

/** Portfolio holdings: quantity from ledger, price from latest price row. */
export async function getHoldings(userId?: string): Promise<Holding[]> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' holdings.
  if (!u && (await hasMultipleUsers())) return [];
  return rows<Holding>(sql`
    with latest as (
      select distinct on (asset_id) asset_id, price_base
      from prices order by asset_id, as_of desc
    )
    select ast.id as "assetId",
           ast.symbol as "symbol",
           ast.name as "name",
           ast.decimals as "decimals",
           ac.name as "className",
           ac.color as "classColor",
           coalesce(sum(case when je.status = 'posted' then p.quantity else 0 end), 0)::text as "quantity",
           coalesce(sum(case when je.status = 'posted' then p.base_value else 0 end), 0)::text as "costBase",
           l.price_base::text as "price"
    from assets ast
      join asset_classes ac on ac.id = ast.class_id
      left join postings p on p.asset_id = ast.id
      left join journal_entries je on je.id = p.entry_id ${u ? sql`and je.user_id = ${u}` : sql``}
      left join accounts a on a.id = p.account_id and a.type = 'asset' ${u ? sql`and a.user_id = ${u}` : sql``}
      left join latest l on l.asset_id = ast.id
    where ast.deleted_at is null and (a.type = 'asset' or p.id is null) ${u ? sql`and (a.user_id = ${u} or p.id is null)` : sql``}
    group by ast.id, ast.symbol, ast.name, ast.decimals, ac.name, ac.color, l.price_base
    order by ast.symbol
  `);
}

export type NetWorth = {
  totalAssets: string;
  totalLiabilities: string;
  netWorth: string;
  byClass: { className: string; color: string; value: string; share: string }[];
  liquid: string;
};

export async function getNetWorth(userId?: string): Promise<NetWorth> {
  const holdings = await getHoldings(userId);
  const balances = await getAccountBalances(userId);

  let assetsTotal = Decimal.zero();
  const byClass = new Map<string, { color: string; value: Decimal }>();
  let liquid = Decimal.zero();

  for (const h of holdings) {
    const qty = D(h.quantity);
    if (qty.isZero()) continue;
    const value = h.price ? qty.mul(h.price) : D(h.costBase);
    assetsTotal = assetsTotal.add(value);
    const cur = byClass.get(h.className) ?? { color: h.classColor, value: Decimal.zero() };
    cur.value = cur.value.add(value);
    byClass.set(h.className, cur);
    if (["نقد و بانک", "استیبل‌کوین"].includes(h.className)) liquid = liquid.add(value);
  }

  const liabilities = balances
    .filter((b) => b.type === "liability")
    .reduce((acc, b) => acc.add(D(b.baseValue).neg()), Decimal.zero());

  return {
    totalAssets: assetsTotal.toString(),
    totalLiabilities: liabilities.toString(),
    netWorth: assetsTotal.sub(liabilities).toString(),
    liquid: liquid.toString(),
    byClass: [...byClass.entries()]
      .map(([className, v]) => ({
        className,
        color: v.color,
        value: v.value.toString(),
        share: assetsTotal.isZero() ? "0" : v.value.div(assetsTotal).mul(100).toString(),
      }))
      .sort((a, b) => Number(b.value) - Number(a.value)),
  };
}

export type LedgerRow = {
  id: string;
  entryDate: string;
  type: string;
  description: string;
  status: string;
  source: string;
  /** leaf category id (expense classification, reporting only) */
  categoryId?: string | null;
  /** leaf category name, e.g. "سوخت خودرو" */
  categoryName?: string | null;
  /** parent (top-level) category name, e.g. "خودرو و حمل‌ونقل" */
  categoryParentName?: string | null;
  /** true when the category is depreciation/reserve (no cash outflow) */
  categoryNonCash?: boolean;
  lines: { account: string; accountType: string; symbol: string; quantity: string; baseValue: string; decimals: number; memo: string | null }[];
};

export async function getLedger(limit = 60, userId?: string): Promise<LedgerRow[]> {
  const safeLimit = Math.min(Math.max(1, limit), 500);
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' ledger entries.
  if (!u && (await hasMultipleUsers())) return [];
  return rows<LedgerRow>(sql`
    select je.id,
           je.entry_date::text as "entryDate",
           je.type, je.description, je.status, je.source,
           coalesce(json_agg(json_build_object(
             'account', a.name,
             'accountType', a.type,
             'symbol', ast.symbol,
             'decimals', ast.decimals,
             'quantity', p.quantity::text,
             'baseValue', p.base_value::text,
             'memo', p.memo
           ) order by p.base_value desc) filter (where p.id is not null), '[]') as lines
    from journal_entries je
      left join postings p on p.entry_id = je.id
      left join accounts a on a.id = p.account_id
      left join assets ast on ast.id = p.asset_id
    where 1=1 ${u ? sql`and je.user_id = ${u}` : sql``}
    group by je.id
    order by je.entry_date desc, je.created_at desc
    limit ${safeLimit}
  `);
}

/** Fetch a single ledger entry by id (asset ↔ ledger navigation, e.g. ?entry=ID). */
export async function getLedgerById(entryId: string, userId?: string): Promise<LedgerRow | null> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never return another tenant's entry.
  if (!u && (await hasMultipleUsers())) return null;
  const result = await rows<LedgerRow>(sql`
    select je.id,
           je.entry_date::text as "entryDate",
           je.type, je.description, je.status, je.source,
           coalesce(json_agg(json_build_object(
             'account', a.name,
             'accountType', a.type,
             'symbol', ast.symbol,
             'decimals', ast.decimals,
             'quantity', p.quantity::text,
             'baseValue', p.base_value::text,
             'memo', p.memo
           ) order by p.base_value desc) filter (where p.id is not null), '[]') as lines
    from journal_entries je
      left join postings p on p.entry_id = je.id
      left join accounts a on a.id = p.account_id
      left join assets ast on ast.id = p.asset_id
    where je.id = ${entryId} ${u ? sql`and je.user_id = ${u}` : sql``}
    group by je.id
    limit 1
  `);
  return result[0] ?? null;
}

export type LotRow = {
  id: string;
  assetId: string;
  symbol: string;
  openedAt: string;
  qtyRemaining: string;
  unitCostBase: string;
};

export async function getOpenLots(assetId?: string, userId?: string): Promise<LotRow[]> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never expose another tenant's FIFO lots.
  if (!u && (await hasMultipleUsers())) return [];
  return rows<LotRow>(sql`
    select l.id, l.asset_id as "assetId", ast.symbol,
           l.opened_at::text as "openedAt",
           l.qty_remaining::text as "qtyRemaining",
           l.unit_cost_base::text as "unitCostBase"
    from lots l join assets ast on ast.id = l.asset_id
    where l.qty_remaining > 0
      ${assetId ? sql`and l.asset_id = ${assetId}` : sql``}
      ${u ? sql`and l.user_id = ${u}` : sql``}
    order by l.opened_at asc, l.id asc
  `);
}

export async function getRealizedPnl(userId?: string): Promise<{ total: string; bySymbol: { symbol: string; pnl: string }[] }> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' realized P&L.
  if (!u && (await hasMultipleUsers())) return { total: "0", bySymbol: [] };
  const data = await rows<{ symbol: string; pnl: string }>(sql`
    select ast.symbol, sum(lc.realized_pnl)::text as pnl
    from lot_consumptions lc
      join lots l on l.id = lc.lot_id
      join assets ast on ast.id = l.asset_id
    where 1=1 ${u ? sql`and l.user_id = ${u}` : sql``}
    group by ast.symbol order by 2 desc
  `);
  return {
    total: Decimal.sum(data.map((d) => d.pnl)).toString(),
    bySymbol: data,
  };
}

/**
 * Monthly cash flow. Outflow counts REAL cash expenses only:
 *  - debt principal repayments (je.type = 'debt_repayment') are excluded —
 *    they are not an expense by the transaction-type separation rule;
 *  - non-cash categories (depreciation / reserves, ec.nature = 'non_cash')
 *    are excluded — they are expenses in reports but never a cash outflow.
 *
 * CURRENCY ISOLATION FIX:
 *  - inflow/outflow remain USD base values (canonical accounting).
 *  - inflowToman/outflowToman are derived from the FROZEN entry_fx_snapshots
 *    (canonical Toman amount at commit time), NEVER re-derived via current FX.
 *    This guarantees IRT balances stay fixed when FX changes, while still
 *    providing a Toman view that matches the user's original input (e.g. 909,090).
 *  - When no snapshot exists (legacy data), Toman is NULL and caller falls
 *    back to current-rate valuation only for display, but never mutates balance.
 */
export async function getCashflow(months = 6, userId?: string) {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' cash flow.
  if (!u && (await hasMultipleUsers())) return [];
  // Two-level aggregation: first per entry (to avoid double-counting snapshot
  // irt_amount when an entry has multiple postings), then per month.
  return rows<{ month: string; inflow: string; outflow: string; inflowToman: string | null; outflowToman: string | null }>(sql`
    with per_entry as (
      select je.id,
             date_trunc('month', je.entry_date)::date as month_trunc,
             coalesce(sum(case when a.type = 'income' then -p.base_value else 0 end), 0) as inflow_usd,
             coalesce(sum(case when a.type = 'expense'
                                and je.type not in ('debt_repayment')
                                and coalesce(ec.nature, 'cash') = 'cash'
                               then p.base_value else 0 end), 0) as outflow_usd,
             s.irt_amount::numeric as irt_amount
      from journal_entries je
        join postings p on p.entry_id = je.id
        join accounts a on a.id = p.account_id
        left join expense_categories ec on ec.id = je.category_id
        left join entry_fx_snapshots s on s.entry_id = je.id
      where je.status = 'posted'
        ${u ? sql`and je.user_id = ${u}` : sql``}
        and je.entry_date >= (current_date - (${months} || ' months')::interval)
      group by je.id, je.entry_date, s.irt_amount, je.type
    )
    select to_char(month_trunc, 'YYYY-MM-01') as month,
           coalesce(sum(inflow_usd), 0)::text as inflow,
           coalesce(sum(outflow_usd), 0)::text as outflow,
           -- Toman is canonical from snapshot, only when that entry contributed to inflow/outflow
           coalesce(sum(case when inflow_usd > 0 then irt_amount else 0 end), 0)::text as \"inflowToman\",
           coalesce(sum(case when outflow_usd > 0 then irt_amount else 0 end), 0)::text as \"outflowToman\"
    from per_entry
    group by month_trunc
    order by month_trunc
  `);
}

/* ------------------------------------------------------------------ */
/* Human Finance Layer — Transactions                                  */
/* Same ledger truth underneath, filtered/ordered for humans.          */
/* ------------------------------------------------------------------ */

export type TxFilter = {
  limit?: number;
  type?: string; // income|expense|transfer|buy|sell|adjustment|installment|debt|debt_repayment|opening
  q?: string;
  accountId?: string;
  /** category id (leaf OR parent — a parent matches all of its children) */
  categoryId?: string;
  from?: string; // ISO date
  to?: string; // ISO date
  review?: "reviewed" | "unreviewed";
  sort?: "new" | "old" | "amount";
  userId?: string;
};

export type TxRow = LedgerRow & { reviewed: boolean };

/** Recent activity — same repository as the Transactions module (SSOT). */
export async function getRecent(limit = 6, userId?: string): Promise<TxRow[]> {
  return getTransactions({ limit, userId });
}

export async function getTransactions(filter: TxFilter = {}): Promise<TxRow[]> {
  const { type, q, accountId, categoryId, from, to } = filter;
  const safeLimit = Math.min(Math.max(1, filter.limit || 120), 500);
  const u = await resolveQueryUserId(filter.userId);
  // Fail-closed: never blend tenants' transactions.
  if (!u && (await hasMultipleUsers())) return [];
  const orderBy =
    filter.sort === "old"
      ? sql`order by je.entry_date asc, je.created_at asc`
      : filter.sort === "amount"
        ? sql`order by (select coalesce(sum(p3.base_value), 0) from postings p3 where p3.entry_id = je.id and p3.base_value > 0) desc`
        : sql`order by je.entry_date desc, je.created_at desc`;
  return rows<TxRow>(sql`
    select je.id,
           je.entry_date::text as "entryDate",
           je.type, je.description, je.status, je.source,
           je.category_id::text as "categoryId",
           ec.name as "categoryName",
           epc.name as "categoryParentName",
           (coalesce(ec.nature, 'cash') = 'non_cash') as "categoryNonCash",
           coalesce(json_agg(json_build_object(
             'account', a.name,
             'accountType', a.type,
             'symbol', ast.symbol,
             'decimals', ast.decimals,
             'quantity', p.quantity::text,
             'baseValue', p.base_value::text,
             'memo', p.memo
           ) order by p.base_value desc) filter (where p.id is not null), '[]') as lines,
           (er.entry_id is not null) as reviewed
    from journal_entries je
      left join postings p on p.entry_id = je.id
      left join accounts a on a.id = p.account_id
      left join assets ast on ast.id = p.asset_id
      left join entry_reviews er on er.entry_id = je.id
      left join expense_categories ec on ec.id = je.category_id
      left join expense_categories epc on epc.id = ec.parent_id
    where 1 = 1
      ${u ? sql`and je.user_id = ${u}` : sql``}
      ${type ? sql`and je.type = ${type}` : sql``}
      ${from ? sql`and je.entry_date >= ${from}` : sql``}
      ${to ? sql`and je.entry_date <= ${to}` : sql``}
      ${q ? sql`and (je.description ilike ${"%" + q + "%"} or je.reference ilike ${"%" + q + "%"})` : sql``}
      ${
        accountId
          ? sql`and exists (select 1 from postings p2 where p2.entry_id = je.id and p2.account_id = ${accountId})`
          : sql``
      }
      ${
        categoryId
          ? sql`and (je.category_id = ${categoryId} or je.category_id in (select id from expense_categories where parent_id = ${categoryId}))`
          : sql``
      }
      ${filter.review === "reviewed" ? sql`and er.entry_id is not null` : sql``}
      ${filter.review === "unreviewed" ? sql`and er.entry_id is null` : sql``}
    group by je.id, er.entry_id, ec.name, epc.name, ec.nature
    ${orderBy}
    limit ${safeLimit}
  `);
}

export async function countUnreviewed(userId?: string): Promise<number> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never count another tenant's records.
  if (!u && (await hasMultipleUsers())) return 0;
  const res = await rows<{ c: string }>(sql`
    select count(*)::text as c
    from journal_entries je
    where je.source = 'import' and je.status = 'posted'
      ${u ? sql`and je.user_id = ${u}` : sql``}
      and not exists (select 1 from entry_reviews er where er.entry_id = je.id)
  `);
  return Number(res[0]?.c ?? 0);
}

/**
 * Expense/income account breakdown for the Cash Flow page (posted, last N months).
 * Debt principal repayments (type 'debt_repayment') are never counted here —
 * by the transaction-type separation rule they are not income/expense.
 *
 * Returns both USD (base) and canonical Toman (from frozen snapshots) to keep
 * IRT amounts stable when FX changes.
 */
export async function getFlowByAccount(accountType: "income" | "expense", months = 6, userId?: string) {
  const u = await resolveQueryUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];
  return rows<{ accountId: string; code: string; name: string; total: string; totalToman: string | null; months: number }>(sql`
    with per_entry as (
      select a.id as acc_id, a.code, a.name,
             je.id as entry_id,
             coalesce(sum(case when ${accountType} = 'income' then -p.base_value else p.base_value end), 0) as total_usd,
             s.irt_amount::numeric as irt_amount,
             sum(case when ${accountType} = 'income' then 1 when ${accountType} = 'expense' then 1 else 0 end) as matched
      from postings p
        join journal_entries je on je.id = p.entry_id
        join accounts a on a.id = p.account_id
        left join entry_fx_snapshots s on s.entry_id = je.id
      where a.type = ${accountType}
        and je.status = 'posted'
        and je.type not in ('debt_repayment')
        ${u ? sql`and je.user_id = ${u}` : sql``}
        and je.entry_date >= (current_date - (${months} || ' months')::interval)
      group by a.id, a.code, a.name, je.id, s.irt_amount
    )
    select acc_id as "accountId", code, name,
           coalesce(sum(total_usd),0)::text as total,
           coalesce(sum(case when total_usd != 0 then irt_amount else 0 end),0)::text as \"totalToman\",
           ${months}::int as months
    from per_entry
    group by acc_id, code, name
    having abs(coalesce(sum(total_usd),0)) > 0.000000001
    order by abs(sum(total_usd)) desc
  `);
}

/**
 * Net (income − expense) inside an arbitrary window — for Net Worth attribution.
 * Debt repayments are excluded (not an expense) and non-cash depreciation /
 * reserve entries are excluded (no cash movement) — savings is a cash concept.
 */
export async function getNetSavingsBetween(from: string, to: string, userId?: string): Promise<string> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' savings.
  if (!u && (await hasMultipleUsers())) return "0";
  const res = await rows<{ net: string }>(sql`
    select coalesce(sum(
      case when a.type = 'income' then -p.base_value
           when a.type = 'expense' then -p.base_value
           else 0 end), 0)::text as net
    from journal_entries je
      join postings p on p.entry_id = je.id
      join accounts a on a.id = p.account_id
      left join expense_categories ec on ec.id = je.category_id
    where je.status = 'posted' and a.type in ('income', 'expense')
      and je.type not in ('debt_repayment')
      and coalesce(ec.nature, 'cash') = 'cash'
      ${u ? sql`and je.user_id = ${u}` : sql``}
      and je.entry_date >= ${from} and je.entry_date <= ${to}
  `);
  return res[0]?.net ?? "0";
}

/**
 * Net-worth snapshot history (newest first) for the CURRENT tenant only.
 *
 * Read-only: this touches the `snapshots` history table exclusively — the
 * ledger, FIFO lots and every accounting primitive stay untouched. Isolation
 * is enforced in SQL (`where user_id = :currentUserId`), never by filtering
 * in application code, so one user's history can never reach another user's
 * dashboard, delta badge or chart.
 */
export async function getSnapshotSeries(limit = 40, userId?: string) {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: in a multi-tenant database an unresolved identity must never
  // fall back to a global (cross-user) read of the history table.
  if (!u && (await hasMultipleUsers())) return [];
  return rows<{ asOf: string; netWorth: string; totalAssets: string; totalLiabilities: string; baseCurrency: string }>(sql`
    select as_of::text as "asOf", net_worth::text as "netWorth",
           total_assets::text as "totalAssets", total_liabilities::text as "totalLiabilities",
           base_currency as "baseCurrency"
    from snapshots
    where 1=1
      ${u ? sql`and user_id = ${u}` : sql``}
    order by as_of desc
    limit ${limit}
  `);
}

/** Snapshot nearest to (and not after) a date — Net Worth range baselines. */
export async function getSnapshotAsOf(isoDate: string, userId?: string) {
  const u = await resolveQueryUserId(userId);
  if (!u && (await hasMultipleUsers())) return null;
  const res = await rows<{ asOf: string; netWorth: string; totalAssets: string; totalLiabilities: string }>(sql`
    select as_of::text as "asOf", net_worth::text as "netWorth",
           total_assets::text as "totalAssets", total_liabilities::text as "totalLiabilities"
    from snapshots
    where as_of <= ${isoDate}
      ${u ? sql`and user_id = ${u}` : sql``}
    order by as_of desc
    limit 1
  `);
  return res[0] ?? null;
}

/** Earliest snapshot on/after a date — used when no prior baseline exists. */
export async function getFirstSnapshotAfter(isoDate: string, userId?: string) {
  const u = await resolveQueryUserId(userId);
  if (!u && (await hasMultipleUsers())) return null;
  const res = await rows<{ asOf: string; netWorth: string; totalAssets: string; totalLiabilities: string }>(sql`
    select as_of::text as "asOf", net_worth::text as "netWorth",
           total_assets::text as "totalAssets", total_liabilities::text as "totalLiabilities"
    from snapshots
    where as_of >= ${isoDate}
      ${u ? sql`and user_id = ${u}` : sql``}
    order by as_of asc
    limit 1
  `);
  return res[0] ?? null;
}

/** Liability balance (derived from ledger) as derived total — no dates stored; snapshots give history. */
export async function getLiabilitiesTotal(userId?: string): Promise<string> {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: never blend tenants' liabilities.
  if (!u && (await hasMultipleUsers())) return "0";
  const res = await rows<{ total: string }>(sql`
    select coalesce(-sum(p.base_value) filter (where a.type = 'liability'), 0)::text as total
    from postings p
      join journal_entries je on je.id = p.entry_id
      join accounts a on a.id = p.account_id
    where je.status = 'posted'
      ${u ? sql`and je.user_id = ${u}` : sql``}
  `);
  return res[0]?.total ?? "0";
}

/** Accounting Query Service: Exposes capital flow records for analytics adapter */
export async function getCapitalFlowRecords(periodStart: string, periodEnd: string, userId?: string) {
  const u = await resolveQueryUserId(userId);
  // Fail-closed: capital-flow records are user financial data — never blend tenants.
  if (!u && (await hasMultipleUsers())) return [];
  return db
    .select({
      id: journalEntries.id,
      entryDate: journalEntries.entryDate,
      type: journalEntries.type,
      description: journalEntries.description,
      reference: journalEntries.reference,
      baseValue: postings.baseValue,
    })
    .from(postings)
    .innerJoin(journalEntries, eq(journalEntries.id, postings.entryId))
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(
      and(
        eq(journalEntries.status, "posted"),
        eq(accounts.type, "asset"),
        u ? eq(journalEntries.userId, u) : sql`1=1`,
        sql`${journalEntries.entryDate} >= ${periodStart}`,
        sql`${journalEntries.entryDate} <= ${periodEnd}`,
      ),
    );
}
