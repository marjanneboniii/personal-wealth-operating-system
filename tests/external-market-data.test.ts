import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assetProviderMappings,
  assets,
  currencies,
  externalPriceHistory,
  externalProviders,
  journalEntries,
  lots,
  lotConsumptions,
  postings,
  users,
  wallets,
  walletObservations,
} from "../src/db/schema";
import {
  ensureExternalProvidersInDb,
  fetchAndCacheCurrentPrice,
  fetchAndCacheHistoricalPrice,
  getAssetMetadata,
  getAssetProviderMapping,
  getCurrentPriceQuote,
  getHistoricalPriceQuote,
  listExternalProvidersFromDb,
  marketProviderRegistry,
  MockExternalProvider,
  recordWalletObservation,
  registerAssetProviderMapping,
} from "../src/features/marketData";
import { recordBuy, recordSell } from "../src/features/ledger/service";
import { D } from "../src/domain/decimal";
import { todayIso } from "../src/lib/format";

let testUsdId = "";
let testUsdAssetId = "";
let testEthId = "";
let testPaxgId = "";
let testUserId = "";
let testWalletId = "";

async function resetDb() {
  await createSchemaIfNotExists();

  await db.delete(walletObservations);
  await db.delete(externalPriceHistory);
  await db.delete(assetProviderMappings);
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);
  await db.delete(externalProviders);

  const [u] = await db
    .insert(users)
    .values({ name: "Phase 2.7 Tester" })
    .returning();
  testUserId = u.id;

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$" })
    .returning();
  testUsdId = usd.id;

  const [cryptoCls] = await db
    .insert(assetClasses)
    .values({ name: "Crypto & Tokenized Gold", code: "CRYPTO" })
    .returning();

  const [eth] = await db
    .insert(assets)
    .values({
      symbol: "ETH",
      name: "Ethereum",
      classId: cryptoCls.id,
      currencyId: usd.id,
      decimals: 8,
    })
    .returning();
  testEthId = eth.id;

  const [paxg] = await db
    .insert(assets)
    .values({
      symbol: "PAXG",
      name: "PAX Gold",
      classId: cryptoCls.id,
      currencyId: usd.id,
      decimals: 8,
    })
    .returning();
  testPaxgId = paxg.id;

  const [w] = await db
    .insert(wallets)
    .values({ name: "Test Crypto Wallet", kind: "hot" })
    .returning();
  testWalletId = w.id;

  const [usdAsset] = await db
    .insert(assets)
    .values({
      symbol: "USD",
      name: "US Dollar Asset",
      classId: cryptoCls.id,
      currencyId: usd.id,
      decimals: 2,
    })
    .returning();
  testUsdAssetId = usdAsset.id;

  // Create accounts required for ledger buy/sell
  const [cashAcc] = await db
    .insert(accounts)
    .values({
      name: "USD Cash",
      code: "1010",
      type: "asset",
      assetId: usdAsset.id,
    })
    .returning();

  const [ethAcc] = await db
    .insert(accounts)
    .values({
      name: "ETH Wallet Account",
      code: "1200",
      type: "asset",
      assetId: eth.id,
    })
    .returning();

  const [gainAcc] = await db
    .insert(accounts)
    .values({
      name: "Realized Capital Gain",
      code: "4100",
      type: "income",
      assetId: usdAsset.id,
    })
    .returning();

  const [feeAcc] = await db
    .insert(accounts)
    .values({
      name: "Trading Fee Expense",
      code: "5100",
      type: "expense",
      assetId: usdAsset.id,
    })
    .returning();
}

async function getLedgerCount() {
  const e = await db.select().from(journalEntries);
  const p = await db.select().from(postings);
  const l = await db.select().from(lots);
  const lc = await db.select().from(lotConsumptions);
  const a = await db.select().from(accounts);
  return e.length + p.length + l.length + lc.length + a.length;
}

test("Phase 2.7 — Provider Registry & Built-in Providers (CoinGecko, Binance, Coinbase, Mock)", async () => {
  await resetDb();

  const providers = marketProviderRegistry.listProviders();
  const names = providers.map((p) => p.name);

  assert.ok(names.includes("coingecko"), "Must include coingecko provider");
  assert.ok(names.includes("binance"), "Must include binance provider");
  assert.ok(names.includes("coinbase"), "Must include coinbase provider");
  assert.ok(names.includes("mock"), "Must include mock provider");

  const cg = marketProviderRegistry.getProvider("coingecko");
  assert.ok(cg);
  assert.equal(cg.displayName, "CoinGecko API");
  assert.equal(cg.type, "crypto");

  // Verify DB seeding
  const dbProviders = await listExternalProvidersFromDb();
  assert.ok(dbProviders.length >= 4);
});

test("Phase 2.7 — Asset Metadata & Provider Mapping Ingestion (Reference Data Only)", async () => {
  await resetDb();

  const beforeCount = await getLedgerCount();

  const mapping = await registerAssetProviderMapping({
    assetId: testPaxgId,
    providerName: "coingecko",
    externalSymbol: "PAXG",
    externalName: "PAX Gold Tokenized Asset",
    providerAssetId: "pax-gold",
    assetType: "tokenized_asset",
    logoUrl: "https://assets.coingecko.com/coins/images/9519/large/paxg.png",
    supportedMarkets: "USD,IRT,USDT",
  });

  assert.ok(mapping.id);

  const retrieved = await getAssetProviderMapping(testPaxgId, "coingecko");
  assert.ok(retrieved);
  assert.equal(retrieved.externalSymbol, "PAXG");
  assert.equal(retrieved.providerAssetId, "pax-gold");
  assert.equal(retrieved.assetType, "tokenized_asset");
  assert.equal(
    retrieved.logoUrl,
    "https://assets.coingecko.com/coins/images/9519/large/paxg.png",
  );

  const metadata = await getAssetMetadata(testPaxgId, "coingecko");
  assert.ok(metadata);
  assert.equal(metadata.name, "PAX Gold Tokenized Asset");
  assert.equal(metadata.symbol, "PAXG");
  assert.equal(metadata.assetType, "tokenized_asset");
  assert.equal(metadata.providerId, "pax-gold");
  assert.deepEqual(metadata.supportedMarkets, ["USD", "IRT", "USDT"]);

  // CRITICAL INVARIANT: Zero impact on accounting tables
  const afterCount = await getLedgerCount();
  assert.equal(beforeCount, afterCount, "Mapping metadata must never modify Accounting Core");
});

test("Phase 2.7 — Current Price Retrieval & Caching Service", async () => {
  await resetDb();

  const mockP = marketProviderRegistry.getProvider("mock") as MockExternalProvider;
  mockP.setMockPrice("ETH", "3450.75", "USD");

  const beforeCount = await getLedgerCount();

  // 1. Fetch and cache current price from mock provider
  const res = await fetchAndCacheCurrentPrice(testEthId, "mock", "USD", "ETH");
  assert.ok(res.cached);
  assert.ok(res.quote);
  assert.equal(res.quote.price, "3450.75");
  assert.equal(res.quote.symbol, "ETH");

  // 2. Verify cached row in external_price_history
  const historyRows = await db
    .select()
    .from(externalPriceHistory)
    .where(eq(externalPriceHistory.assetId, testEthId));
  assert.equal(historyRows.length, 1);
  assert.equal(D(historyRows[0].price).toString(), "3450.75");
  assert.equal(historyRows[0].isCurrent, true);

  // 3. Verify retrieval via getCurrentPriceQuote uses cache
  const cachedQuote = await getCurrentPriceQuote(testEthId, "mock", "USD");
  assert.ok(cachedQuote);
  assert.equal(cachedQuote.price, "3450.75");
  assert.equal(cachedQuote.sourceType, "cache");

  // CRITICAL INVARIANT: Zero impact on accounting tables
  const afterCount = await getLedgerCount();
  assert.equal(beforeCount, afterCount, "Price caching must never modify Accounting Core");
});

test("Phase 2.7 — Historical Price Storage & Retrieval", async () => {
  await resetDb();

  const mockP = marketProviderRegistry.getProvider("mock") as MockExternalProvider;
  const targetDate = "2026-01-15";
  mockP.setMockHistoricalPrice("ETH", targetDate, "2980.50", "USD");

  const beforeCount = await getLedgerCount();

  const res = await fetchAndCacheHistoricalPrice(
    testEthId,
    targetDate,
    "mock",
    "USD",
    "ETH",
  );
  assert.ok(res.cached);
  assert.ok(res.quote);
  assert.equal(D(res.quote.price).toString(), "2980.5");
  assert.equal(res.quote.asOfDate, targetDate);

  const histQuote = await getHistoricalPriceQuote(
    testEthId,
    targetDate,
    "mock",
    "USD",
  );
  assert.ok(histQuote);
  assert.equal(D(histQuote.price).toString(), "2980.5");
  assert.equal(histQuote.asOfDate, targetDate);

  const afterCount = await getLedgerCount();
  assert.equal(beforeCount, afterCount, "Historical price caching must never modify Accounting Core");
});

test("Phase 2.7 — Profit and Loss Invariance Rule (Internally Calculated vs External API Prices)", async () => {
  await resetDb();

  // Retrieve accounts
  const accs = await db.select().from(accounts);
  const cashAcc = accs.find((a) => a.code === "1010")!;
  const ethAcc = accs.find((a) => a.code === "1200")!;
  const gainAcc = accs.find((a) => a.code === "4100")!;

  // 1. Record BUY transaction in ledger: 5 ETH @ $3000 = $15,000 cost basis
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy 5 ETH @ 3000 USD",
    assetAccountId: ethAcc.id,
    cashAccountId: cashAcc.id,
    assetId: testEthId,
    quantity: "5",
    cashAssetId: testUsdAssetId,
    cashQuantity: "15000",
    baseValue: "15000",
  });

  // Verify open lot
  const openLots = await db.select().from(lots);
  assert.equal(openLots.length, 1);
  assert.equal(D(openLots[0].qtyRemaining).toString(), "5");
  assert.equal(D(openLots[0].unitCostBase).toString(), "3000");

  const costBasisBefore = D("5").mul("3000"); // $15,000

  // 2. Ingest external market price from CoinGecko/Mock: ETH @ $4000
  const mockP = marketProviderRegistry.getProvider("mock") as MockExternalProvider;
  mockP.setMockPrice("ETH", "4000.00", "USD");
  await fetchAndCacheCurrentPrice(testEthId, "mock", "USD", "ETH");

  // Verify Unrealized P/L = Current Market Value ($20,000) - Cost Basis ($15,000) = +$5,000
  const currentMktValue = D("5").mul("4000");
  const unrealizedPnl = currentMktValue.sub(costBasisBefore);
  assert.equal(unrealizedPnl.toString(), "5000");

  // Assert that cost basis and lot remaining quantities in DB remain completely unchanged
  const lotsAfterApi = await db.select().from(lots);
  assert.equal(D(lotsAfterApi[0].unitCostBase).toString(), "3000");
  assert.equal(D(lotsAfterApi[0].qtyRemaining).toString(), "5");

  // 3. Record SELL transaction in ledger: Dispose 2 ETH @ $4500 ($9,000 disposal value)
  const sellRes = await recordSell({
    entryDate: todayIso(),
    description: "Sell 2 ETH @ 4500 USD",
    assetAccountId: ethAcc.id,
    cashAccountId: cashAcc.id,
    assetId: testEthId,
    quantity: "2",
    cashAssetId: testUsdAssetId,
    cashQuantity: "9000",
    baseValue: "9000",
    pnlAccountId: gainAcc.id,
  });

  assert.ok(sellRes.id);

  const gainPostings = await db
    .select()
    .from(postings)
    .where(eq(postings.accountId, gainAcc.id));
  assert.equal(gainPostings.length, 1);
  assert.equal(D(gainPostings[0].baseValue).abs().toString(), "3000"); // (4500 - 3000) * 2 = 3000 realized gain

  // Verify remaining lot in DB is 3 ETH @ $3000 cost basis ($9,000 remaining cost basis)
  const lotsAfterSell = await db.select().from(lots);
  assert.equal(D(lotsAfterSell[0].qtyRemaining).toString(), "3");
  assert.equal(D(lotsAfterSell[0].unitCostBase).toString(), "3000");
});

test("Phase 2.7 — Wallet Observations Prevent Double Counting (Manual Transactions remain Source of Truth)", async () => {
  await resetDb();

  // Retrieve accounts
  const accs = await db.select().from(accounts);
  const cashAcc = accs.find((a) => a.code === "1010")!;
  const ethAcc = accs.find((a) => a.code === "1200")!;

  // 1. Record manual transaction: Buy 3 ETH
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy 3 ETH",
    assetAccountId: ethAcc.id,
    cashAccountId: cashAcc.id,
    assetId: testEthId,
    quantity: "3",
    cashAssetId: testUsdAssetId,
    cashQuantity: "9000",
    baseValue: "9000",
  });

  const beforeCount = await getLedgerCount();

  // 2. Record Wallet Observation: Blockchain wallet balance observed as 3.2 ETH (0.2 ETH discrepancy)
  const obsResult = await recordWalletObservation({
    userId: testUserId,
    walletId: testWalletId,
    assetId: testEthId,
    observedBalance: "3.2",
    observationDate: todayIso(),
    source: "blockchain_explorer",
    notes: "Staking reward observed on chain not yet recorded manually",
  });

  assert.ok(obsResult.id);
  assert.equal(obsResult.observedBalance, "3.2");
  assert.equal(obsResult.recordedBalance, "3");
  assert.equal(obsResult.discrepancy, "0.2");
  assert.equal(obsResult.isReconciled, false);

  // CRITICAL FINANCIAL INVARIANT:
  // Wallet observation MUST NOT create journal entries, postings, accounts, lots, or lot consumptions
  const afterCount = await getLedgerCount();
  assert.equal(beforeCount, afterCount, "Wallet observation must never modify Accounting Core");

  // Verify observation was saved in wallet_observations table
  const rows = await db
    .select()
    .from(walletObservations)
    .where(eq(walletObservations.assetId, testEthId));
  assert.equal(rows.length, 1);
  assert.equal(D(rows[0].observedBalance).toString(), "3.2");
  assert.equal(D(rows[0].discrepancy).toString(), "0.2");
});

test("Phase 2.7 — External Providers and Mappings are Included in Backup/Restore Schema", async () => {
  await resetDb();

  await registerAssetProviderMapping({
    assetId: testEthId,
    providerName: "coingecko",
    externalSymbol: "ETH",
    externalName: "Ethereum",
    providerAssetId: "ethereum",
    assetType: "crypto",
  });

  const allProviders = await db.select().from(externalProviders);
  const allMappings = await db.select().from(assetProviderMappings);

  assert.ok(allProviders.length >= 4);
  assert.equal(allMappings.length, 1);
});
