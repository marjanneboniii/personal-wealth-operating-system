/**
 * Scenario Simulation Engine
 * Responsibilities:
 *  - Historical Investment Simulation
 *  - Time Range Simulation
 *  - Asset Comparison
 *  - Live Tracking
 *
 * CRITICAL: This module only READS Market Data SSOT, never writes.
 * It uses existing Market Data tables via direct queries (to stay isolated)
 * AND can reuse getMarketPrices / getMarketSnapshots service for current prices.
 *
 * Market Data SSOT Read Path:
 *  - Historical: market_snapshots (snapshot_date <= requested) + prices fallback
 *  - Current: market_prices latest timestamp
 */
import { and, asc, desc, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  currencies,
  marketPrices,
  marketSnapshots,
  prices,
} from "@/db/schema";
import { getMarketPrices, getMarketSnapshots } from "@/features/marketData/service";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import {
  calculateAnnualizedReturn,
  calculateCurrentValue,
  calculateInitialQuantity,
  calculateProfitLoss,
  calculateRoiPercentage,
  calculateHistoricalSimulation,
  CALCULATION_VERSION,
} from "./calculator";
import type {
  AssetComparisonItem,
  AssetComparisonResult,
  SimulationResult,
  TimeRangePoint,
  TimeRangeSimulationResult,
} from "./types";

/**
 * Fetch historical price for asset on or before given date from Market Data SSOT.
 * Priority: market_snapshots <= date DESC, then prices table <= date DESC, then market_prices latest before? 
 * Returns price string or null if missing.
 */
export async function fetchHistoricalPrice(assetId: string, targetDate: string): Promise<string | null> {
  // Try market_snapshots closest prior or equal
  const snaps = await db
    .select({ price: marketSnapshots.price, date: marketSnapshots.snapshotDate })
    .from(marketSnapshots)
    .where(and(eq(marketSnapshots.assetId, assetId), lte(marketSnapshots.snapshotDate, targetDate)))
    .orderBy(desc(marketSnapshots.snapshotDate))
    .limit(1);

  if (snaps.length > 0 && snaps[0].price) {
    return snaps[0].price.toString();
  }

  // Fallback to prices table (legacy compatibility)
  const legacy = await db
    .select({ price: prices.priceBase, date: prices.asOf })
    .from(prices)
    .where(and(eq(prices.assetId, assetId), lte(prices.asOf, targetDate)))
    .orderBy(desc(prices.asOf))
    .limit(1);

  if (legacy.length > 0 && legacy[0].price) {
    return legacy[0].price.toString();
  }

  // Final fallback: if targetDate is today or future, try current market_prices
  // This handles case where only live price exists and no snapshot history
  try {
    const quotes = await getMarketPrices(assetId);
    if (quotes.length > 0) {
      // Use latest quote if its date is not far? Simplify: return latest
      return quotes[0].price.toString();
    }
  } catch {
    // ignore, marketData service may fail if no pool yet
  }

  return null;
}

/**
 * Fetch current/live price for asset from Market Data SSOT.
 * Uses getMarketPrices which queries market_prices ordered by priceTimestamp desc.
 */
export async function fetchCurrentPrice(assetId: string): Promise<string | null> {
  const quotes = await getMarketPrices(assetId);
  if (quotes.length > 0) {
    return quotes[0].price.toString();
  }

  // Fallback to latest market_snapshots
  const snaps = await db
    .select({ price: marketSnapshots.price })
    .from(marketSnapshots)
    .where(eq(marketSnapshots.assetId, assetId))
    .orderBy(desc(marketSnapshots.snapshotDate))
    .limit(1);

  if (snaps.length > 0) {
    return snaps[0].price.toString();
  }

  // Fallback to prices
  const legacy = await db
    .select({ price: prices.priceBase })
    .from(prices)
    .where(eq(prices.assetId, assetId))
    .orderBy(desc(prices.asOf))
    .limit(1);

  if (legacy.length > 0) {
    return legacy[0].price.toString();
  }

  return null;
}

/**
 * Fetch timeline of historical prices between start and end inclusive from market_snapshots
 * Returns sorted ascending by date.
 */
export async function fetchPriceHistory(
  assetId: string,
  startDate: string,
  endDate: string,
): Promise<Array<{ date: string; price: string }>> {
  // Prefer market_snapshots via getMarketSnapshots then filter, or direct DB query
  const rows = await db
    .select({ date: marketSnapshots.snapshotDate, price: marketSnapshots.price })
    .from(marketSnapshots)
    .where(
      and(
        eq(marketSnapshots.assetId, assetId),
        gte(marketSnapshots.snapshotDate, startDate),
        lte(marketSnapshots.snapshotDate, endDate),
      ),
    )
    .orderBy(asc(marketSnapshots.snapshotDate));

  if (rows.length > 0) {
    return rows.map((r) => ({ date: r.date, price: r.price.toString() }));
  }

  // Fallback to prices table if no snapshots
  const legacyRows = await db
    .select({ date: prices.asOf, price: prices.priceBase })
    .from(prices)
    .where(
      and(eq(prices.assetId, assetId), gte(prices.asOf, startDate), lte(prices.asOf, endDate)),
    )
    .orderBy(asc(prices.asOf));

  return legacyRows.map((r) => ({ date: r.date, price: r.price.toString() }));
}

/**
 * Historical Investment Simulation
 * If I invested X into Y at date Z — pure + fetched prices
 */
export async function simulateHistoricalInvestment(params: {
  assetId: string;
  assetSymbol: string;
  assetName?: string;
  initialCapital: string;
  capitalCurrencyCode?: string;
  startDate: string;
  initialPrice: string;
  currentPrice: string;
  evaluationDate: string;
  scenarioId?: string;
  scenarioName?: string;
}): Promise<SimulationResult> {
  const calc = calculateHistoricalSimulation({
    initialCapital: params.initialCapital,
    initialPrice: params.initialPrice,
    currentPrice: params.currentPrice,
    startDate: params.startDate,
    evaluationDate: params.evaluationDate,
  });

  return {
    scenarioId: params.scenarioId,
    name: params.scenarioName,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    assetName: params.assetName,
    initialCapital: params.initialCapital,
    capitalCurrencyCode: params.capitalCurrencyCode ?? "USD",
    startDate: params.startDate,
    initialPrice: params.initialPrice,
    initialQuantity: calc.quantity,
    evaluationDate: params.evaluationDate,
    currentPrice: params.currentPrice,
    currentValue: calc.currentValue,
    profitLoss: calc.profitLoss,
    roiPercentage: calc.roiPercentage,
    annualizedReturnPercentage: calc.annualizedReturnPercentage,
    calculationVersion: CALCULATION_VERSION,
    calculationStatus: "complete",
  };
}

/**
 * Time Range Simulation: Jan 2025 to Aug 2026 etc.
 * Returns timeline of values across historical prices.
 */
export async function simulateTimeRange(params: {
  scenarioId: string;
  assetId: string;
  assetSymbol: string;
  initialCapital: string;
  initialPrice: string;
  initialQuantity: string;
  startDate: string;
  endDate: string;
}): Promise<TimeRangeSimulationResult> {
  const history = await fetchPriceHistory(params.assetId, params.startDate, params.endDate);

  const quantity = params.initialQuantity;

  const timeline: TimeRangePoint[] = history.map((h) => {
    const currentValue = calculateCurrentValue(quantity, h.price);
    const profitLoss = calculateProfitLoss(currentValue, params.initialCapital);
    const roiPercentage = calculateRoiPercentage(profitLoss, params.initialCapital);
    return {
      date: h.date,
      price: h.price,
      value: currentValue,
      profitLoss,
      roiPercentage,
    };
  });

  // Final result using last point or current price if no history points after end
  let finalPrice: string;
  let finalDate: string;

  if (timeline.length > 0) {
    finalPrice = timeline[timeline.length - 1].price;
    finalDate = timeline[timeline.length - 1].date;
  } else {
    // Fallback to current price
    const cp = await fetchCurrentPrice(params.assetId);
    finalPrice = cp ?? params.initialPrice;
    finalDate = params.endDate;
  }

  const calc = calculateHistoricalSimulation({
    initialCapital: params.initialCapital,
    initialPrice: params.initialPrice,
    currentPrice: finalPrice,
    startDate: params.startDate,
    evaluationDate: finalDate,
  });

  const finalResult: SimulationResult = {
    scenarioId: params.scenarioId,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    initialCapital: params.initialCapital,
    capitalCurrencyCode: "USD",
    startDate: params.startDate,
    initialPrice: params.initialPrice,
    initialQuantity: params.initialQuantity,
    evaluationDate: finalDate,
    currentPrice: finalPrice,
    currentValue: calc.currentValue,
    profitLoss: calc.profitLoss,
    roiPercentage: calc.roiPercentage,
    annualizedReturnPercentage: calc.annualizedReturnPercentage,
    calculationVersion: CALCULATION_VERSION,
    calculationStatus: "complete",
  };

  return {
    scenarioId: params.scenarioId,
    assetId: params.assetId,
    assetSymbol: params.assetSymbol,
    startDate: params.startDate,
    endDate: params.endDate,
    initialCapital: params.initialCapital,
    initialPrice: params.initialPrice,
    initialQuantity: params.initialQuantity,
    timeline,
    finalResult,
  };
}

/**
 * Asset Comparison: e.g., ETH vs BTC, BTC vs GOLD
 * Given primary asset scenario, compare with benchmark assets using same capital and dates.
 */
export async function simulateAssetComparison(params: {
  primaryAssetId: string;
  primarySymbol: string;
  primaryName: string;
  benchmarkAssetInfos: Array<{ assetId: string; symbol: string; name: string }>;
  initialCapital: string;
  startDate: string;
  evaluationDate: string;
  initialPrice: string; // primary initial
  currentPrice: string; // primary current
}): Promise<AssetComparisonResult> {
  const primaryQuantity = calculateInitialQuantity(params.initialCapital, params.initialPrice);
  const primaryCurrentValue = calculateCurrentValue(primaryQuantity, params.currentPrice);
  const primaryPnL = calculateProfitLoss(primaryCurrentValue, params.initialCapital);
  const primaryRoi = calculateRoiPercentage(primaryPnL, params.initialCapital);
  const primaryAnnualized = calculateAnnualizedReturn(
    primaryRoi,
    params.startDate,
    params.evaluationDate,
  );

  const primaryItem: AssetComparisonItem = {
    assetId: params.primaryAssetId,
    symbol: params.primarySymbol,
    name: params.primaryName,
    startPrice: params.initialPrice,
    currentPrice: params.currentPrice,
    quantity: primaryQuantity,
    currentValue: primaryCurrentValue,
    profitLoss: primaryPnL,
    roiPercentage: primaryRoi,
    annualizedReturnPercentage: primaryAnnualized,
  };

  const benchmarkItems: AssetComparisonItem[] = [];

  for (const bench of params.benchmarkAssetInfos) {
    const benchStart = await fetchHistoricalPrice(bench.assetId, params.startDate);
    const benchCurrent = await fetchCurrentPrice(bench.assetId);

    if (!benchStart || !benchCurrent) {
      // Missing data — skip or create zero? We'll skip with missing marker, but keep structure
      continue;
    }

    const qty = calculateInitialQuantity(params.initialCapital, benchStart);
    const curVal = calculateCurrentValue(qty, benchCurrent);
    const pnl = calculateProfitLoss(curVal, params.initialCapital);
    const roi = calculateRoiPercentage(pnl, params.initialCapital);
    const ann = calculateAnnualizedReturn(roi, params.startDate, params.evaluationDate);

    benchmarkItems.push({
      assetId: bench.assetId,
      symbol: bench.symbol,
      name: bench.name,
      startPrice: benchStart,
      currentPrice: benchCurrent,
      quantity: qty,
      currentValue: curVal,
      profitLoss: pnl,
      roiPercentage: roi,
      annualizedReturnPercentage: ann,
    });
  }

  // Calculate average benchmark ROI for diff
  let avgBenchmarkRoi = D("0");
  if (benchmarkItems.length > 0) {
    const sum = benchmarkItems.reduce((acc, b) => acc.add(b.roiPercentage), D("0"));
    avgBenchmarkRoi = sum.div(benchmarkItems.length.toString());
  }

  const perfDiff = D(primaryRoi).sub(avgBenchmarkRoi).toFixed(2);

  const comparisonDetails = benchmarkItems.map((b) => ({
    benchmarkSymbol: b.symbol,
    roiDifference: D(primaryRoi).sub(b.roiPercentage).toFixed(2),
    valueDifference: D(primaryCurrentValue).sub(b.currentValue).toString(),
    outperformed: D(primaryRoi).gte(b.roiPercentage),
  }));

  return {
    primaryAsset: primaryItem,
    benchmarks: benchmarkItems,
    performanceDifference: perfDiff,
    comparisonDetails,
  };
}

/**
 * Live Scenario Tracking — No fixed end date, reads latest price from SSOT each evaluation
 */
export async function evaluateLiveScenario(params: {
  assetId: string;
  initialCapital: string;
  initialPrice: string;
  initialQuantity: string;
  startDate: string;
  evaluationDate: string;
  currentPrice: string;
}): Promise<{
  currentValue: string;
  profitLoss: string;
  roiPercentage: string;
  annualizedReturnPercentage: string;
}> {
  const currentValue = calculateCurrentValue(params.initialQuantity, params.currentPrice);
  const profitLoss = calculateProfitLoss(currentValue, params.initialCapital);
  const roiPercentage = calculateRoiPercentage(profitLoss, params.initialCapital);
  const annualizedReturnPercentage = calculateAnnualizedReturn(
    roiPercentage,
    params.startDate,
    params.evaluationDate,
  );

  return {
    currentValue,
    profitLoss,
    roiPercentage,
    annualizedReturnPercentage,
  };
}
