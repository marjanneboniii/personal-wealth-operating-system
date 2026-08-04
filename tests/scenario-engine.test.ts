import assert from "node:assert/strict";
import { test } from "node:test";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  journalEntries,
  lotConsumptions,
  lots,
  marketPrices,
  marketPriceSources,
  marketSnapshots,
  portfolioSnapshots,
  portfolioValuations,
  postings,
  prices,
  scenarioEvaluationRuns,
  scenarioSimulations,
  analyticsRuns,
  benchmarkDefinitions,
} from "../src/db/schema";
import { recordManualPrice, getMarketPrices } from "../src/features/marketData/service";
import {
  createScenario,
  evaluateScenario,
  getScenario,
  listScenarios,
  compareScenarioBenchmarks,
  compareAssets,
  getScenarioTimeline,
  deleteScenario,
  simulateHistoricalInvestmentOnce,
} from "../src/features/scenarios/service";
import {
  calculateInitialQuantity,
  calculateCurrentValue,
  calculateProfitLoss,
  calculateRoiPercentage,
} from "../src/features/scenarios/calculator";
import { todayIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

async function setupScenarioDb() {
  await createSchemaIfNotExists();

  // Delete in correct FK order: scenario children first
  await db.delete(scenarioEvaluationRuns);
  await db.delete(scenarioSimulations);
  await db.delete(analyticsRuns);
  await db.delete(portfolioValuations);
  await db.delete(portfolioSnapshots);
  await db.delete(marketSnapshots);
  await db.delete(marketPrices);
  await db.delete(marketPriceSources);
  await db.delete(prices);
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(benchmarkDefinitions);

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true })
    .returning();

  const [btcClass] = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "Crypto", color: "#f59e0b" })
    .returning();

  // Create assets: ETH, BTC, GOLD, SP500, USD etc.
  const [ethAsset] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: btcClass.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [btcAsset] = await db
    .insert(assets)
    .values({ symbol: "BTC", name: "Bitcoin", classId: btcClass.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [goldAsset] = await db
    .insert(assets)
    .values({ symbol: "GOLD", name: "Gold", classId: btcClass.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [sp500Asset] = await db
    .insert(assets)
    .values({ symbol: "SP500", name: "S&P 500", classId: btcClass.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USDC", name: "USDC Stablecoin", classId: btcClass.id, currencyId: usd.id, decimals: 6 })
    .returning();

  // Record historical prices for simulation
  // ETH: 1575 on 2025-01-01, 3500 current
  await recordManualPrice({ assetId: ethAsset.id, price: "1575", asOfDate: "2025-01-01", sourceName: "MANUAL" });
  await recordManualPrice({ assetId: ethAsset.id, price: "3500", asOfDate: todayIso(), sourceName: "MANUAL" });

  // BTC: 40000 on 2025-01-01, 65000 current
  await recordManualPrice({ assetId: btcAsset.id, price: "40000", asOfDate: "2025-01-01", sourceName: "MANUAL" });
  await recordManualPrice({ assetId: btcAsset.id, price: "65000", asOfDate: todayIso(), sourceName: "MANUAL" });

  // GOLD: 2000 on 2025-01-01, 2300 current
  await recordManualPrice({ assetId: goldAsset.id, price: "2000", asOfDate: "2025-01-01", sourceName: "MANUAL" });
  await recordManualPrice({ assetId: goldAsset.id, price: "2300", asOfDate: todayIso(), sourceName: "MANUAL" });

  // SP500: 4500 on 2025-01-01, 5200 current
  await recordManualPrice({ assetId: sp500Asset.id, price: "4500", asOfDate: "2025-01-01", sourceName: "MANUAL" });
  await recordManualPrice({ assetId: sp500Asset.id, price: "5200", asOfDate: todayIso(), sourceName: "MANUAL" });

  return { usd, ethAsset, btcAsset, goldAsset, sp500Asset, usdAsset };
}

test("Calculator — quantity = capital / price (example: 10000 / 1575 = 6.349206...)", () => {
  const qty = calculateInitialQuantity("10000", "1575");
  // 10000 / 1575 = 6.349206349206...
  const expected = D("10000").div("1575").toString();
  assert.equal(D(qty).toString(), D(expected).toString());
  // Check approximate
  assert.ok(Math.abs(Number(qty) - 6.349206) < 0.00001);
});

test("Calculator — currentValue, PnL, ROI (ETH example from spec)", () => {
  const qty = calculateInitialQuantity("10000", "1575"); // 6.349206
  const currentValue = calculateCurrentValue(qty, "3500"); // ~22222.22
  const pnl = calculateProfitLoss(currentValue, "10000");
  const roi = calculateRoiPercentage(pnl, "10000");

  assert.ok(Math.abs(Number(currentValue) - 22222.22) < 0.1);
  assert.ok(Math.abs(Number(pnl) - 12222.22) < 0.1);
  assert.equal(roi, "122.22"); // 122.22%
});

test("Test 1 — Scenario creation does NOT create journal entries", async () => {
  const { ethAsset } = await setupScenarioDb();

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);

  const { id } = await createScenario({
    name: "ETH 10k Jan 2025",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  assert.ok(id);

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  assert.equal(entriesBefore[0].c, entriesAfter[0].c, "Scenario creation must NOT touch journal_entries");
});

test("Test 2 — Scenario execution does NOT modify postings", async () => {
  const { ethAsset } = await setupScenarioDb();

  const { id } = await createScenario({
    name: "ETH live track",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  await evaluateScenario(id);

  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c, "Evaluation must NOT modify postings");
});

test("Test 3 — Scenario execution does NOT modify portfolio snapshots", async () => {
  const { ethAsset } = await setupScenarioDb();

  const { id } = await createScenario({
    name: "ETH snapshot isolation",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const snapsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(portfolioSnapshots);

  await evaluateScenario(id);

  const snapsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(portfolioSnapshots);
  assert.equal(snapsBefore[0].c, snapsAfter[0].c, "Eval must NOT touch portfolio_snapshots");
});

test("Test 4 — Scenario execution does NOT modify market prices", async () => {
  const { ethAsset } = await setupScenarioDb();

  const pricesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(marketPrices);
  const snapBefore = await db.select({ c: sql<number>`count(*)::int` }).from(marketSnapshots);
  const legacyBefore = await db.select({ c: sql<number>`count(*)::int` }).from(prices);

  const { id } = await createScenario({
    name: "ETH market isolation",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  await evaluateScenario(id);

  const pricesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(marketPrices);
  const snapAfter = await db.select({ c: sql<number>`count(*)::int` }).from(marketSnapshots);
  const legacyAfter = await db.select({ c: sql<number>`count(*)::int` }).from(prices);

  assert.equal(pricesBefore[0].c, pricesAfter[0].c);
  assert.equal(snapBefore[0].c, snapAfter[0].c);
  assert.equal(legacyBefore[0].c, legacyAfter[0].c);
});

test("Test 5 — Scenario uses Market Data Single Source of Truth", async () => {
  const { ethAsset } = await setupScenarioDb();

  const { id } = await createScenario({
    name: "ETH SSOT verification",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const result = await evaluateScenario(id);

  // Current price should come from market_prices SSOT (3500 per setup)
  assert.equal(D(result.currentPrice).toString(), "3500");
  // 10000 / 1575 * 3500 = 22222...
  const expectedQty = D("10000").div("1575");
  const expectedVal = expectedQty.mul("3500");
  assert.ok(Math.abs(Number(result.currentValue) - Number(expectedVal.toString())) < 0.01);

  // Now update market price via official marketData service (SSOT writer)
  await recordManualPrice({ assetId: ethAsset.id, price: "4000", asOfDate: todayIso(), sourceName: "MANUAL" });

  const quotes = await getMarketPrices(ethAsset.id);
  assert.equal(D(quotes[0].price).toString(), "4000");

  // Re-evaluate, should reflect new price
  const result2 = await evaluateScenario(id);
  assert.equal(D(result2.currentPrice).toString(), "4000");
  const expectedVal2 = expectedQty.mul("4000");
  assert.ok(Math.abs(Number(result2.currentValue) - Number(expectedVal2.toString())) < 0.01);
});

test("Historical Investment Simulation — spec example $10k ETH Jan 1 2025", async () => {
  const { ethAsset } = await setupScenarioDb();

  const sim = await simulateHistoricalInvestmentOnce({
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  assert.equal(sim.assetSymbol, "ETH");
  assert.equal(D(sim.initialPrice).toString(), "1575");
  assert.equal(D(sim.currentPrice).toString(), D((await getMarketPrices(ethAsset.id))[0].price).toString());
  // qty 6.349206
  assert.ok(Math.abs(Number(sim.initialQuantity) - 6.349206) < 0.0001);
  // value 22222 at 3500
  assert.ok(Number(sim.currentValue) > 20000);
  assert.equal(sim.calculationVersion, "v1.0");
  assert.equal(sim.calculationStatus, "complete");
});

test("Live Scenario Tracking — updates when market moves", async () => {
  const { ethAsset } = await setupScenarioDb();

  const { id } = await createScenario({
    name: "Live ETH",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const first = await evaluateScenario(id);
  const firstVal = Number(first.currentValue);

  // Simulate price move July 10, Aug 3 etc.
  await recordManualPrice({ assetId: ethAsset.id, price: "3800", asOfDate: todayIso(), sourceName: "MANUAL" });
  const second = await evaluateScenario(id);
  assert.ok(Number(second.currentValue) > firstVal, "Live scenario should increase with price");

  await recordManualPrice({ assetId: ethAsset.id, price: "3000", asOfDate: todayIso(), sourceName: "MANUAL" });
  const third = await evaluateScenario(id);
  assert.ok(Number(third.currentValue) < Number(second.currentValue), "Live scenario should decrease when price drops");
});

test("Time Range Simulation — Jan 2025 to now", async () => {
  const { ethAsset } = await setupScenarioDb();

  // Add intermediate snapshots for timeline
  await recordManualPrice({ assetId: ethAsset.id, price: "2000", asOfDate: "2025-03-01", sourceName: "MANUAL" });
  await recordManualPrice({ assetId: ethAsset.id, price: "2800", asOfDate: "2025-06-01", sourceName: "MANUAL" });

  const { id } = await createScenario({
    name: "ETH time range",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const timelineResult = await getScenarioTimeline(id, "2025-01-01", todayIso());
  assert.ok(timelineResult.timeline.length >= 3, "Timeline should have at least 3 points");
  // First point should be >=2000 price point? Check sorted
  const firstPoint = timelineResult.timeline[0];
  assert.ok(firstPoint.date >= "2025-01-01");
  assert.equal(timelineResult.assetId, ethAsset.id);
});

test("Asset Comparison — ETH vs BTC performance difference", async () => {
  const { ethAsset, btcAsset } = await setupScenarioDb();

  const { id } = await createScenario({
    name: "ETH vs BTC",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const comparison = await compareAssets(id, ["BTC"]);

  assert.equal(comparison.primaryAsset.symbol, "ETH");
  assert.ok(comparison.benchmarks.length >= 1);
  const btcComp = comparison.benchmarks.find((b) => b.symbol === "BTC");
  assert.ok(btcComp);
  // ETH ROI 122.22% vs BTC (40000->65000) = 62.5%
  // 10000/40000=0.25 BTC *65000=16250 => 62.5% ROI
  assert.ok(Math.abs(Number(btcComp.roiPercentage) - 62.5) < 0.1);
  assert.ok(comparison.comparisonDetails.length >= 1);
});

test("Benchmark Comparison — $10k ETH vs BTC, GOLD, SP500 using existing benchmark logic", async () => {
  const { ethAsset } = await setupScenarioDb();

  const { id } = await createScenario({
    name: "ETH benchmark",
    assetId: ethAsset.id,
    initialCapital: "10000",
    startDate: "2025-01-01",
  });

  const { comparisons } = await compareScenarioBenchmarks(id, ["BTC", "GOLD", "SP500"]);

  assert.ok(comparisons.length >= 2);
  const btc = comparisons.find((c) => c.symbol === "BTC");
  const gold = comparisons.find((c) => c.symbol === "GOLD");
  assert.ok(btc);
  assert.ok(gold);

  // ETH outperformed BTC? 122% vs 62% => yes, alpha positive, outperformed true
  assert.equal(btc.outperformed, true);

  // Check reuse of existing benchmark logic not duplicated — alpha calculation should match portfolio - benchmark
  const expectedAlpha = D("122.22").sub(btc.roiPercentage).toFixed(2);
  // Since actual ROI may be 122.22 exact, alpha ~59.72
  assert.ok(Math.abs(Number(btc.alphaPercentage) - Number(expectedAlpha)) < 1);
});

test("Scenario DB isolation — only scenario tables written", async () => {
  const { ethAsset } = await setupScenarioDb();

  const accountsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(accounts);
  const lotsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(lots);

  const { id } = await createScenario({
    name: "Isolation check",
    assetId: ethAsset.id,
    initialCapital: "5000",
    startDate: "2025-01-01",
  });

  await evaluateScenario(id);

  const accountsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(accounts);
  const lotsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(lots);
  const scenCount = await db.select({ c: sql<number>`count(*)::int` }).from(scenarioSimulations);
  const evalCount = await db.select({ c: sql<number>`count(*)::int` }).from(scenarioEvaluationRuns);

  assert.equal(accountsBefore[0].c, accountsAfter[0].c, "No accounts created");
  assert.equal(lotsBefore[0].c, lotsAfter[0].c, "No lots created");
  assert.equal(scenCount[0].c, 1, "One scenario created in isolated table");
  assert.equal(evalCount[0].c, 1, "One eval run in isolated table");
});

test("Scenario validation — rejects future start date & zero capital", async () => {
  const { ethAsset } = await setupScenarioDb();

  await assert.rejects(
    async () => {
      await createScenario({
        name: "Future",
        assetId: ethAsset.id,
        initialCapital: "1000",
        startDate: "2999-01-01",
      });
    },
    /future/i,
  );

  await assert.rejects(
    async () => {
      await createScenario({
        name: "Zero",
        assetId: ethAsset.id,
        initialCapital: "0",
        startDate: "2025-01-01",
      });
    },
    /greater than zero/i,
  );
});
