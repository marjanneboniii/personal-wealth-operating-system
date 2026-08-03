import { D } from "@/domain/decimal";
import { AssetPerformanceSummary } from "./types";

/**
 * Calculates absolute and percentage performance between two valuation checkpoints
 */
export function calculatePerformance(
  assetId: string,
  symbol: string,
  periodStart: string,
  periodEnd: string,
  startingValue: string,
  endingValue: string,
): AssetPerformanceSummary {
  const start = D(startingValue);
  const end = D(endingValue);
  const diff = end.sub(start);
  const pct = start.isZero() ? "0" : diff.div(start).mul("100").toFixed(2);

  return {
    assetId,
    symbol,
    periodStart,
    periodEnd,
    startingValue: start.toString(),
    endingValue: end.toString(),
    absoluteChange: diff.toString(),
    percentageChange: pct,
  };
}
