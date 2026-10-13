/**
 * میانگین خرید تومانی استیبل‌کوین — what a tether (or any USD stablecoin)
 * actually cost in Toman, from the transactions themselves.
 *
 * WHY NOT LOTS. A stablecoin is money in this app: buying or selling one is a
 * conversion (سواپ) that opens and consumes NO FIFO lot (features/trade/rules).
 * Only the setup wizard opens a lot for a tether row, and nothing ever consumes
 * it — so a lot-based cost kept the whole setup quantity forever and showed a
 * fake loss after the first sale. Lots are therefore read here only as the
 * record of a setup purchase (its Toman price and date), never as a position.
 *
 * THE RULE — weighted average cost, in Toman, in date order:
 *   • an entry that ADDS the coin to the user's accounts adds its Toman cost:
 *       – a setup row with a lot: qty × unit cost × the lot's purchase rate;
 *       – Toman left an account in the same entry (a swap from Toman): exactly
 *         that Toman, so the exchange's fee and spread are part of the cost;
 *       – otherwise its book value × the rate frozen on the entry (a sale of a
 *         coin into tether, an income in tether…), or today's rate when the
 *         entry has no frozen rate (then marked as estimated).
 *   • an entry that REMOVES it takes cost out at the running average.
 *   • a transfer between the user's own accounts nets to zero and is ignored.
 *
 * READ MODEL ONLY: it never writes a posting, a lot or a balance.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D, Decimal } from "@/domain/decimal";

export type StablecoinMove = {
  /** Net change of the coin across the user's asset accounts in one entry. */
  qty: string;
  /** Net book value (USD) of those postings. */
  base: string;
  /** Rate frozen on the entry (IRT per USD), if any. */
  fxRate: string | null;
  /** Toman that left the user's Toman accounts in the same entry. */
  tomanPaid: string;
  /** Setup lots opened by this entry for this coin. */
  lotQty: string;
  lotToman: string;
};

export type StablecoinCost = {
  /** Quantity the average is carried on (may differ from the live balance). */
  quantity: string;
  costToman: string;
  avgToman: string;
  /** Some acquisition had no frozen rate and was valued at today's rate. */
  estimated: boolean;
  /** Quantity acquired by paying Toman (vs. received in dollars or coins). */
  tomanPaidQuantity: string;
};

/** Folds one coin's moves (already in date order) into its average cost. */
export function foldStablecoinCost(moves: StablecoinMove[], todayRate: string): StablecoinCost {
  let held = Decimal.zero();
  let cost = Decimal.zero();
  let tomanPaidQty = Decimal.zero();
  let estimated = false;
  const fallback = D(todayRate);

  for (const m of moves) {
    const qty = D(m.qty);
    if (qty.isZero()) continue;
    if (qty.gt(0)) {
      let toman: Decimal;
      const lotQty = D(m.lotQty);
      if (lotQty.gt(0)) {
        toman = D(m.lotToman).mul(qty.div(lotQty));
      } else if (D(m.tomanPaid).gt(0)) {
        toman = D(m.tomanPaid);
        tomanPaidQty = tomanPaidQty.add(qty);
      } else if (m.fxRate && D(m.fxRate).gt(0)) {
        toman = D(m.base).abs().mul(m.fxRate);
      } else {
        toman = D(m.base).abs().mul(fallback);
        estimated = true;
      }
      held = held.add(qty);
      cost = cost.add(toman);
    } else if (held.gt(0)) {
      const out = qty.abs().lt(held) ? qty.abs() : held;
      const avg = cost.div(held);
      cost = cost.sub(avg.mul(out));
      held = held.sub(out);
      if (held.isZero()) cost = Decimal.zero();
    }
  }

  return {
    quantity: held.toString(),
    costToman: cost.toFixed(0),
    avgToman: held.gt(0) ? cost.div(held).toFixed(0) : "0",
    estimated,
    tomanPaidQuantity: tomanPaidQty.toString(),
  };
}

/** Average Toman cost per stablecoin asset, for the given assets of a user. */
export async function loadStablecoinTomanCost(
  assetIds: string[],
  userId: string | null,
  todayRate: string,
  client: any = db,
): Promise<Map<string, StablecoinCost>> {
  const out = new Map<string, StablecoinCost>();
  if (!assetIds.length) return out;
  const ids = sql.join(assetIds.map((id) => sql`${id}`), sql`,`);
  const res = await client.execute(sql`
    with legs as (
      select je.id as entry_id, je.entry_date, je.created_at,
             coalesce(p.asset_id, a.asset_id) as asset_id,
             sum(p.quantity) as qty, sum(p.base_value) as base
      from postings p
        join journal_entries je on je.id = p.entry_id and je.status = 'posted'
        join accounts a on a.id = p.account_id and a.type = 'asset'
      where coalesce(p.asset_id, a.asset_id) in (${ids})
        ${userId ? sql`and a.user_id = ${userId} and je.user_id = ${userId}` : sql``}
      group by je.id, je.entry_date, je.created_at, coalesce(p.asset_id, a.asset_id)
      having sum(p.quantity) <> 0
    )
    select legs.asset_id as "assetId",
           legs.qty::text as "qty",
           legs.base::text as "base",
           fx.fx_rate::text as "fxRate",
           coalesce((
             select sum(-p2.quantity * case when ast2.symbol = 'IRR' then 0.1 else 1 end)
             from postings p2
               join accounts a2 on a2.id = p2.account_id and a2.type = 'asset'
               join assets ast2 on ast2.id = coalesce(p2.asset_id, a2.asset_id)
             where p2.entry_id = legs.entry_id and p2.quantity < 0 and ast2.symbol in ('IRT', 'IRR')
           ), 0)::text as "tomanPaid",
           coalesce((
             select sum(l.qty_opened) from lots l
             where l.open_entry_id = legs.entry_id and l.asset_id = legs.asset_id
           ), 0)::text as "lotQty",
           coalesce((
             select sum(l.qty_opened * l.unit_cost_base * coalesce(l.purchase_fx_rate, fx.fx_rate, 0))
             from lots l
             where l.open_entry_id = legs.entry_id and l.asset_id = legs.asset_id
           ), 0)::text as "lotToman"
    from legs
      left join entry_fx_snapshots fx on fx.entry_id = legs.entry_id
    order by legs.entry_date asc, legs.created_at asc, legs.entry_id asc
  `);

  const byAsset = new Map<string, StablecoinMove[]>();
  for (const r of res.rows as Array<Record<string, string | null>>) {
    const id = r.assetId as string;
    byAsset.set(id, [
      ...(byAsset.get(id) ?? []),
      {
        qty: r.qty ?? "0",
        base: r.base ?? "0",
        fxRate: r.fxRate ?? null,
        tomanPaid: r.tomanPaid ?? "0",
        lotQty: r.lotQty ?? "0",
        lotToman: r.lotToman ?? "0",
      },
    ]);
  }
  for (const [id, moves] of byAsset) out.set(id, foldStablecoinCost(moves, todayRate));
  return out;
}
