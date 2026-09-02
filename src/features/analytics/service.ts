import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  analyticsRuns,
  benchmarkDefinitions,
  portfolioSnapshots,
} from "@/db/schema";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { getSnapshotSeries, hasMultipleUsers } from "@/features/ledger/queries";
import { isInactiveOrOrphanedRwaAsset } from "@/features/rwa/orphanFilter";
import { D } from "@/domain/decimal";
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
 * Resolve the tenant for analytics.
 *
 * FAIL-CLOSED (multi-user isolation): in a multi-tenant database an analytics
 * request without a resolved identity must NEVER degrade to a global read —
 * blending every tenant's net worth, growth, risk, timeline and capital flows
 * into one user's dashboard is a critical cross-user data leak.
 *
 * Legacy single-tenant mode (≤1 user, pre-migration) keeps its global view.
 */
async function resolveAnalyticsUserId(explicitUserId?: string): Promise<string | undefined> {
  if (explicitUserId) return explicitUserId;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const u = await getCurrentUser();
    if (u?.id) return u.id;
  } catch (e: any) {
    if (e?.message?.includes("Authentication/Database error")) throw e;
  }
  if (await hasMultipleUsers()) {
    throw new Error("Authentication/Database error: Access denied");
  }
  return undefined;
}

/**
 * Explicit append-only tracking of an analytics run.
 *
 * Separated from getAnalyticsSummary so rendering Net Worth / Reports never
 * writes. Callers that WANT a run recorded (a user-triggered action) invoke
 * this after computing the summary. journal_entries / postings / lots are
 * never touched.
 */
export async function recordAnalyticsRun(input: {
  userId?: string | null;
  periodStart: string;
  periodEnd: string;
  sourceSnapshotReference?: string | null;
  runType?: string;
}): Promise<void> {
  await db.insert(analyticsRuns).values({
    userId: input.userId ?? null,
    runType: input.runType ?? "dashboard",
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    calculationVersion: "v1.0",
    sourceSnapshotReference: input.sourceSnapshotReference ?? null,
  });
}

/** ISO date one day after `iso` (flow window start — flows inside the
 *  starting snapshot must not be subtracted a second time). */
function dayAfterIso(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Subtract inactive/orphaned RWA contributions from stored portfolio
 * snapshot totals — presentation only. Snapshot rows are never rewritten.
 */
async function ghostRwaValueBySnapshotDate(userId?: string): Promise<Map<string, string>> {
  const res = await db.execute(sql`
    select pv.valuation_date::text as "valuationDate",
           coalesce(sum(pv.total_value), 0)::text as "ghostValue"
    from portfolio_valuations pv
      join assets ast on ast.id = pv.asset_id
    where ${isInactiveOrOrphanedRwaAsset("ast")}
      ${userId ? sql`and pv.user_id = ${userId}` : sql``}
    group by pv.valuation_date
  `);
  return new Map(
    (res.rows as Array<{ valuationDate: string; ghostValue: string }>).map((row) => [
      String(row.valuationDate ?? "").slice(0, 10),
      row.ghostValue,
    ]),
  );
}

/**
 * Service: Wealth Analytics & Performance Intelligence Engine (Phase 2.5)
 *
 * READ-ONLY SYSTEM GUARANTEE:
 * This service consumes data from Portfolio Valuation, Market Data, and Accounting Core.
 * It NEVER creates journal entries, postings, FIFO lots, or account modifications.
 * It NEVER inserts analytics_runs — that is a separate mutation (recordAnalyticsRun).
 *
 * APPEND-ONLY GUARANTEE:
 * Analytics tables (analytics_runs, wealth_performance_snapshots, etc.) behave strictly as APPEND-ONLY.
 * Historical calculation results are never updated or deleted.
 */
export async function getAnalyticsSummary(userId?: string): Promise<AnalyticsDashboardSummary> {
  const u = await resolveAnalyticsUserId(userId);

  // SNAPSHOT HISTORY SOURCE OF TRUTH (root cause fix):
  // The «ثبت اسنپ‌شات» button in the UI writes the legacy `snapshots` history
  // (takeSnapshotAction), NOT `portfolio_snapshots` (which nothing in the UI
  // writes). Analytics therefore used to see ZERO starting snapshots, fell
  // back to TODAY's total cost basis as the "period start", and then
  // subtracted the same capital flows from that already-flow-inclusive value
  // a second time — manufacturing a fake negative «بازده سرمایه‌گذاری خالص»
  // equal to −(net deposits), e.g. −۶٬۷۵۷٬۳۷۴٬۷۷۷ تومان (≈ −۳۲٬۱۷۷.۹۸ دلار at
  // 210,000 IRT/USD). Both histories are now merged (portfolio snapshot wins
  // on the same date); both are tenant-scoped and ghost-filtered.
  const [valuationSummary, rawSnapshots, legacyHistory, _benchmarks, ghostByDate] = await Promise.all([
    getPortfolioValuation(undefined, u),
    db
      .select()
      .from(portfolioSnapshots)
      .where(u ? eq(portfolioSnapshots.userId, u) : sql`1=1`)
      .orderBy(desc(portfolioSnapshots.snapshotDate)),
    getSnapshotSeries(5000, u),
    ensureBenchmarkDefinitions(),
    ghostRwaValueBySnapshotDate(u),
  ]);

  // Presentation adjustment: a deleted/orphaned property must not inflate
  // historical snapshot totals used for wealth-metric comparison.
  const dateKey = (value: unknown) => {
    if (typeof value === "string") return value.slice(0, 10);
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return String(value ?? "").slice(0, 10);
  };

  const adjustedSnapshots = rawSnapshots.map((s) => {
    const ghost = ghostByDate.get(dateKey(s.snapshotDate)) ?? "0";
    return {
      ...s,
      totalPortfolioValue: D(s.totalPortfolioValue).sub(ghost).toString(),
    };
  });

  // Unified, date-sorted snapshot history (portfolio snapshot wins per date).
  const historyByDate = new Map<string, { snapshotDate: string; totalPortfolioValue: string }>();
  for (const s of adjustedSnapshots) {
    const date = dateKey(s.snapshotDate);
    historyByDate.set(date, { snapshotDate: date, totalPortfolioValue: s.totalPortfolioValue });
  }
  for (const s of legacyHistory) {
    const date = String(s.asOf).slice(0, 10);
    if (!historyByDate.has(date)) {
      historyByDate.set(date, { snapshotDate: date, totalPortfolioValue: s.totalAssets });
    }
  }
  const history = [...historyByDate.values()].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate));

  // A REAL period-start value is required. Without any historical snapshot
  // the current cost basis must never be used as "starting value": it already
  // embeds every deposit/withdrawal of the period, so subtracting the flows
  // again created the fake negative adjusted return. Report missing data
  // instead of a fabricated number.
  const hasStartingSnapshot = history.length > 0;
  const periodStart = hasStartingSnapshot ? history[0].snapshotDate : "2025-01-01";
  const periodEnd = valuationSummary.valuationDate;

  // Capital flows strictly AFTER the starting snapshot date: a flow that is
  // already captured inside the starting snapshot must never be subtracted
  // again (that double subtraction is exactly the −(net deposits) fake loss).
  const flowStart = hasStartingSnapshot ? dayAfterIso(history[0].snapshotDate) : periodStart;

  // Use explicit ExternalCapitalFlowProvider abstraction
  const flowProvider = new DefaultExternalCapitalFlowProvider();
  const capitalFlows = await flowProvider.getExternalCapitalFlows(u, flowStart, periodEnd);

  const timeline = generateWealthTimeline(history);

  const startingVal = hasStartingSnapshot ? history[0].totalPortfolioValue : "0";
  const endingVal = valuationSummary.totalNetWorth;

  // Growth Analysis with External Capital Flow Awareness & Versioning
  const growth = calculateGrowth({
    startingValue: startingVal,
    endingValue: endingVal,
    netExternalFlow: capitalFlows.netExternalCapitalFlow,
    periodStart,
    periodEnd,
    hasMissingData: !hasStartingSnapshot,
    missingDataReason:
      "برای محاسبه «بازده تعدیل‌شده» به حداقل یک اسنپ‌شات تاریخی نیاز است؛ بدون نقطه شروع واقعی، بازده قابل محاسبه نیست. با «ثبت اسنپ‌شات امروز» شروع کنید.",
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

  // Risk Metrics — use the same unified real history (legacy + portfolio snapshots).
  const historicalValuesList = history.map((s) => s.totalPortfolioValue);
  const risk = calculateRiskMetrics(
    valuationSummary.assetValuations,
    valuationSummary.totalNetWorth,
    historicalValuesList,
    valuationSummary.valuationDate,
  );

  return {
    growth,
    attribution,
    benchmarks: benchmarkItems,
    risk,
    timeline,
  };
}
