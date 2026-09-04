/**
 * Per-asset DCA (average acquisition cost) for MIXED-CURRENCY purchases.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * An Iranian portfolio routinely buys the SAME asset with different
 * denominations over time: 0.5 ETH with Toman at 95 000 000 IRT/USD, later
 * 0.2 ETH with USDT from a hot wallet, later 0.1 ETH with dollars. The ledger
 * stores every lot in ONE canonical book currency (USD) plus the *native*
 * quantity, so a naive "average price" derived from the USD figures silently
 * re-rates history at today's exchange rate: after a rial devaluation the
 * average buy price looks artificially high in Toman and the unrealized P&L is
 * wrong in the currency the user actually thinks in.
 *
 * THE RULE (frozen rate at transaction time — never today's rate)
 * ---------------------------------------------------------------
 *   FX_Rate_At_Tx     = entry_fx_snapshots.fx_rate of the BUY entry (IRT per USD)
 *   TotalCost(USD)    = Σ  qty × unit_cost_base(USD)
 *   TotalCost(IRT)    = Σ  qty × unit_cost_base(USD) × FX_Rate_At_Tx
 *   DCA_Unit_Price(USD)   = TotalCost(USD) / Σ qty
 *   DCA_Unit_Price(IRT)   = TotalCost(IRT) / Σ qty
 *   UnrealizedPnL(IRT)= marketValue(IRT) − TotalCost(IRT)
 * A lot bought in Toman therefore keeps its Toman cost forever; a lot bought in
 * USDT/USD is converted at the rate that was in force the day it was bought.
 *
 * A READ MODEL ONLY. It aggregates `lots` (which the FIFO engine owns) and the
 * immutable FX snapshots; it never opens, consumes or rewrites a lot, and it
 * never changes a posting or the Σ = 0 invariant.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { D, Decimal } from "@/domain/decimal";
import { isOrphanedRwaAssetWithClass } from "@/features/rwa/orphanFilter";

export type AssetDca = {
  assetId: string;
  /** Σ qty of the lots that are still open (the position being valued). */
  quantityHeld: string;
  /** Σ (qty × unit cost) of the open lots, in the USD book currency. */
  totalCostUsd: string;
  /** The same cost expressed in Toman at the rate frozen on each buy. */
  totalCostToman: string;
  /** USD per unit — the canonical "میانگین قیمت تمام‌شده". */
  dcaUnitPriceUsd: string;
  /** Toman per unit — the figure a Toman-thinking user compares to a price. */
  dcaUnitPriceToman: string;
  /** Lifetime totals across EVERY buy of this asset (sold lots included). */
  quantityBought: string;
  totalInvestedUsd: string;
  totalInvestedToman: string;
  /** Buys made with Toman (their cost is a static Toman anchor). */
  tomanDenominatedQuantity: string;
  /** Buys made with a USD-family unit (their cost is fixed in USD). */
  usdDenominatedQuantity: string;
  /**
   * True when at least one lot has no frozen rate (a pre-snapshot entry), in
   * which case its Toman cost was derived with TODAY's rate and must be shown
   * as an estimate («برآورد»), never as a historical figure.
   */
  hasEstimatedFx: boolean;
  /** The rate used for those estimated lots, for the UI footnote. */
  fallbackFxRate: string;
  lotCount: number;
};

const ZERO_DCA = (assetId: string, fallbackFxRate: string): AssetDca => ({
  assetId,
  quantityHeld: "0",
  totalCostUsd: "0",
  totalCostToman: "0",
  dcaUnitPriceUsd: "0",
  dcaUnitPriceToman: "0",
  quantityBought: "0",
  totalInvestedUsd: "0",
  totalInvestedToman: "0",
  tomanDenominatedQuantity: "0",
  usdDenominatedQuantity: "0",
  hasEstimatedFx: false,
  fallbackFxRate,
  lotCount: 0,
});

/**
 * Pure aggregation of one asset's lot rows. Exported for tests — the numbers
 * below are exactly what the portfolio UI and the DCA column must display.
 */
export function computeAssetDca(
  assetId: string,
  rows: Array<{
    qtyOpened: string;
    qtyRemaining: string;
    unitCostBase: string;
    fxRate: string | null;
    /** denomination of the account that paid for this lot (IRT | USDT | USD …) */
    paySymbol?: string | null;
  }>,
  fallbackFxRate: string,
): AssetDca {
  const rate = D(fallbackFxRate);
  const fallback = rate.gt(0) ? rate : D("1");

  let heldQty = Decimal.zero();
  let heldUsd = Decimal.zero();
  let heldToman = Decimal.zero();
  let boughtQty = Decimal.zero();
  let boughtUsd = Decimal.zero();
  let boughtToman = Decimal.zero();
  let tomanQty = Decimal.zero();
  let usdQty = Decimal.zero();
  let estimated = false;

  for (const row of rows) {
    const remaining = D(row.qtyRemaining);
    const opened = D(row.qtyOpened);
    const unitUsd = D(row.unitCostBase);
    const rawRate = row.fxRate == null ? null : D(row.fxRate);
    const txRate = rawRate && rawRate.gt(0) ? rawRate : null;
    if (!txRate && (remaining.gt(0) || opened.gt(0))) estimated = true;
    const usedRate = txRate ?? fallback;

    boughtQty = boughtQty.add(opened);
    boughtUsd = boughtUsd.add(opened.mul(unitUsd));
    boughtToman = boughtToman.add(opened.mul(unitUsd).mul(usedRate));
    heldQty = heldQty.add(remaining);
    heldUsd = heldUsd.add(remaining.mul(unitUsd));
    heldToman = heldToman.add(remaining.mul(unitUsd).mul(usedRate));

    // Which denomination was actually PAID? A Toman-unit buy is a static Toman
    // anchor; a USD/USDT-unit buy is fixed in dollars.
    const symbol = (row.paySymbol ?? "").toUpperCase();
    if (symbol === "IRT" || symbol === "IRR") tomanQty = tomanQty.add(opened);
    else usdQty = usdQty.add(opened);
  }

  const unitUsd = heldQty.gt(0) ? heldUsd.div(heldQty) : D("0");
  const unitToman = heldQty.gt(0) ? heldToman.div(heldQty) : D("0");

  return {
    assetId,
    quantityHeld: heldQty.toString(),
    totalCostUsd: heldUsd.toString(),
    totalCostToman: heldToman.toFixed(0),
    dcaUnitPriceUsd: unitUsd.toFixed(2),
    dcaUnitPriceToman: unitToman.toFixed(0),
    quantityBought: boughtQty.toString(),
    totalInvestedUsd: boughtUsd.toString(),
    totalInvestedToman: boughtToman.toFixed(0),
    tomanDenominatedQuantity: tomanQty.toString(),
    usdDenominatedQuantity: usdQty.toString(),
    hasEstimatedFx: estimated,
    fallbackFxRate: fallback.toString(),
    lotCount: rows.length,
  };
}

/**
 * One lot row as the aggregator needs it. `paySymbol` is the denomination of
 * the account that actually PAID for the lot (the entry's largest negative
 * asset posting), which is what makes a mixed Toman/USDT portfolio readable:
 * the same coin can have been bought with rials once and with USDT twice.
 */
type DcaLotRow = {
  qtyOpened: string;
  qtyRemaining: string;
  unitCostBase: string;
  fxRate: string | null;
  paySymbol: string | null;
};

/**
 * The whole aggregation in one statement: lots (+ their frozen rate + their
 * paying denomination). `assetIds` empty ⇒ every asset of the tenant.
 */
function dcaSql(assetIds: string[] | null, userId: string | null): ReturnType<typeof sql> {
  return sql`
    select l.asset_id                 as "assetId",
           l.qty_opened::text         as "qtyOpened",
           l.qty_remaining::text      as "qtyRemaining",
           l.unit_cost_base::text     as "unitCostBase",
           fx.fx_rate::text           as "fxRate",
           pay_ast.symbol             as "paySymbol"
    from lots l
      join assets ast on ast.id = l.asset_id
      join asset_classes ac on ac.id = ast.class_id
      left join entry_fx_snapshots fx on fx.entry_id = l.open_entry_id
      left join lateral (
        select a2.asset_id
        from postings p2
          join accounts a2 on a2.id = p2.account_id
        where p2.entry_id = l.open_entry_id
          and a2.type = 'asset'
          and p2.base_value < 0
        order by p2.base_value asc
        limit 1
      ) pay on true
      left join assets pay_ast on pay_ast.id = pay.asset_id
    where ast.deleted_at is null
      and not ${isOrphanedRwaAssetWithClass("ast", "ac")}
      ${userId ? sql`and l.user_id = ${userId}` : sql``}
      ${assetIds && assetIds.length ? sql`and l.asset_id in (${sql.join(assetIds.map((id) => sql`${id}`), sql`,`)})` : sql``}
  `;
}

function group(rows: Array<Record<string, string | null>>): Map<string, DcaLotRow[]> {
  const out = new Map<string, DcaLotRow[]>();
  for (const raw of rows) {
    const assetId = raw.assetId as string;
    const row: DcaLotRow = {
      qtyOpened: raw.qtyOpened ?? "0",
      qtyRemaining: raw.qtyRemaining ?? "0",
      unitCostBase: raw.unitCostBase ?? "0",
      fxRate: raw.fxRate ?? null,
      paySymbol: raw.paySymbol ?? null,
    };
    out.set(assetId, [...(out.get(assetId) ?? []), row]);
  }
  return out;
}

/**
 * DCA for every asset the tenant has ever bought (lots table), keyed by
 * assetId. Assets with no lots (a position registered directly, e.g. a vehicle
 * from the registry) simply have no entry — callers must fall back to their own
 * purchase record, exactly as the valuation service already does.
 */
export async function loadDcaByAsset(
  userId: string | null,
  fallbackFxRate: string,
  client: any = db,
): Promise<Map<string, AssetDca>> {
  const res = await client.execute(dcaSql(null, userId));
  const out = new Map<string, AssetDca>();
  for (const [assetId, rows] of group(res.rows as Array<Record<string, string | null>>)) {
    out.set(assetId, computeAssetDca(assetId, rows, fallbackFxRate));
  }
  return out;
}

/**
 * Same numbers for a set of assets only (used by the assets list and the
 * portfolio page, which must not aggregate the whole lots table).
 */
export async function loadDcaForAssets(
  assetIds: string[],
  userId: string | null,
  fallbackFxRate: string,
  client: any = db,
): Promise<Map<string, AssetDca>> {
  const out = new Map<string, AssetDca>();
  if (!assetIds.length) return out;
  const res = await client.execute(dcaSql(assetIds, userId));
  for (const [assetId, rows] of group(res.rows as Array<Record<string, string | null>>)) {
    out.set(assetId, computeAssetDca(assetId, rows, fallbackFxRate));
  }
  for (const id of assetIds) if (!out.has(id)) out.set(id, ZERO_DCA(id, fallbackFxRate));
  return out;
}

/**
 * Was this acquisition paid in Toman? Used by the UI to label the cost anchor
 * («مبتنی بر تومان» vs «مبتنی بر دلار»): a Toman cost is static, a USD cost is
 * converted to Toman at today's rate.
 */
export function isTomanAnchored(dca: AssetDca | undefined): boolean {
  if (!dca) return false;
  return D(dca.tomanDenominatedQuantity).gt(0) && !D(dca.usdDenominatedQuantity).gt(0);
}
