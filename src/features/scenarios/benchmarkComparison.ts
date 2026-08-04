/**
 * Benchmark Comparison — Reuses existing analytics benchmark logic
 * DO NOT duplicate benchmark logic; import from analytics/benchmark.ts
 */
import { db } from "@/db";
import { assets, currencies } from "@/db/schema";
import { eq } from "drizzle-orm";
import { calculateBenchmarkComparison as existingBenchmarkComparison } from "@/features/analytics/benchmark";
import { fetchHistoricalPrice, fetchCurrentPrice } from "./simulation";
import { calculateInitialQuantity, calculateCurrentValue, calculateProfitLoss, calculateRoiPercentage, calculateAnnualizedReturn } from "./calculator";
import type { BenchmarkComparisonResult, SimulationResult } from "./types";

export type BenchmarkAssetLookup = {
  assetId: string;
  symbol: string;
  name: string;
};

/**
 * Build BenchmarkComparisonResults for a given scenario result
 * vs array of benchmark assets (BTC, GOLD, SP500, USD etc.)
 *
 * Formula:
 * - For each benchmark asset, compute what-if investment of same capital on same start date:
 *   benchQty = initialCapital / benchStartPrice
 *   benchCurrentValue = benchQty * benchCurrentPrice
 *   benchRoi = (benchCurrentValue - initialCapital)/initialCapital*100
 * - Alpha = scenarioRoi - benchRoi
 */
export async function buildBenchmarkComparisons(
  scenarioResult: SimulationResult,
  benchmarkSymbols: string[],
): Promise<BenchmarkComparisonResult[]> {
  const results: BenchmarkComparisonResult[] = [];

  for (const symbol of benchmarkSymbols) {
    // Lookup asset by symbol in assets table (single identity)
    const [assetRow] = await db.select().from(assets).where(eq(assets.symbol, symbol)).limit(1);

    if (!assetRow) {
      // Symbol not found as asset — try to treat as benchmark definition? For now skip.
      // In analytics, benchmark definitions are separate table, but for scenario we require assets table identity per spec.
      // If not found, skip or use definition? We'll skip with warning.
      continue;
    }

    const benchStartPrice = await fetchHistoricalPrice(assetRow.id, scenarioResult.startDate);
    const benchCurrentPrice = await fetchCurrentPrice(assetRow.id);

    if (!benchStartPrice || !benchCurrentPrice) {
      // Missing price data — skip, do not fake
      continue;
    }

    const qty = calculateInitialQuantity(scenarioResult.initialCapital, benchStartPrice);
    const curVal = calculateCurrentValue(qty, benchCurrentPrice);
    const pnl = calculateProfitLoss(curVal, scenarioResult.initialCapital);
    const roi = calculateRoiPercentage(pnl, scenarioResult.initialCapital);

    const alpha = (Number(scenarioResult.roiPercentage) - Number(roi)).toFixed(2);
    const outperformed = Number(alpha) >= 0;

    results.push({
      symbol,
      name: assetRow.name,
      startPrice: benchStartPrice,
      currentPrice: benchCurrentPrice,
      quantity: qty,
      currentValue: curVal,
      roiPercentage: roi,
      alphaPercentage: alpha,
      outperformed,
    });
  }

  return results;
}

/**
 * Wrapper that reuses existing analytics benchmark calculation for portfolio vs benchmarks,
 * but adapted for scenario ROI.
 *
 * Existing function: calculateBenchmarkComparison(portfolioReturnPct, benchmarks[])
 * where benchmarks = [{symbol, name, returnPercentage}]
 *
 * We map our BenchmarkComparisonResult into that shape to reuse logic.
 */
export function reuseExistingBenchmarkLogic(
  scenarioRoiPercentage: string,
  benchmarkComparisons: BenchmarkComparisonResult[],
) {
  const benchmarkReturnData = benchmarkComparisons.map((b) => ({
    symbol: b.symbol,
    name: b.name,
    returnPercentage: b.roiPercentage,
  }));

  // Reuse existing logic — this is required per spec
  return existingBenchmarkComparison(scenarioRoiPercentage, benchmarkReturnData);
}

/**
 * Convenience: Evaluate scenario ROI vs benchmarks and produce both custom results + existing analytics alpha
 */
export async function compareScenarioWithBenchmarks(
  scenarioResult: SimulationResult,
  benchmarkSymbols: string[],
) {
  const comparisons = await buildBenchmarkComparisons(scenarioResult, benchmarkSymbols);
  const alphaItems = reuseExistingBenchmarkLogic(scenarioResult.roiPercentage, comparisons);

  // Merge to include standardized alpha calculation from existing logic
  const merged = comparisons.map((c) => {
    const alphaFromExisting = alphaItems.find((a) => a.symbol === c.symbol);
    return {
      ...c,
      alphaPercentage: alphaFromExisting?.alphaPercentage ?? c.alphaPercentage,
      outperformed: alphaFromExisting?.outperformed ?? c.outperformed,
    };
  });

  return {
    comparisons: merged,
    alphaItems,
  };
}

/**
 * Lookup benchmark asset IDs by symbols — helper for asset comparison
 */
export async function lookupBenchmarkAssets(symbols: string[]): Promise<BenchmarkAssetLookup[]> {
  const results: BenchmarkAssetLookup[] = [];
  for (const sym of symbols) {
    const [row] = await db.select().from(assets).where(eq(assets.symbol, sym)).limit(1);
    if (row) {
      results.push({ assetId: row.id, symbol: row.symbol, name: row.name });
    }
  }
  return results;
}
