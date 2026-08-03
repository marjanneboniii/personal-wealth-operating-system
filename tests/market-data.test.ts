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
  marketPrices,
  marketPriceSources,
  marketSnapshots,
  postings,
  prices,
} from "../src/db/schema";
import {
  getMarketPrices,
  getMarketSnapshots,
  recordManualPrice,
} from "../src/features/marketData/service";
import { getAccountBalances } from "../src/features/ledger/queries";
import { recordBuy } from "../src/features/ledger/service";
import { todayIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

async function setupMarketDb() {
  await createSchemaIfNotExists();

  await db.delete(marketSnapshots);
  await db.delete(marketPrices);
  await db.delete(marketPriceSources);
  await db.delete(prices);
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

  const [cls] = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "Crypto", color: "#a78bfa" })
    .returning();

  const [ethAsset] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: cls.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "US Dollar Asset", classId: cls.id, currencyId: usd.id, decimals: 2 })
    .returning();

  const [cashAccount] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash Account", type: "asset", assetId: usdAsset.id })
    .returning();

  const [ethAccount] = await db
    .insert(accounts)
    .values({ code: "1200", name: "ETH Account", type: "asset", assetId: ethAsset.id })
    .returning();

  return { usd, ethAsset, usdAsset, cashAccount, ethAccount };
}

test("Phase 2.3 Requirement — Manual price creation works", async () => {
  const { usd, ethAsset } = await setupMarketDb();

  // Record manual price: 3500 USD for ETH
  const result = await recordManualPrice({
    assetId: ethAsset.id,
    price: "3500",
    currencyId: usd.id,
    asOfDate: "2026-08-02",
    sourceName: "MANUAL",
  });

  assert.ok(result.id);

  // Check market_prices table
  const quotes = await getMarketPrices(ethAsset.id);
  assert.equal(quotes.length, 1);
  assert.equal(D(quotes[0].price).toString(), "3500");
  assert.equal(quotes[0].symbol, "ETH");

  // Check market_snapshots table
  const snapshots = await getMarketSnapshots(ethAsset.id);
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].snapshotDate, "2026-08-02");
  assert.equal(D(snapshots[0].price).toString(), "3500");
});

test("Phase 2.3 Requirement — Market price update does NOT create journal entries or postings", async () => {
  const { ethAsset } = await setupMarketDb();

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Record market price update
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "4000",
    asOfDate: todayIso(),
    sourceName: "MANUAL",
  });

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // CRITICAL INVARIANT GUARANTEE: Price updates MUST NEVER touch journal_entries or postings!
  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

test("Phase 2.3 Requirement — Historical price snapshots are preserved across dates", async () => {
  const { ethAsset } = await setupMarketDb();

  // Price on Day 1
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "3200",
    asOfDate: "2026-01-01",
    sourceName: "MANUAL",
  });

  // Price on Day 2
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "3500",
    asOfDate: "2026-08-02",
    sourceName: "MANUAL",
  });

  const snapshots = await getMarketSnapshots(ethAsset.id);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].snapshotDate, "2026-08-02");
  assert.equal(D(snapshots[0].price).toString(), "3500");
  assert.equal(snapshots[1].snapshotDate, "2026-01-01");
  assert.equal(D(snapshots[1].price).toString(), "3200");
});

test("Phase 2.3 Requirement — Multiple price sources can coexist for same asset", async () => {
  const { ethAsset } = await setupMarketDb();

  // Price from MANUAL
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "3500",
    asOfDate: "2026-08-02",
    sourceName: "MANUAL",
  });

  // Price from COINGECKO
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "3550",
    asOfDate: "2026-08-02",
    sourceName: "COINGECKO",
    sourceType: "api",
  });

  const snapshots = await getMarketSnapshots(ethAsset.id);
  assert.equal(snapshots.length, 2);

  const sources = new Set(snapshots.map((s) => s.sourceName));
  assert.ok(sources.has("MANUAL"));
  assert.ok(sources.has("COINGECKO"));
});

test("Phase 2.3 Requirement — Ledger balances remain completely unchanged after price updates", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupMarketDb();

  // 1. Post a trade buy (2 ETH @ $3,000 = $6,000)
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy 2 ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });

  const balancesBefore = await getAccountBalances();
  const ethBalBefore = balancesBefore.find((b) => b.accountId === ethAccount.id);
  assert.equal(D(ethBalBefore?.quantity ?? "0").toString(), "2");

  // 2. Update market price drastically ($3,000 -> $10,000)
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "10000",
    asOfDate: todayIso(),
    sourceName: "MANUAL",
  });

  // 3. Verify ledger balances in getAccountBalances() are 100% UNCHANGED
  const balancesAfter = await getAccountBalances();
  const ethBalAfter = balancesAfter.find((b) => b.accountId === ethAccount.id);
  assert.equal(D(ethBalAfter?.quantity ?? "0").toString(), "2");
  assert.equal(D(ethBalAfter?.baseValue ?? "0").toString(), "6000"); // Cost base in ledger remains $6,000
});
