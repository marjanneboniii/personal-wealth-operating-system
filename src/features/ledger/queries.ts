import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D, Decimal } from "@/domain/decimal";
import type { AccountType } from "@/domain/accounting";

async function rows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  const res = await db.execute(query);
  return res.rows as T[];
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
export async function getAccountBalances(): Promise<AccountBalance[]> {
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
           coalesce(sum(p.quantity), 0)::text  as "quantity",
           coalesce(sum(p.base_value), 0)::text as "baseValue"
    from accounts a
      left join postings p on p.account_id = a.id
      left join journal_entries je on je.id = p.entry_id and je.status = 'posted'
      left join assets ast on ast.id = coalesce(p.asset_id, a.asset_id)
      left join wallets w on w.id = a.wallet_id
      left join asset_classes ac on ac.id = ast.class_id
    where a.deleted_at is null
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
export async function getHoldings(): Promise<Holding[]> {
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
           coalesce(sum(p.quantity), 0)::text as "quantity",
           coalesce(sum(p.base_value), 0)::text as "costBase",
           l.price_base::text as "price"
    from assets ast
      join asset_classes ac on ac.id = ast.class_id
      left join postings p on p.asset_id = ast.id
      left join journal_entries je on je.id = p.entry_id and je.status = 'posted'
      left join accounts a on a.id = p.account_id and a.type = 'asset'
      left join latest l on l.asset_id = ast.id
    where ast.deleted_at is null and (a.type = 'asset' or p.id is null)
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

export async function getNetWorth(): Promise<NetWorth> {
  const holdings = await getHoldings();
  const balances = await getAccountBalances();

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
  lines: { account: string; accountType: string; symbol: string; quantity: string; baseValue: string; decimals: number }[];
};

export async function getLedger(limit = 60): Promise<LedgerRow[]> {
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
             'baseValue', p.base_value::text
           ) order by p.base_value desc) filter (where p.id is not null), '[]') as lines
    from journal_entries je
      left join postings p on p.entry_id = je.id
      left join accounts a on a.id = p.account_id
      left join assets ast on ast.id = p.asset_id
    group by je.id
    order by je.entry_date desc, je.created_at desc
    limit ${limit}
  `);
}

export type LotRow = {
  id: string;
  assetId: string;
  symbol: string;
  openedAt: string;
  qtyRemaining: string;
  unitCostBase: string;
};

export async function getOpenLots(assetId?: string): Promise<LotRow[]> {
  return rows<LotRow>(sql`
    select l.id, l.asset_id as "assetId", ast.symbol,
           l.opened_at::text as "openedAt",
           l.qty_remaining::text as "qtyRemaining",
           l.unit_cost_base::text as "unitCostBase"
    from lots l join assets ast on ast.id = l.asset_id
    where l.qty_remaining > 0 ${assetId ? sql`and l.asset_id = ${assetId}` : sql``}
    order by l.opened_at asc
  `);
}

export async function getRealizedPnl(): Promise<{ total: string; bySymbol: { symbol: string; pnl: string }[] }> {
  const data = await rows<{ symbol: string; pnl: string }>(sql`
    select ast.symbol, sum(lc.realized_pnl)::text as pnl
    from lot_consumptions lc
      join lots l on l.id = lc.lot_id
      join assets ast on ast.id = l.asset_id
    group by ast.symbol order by 2 desc
  `);
  return {
    total: Decimal.sum(data.map((d) => d.pnl)).toString(),
    bySymbol: data,
  };
}

export async function getCashflow(months = 6) {
  return rows<{ month: string; inflow: string; outflow: string }>(sql`
    select to_char(date_trunc('month', je.entry_date), 'YYYY-MM-01') as month,
           coalesce(sum(case when a.type = 'income' then -p.base_value else 0 end), 0)::text as inflow,
           coalesce(sum(case when a.type = 'expense' then p.base_value else 0 end), 0)::text as outflow
    from journal_entries je
      join postings p on p.entry_id = je.id
      join accounts a on a.id = p.account_id
    where je.status = 'posted'
      and je.entry_date >= (current_date - (${months} || ' months')::interval)
    group by 1 order by 1
  `);
}
