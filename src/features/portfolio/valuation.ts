import { D, Decimal } from "@/domain/decimal";

/**
 * Calculates current market value: Asset Quantity * Latest Market Price
 */
export function calculateAssetValue(quantity: string, marketPrice: string): string {
  const qty = D(quantity);
  const price = D(marketPrice);
  return qty.mul(price).toString();
}

/**
 * Calculates unrealized profit/loss: Current Value - Cost Basis
 */
export function calculateUnrealizedPnl(currentValue: string, costBasis: string): string {
  const value = D(currentValue);
  const cost = D(costBasis);
  return value.sub(cost).toString();
}

/**
 * Calculates Return on Investment percentage: ((Current Value - Cost Basis) / Cost Basis) * 100
 */
export function calculateRoi(currentValue: string, costBasis: string): string {
  const cost = D(costBasis);
  if (cost.isZero() || cost.isNegative()) return "0";
  const pnl = D(currentValue).sub(cost);
  return pnl.div(cost).mul("100").toFixed(2);
}
