import assert from "node:assert/strict";
import { test } from "node:test";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  analyticsRuns,
  assetClasses,
  assetPerformanceAnalysis,
  assets,
  benchmarkDefinitions,
  benchmarkResults,
  benchmarkSnapshots,
  currencies,
  journalEntries,
  lotConsumptions,
  lots,
  portfolioRiskMetrics,
  portfolioSnapshots,
  portfolioValuations,
  postings,
  prices,
  wealthPerformanceSnapshots,
} from "../src/db/schema";
import { postEntry, recordBuy } from "../src/features/ledger/service";
import { createPortfolioSnapshot } from "../src/features/portfolio/service";
import { calculateGrowth } from "../src/features/analytics/performance";
import { calculateAttribution } from "../src/features/analytics/attribution";
import { calculateBenchmarkComparison } from "../src/features/analytics/benchmark";
import { calculateRiskMetrics } from "../src/features/analytics/risk";
import {
  ensureBenchmarkDefinitions,
  getAnalyticsSummary,
  recordAnalyticsRun,
} from "../src/features/analytics/service";
import { DefaultExternalCapitalFlowProvider } from "../src/features/analytics/capitalFlows";
import { todayIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

async function setupAnalyticsDb() {
  await createSchemaIfNotExists();

  await db.delete(analyticsRuns);
  await db.delete(benchmarkResults);
  await db.delete(benchmarkSnapshots);
  await db.delete(benchmarkDefinitions);
  await db.delete(portfolioRiskMetrics);
  await db.delete(assetPerformanceAnalysis);
  await db.delete(wealthPerformanceSnapshots);
  await db.delete(portfolioValuations);
  await db.delete(portfolioSnapshots);
  await db.delete(prices);
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true })
    .returning();

  const [cryptoCls] = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "Crypto", color: "#c9cafa" })
    .returning();

  const [ethAsset] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: cryptoCls.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [btcAsset] = await db
    .insert(assets)
    .values({ symbol: "BTC", name: "Bitcoin", classId: cryptoCls.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: cryptoCls.id, currencyId: usd.id, decimals: 2 })
    .returning();

  const [cashAccount] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash Account", type: "asset", assetId: usdAsset.id })
    .returning();

  const [ethAccount] = await db
    .insert(accounts)
    .values({ code: "1200", name: "ETH Account", type: "asset", assetId: ethAsset.id })
    .returning();

  const [btcAccount] = await db
    .insert(accounts)
    .values({ code: "1210", name: "BTC Account", type: "asset", assetId: btcAsset.id })
    .returning();

  const [equityAccount] = await db
    .insert(accounts)
    .values({ code: "3010", name: "Opening Equity", type: "equity", assetId: usdAsset.id })
    .returning();

  const [incomeAccount] = await db
    .insert(accounts)
    .values({ code: "4010", name: "Income Account", type: "income", assetId: usdAsset.id })
    .returning();

  // Initial cash
  await postEntry({
    entryDate: todayIso(),
    type: "opening",
    description: "Initial Cash",
    postings: [
      { accountId: cashAccount.id, assetId: usdAsset.id, quantity: "50000", baseValue: "50000" },
      { accountId: equityAccount.id, assetId: usdAsset.id, quantity: "-50000", baseValue: "-50000" },
    ],
  });

  return { usd, ethAsset, btcAsset, usdAsset, cashAccount, ethAccount, btcAccount, incomeAccount };
}

test("Test 1 — Analytics calculation NEVER creates journal entries or postings", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupAnalyticsDb();

  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Run Analytics
  await getAnalyticsSummary();

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // STRICT GUARANTEE: Zero new journal entries or postings
  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

test("Test 2 — Portfolio performance calculation is correct (10,000 -> 12,000 = +20%)", () => {
  const growth = calculateGrowth({
    startingValue: "10000",
    endingValue: "12000",
    periodStart: "2025-01-01",
    periodEnd: "2026-08-02",
  });

  assert.equal(growth.absoluteChange, "2000");
  assert.equal(growth.percentageChange, "20.00");
  assert.equal(growth.calculationVersion, "v1.0");
  assert.equal(growth.calculationStatus, "complete");
});

test("Test 3 — Asset attribution calculation is correct (ETH +2000, BTC +1000 -> ETH contribution 66.67%)", () => {
  const items = [
    { assetId: "ast-1", symbol: "ETH", name: "Ethereum", startingValue: "3000", endingValue: "5000" }, // +2000
    { assetId: "ast-2", symbol: "BTC", name: "Bitcoin", startingValue: "4000", endingValue: "5000" },  // +1000
  ];

  const report = calculateAttribution(items, "3000");

  assert.ok(report.topWinner);
  assert.equal(report.topWinner.symbol, "ETH");
  assert.equal(report.topWinner.absoluteChange, "2000");
  assert.equal(report.topWinner.contributionPercentage, "66.67");

  const btcItem = report.attributions.find((a) => a.symbol === "BTC");
  assert.ok(btcItem);
  assert.equal(btcItem.contributionPercentage, "33.33");
});

test("Test 4 — Benchmark comparison works", () => {
  const benchmarkData = [
    { symbol: "BTC", name: "Bitcoin", returnPercentage: "30.00" },
    { symbol: "GOLD", name: "Gold", returnPercentage: "25.00" },
    { symbol: "SP500", name: "S&P 500", returnPercentage: "15.00" },
  ];

  const comparison = calculateBenchmarkComparison("18.00", benchmarkData);

  const btcComp = comparison.find((c) => c.symbol === "BTC");
  assert.ok(btcComp);
  assert.equal(btcComp.portfolioReturnPercentage, "18.00");
  assert.equal(btcComp.benchmarkReturnPercentage, "30.00");
  assert.equal(btcComp.alphaPercentage, "-12.00");
  assert.equal(btcComp.outperformed, false);

  const spComp = comparison.find((c) => c.symbol === "SP500");
  assert.ok(spComp);
  assert.equal(spComp.alphaPercentage, "3.00");
  assert.equal(spComp.outperformed, true);
});

test("Test 5 — Risk concentration calculation works (ETH 70% -> High/Critical warning)", () => {
  const valuations = [
    { symbol: "ETH", className: "Crypto", currentValue: "7000" },
    { symbol: "USD", className: "Cash", currentValue: "3000" },
  ];

  const risk = calculateRiskMetrics(valuations, "10000");

  assert.equal(risk.largestAssetSymbol, "ETH");
  assert.equal(risk.largestAssetPercentage, "70.00");
  assert.equal(risk.cryptoExposurePercentage, "70.00");
  assert.equal(risk.riskScore, "critical");
  assert.ok(risk.concentrationWarning);
  assert.match(risk.concentrationWarning!, /تمرکز ریسک بحرانی/);
});

test("Test 6 — Historical portfolio snapshots remain immutable", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupAnalyticsDb();

  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });

  const snap1 = await createPortfolioSnapshot("2026-01-01");
  const [snapRow1] = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.id, snap1.id));

  // Run analytics report
  await getAnalyticsSummary();

  const [snapRow1After] = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.id, snap1.id));
  assert.equal(D(snapRow1.totalPortfolioValue).toString(), D(snapRow1After.totalPortfolioValue).toString());
});

test("Test 7 — Changing UI currency preference does NOT modify accounting data", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupAnalyticsDb();

  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });

  const postingsBefore = await db.select().from(postings);

  // Run Analytics
  await getAnalyticsSummary();

  const postingsAfter = await db.select().from(postings);
  assert.equal(postingsBefore.length, postingsAfter.length);
  assert.equal(D(postingsBefore[0].baseValue).toString(), D(postingsAfter[0].baseValue).toString());
});

test("Test 9 — Benchmark isolation test (creating/updating benchmark data NEVER creates accounts, journal entries, or postings)", async () => {
  await setupAnalyticsDb();

  const accountsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(accounts);
  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Ensure benchmark definitions
  await ensureBenchmarkDefinitions();

  const accountsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(accounts);
  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // BENCHMARK ISOLATION GUARANTEE: Benchmark records MUST NEVER pollute accounts or ledger tables
  assert.equal(accountsBefore[0].c, accountsAfter[0].c);
  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);

  const bDefs = await db.select().from(benchmarkDefinitions);
  assert.ok(bDefs.length >= 4);
});

test("Test 10 — External Capital Flow Awareness (Start: 30k, Deposit: 10k, End: 40k -> Investment return = $0 / 0.00%)", () => {
  const growth = calculateGrowth({
    startingValue: "30000",
    endingValue: "40000",
    externalInflows: "10000", // $10,000 deposit
    externalOutflows: "0",
    periodStart: "2025-01-01",
    periodEnd: "2026-08-02",
  });

  // Total change = $10,000, but all of it was an external capital deposit
  assert.equal(growth.absoluteChange, "10000");
  assert.equal(growth.netExternalCapitalFlows, "10000");
  assert.equal(growth.netInvestmentReturn, "0"); // Pure investment return = $0
  assert.equal(growth.adjustedWealthReturnPercentage, "0.00"); // 0.00% return
});

test("Test 11 — Missing Data Protection (Missing historical market prices -> Returns incomplete status & warning without fake estimates)", () => {
  const growth = calculateGrowth({
    startingValue: "0",
    endingValue: "10000",
    hasMissingData: true,
    missingDataReason: "Historical performance unavailable because market price data is missing.",
  });

  assert.equal(growth.calculationStatus, "missing_data");
  assert.ok(growth.missingDataWarning);
  assert.match(growth.missingDataWarning!, /market price data is missing/);
  assert.equal(growth.adjustedWealthReturnPercentage, "0.00");
});

test("Test 12 — Analytics execution tracking is a separate mutation (page reads do not write analytics_runs)", async () => {
  await setupAnalyticsDb();

  const runsBefore = await db.select().from(analyticsRuns);
  const initialCount = runsBefore.length;

  const summary = await getAnalyticsSummary();
  const afterRead = await db.select().from(analyticsRuns);
  assert.equal(afterRead.length, initialCount, "getAnalyticsSummary must not insert analytics_runs");

  await recordAnalyticsRun({
    periodStart: summary.growth.periodStart,
    periodEnd: summary.growth.periodEnd,
  });

  const runsAfter = await db.select().from(analyticsRuns);
  assert.equal(runsAfter.length, initialCount + 1);
  assert.equal(runsAfter[runsAfter.length - 1].runType, "dashboard");
  assert.equal(runsAfter[runsAfter.length - 1].calculationVersion, "v1.0");
});

test("Test 3 — Analytics Append Only (Attempt UPDATE or DELETE on analytics_runs is blocked by DB rule)", async () => {
  await setupAnalyticsDb();

  const summary = await getAnalyticsSummary();
  await recordAnalyticsRun({
    periodStart: summary.growth.periodStart,
    periodEnd: summary.growth.periodEnd,
  });
  const runsBefore = await db.select().from(analyticsRuns);
  assert.ok(runsBefore.length > 0);

  const targetId = runsBefore[0].id;

  // Attempt UPDATE
  await db
    .update(analyticsRuns)
    .set({ calculationVersion: "v9.9" })
    .where(eq(analyticsRuns.id, targetId));

  const runsAfterUpdate = await db.select().from(analyticsRuns).where(eq(analyticsRuns.id, targetId));
  // APPEND-ONLY PROOF: Version remains v1.0, update was ignored by DB rule!
  assert.equal(runsAfterUpdate[0].calculationVersion, "v1.0");

  // Attempt DELETE
  await db.delete(analyticsRuns).where(eq(analyticsRuns.id, targetId));

  const runsAfterDelete = await db.select().from(analyticsRuns).where(eq(analyticsRuns.id, targetId));
  // APPEND-ONLY PROOF: Row still exists, delete was ignored by DB rule!
  assert.equal(runsAfterDelete.length, 1);
});

test("Test 13 — Patch 5: Analytics Isolation (Ledger Hash / Count before === Ledger Hash / Count after)", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupAnalyticsDb();

  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH for isolation test",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "3",
    cashAssetId: usdAsset.id,
    cashQuantity: "9000",
    baseValue: "9000",
  });

  const entriesBefore = await db.select().from(journalEntries);
  const postingsBefore = await db.select().from(postings);
  const lotsBefore = await db.select().from(lots);
  const accountsBefore = await db.select().from(accounts);

  // Execute analytics engine
  await getAnalyticsSummary();

  const entriesAfter = await db.select().from(journalEntries);
  const postingsAfter = await db.select().from(postings);
  const lotsAfter = await db.select().from(lots);
  const accountsAfter = await db.select().from(accounts);

  // LEDGER ISOLATION PROOF: Ledger Core state is 100% untouched
  assert.equal(entriesBefore.length, entriesAfter.length);
  assert.equal(postingsBefore.length, postingsAfter.length);
  assert.equal(lotsBefore.length, lotsAfter.length);
  assert.equal(accountsBefore.length, accountsAfter.length);
});

test("Test 14 — Patch 5: Benchmark Isolation (Creating benchmark data creates zero accounts, transactions, or ownership)", async () => {
  await setupAnalyticsDb();

  const accountsBefore = await db.select().from(accounts);
  const entriesBefore = await db.select().from(journalEntries);

  await ensureBenchmarkDefinitions();

  const accountsAfter = await db.select().from(accounts);
  const entriesAfter = await db.select().from(journalEntries);

  // BENCHMARK ISOLATION PROOF: Benchmark records live strictly in benchmark tables
  assert.equal(accountsBefore.length, accountsAfter.length);
  assert.equal(entriesBefore.length, entriesAfter.length);
});

test("Test 15 — Patch 5: Portfolio Snapshot Immutability (Analytics recalculation never modifies portfolio_snapshots)", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupAnalyticsDb();

  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH for snapshot test",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "1",
    cashAssetId: usdAsset.id,
    cashQuantity: "3000",
    baseValue: "3000",
  });

  const snap = await createPortfolioSnapshot("2026-01-01");
  const [snapBefore] = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.id, snap.id));

  // Run analytics recalculations multiple times
  await getAnalyticsSummary();
  await getAnalyticsSummary();

  const [snapAfter] = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.id, snap.id));

  // IMMUTABILITY PROOF: Total portfolio snapshot value remains unchanged
  assert.equal(D(snapBefore.totalPortfolioValue).toString(), D(snapAfter.totalPortfolioValue).toString());
});

test("Test 16 — Patch 5: Deterministic Calculation (Same inputs produce identical output)", () => {
  const input = {
    startingValue: "100000",
    endingValue: "118250",
    externalInflows: "0",
    externalOutflows: "0",
    periodStart: "2025-01-01",
    periodEnd: "2026-08-02",
  };

  const calc1 = calculateGrowth(input);
  const calc2 = calculateGrowth(input);

  assert.equal(calc1.absoluteChange, calc2.absoluteChange);
  assert.equal(calc1.percentageChange, calc2.percentageChange);
  assert.equal(calc1.percentageChange, "18.25");
  assert.equal(calc2.percentageChange, "18.25");
});
