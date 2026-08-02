import { D, Decimal } from "./decimal";

export type OpenLot = {
  id: string;
  openedAt: string;
  qtyRemaining: string;
  unitCostBase: string;
};

export type LotAllocation = {
  lotId: string;
  quantity: string;
  costBase: string;
  proceedsBase: string;
  realizedPnl: string;
  newQtyRemaining: string;
};

export type FifoResult = {
  allocations: LotAllocation[];
  totalCost: string;
  totalProceeds: string;
  realizedPnl: string;
  unmatchedQty: string;
};

/**
 * Consume open lots in FIFO order for a sale of `qty` units with `proceedsBase`
 * total proceeds. Realized P&L = proceeds − cost basis, allocated pro-rata.
 */
export function consumeFifo(
  lotsIn: OpenLot[],
  qty: string,
  proceedsBase: string,
): FifoResult {
  const sorted = [...lotsIn].sort((a, b) => a.openedAt.localeCompare(b.openedAt));
  const totalQty = D(qty);
  let remaining = totalQty;
  const unitProceeds = totalQty.isZero() ? Decimal.zero() : D(proceedsBase).div(totalQty);
  const allocations: LotAllocation[] = [];
  let totalCost = Decimal.zero();
  let totalProceeds = Decimal.zero();

  for (const lot of sorted) {
    if (remaining.lte(0)) break;
    const avail = D(lot.qtyRemaining);
    if (avail.lte(0)) continue;
    const take = remaining.min(avail);
    const cost = take.mul(lot.unitCostBase);
    const proceeds = take.mul(unitProceeds);
    allocations.push({
      lotId: lot.id,
      quantity: take.toString(),
      costBase: cost.toString(),
      proceedsBase: proceeds.toString(),
      realizedPnl: proceeds.sub(cost).toString(),
      newQtyRemaining: avail.sub(take).toString(),
    });
    totalCost = totalCost.add(cost);
    totalProceeds = totalProceeds.add(proceeds);
    remaining = remaining.sub(take);
  }

  return {
    allocations,
    totalCost: totalCost.toString(),
    totalProceeds: totalProceeds.toString(),
    realizedPnl: totalProceeds.sub(totalCost).toString(),
    unmatchedQty: remaining.toString(),
  };
}

/** Weighted average cost — reported alongside FIFO. */
export function averageCost(lotsIn: OpenLot[]): string {
  let qty = Decimal.zero();
  let cost = Decimal.zero();
  for (const l of lotsIn) {
    const q = D(l.qtyRemaining);
    if (q.lte(0)) continue;
    qty = qty.add(q);
    cost = cost.add(q.mul(l.unitCostBase));
  }
  return qty.isZero() ? "0" : cost.div(qty).toString();
}
