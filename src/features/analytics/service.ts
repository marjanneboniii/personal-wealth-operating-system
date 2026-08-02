import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsRuns,
  benchmarkDefinitions,
  portfolioSnapshots,
} from "@/db/schema";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { calculateGrowth } from "./performance";
import { calculateAttribution } from "./attribution";
import { calculateBenchmarkComparison } from "./benchmark";
import { calculateRiskMetrics } from "./risk";
import { generateWealthTimeline } from "./timeline";
import { DefaultExternalCapitalFlowProvider } from "./capitalFlows";
import { AnalyticsDashboardSummary } from "./types";

/**
 * Ensure default analytical benchmark definitions exist in benchmark_definitions.
 *
 * CRITICAL ISOLATION GUARANTEE:
 * Benchmark definitions live exclusively in benchmark_definitions.
 * They are NEVER inserted into accounts, journal_entries, or postings.
 */
export async function ensureBenchmarkDefinitions() {
  const defaults = [
    { symbol: "BTC", name: "بیت‌کوین (BTC)", type: "crypto", description: "شاخص عملکرد بیت‌کوین" },
    { symbol: "GOLD", name: "طلا (GOLD)", type: "commodity", description: "شاخص عملکرد طلا" },
    { symbol: "SP500", name: "S&P 500 Index", type: "index", description: "شاخص بورس آمریکا" },
    { symbol: "USD", name: "دلار (USD)", type: "fiat", description: "نقدینگی دلار" },
  ];

  for (const b of defaults) {
    await db
      .insert(benchmarkDefinitions)
      .values(b)
      .onConflictDoNothing({ target: benchmarkDefinitions.symbol });
  }

  return db.select().from(benchmarkDefinitions);
}

/**
 * Service: Wealth Analytics & Performance Intelligence Engine (Phase 2.5)
 *
 * READ-ONLY SYSTEM GUARANTEE:
 * This service consumes data from Portfolio Valuation, Market Data, and Accounting Core.
 * It NEVER creates journal entries, postings, FIFO lots, or account modifications.
 *
 * APPEND-ONLY GUARANTEE:
 * Analytics tables (analytics_runs, wealth_performance_snapshots, etc.) behave strictly as APPEND-ONLY.
 * Historical calculation results are never updated or deleted.
 */
export async function getAnalyticsSummary(userId?: string): Promise<AnalyticsDashboardSummary> {
  const [valuationSummary, rawSnapshots, benchmarks] = await Promise.all([
    getPortfolioValuation(),
    db.select().from(portfolioSnapshots).orderBy(desc(portfolioSnapshots.snapshotDate)),
    ensureBenchmarkDefinitions(),
  ]);

  const periodStart = rawSnapshots.length > 0
    ? rawSnapshots[rawSnapshots.length - 1].snapshotDate
    : "2025-01-01";
  const periodEnd = valuationSummary.valuationDate;

  // Use explicit ExternalCapitalFlowProvider abstraction
  const flowProvider = new DefaultExternalCapitalFlowProvider();
  const capitalFlows = await flowProvider.getExternalCapitalFlows(userId, periodStart, periodEnd);

  const timeline = generateWealthTimeline(
    rawSnapshots.map((s) => ({
      snapshotDate: s.snapshotDate,
      totalPortfolioValue: s.totalPortfolioValue,
    })),
  );

  const startingVal = rawSnapshots.length > 0
    ? rawSnapshots[rawSnapshots.length - 1].totalPortfolioValue
    : valuationSummary.totalCostBasis;

  const endingVal = valuationSummary.totalNetWorth;

  // Growth Analysis with External Capital Flow Awareness & Versioning
  const growth = calculateGrowth({
    startingValue: startingVal,
    endingValue: endingVal,
    netExternalFlow: capitalFlows.netExternalCapitalFlow,
    periodStart,
    periodEnd,
  });

  // Asset Attribution
  const periodValues = valuationSummary.assetValuations.map((v) => ({
    assetId: v.assetId,
    symbol: v.symbol,
    name: v.name,
    startingValue: v.costBasis,
    endingValue: v.currentValue,
  }));

  const attribution = calculateAttribution(periodValues, growth.absoluteChange);

  // Benchmark Comparisons
  const benchmarkReturnData = [
    { symbol: "BTC", name: "بیت‌کوین (BTC)", returnPercentage: "30.00" },
    { symbol: "GOLD", name: "طلا (GOLD)", returnPercentage: "25.00" },
    { symbol: "SP500", name: "S&P 500", returnPercentage: "15.00" },
    { symbol: "USD", name: "دلار (USD)", returnPercentage: "0.00" },
  ];

  const benchmarkItems = calculateBenchmarkComparison(
    growth.adjustedWealthReturnPercentage,
    benchmarkReturnData,
  );

  // Risk Metrics
  const historicalValuesList = rawSnapshots.map((s) => s.totalPortfolioValue);
  const risk = calculateRiskMetrics(
    valuationSummary.assetValuations,
    valuationSummary.totalNetWorth,
    historicalValuesList,
    valuationSummary.valuationDate,
  );

  // APPEND-ONLY Execution Tracking: Insert new run metadata into analytics_runs
  await db.insert(analyticsRuns).values({
    userId: userId ?? null,
    runType: "dashboard",
    periodStart: growth.periodStart,
    periodEnd: growth.periodEnd,
    calculationVersion: "v1.0",
    sourceSnapshotReference: rawSnapshots[0]?.id ?? null,
  });

  return {
    growth,
    attribution,
    benchmarks: benchmarkItems,
    risk,
    timeline,
  };
}
