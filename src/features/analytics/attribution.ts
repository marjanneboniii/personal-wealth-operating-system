import { D } from "@/domain/decimal";
import { AssetAttributionItem, AttributionReport } from "./types";

export type AssetPeriodValue = {
  assetId: string;
  symbol: string;
  name: string;
  startingValue: string;
  endingValue: string;
};

/**
 * Calculates asset performance attribution & identifies top contributors and losers
 */
export function calculateAttribution(
  items: AssetPeriodValue[],
  totalGrowthAmount: string,
): AttributionReport {
  const totalGrowth = D(totalGrowthAmount);

  const attributions: AssetAttributionItem[] = items.map((item) => {
    const start = D(item.startingValue);
    const end = D(item.endingValue);
    const absChange = end.sub(start);
    const pctChange = start.isZero() ? "0" : absChange.div(start).mul("100").toFixed(2);
    const contribPct = totalGrowth.isZero()
      ? "0"
      : absChange.div(totalGrowth.abs()).mul("100").toFixed(2);

    return {
      assetId: item.assetId,
      symbol: item.symbol,
      name: item.name,
      startingValue: start.toString(),
      endingValue: end.toString(),
      absoluteChange: absChange.toString(),
      percentageChange: pctChange,
      contributionPercentage: contribPct,
    };
  });

  // Sort by absolute change descending
  const sorted = [...attributions].sort(
    (a, b) => Number(b.absoluteChange) - Number(a.absoluteChange),
  );

  const topWinner = sorted.find((a) => D(a.absoluteChange).gt(0)) ?? null;
  const topLoser = sorted.slice().reverse().find((a) => D(a.absoluteChange).lt(0)) ?? null;

  // Largest risk source = asset with highest negative contribution or highest concentration
  const largestRiskSource = topLoser ?? sorted[0] ?? null;

  return {
    topWinner,
    topLoser,
    largestContributor: topWinner,
    largestRiskSource,
    attributions: sorted,
  };
}
