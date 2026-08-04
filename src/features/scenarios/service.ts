/**
 * Scenario Service — Orchestration Layer
 *
 * ARCHITECTURAL GUARANTEES:
 * - READ ONLY from Market Data SSOT (getMarketPrices, getMarketSnapshots, direct market tables via simulation.ts)
 * - READ ONLY from assets, currencies, users
 * - READ from analytics benchmark via benchmarkComparison.ts wrapper
 * - WRITE ONLY to scenario_simulations, scenario_evaluation_runs
 * - NEVER writes to journal_entries, postings, lots, lot_consumptions, accounts, market_prices, portfolio_snapshots, analytics_runs
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  aiScenarioSimulations,
  assets,
  currencies,
  duneQueryCache,
  scenarioEvaluationRuns,
  scenarioSimulations,
} from "@/db/schema";
import { DuneAnalyticsProvider } from "./providers/dune";
import { GoogleAIStudioProvider } from "./providers/aiStudio";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import {
  createScenarioSchema,
  evaluateScenarioSchema,
  compareBenchmarksSchema,
  timeRangeSchema,
} from "./validators";
import { calculateInitialQuantity } from "./calculator";
import {
  fetchCurrentPrice,
  fetchHistoricalPrice,
  simulateHistoricalInvestment,
  simulateTimeRange,
  simulateAssetComparison,
  evaluateLiveScenario,
} from "./simulation";
import {
  buildBenchmarkComparisons,
  compareScenarioWithBenchmarks,
  lookupBenchmarkAssets,
} from "./benchmarkComparison";
import type {
  CreateScenarioInput,
  ScenarioSimulation,
  LiveScenarioResult,
  TimeRangeSimulationResult,
  AssetComparisonResult,
  BenchmarkComparisonResult,
  SimulationResult,
} from "./types";

/**
 * Create a new scenario simulation
 * Steps:
 * 1. Validate input via zod
 * 2. Validate asset exists (single identity)
 * 3. Fetch historical price on startDate from Market Data SSOT if initialPrice not provided
 * 4. Calculate quantity = capital / price
 * 5. Insert into scenario_simulations only
 */
export async function createScenario(input: CreateScenarioInput): Promise<{ id: string }> {
  const parsed = createScenarioSchema.parse(input);

  // Validate asset exists
  const [assetRow] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, parsed.assetId), sql`${assets.deletedAt} IS NULL`))
    .limit(1);

  if (!assetRow) {
    throw new Error(`Asset not found: ${parsed.assetId}`);
  }

  // Resolve initial price: use provided or fetch from market data SSOT
  let initialPrice: string;
  if (parsed.initialPrice) {
    initialPrice = parsed.initialPrice;
  } else {
    const fetched = await fetchHistoricalPrice(parsed.assetId, parsed.startDate);
    if (!fetched) {
      throw new Error(
        `Historical price not found for asset ${assetRow.symbol} on or before ${parsed.startDate}. Please record price in market data first or provide initialPrice explicitly.`,
      );
    }
    initialPrice = fetched;
  }

  // Validate capital currency exists if provided
  let capitalCurrencyId = parsed.capitalCurrencyId ?? null;
  let capitalCurrencyCode = "USD";
  if (capitalCurrencyId) {
    const [cur] = await db.select().from(currencies).where(eq(currencies.id, capitalCurrencyId)).limit(1);
    if (!cur) throw new Error(`Currency not found: ${capitalCurrencyId}`);
    capitalCurrencyCode = cur.code;
  } else {
    // Try asset's currency or USD fallback
    if (assetRow.currencyId) {
      const [cur] = await db.select().from(currencies).where(eq(currencies.id, assetRow.currencyId)).limit(1);
      if (cur) {
        capitalCurrencyId = cur.id;
        capitalCurrencyCode = cur.code;
      }
    }
    if (!capitalCurrencyId) {
      const [usd] = await db.select().from(currencies).where(eq(currencies.code, "USD")).limit(1);
      if (usd) {
        capitalCurrencyId = usd.id;
        capitalCurrencyCode = usd.code;
      }
    }
  }

  // Calculate initial quantity
  const initialQuantity = calculateInitialQuantity(parsed.initialCapital, initialPrice);

  // Insert ONLY into scenario_simulations
  const [inserted] = await db
    .insert(scenarioSimulations)
    .values({
      userId: parsed.userId ?? null,
      name: parsed.name,
      description: parsed.description ?? null,
      assetId: parsed.assetId,
      initialCapital: D(parsed.initialCapital).toString(),
      capitalCurrencyId,
      startDate: parsed.startDate,
      initialPrice: D(initialPrice).toString(),
      initialQuantity: D(initialQuantity).toString(),
      status: "active",
      notes: parsed.notes ?? null,
    })
    .returning();

  return { id: inserted.id };
}

/**
 * Get scenario by ID with asset join
 */
export async function getScenario(scenarioId: string): Promise<ScenarioSimulation | null> {
  const rows = await db
    .select({
      id: scenarioSimulations.id,
      userId: scenarioSimulations.userId,
      name: scenarioSimulations.name,
      description: scenarioSimulations.description,
      assetId: scenarioSimulations.assetId,
      assetSymbol: assets.symbol,
      assetName: assets.name,
      initialCapital: scenarioSimulations.initialCapital,
      capitalCurrencyId: scenarioSimulations.capitalCurrencyId,
      capitalCurrencyCode: currencies.code,
      startDate: scenarioSimulations.startDate,
      initialPrice: scenarioSimulations.initialPrice,
      initialQuantity: scenarioSimulations.initialQuantity,
      status: scenarioSimulations.status,
      notes: scenarioSimulations.notes,
      createdAt: scenarioSimulations.createdAt,
      updatedAt: scenarioSimulations.updatedAt,
    })
    .from(scenarioSimulations)
    .innerJoin(assets, eq(assets.id, scenarioSimulations.assetId))
    .leftJoin(currencies, eq(currencies.id, scenarioSimulations.capitalCurrencyId))
    .where(eq(scenarioSimulations.id, scenarioId))
    .limit(1);

  if (rows.length === 0) return null;

  const r = rows[0];
  return {
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    assetName: r.assetName,
    initialCapital: r.initialCapital.toString(),
    capitalCurrencyId: r.capitalCurrencyId,
    capitalCurrencyCode: r.capitalCurrencyCode ?? "USD",
    startDate: r.startDate,
    initialPrice: r.initialPrice.toString(),
    initialQuantity: r.initialQuantity.toString(),
    status: r.status as any,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? todayIso(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

/**
 * List all scenarios (optionally filtered by userId/status)
 */
export async function listScenarios(
  filter: { userId?: string; status?: "active" | "archived" | "closed" } = {},
): Promise<ScenarioSimulation[]> {
  let query = db
    .select({
      id: scenarioSimulations.id,
      userId: scenarioSimulations.userId,
      name: scenarioSimulations.name,
      description: scenarioSimulations.description,
      assetId: scenarioSimulations.assetId,
      assetSymbol: assets.symbol,
      assetName: assets.name,
      initialCapital: scenarioSimulations.initialCapital,
      capitalCurrencyId: scenarioSimulations.capitalCurrencyId,
      capitalCurrencyCode: currencies.code,
      startDate: scenarioSimulations.startDate,
      initialPrice: scenarioSimulations.initialPrice,
      initialQuantity: scenarioSimulations.initialQuantity,
      status: scenarioSimulations.status,
      notes: scenarioSimulations.notes,
      createdAt: scenarioSimulations.createdAt,
      updatedAt: scenarioSimulations.updatedAt,
    })
    .from(scenarioSimulations)
    .innerJoin(assets, eq(assets.id, scenarioSimulations.assetId))
    .leftJoin(currencies, eq(currencies.id, scenarioSimulations.capitalCurrencyId))
    .orderBy(desc(scenarioSimulations.createdAt));

  const rows = await query;

  let filtered = rows;
  if (filter.userId) filtered = filtered.filter((r) => r.userId === filter.userId);
  if (filter.status) filtered = filtered.filter((r) => r.status === filter.status);

  return filtered.map((r) => ({
    id: r.id,
    userId: r.userId,
    name: r.name,
    description: r.description,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    assetName: r.assetName,
    initialCapital: r.initialCapital.toString(),
    capitalCurrencyId: r.capitalCurrencyId,
    capitalCurrencyCode: r.capitalCurrencyCode ?? "USD",
    startDate: r.startDate,
    initialPrice: r.initialPrice.toString(),
    initialQuantity: r.initialQuantity.toString(),
    status: r.status as any,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? todayIso(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}

/**
 * Evaluate scenario live — fetches current price from Market Data SSOT
 * and recalculates currentValue, PnL, ROI, annualized.
 * Optionally persists evaluation run into scenario_evaluation_runs (isolated).
 */
export async function evaluateScenario(
  scenarioId: string,
  evaluationDate = todayIso(),
): Promise<LiveScenarioResult> {
  const parsed = evaluateScenarioSchema.parse({ scenarioId, evaluationDate });

  const scenario = await getScenario(parsed.scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${parsed.scenarioId}`);

  // Fetch current price from SSOT — live tracking
  const currentPrice = await fetchCurrentPrice(scenario.assetId);
  if (!currentPrice) {
    throw new Error(
      `Current price not found for asset ${scenario.assetSymbol}. Please record market price first.`,
    );
  }

  // Evaluate
  const live = await evaluateLiveScenario({
    assetId: scenario.assetId,
    initialCapital: scenario.initialCapital,
    initialPrice: scenario.initialPrice,
    initialQuantity: scenario.initialQuantity,
    startDate: scenario.startDate,
    evaluationDate: parsed.evaluationDate ?? todayIso(),
    currentPrice,
  });

  const simulationResult: SimulationResult = {
    scenarioId: scenario.id,
    name: scenario.name,
    assetId: scenario.assetId,
    assetSymbol: scenario.assetSymbol ?? "",
    assetName: scenario.assetName ?? undefined,
    initialCapital: scenario.initialCapital,
    capitalCurrencyCode: scenario.capitalCurrencyCode ?? "USD",
    startDate: scenario.startDate,
    initialPrice: scenario.initialPrice,
    initialQuantity: scenario.initialQuantity,
    evaluationDate: parsed.evaluationDate ?? todayIso(),
    currentPrice,
    currentValue: live.currentValue,
    profitLoss: live.profitLoss,
    roiPercentage: live.roiPercentage,
    annualizedReturnPercentage: live.annualizedReturnPercentage,
    calculationVersion: "v1.0",
    calculationStatus: "complete",
  };

  // Persist evaluation run (upsert on scenario_id + evaluation_date)
  const evalDate = parsed.evaluationDate ?? todayIso();
  const [run] = await db
    .insert(scenarioEvaluationRuns)
    .values({
      scenarioId: scenario.id,
      evaluationDate: evalDate,
      currentPrice: D(currentPrice).toString(),
      currentValue: D(live.currentValue).toString(),
      profitLoss: D(live.profitLoss).toString(),
      roiPercentage: D(live.roiPercentage).toString(),
      annualizedReturnPercentage: D(live.annualizedReturnPercentage).toString(),
    })
    .onConflictDoUpdate({
      target: [scenarioEvaluationRuns.scenarioId, scenarioEvaluationRuns.evaluationDate],
      set: {
        currentPrice: D(currentPrice).toString(),
        currentValue: D(live.currentValue).toString(),
        profitLoss: D(live.profitLoss).toString(),
        roiPercentage: D(live.roiPercentage).toString(),
        annualizedReturnPercentage: D(live.annualizedReturnPercentage).toString(),
      },
    })
    .returning();

  return {
    ...simulationResult,
    evaluationRunId: run.id,
  };
}

/**
 * Get scenario timeline (time range simulation)
 * Example: Jan 2025 to Aug 2026
 */
export async function getScenarioTimeline(
  scenarioId: string,
  startDate?: string,
  endDate?: string,
): Promise<TimeRangeSimulationResult> {
  const parsed = timeRangeSchema.parse({ scenarioId, startDate, endDate });
  const scenario = await getScenario(parsed.scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${parsed.scenarioId}`);

  const sDate = parsed.startDate ?? scenario.startDate;
  const eDate = parsed.endDate ?? todayIso();

  return simulateTimeRange({
    scenarioId: scenario.id,
    assetId: scenario.assetId,
    assetSymbol: scenario.assetSymbol ?? "",
    initialCapital: scenario.initialCapital,
    initialPrice: scenario.initialPrice,
    initialQuantity: scenario.initialQuantity,
    startDate: sDate,
    endDate: eDate,
  });
}

/**
 * Compare scenario with benchmarks (BTC, GOLD, SP500, USD etc.)
 * Uses existing benchmark.ts logic via wrapper
 */
export async function compareScenarioBenchmarks(
  scenarioId: string,
  benchmarkSymbols: string[],
  evaluationDate = todayIso(),
): Promise<{ scenario: LiveScenarioResult; comparisons: BenchmarkComparisonResult[] }> {
  const parsed = compareBenchmarksSchema.parse({ scenarioId, benchmarkSymbols, evaluationDate });

  // Live evaluate scenario first (ensures current price is fresh from SSOT)
  const liveResult = await evaluateScenario(parsed.scenarioId, parsed.evaluationDate);

  const comparisons = await buildBenchmarkComparisons(liveResult, parsed.benchmarkSymbols);

  // Optional: persist comparisons JSON into evaluation run? Not required for core, but we can update latest eval run's benchmark_comparisons
  try {
    const evalDate = parsed.evaluationDate ?? todayIso();
    await db
      .update(scenarioEvaluationRuns)
      .set({ benchmarkComparisons: JSON.stringify(comparisons) })
      .where(
        and(
          eq(scenarioEvaluationRuns.scenarioId, parsed.scenarioId),
          eq(scenarioEvaluationRuns.evaluationDate, evalDate),
        ),
      );
  } catch {
    // ignore persistence errors for benchmarks
  }

  return {
    scenario: { ...liveResult, benchmarkComparisons: comparisons },
    comparisons,
  };
}

/**
 * Asset Comparison: e.g., ETH vs BTC
 */
export async function compareAssets(
  scenarioId: string,
  benchmarkSymbols: string[],
  evaluationDate = todayIso(),
): Promise<AssetComparisonResult> {
  const scenario = await getScenario(scenarioId);
  if (!scenario) throw new Error(`Scenario not found: ${scenarioId}`);

  const currentPrice = await fetchCurrentPrice(scenario.assetId);
  if (!currentPrice) throw new Error(`Current price not found for ${scenario.assetSymbol}`);

  const benchmarkAssets = await lookupBenchmarkAssets(benchmarkSymbols);

  return simulateAssetComparison({
    primaryAssetId: scenario.assetId,
    primarySymbol: scenario.assetSymbol ?? "",
    primaryName: scenario.assetName ?? scenario.assetSymbol ?? "",
    benchmarkAssetInfos: benchmarkAssets,
    initialCapital: scenario.initialCapital,
    startDate: scenario.startDate,
    evaluationDate,
    initialPrice: scenario.initialPrice,
    currentPrice,
  });
}

/**
 * Archive scenario (soft status change, no ledger touch)
 */
export async function archiveScenario(scenarioId: string): Promise<void> {
  await db
    .update(scenarioSimulations)
    .set({ status: "archived", updatedAt: new Date() })
    .where(eq(scenarioSimulations.id, scenarioId));
}

/**
 * Delete scenario (cascades evaluation runs)
 */
export async function deleteScenario(scenarioId: string): Promise<void> {
  await db.delete(scenarioSimulations).where(eq(scenarioSimulations.id, scenarioId));
}

/**
 * Get evaluation runs for a scenario (audit / timeline)
 */
export async function getEvaluationRuns(scenarioId: string) {
  return db
    .select()
    .from(scenarioEvaluationRuns)
    .where(eq(scenarioEvaluationRuns.scenarioId, scenarioId))
    .orderBy(desc(scenarioEvaluationRuns.evaluationDate));
}

/**
 * Historical Investment Simulation — one-off without persisting scenario
 * Answers: "What would have happened if I invested X into Y at date Z?"
 */
export async function simulateHistoricalInvestmentOnce(params: {
  assetId: string;
  initialCapital: string;
  startDate: string;
  evaluationDate?: string;
}): Promise<SimulationResult> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, params.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${params.assetId}`);

  const [cur] = assetRow.currencyId
    ? await db.select().from(currencies).where(eq(currencies.id, assetRow.currencyId)).limit(1)
    : [];

  const startPrice = await fetchHistoricalPrice(params.assetId, params.startDate);
  if (!startPrice) throw new Error(`Historical price missing for ${assetRow.symbol} on ${params.startDate}`);

  const evalDate = params.evaluationDate ?? todayIso();
  const currentPrice = await fetchCurrentPrice(params.assetId);
  if (!currentPrice) throw new Error(`Current price missing for ${assetRow.symbol}`);

  return simulateHistoricalInvestment({
    assetId: params.assetId,
    assetSymbol: assetRow.symbol,
    assetName: assetRow.name,
    initialCapital: params.initialCapital,
    capitalCurrencyCode: cur?.code ?? "USD",
    startDate: params.startDate,
    initialPrice: startPrice,
    currentPrice,
    evaluationDate: evalDate,
  });
}

/* ------------------------------------------------------------------ */
/* Dune + AI Studio On-Chain Scenario Simulation — New Feature         */
/* ------------------------------------------------------------------ */
// Implements: runOnChainScenarioSimulation(userHypothesis, duneQueryId, queryParams)
// Fetches on-chain metrics from Dune API/MCP, passes to Google AI Studio, saves evaluation in ai_scenario_simulations
// Isolated cache tables: dune_query_cache, ai_scenario_simulations — no FK to Financial Core

export type OnChainScenarioResult = {
  id: string;
  scenarioTitle: string;
  userHypothesis: string;
  duneQueryId: number | null;
  duneResultRows: Record<string, any>[];
  aiMarkdownAnalysis: string;
  structuredMetrics: {
    simulatedReturnPercent: number;
    riskScore: number;
    stressTestResult: string;
    confidenceScore?: number;
    additionalMetrics?: Record<string, any>;
  };
  createdAt: string;
};

export async function runOnChainScenarioSimulation(
  userHypothesis: string,
  duneQueryId: number,
  queryParams?: Record<string, any>,
): Promise<OnChainScenarioResult> {
  if (!userHypothesis || userHypothesis.trim().length < 10) {
    throw new Error("User hypothesis must be at least 10 characters");
  }
  if (!duneQueryId || isNaN(duneQueryId)) {
    throw new Error("Invalid Dune query ID");
  }

  const duneProvider = new DuneAnalyticsProvider();
  const aiProvider = new GoogleAIStudioProvider();

  // Fetch on-chain metrics from Dune API/MCP
  let duneResult: Awaited<ReturnType<typeof duneProvider.executeQueryAndPoll>> | null = null;
  let resultRows: Record<string, any>[] = [];

  try {
    // Try to get latest cached result first for speed, fallback to execute fresh if not found
    if (queryParams && Object.keys(queryParams).length > 0) {
      duneResult = await duneProvider.executeQueryAndPoll(duneQueryId, queryParams);
    } else {
      duneResult = await duneProvider.getLatestQueryResult(duneQueryId);
      // If no cached result, execute fresh
      if (!duneResult || duneResult.resultRows.length === 0) {
        duneResult = await duneProvider.executeQueryAndPoll(duneQueryId, queryParams);
      }
    }

    if (duneResult) {
      resultRows = duneResult.resultRows;

      // Cache result in dune_query_cache — isolated, no FK to Financial Core
      await db
        .insert(duneQueryCache)
        .values({
          queryId: duneQueryId,
          queryName: duneResult.queryName ?? `Query ${duneQueryId}`,
          parametersJson: queryParams ? JSON.stringify(queryParams) : null,
          resultRowsJson: JSON.stringify(resultRows).slice(0, 50000), // limit size
          executionId: duneResult.executionId ?? null,
          fetchedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: duneQueryCache.queryId,
          set: {
            queryName: duneResult.queryName ?? `Query ${duneQueryId}`,
            parametersJson: queryParams ? JSON.stringify(queryParams) : null,
            resultRowsJson: JSON.stringify(resultRows).slice(0, 50000),
            executionId: duneResult.executionId ?? null,
            fetchedAt: new Date(),
          },
        });
    }
  } catch (e) {
    console.warn("[runOnChainScenarioSimulation] Dune fetch failed, proceeding with empty data", e);
    resultRows = [];
  }

  // Pass to Google AI Studio for evaluation
  const aiEvaluation = await aiProvider.evaluateDeFiHypothesis(userHypothesis, resultRows);

  // Save evaluation in ai_scenario_simulations — isolated cache
  const scenarioTitle = userHypothesis.slice(0, 100);

  const [inserted] = await db
    .insert(aiScenarioSimulations)
    .values({
      scenarioTitle,
      userHypothesis,
      duneQueryId,
      aiMarkdownAnalysis: aiEvaluation.markdownAnalysis,
      structuredMetricsJson: JSON.stringify(aiEvaluation.structuredMetrics),
    })
    .returning();

  return {
    id: inserted.id,
    scenarioTitle: inserted.scenarioTitle,
    userHypothesis: inserted.userHypothesis,
    duneQueryId: inserted.duneQueryId,
    duneResultRows: resultRows,
    aiMarkdownAnalysis: aiEvaluation.markdownAnalysis,
    structuredMetrics: aiEvaluation.structuredMetrics,
    createdAt: inserted.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function getAiScenarioHistory(limit = 20) {
  const rows = await db.select().from(aiScenarioSimulations).orderBy(desc(aiScenarioSimulations.createdAt)).limit(limit);

  return rows.map((r) => ({
    id: r.id,
    scenarioTitle: r.scenarioTitle,
    userHypothesis: r.userHypothesis,
    duneQueryId: r.duneQueryId,
    aiMarkdownAnalysis: r.aiMarkdownAnalysis,
    structuredMetricsJson: r.structuredMetricsJson,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function getDuneQueryCache(queryId: number) {
  const [row] = await db.select().from(duneQueryCache).where(eq(duneQueryCache.queryId, queryId)).limit(1);
  return row ?? null;
}
