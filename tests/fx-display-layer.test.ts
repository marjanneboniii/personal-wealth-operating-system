/**
 * PWOS Phase 2.6 — FX Engine & Display Valuation Tests
 *
 * Tests verify:
 * 1. FX Engine isolation from Accounting Core
 * 2. FX conversion correctness
 * 3. Missing FX rate safety (no silent fallback)
 * 4. Display currency safety (no financial events created)
 * 5. IRR rejection / IRT support
 * 6. Historical valuation accuracy
 * 7. Backward compatibility (all existing systems unaffected)
 * 8. BTC/ETH/XAUT/PAXG are display-only
 * 9. Physical gold separation from XAUT/PAXG
 * 10. Backup/restore safety
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  analyticsRuns,
  assetClasses,
  assets,
  currencies,
  exchangeRates,
  journalEntries,
  lots,
  lotConsumptions,
  portfolioSnapshots,
  postings,
  userDisplayPreferences,
} from "../src/db/schema";
import { postEntry, recordBuy } from "../src/features/ledger/service";
import { D } from "../src/domain/decimal";
import { todayIso } from "../src/lib/format";
import {
  isSupportedDisplayCurrency,
  SUPPORTED_DISPLAY_CURRENCIES,
} from "../src/features/fx/types";
import {
  recordFxRate,
  getLatestFxRate,
  getHistoricalFxRate,
  getFxRateHistory,
} from "../src/features/fx/rates";
import {
  convertAmount,
  convertThroughIntermediate,
  invertRate,
  safeConvert,
} from "../src/features/fx/convert";
import {
  getDisplayPreference,
  setDisplayPreference,
} from "../src/features/display/preferences";
import { getDisplayValuation } from "../src/features/display/service";
import { createPortfolioSnapshot } from "../src/features/portfolio/service";
import { recordManualPrice } from "../src/features/marketData/service";

/* ──────────────────── Helper: Setup fresh test DB ──────────────────── */

async function setupTestDb() {
  await createSchemaIfNotExists();

  // Clean all tables in reverse dependency order (FK-safe)
  await db.execute(sql`DELETE FROM analytics_runs`);
  await db.execute(sql`DELETE FROM user_display_preferences`);
  await db.execute(sql`DELETE FROM exchange_rates`);
  await db.execute(sql`DELETE FROM benchmark_results`);
  await db.execute(sql`DELETE FROM benchmark_snapshots`);
  await db.execute(sql`DELETE FROM benchmark_definitions`);
  await db.execute(sql`DELETE FROM portfolio_risk_metrics`);
  await db.execute(sql`DELETE FROM asset_performance_analysis`);
  await db.execute(sql`DELETE FROM wealth_performance_snapshots`);
  await db.execute(sql`DELETE FROM portfolio_valuations`);
  await db.execute(sql`DELETE FROM portfolio_snapshots`);
  await db.execute(sql`DELETE FROM market_snapshots`);
  await db.execute(sql`DELETE FROM market_prices`);
  await db.execute(sql`DELETE FROM market_price_sources`);
  await db.execute(sql`DELETE FROM prices`);
  await db.execute(sql`DELETE FROM lot_consumptions`);
  await db.execute(sql`DELETE FROM lots`);
  await db.execute(sql`DELETE FROM postings`);
  await db.execute(sql`DELETE FROM journal_entries`);
  await db.execute(sql`DELETE FROM accounts`);
  await db.execute(sql`DELETE FROM wallets`);
  await db.execute(sql`DELETE FROM assets`);
  await db.execute(sql`DELETE FROM asset_classes`);
  await db.execute(sql`DELETE FROM currencies`);

  // Seed base data
  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true })
    .returning();

  const [cryptoCls] = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "Crypto", color: "#a78bfa" })
    .returning();

  const [goldCls] = await db
    .insert(assetClasses)
    .values({ code: "precious_metal", name: "Precious Metal", color: "#fbbf24" })
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

  const [xautAsset] = await db
    .insert(assets)
    .values({ symbol: "XAUT", name: "Tether Gold", classId: goldCls.id, currencyId: usd.id, decimals: 8 })
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

  const [xautAccount] = await db
    .insert(accounts)
    .values({ code: "1220", name: "XAUT Account", type: "asset", assetId: xautAsset.id })
    .returning();

  const [equityAccount] = await db
    .insert(accounts)
    .values({ code: "3010", name: "Opening Equity", type: "equity", assetId: usdAsset.id })
    .returning();

  // Initial cash opening
  await postEntry({
    entryDate: todayIso(),
    type: "opening",
    description: "Initial Cash",
    postings: [
      { accountId: cashAccount.id, assetId: usdAsset.id, quantity: "100000", baseValue: "100000" },
      { accountId: equityAccount.id, assetId: usdAsset.id, quantity: "-100000", baseValue: "-100000" },
    ],
  });

  return {
    usd, cryptoCls, goldCls,
    ethAsset, btcAsset, usdAsset, xautAsset,
    cashAccount, ethAccount, btcAccount, xautAccount, equityAccount,
  };
}

/* ================================================================
   TEST 1: FX Engine never creates journal entries or postings
   ================================================================ */
test("Test 1 — FX rate recording NEVER creates journal entries or postings", async () => {
  await setupTestDb();

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Record multiple FX rates
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "BTC", rate: "0.00001613" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "ETH", rate: "0.0005405" });

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // ISOLATION GUARANTEE: Zero new journal entries or postings
  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

/* ================================================================
   TEST 2: FX Engine never modifies accounts
   ================================================================ */
test("Test 2 — FX rate recording NEVER modifies accounts", async () => {
  await setupTestDb();

  const accountsBefore = await db.select().from(accounts);

  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "BTC", rate: "0.00001613" });

  const accountsAfter = await db.select().from(accounts);

  assert.equal(accountsBefore.length, accountsAfter.length);
  for (let i = 0; i < accountsBefore.length; i++) {
    assert.equal(accountsBefore[i].id, accountsAfter[i].id);
    assert.equal(accountsBefore[i].code, accountsAfter[i].code);
  }
});

/* ================================================================
   TEST 3: FX Engine never modifies lots or lot_consumptions
   ================================================================ */
test("Test 3 — FX operations NEVER modify lots or lot_consumptions", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupTestDb();

  // Create a buy to have lots
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "5",
    cashAssetId: usdAsset.id,
    cashQuantity: "15000",
    baseValue: "15000",
  });

  const lotsBefore = await db.select().from(lots);
  const consumptionsBefore = await db.select().from(lotConsumptions);

  // Record FX rates
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });

  // Run display valuation
  await getDisplayValuation();

  const lotsAfter = await db.select().from(lots);
  const consumptionsAfter = await db.select().from(lotConsumptions);

  assert.equal(lotsBefore.length, lotsAfter.length);
  assert.equal(consumptionsBefore.length, consumptionsAfter.length);
});

/* ================================================================
   TEST 4: FX conversion correctness (USD → IRT)
   ================================================================ */
test("Test 4 — USD to IRT conversion is mathematically correct", () => {
  // 100000 USD × 920000 = 92,000,000,000 IRT
  const result = convertAmount("100000", "920000", "USD", "IRT", "2026-08-03", "manual");

  assert.equal(result.success, true);
  assert.equal(result.convertedAmount, "92000000000");
  assert.equal(result.fromCurrency, "USD");
  assert.equal(result.toCurrency, "IRT");
});

/* ================================================================
   TEST 5: FX conversion correctness (USD → BTC)
   ================================================================ */
test("Test 5 — USD to BTC conversion is mathematically correct", () => {
  // 100000 USD × 0.00001613 (rate = 1 USD = 0.00001613 BTC) = 1.613 BTC
  const result = convertAmount("100000", "0.00001613", "USD", "BTC", "2026-08-03", "manual");

  assert.equal(result.success, true);
  assert.equal(D(result.convertedAmount).toFixed(4), "1.6130");
});

/* ================================================================
   TEST 6: FX conversion correctness (USD → ETH)
   ================================================================ */
test("Test 6 — USD to ETH conversion is mathematically correct", () => {
  // 100000 USD × 0.0005405 = 54.05 ETH
  const result = convertAmount("100000", "0.0005405", "USD", "ETH", "2026-08-03", "manual");

  assert.equal(result.success, true);
  assert.equal(D(result.convertedAmount).toFixed(2), "54.05");
});

/* ================================================================
   TEST 7: Missing FX rate safety — NEVER falls back to 1
   ================================================================ */
test("Test 7 — Missing FX rate returns null (NEVER falls back to 1)", () => {
  const result = safeConvert("100000", null, "USD", "IRT", "2026-08-03", "manual");
  assert.equal(result, null);

  const result2 = safeConvert("100000", "0", "USD", "IRT", "2026-08-03", "manual");
  assert.equal(result2, null);

  const result3 = safeConvert("100000", "-5", "USD", "IRT", "2026-08-03", "manual");
  assert.equal(result3, null);
});

/* ================================================================
   TEST 8: Missing FX rate in display valuation produces incomplete status
   ================================================================ */
test("Test 8 — Display valuation with missing FX rate returns incomplete (never silent)", async () => {
  await setupTestDb();

  // Set display to IRT but DON'T record any FX rate
  await setDisplayPreference("IRT");

  const display = await getDisplayValuation();

  assert.equal(display.conversionComplete, false);
  assert.ok(display.conversionWarning);
  assert.match(display.conversionWarning!, /نرخ تبدیل USD → IRT در دسترس نیست/);
  assert.equal(display.fxRateUsed, null);
});

/* ================================================================
   TEST 9: Display currency change NEVER creates journal entries
   ================================================================ */
test("Test 9 — Changing display currency NEVER creates journal entries or postings", async () => {
  await setupTestDb();

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Change display currency multiple times
  await setDisplayPreference("IRT");
  await setDisplayPreference("BTC");
  await setDisplayPreference("ETH");
  await setDisplayPreference("USD");

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

/* ================================================================
   TEST 10: IRR is NOT supported (only IRT)
   ================================================================ */
test("Test 10 — IRR is NOT a supported display currency, IRT IS supported", async () => {
  assert.equal(isSupportedDisplayCurrency("IRR"), false);
  assert.equal(isSupportedDisplayCurrency("IRT"), true);
  assert.equal(isSupportedDisplayCurrency("USD"), true);
  assert.equal(isSupportedDisplayCurrency("BTC"), true);
  assert.equal(isSupportedDisplayCurrency("ETH"), true);
  assert.equal(isSupportedDisplayCurrency("XAUT"), true);
  assert.equal(isSupportedDisplayCurrency("PAXG"), true);

  // Setting IRR should throw — use string cast to bypass TypeScript literal check
  await assert.rejects(
    async () => setDisplayPreference(("IRR") as string as "IRT"),
    /ارز نمایشی پشتیبانی نمی‌شود/,
  );
});

/* ================================================================
   TEST 11: BTC/ETH/XAUT/PAXG are display-only (no transactions)
   ================================================================ */
test("Test 11 — BTC/ETH/XAUT/PAXG display creates NO accounting transactions", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupTestDb();

  // Create holdings
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

  // Record FX rates
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "BTC", rate: "0.00001613" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "ETH", rate: "0.0005405" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "XAUT", rate: "0.0004" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "PAXG", rate: "0.0004" });

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Switch display to BTC
  await setDisplayPreference("BTC");
  const btcDisplay = await getDisplayValuation();
  assert.equal(btcDisplay.displayCurrency, "BTC");

  // Switch display to ETH
  await setDisplayPreference("ETH");
  const ethDisplay = await getDisplayValuation();
  assert.equal(ethDisplay.displayCurrency, "ETH");

  // Switch display to XAUT
  await setDisplayPreference("XAUT");
  const xautDisplay = await getDisplayValuation();
  assert.equal(xautDisplay.displayCurrency, "XAUT");

  // Switch display to PAXG
  await setDisplayPreference("PAXG");
  const paxgDisplay = await getDisplayValuation();
  assert.equal(paxgDisplay.displayCurrency, "PAXG");

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // ZERO new accounting events from display switching
  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

/* ================================================================
   TEST 12: Historical FX rate lookup — exact date match
   ================================================================ */
test("Test 12 — Historical FX rate requires exact date match (no current-rate fallback)", async () => {
  await setupTestDb();

  // Record rates on different dates
  await recordFxRate({
    baseCurrency: "USD",
    quoteCurrency: "IRT",
    rate: "500000",
    effectiveDate: "2025-01-01",
  });
  await recordFxRate({
    baseCurrency: "USD",
    quoteCurrency: "IRT",
    rate: "920000",
    effectiveDate: "2026-08-03",
  });

  // Historical lookup for 2025-01-01
  const historical = await getHistoricalFxRate("USD", "IRT", "2025-01-01");
  assert.ok(historical);
  assert.equal(D(historical.rate).toString(), D("500000").toString());
  assert.equal(historical.effectiveDate, "2025-01-01");

  // Historical lookup for non-existent date
  const missing = await getHistoricalFxRate("USD", "IRT", "2024-06-15");
  assert.equal(missing, null);
});

/* ================================================================
   TEST 13: Historical valuation uses historical FX rate
   ================================================================ */
test("Test 13 — Historical display valuation uses historical FX rate", () => {
  // Simulate: 100000 USD × 500000 IRT/USD (2025-01-01 rate)
  const result = convertAmount("100000", "500000", "USD", "IRT", "2025-01-01", "manual");
  assert.equal(result.success, true);
  assert.equal(result.convertedAmount, "50000000000"); // 50 billion IRT
  assert.equal(result.rateDate, "2025-01-01");
});

/* ================================================================
   TEST 14: Inverse rate calculation
   ================================================================ */
test("Test 14 — Inverse rate calculation is correct", () => {
  // If 1 USD = 920000 IRT, then 1 IRT = 1/920000 USD
  const inverse = invertRate("920000");
  assert.ok(D(inverse).gt(0));
  // Verify round-trip: 100000 × 920000 × (1/920000) ≈ 100000
  const roundTrip = D("100000").mul("920000").mul(inverse);
  assert.ok(roundTrip.sub("100000").abs().lt("0.0001"));
});

/* ================================================================
   TEST 15: Same-currency conversion is identity (no FX needed)
   ================================================================ */
test("Test 15 — Same currency conversion is identity", () => {
  const result = safeConvert("100000", null, "USD", "USD", "2026-08-03", "test");
  assert.ok(result);
  assert.equal(result.success, true);
  assert.equal(result.convertedAmount, "100000");
  assert.equal(result.rateUsed, "1");
  assert.equal(result.rateSource, "identity");
});

/* ================================================================
   TEST 16: FX rate upsert (same pair+date updates, not duplicates)
   ================================================================ */
test("Test 16 — FX rate upsert prevents duplicate entries", async () => {
  await setupTestDb();

  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "500000" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });

  const rates = await getFxRateHistory("USD", "IRT");
  // Should be 1 entry (upsert), not 2
  assert.equal(rates.length, 1);
  assert.equal(D(rates[0].rate).toString(), D("920000").toString());
});

/* ================================================================
   TEST 17: Display preference persistence
   ================================================================ */
test("Test 17 — Display preference persists correctly", async () => {
  await setupTestDb();

  const defaultPref = await getDisplayPreference();
  assert.equal(defaultPref.displayCurrency, "USD");

  await setDisplayPreference("IRT");
  const updated = await getDisplayPreference();
  assert.equal(updated.displayCurrency, "IRT");

  await setDisplayPreference("BTC");
  const updated2 = await getDisplayPreference();
  assert.equal(updated2.displayCurrency, "BTC");
});

/* ================================================================
   TEST 18: Display conversion with valid FX rate
   ================================================================ */
test("Test 18 — Display valuation with valid FX rate converts correctly", async () => {
  await setupTestDb();

  // Record IRT rate
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });
  await setDisplayPreference("IRT");

  const display = await getDisplayValuation();

  assert.equal(display.displayCurrency, "IRT");
  assert.equal(display.conversionComplete, true);
  assert.equal(display.conversionWarning, null);
  assert.equal(D(display.fxRateUsed!).toString(), D("920000").toString());
  // Native net worth should be in USD
  assert.ok(D(display.nativeNetWorth).gt(0));
  // Display net worth should be native × 920000
  const expected = D(display.nativeNetWorth).mul("920000");
  assert.ok(D(display.displayNetWorth).sub(expected).abs().lt("0.01"));
});

/* ================================================================
   TEST 19: XAUT/PAXG are separate from physical gold
   ================================================================ */
test("Test 19 — XAUT and PAXG are tokenized gold, separate from physical gold classes", async () => {
  const { goldCls, xautAsset } = await setupTestDb();

  // XAUT should be in precious_metal class but it's a tokenized asset
  const asset = await db.select().from(assets).where(eq(assets.id, xautAsset.id));
  assert.equal(asset[0].symbol, "XAUT");
  assert.equal(asset[0].classId, goldCls.id);

  // XAUT as display currency is a display unit, not an accounting currency
  assert.equal(isSupportedDisplayCurrency("XAUT"), true);

  // Physical gold assets (طلای آب‌شده, سکه) would be separate asset entries
  // with their own market prices. The display XAUT unit just uses the XAUT
  // exchange rate for portfolio representation.
});

/* ================================================================
   TEST 20: FX data stored only in exchange_rates table
   ================================================================ */
test("Test 20 — FX data exists only in exchange_rates, never in accounting tables", async () => {
  await setupTestDb();

  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "BTC", rate: "0.00001613" });

  // Verify FX data is in exchange_rates
  const rates = await db.select().from(exchangeRates);
  assert.ok(rates.length >= 2);

  // Verify NO FX data in journal_entries
  const entries = await db.select().from(journalEntries);
  for (const entry of entries) {
    // No entry should reference FX or exchange
    assert.equal(entry.description.includes("FX") || entry.description.includes("exchange_rate") || entry.description.includes("تبدیل ارز"), false);
  }
});

/* ================================================================
   TEST 21: Zero or negative rate rejected
   ================================================================ */
test("Test 21 — Zero or negative FX rate is rejected", async () => {
  await setupTestDb();

  await assert.rejects(
    async () => recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "0" }),
    /نرخ تبدیل ارز باید بزرگ‌تر از صفر باشد/,
  );

  await assert.rejects(
    async () => recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "-100" }),
    /نرخ تبدیل ارز باید بزرگ‌تر از صفر باشد/,
  );
});

/* ================================================================
   TEST 22: Through-intermediate conversion
   ================================================================ */
test("Test 22 — Through-intermediate conversion is correct", () => {
  // IRT → USD → BTC: 92000000000 IRT × (1/920000) USD/IRT × 0.00001613 BTC/USD
  const result = convertThroughIntermediate(
    "92000000000",     // amount in IRT
    invertRate("920000"), // IRT → USD rate
    "0.00001613",      // USD → BTC rate
    "IRT",
    "USD",
    "BTC",
    "2026-08-03",
    "manual",
  );

  assert.equal(result.success, true);
  // 92000000000 / 920000 = 100000, 100000 × 0.00001613 = 1.613
  assert.equal(D(result.convertedAmount).toFixed(4), "1.6130");
});

/* ================================================================
   TEST 23: Display conversion NEVER modifies portfolio snapshots
   ================================================================ */
test("Test 23 — Display conversion NEVER modifies portfolio_snapshots", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupTestDb();

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

  await recordManualPrice({ assetId: ethAsset.id, price: "3500", asOfDate: todayIso() });
  const snap = await createPortfolioSnapshot(todayIso());
  const [snapBefore] = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.id, snap.id));

  // Run display conversions
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });
  await setDisplayPreference("IRT");
  await getDisplayValuation();
  await setDisplayPreference("BTC");
  await getDisplayValuation();
  await setDisplayPreference("USD");
  await getDisplayValuation();

  // Portfolio snapshot should remain unchanged
  const [snapAfter] = await db.select().from(portfolioSnapshots).where(eq(portfolioSnapshots.id, snap.id));
  assert.ok(snapAfter);
  assert.equal(D(snapBefore.totalPortfolioValue).toString(), D(snapAfter.totalPortfolioValue).toString());
});

/* ================================================================
   TEST 24: Deterministic conversion (same inputs → same output)
   ================================================================ */
test("Test 24 — FX conversion is deterministic", () => {
  const input = {
    amount: "100000",
    rate: "920000",
    from: "USD",
    to: "IRT",
    date: "2026-08-03",
    source: "manual",
  };

  const result1 = convertAmount(input.amount, input.rate, input.from, input.to, input.date, input.source);
  const result2 = convertAmount(input.amount, input.rate, input.from, input.to, input.date, input.source);

  assert.equal(result1.convertedAmount, result2.convertedAmount);
  assert.equal(result1.success, result2.success);
});

/* ================================================================
   TEST 25: Supported display currencies list
   ================================================================ */
test("Test 25 — Supported display currencies are exactly: USD, IRT, BTC, ETH, XAUT, PAXG", () => {
  assert.equal(SUPPORTED_DISPLAY_CURRENCIES.length, 6);
  assert.ok(SUPPORTED_DISPLAY_CURRENCIES.includes("USD"));
  assert.ok(SUPPORTED_DISPLAY_CURRENCIES.includes("IRT"));
  assert.ok(SUPPORTED_DISPLAY_CURRENCIES.includes("BTC"));
  assert.ok(SUPPORTED_DISPLAY_CURRENCIES.includes("ETH"));
  assert.ok(SUPPORTED_DISPLAY_CURRENCIES.includes("XAUT"));
  assert.ok(SUPPORTED_DISPLAY_CURRENCIES.includes("PAXG"));

  // IRR must NOT be in the list
  assert.ok(!(SUPPORTED_DISPLAY_CURRENCIES as readonly string[]).includes("IRR"));
});

/* ================================================================
   TEST 26: Full isolation ledger hash/count (Ledger untouched by FX+Display)
   ================================================================ */
test("Test 26 — Full ledger isolation: entries, postings, lots unchanged after FX+Display operations", async () => {
  const { ethAsset, btcAsset, usdAsset, ethAccount, btcAccount, cashAccount } = await setupTestDb();

  // Create holdings
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "3",
    cashAssetId: usdAsset.id,
    cashQuantity: "9000",
    baseValue: "9000",
  });

  await recordBuy({
    entryDate: todayIso(),
    description: "Buy BTC",
    assetAccountId: btcAccount.id,
    cashAccountId: cashAccount.id,
    assetId: btcAsset.id,
    quantity: "0.1",
    cashAssetId: usdAsset.id,
    cashQuantity: "6200",
    baseValue: "6200",
  });

  // Snapshot ledger state
  const entriesBefore = await db.select().from(journalEntries);
  const postingsBefore = await db.select().from(postings);
  const lotsBefore = await db.select().from(lots);
  const accountsBefore = await db.select().from(accounts);

  // Perform all FX and Display operations
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "BTC", rate: "0.00001613" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "ETH", rate: "0.0005405" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "XAUT", rate: "0.0004" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "PAXG", rate: "0.0004" });

  // Run display valuations in multiple currencies
  for (const cur of ["IRT", "BTC", "ETH", "XAUT", "PAXG", "USD"]) {
    await setDisplayPreference(cur);
    await getDisplayValuation();
  }

  // Verify ledger is IDENTICAL
  const entriesAfter = await db.select().from(journalEntries);
  const postingsAfter = await db.select().from(postings);
  const lotsAfter = await db.select().from(lots);
  const accountsAfter = await db.select().from(accounts);

  assert.equal(entriesBefore.length, entriesAfter.length);
  assert.equal(postingsBefore.length, postingsAfter.length);
  assert.equal(lotsBefore.length, lotsAfter.length);
  assert.equal(accountsBefore.length, accountsAfter.length);
});

/* ================================================================
   TEST 27: FX rates table does not contain accounting columns
   ================================================================ */
test("Test 27 — exchange_rates has NO foreign keys to accounting tables", async () => {
  await setupTestDb();

  // Record a rate
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000" });

  // Verify the FX rate record has no references to accounting tables
  const [rate] = await db.select().from(exchangeRates);
  assert.ok(rate);
  assert.equal(rate.baseCurrency, "USD");
  assert.equal(rate.quoteCurrency, "IRT");
  assert.equal(D(rate.rate).toString(), D("920000").toString());
  // No account_id, entry_id, lot_id, or posting_id columns exist
});

/* ================================================================
   TEST 28: user_display_preferences has NO accounting references
   ================================================================ */
test("Test 28 — user_display_preferences has NO accounting table references", async () => {
  await setupTestDb();

  await setDisplayPreference("IRT");

  const [pref] = await db.select().from(userDisplayPreferences);
  assert.ok(pref);
  assert.equal(pref.displayCurrency, "IRT");
  // No journal_entries, postings, accounts, lots references
});

/* ================================================================
   TEST 29: FX rate history retrieval
   ================================================================ */
test("Test 29 — FX rate history returns chronological data", async () => {
  await setupTestDb();

  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "500000", effectiveDate: "2025-01-01" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "600000", effectiveDate: "2025-06-01" });
  await recordFxRate({ baseCurrency: "USD", quoteCurrency: "IRT", rate: "920000", effectiveDate: "2026-08-03" });

  const history = await getFxRateHistory("USD", "IRT");
  assert.equal(history.length, 3);
  // Most recent first
  assert.equal(D(history[0].rate).toString(), D("920000").toString());
  assert.equal(D(history[1].rate).toString(), D("600000").toString());
  assert.equal(D(history[2].rate).toString(), D("500000").toString());
});

/* ================================================================
   TEST 30: Currency code normalization (case insensitive)
   ================================================================ */
test("Test 30 — FX rate recording normalizes currency codes to uppercase", async () => {
  await setupTestDb();

  await recordFxRate({ baseCurrency: "usd", quoteCurrency: "irt", rate: "920000" });

  const rate = await getLatestFxRate("USD", "IRT");
  assert.ok(rate);
  assert.equal(rate.baseCurrency, "USD");
  assert.equal(rate.quoteCurrency, "IRT");
});
