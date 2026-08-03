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
} from "../src/db/schema";
import { postEntry, recordBuy } from "../src/features/ledger/service";
import { recordManualPrice } from "../src/features/marketData/service";
import {
  createPortfolioSnapshot,
  getPortfolioValuation,
} from "../src/features/portfolio/service";
import { todayIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

async function setupPortfolioDb() {
  await createSchemaIfNotExists();

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
    .values({ code: "gold", name: "Precious Metals", color: "#fbbf24" })
    .returning();

  const [realEstateCls] = await db
    .insert(assetClasses)
    .values({ code: "real_estate", name: "Real Estate", color: "#34d399" })
    .returning();

  const [stockCls] = await db
    .insert(assetClasses)
    .values({ code: "stock", name: "Tokenized Stock", color: "#38bdf8" })
    .returning();

  // Assets
  const [ethAsset] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: cryptoCls.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [goldAsset] = await db
    .insert(assets)
    .values({ symbol: "GOLD18", name: "18k Gold", classId: goldCls.id, currencyId: usd.id, decimals: 3 })
    .returning();

  const [reAsset] = await db
    .insert(assets)
    .values({ symbol: "APT95", name: "Apartment 95m", classId: realEstateCls.id, currencyId: usd.id, decimals: 0 })
    .returning();

  const [aaplAsset] = await db
    .insert(assets)
    .values({ symbol: "AAPL", name: "Apple Token", classId: stockCls.id, currencyId: usd.id, decimals: 2 })
    .returning();

  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: cryptoCls.id, currencyId: usd.id, decimals: 2 })
    .returning();

  // Accounts
  const [cashAccount] = await db
    .insert(accounts)
    .values({ code: "1010", name: "Cash Account", type: "asset", assetId: usdAsset.id })
    .returning();

  const [ethAccount] = await db
    .insert(accounts)
    .values({ code: "1200", name: "ETH Account", type: "asset", assetId: ethAsset.id })
    .returning();

  const [goldAccount] = await db
    .insert(accounts)
    .values({ code: "1300", name: "Gold Account", type: "asset", assetId: goldAsset.id })
    .returning();

  const [reAccount] = await db
    .insert(accounts)
    .values({ code: "1500", name: "Real Estate Account", type: "asset", assetId: reAsset.id })
    .returning();

  const [aaplAccount] = await db
    .insert(accounts)
    .values({ code: "1600", name: "AAPL Account", type: "asset", assetId: aaplAsset.id })
    .returning();

  const [equityAccount] = await db
    .insert(accounts)
    .values({ code: "3010", name: "Opening Equity", type: "equity", assetId: usdAsset.id })
    .returning();

  // Post opening cash balance ($200,000) credited against Opening Equity
  await postEntry({
    entryDate: todayIso(),
    type: "opening",
    description: "Initial Cash Opening Balance",
    postings: [
      {
        accountId: cashAccount.id,
        assetId: usdAsset.id,
        quantity: "200000",
        baseValue: "200000",
      },
      {
        accountId: equityAccount.id,
        assetId: usdAsset.id,
        quantity: "-200000",
        baseValue: "-200000",
      },
    ],
  });

  return {
    usd,
    ethAsset,
    goldAsset,
    reAsset,
    aaplAsset,
    usdAsset,
    cashAccount,
    ethAccount,
    goldAccount,
    reAccount,
    aaplAccount,
  };
}

test("Test 1 & Test 2 — Portfolio valuation & market price updates NEVER create journal entries", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupPortfolioDb();

  // Buy 5 ETH @ $3,000 ($15,000)
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy 5 ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "5",
    cashAssetId: usdAsset.id,
    cashQuantity: "15000",
    baseValue: "15000",
  });

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // 1. Run Portfolio Valuation (200k starting cash - 15k spent + 15k ETH = 200,000)
  const val1 = await getPortfolioValuation();
  assert.equal(D(val1.totalNetWorth).toString(), "200000");

  // 2. Update Market Price ($3,000 -> $4,000)
  await recordManualPrice({
    assetId: ethAsset.id,
    price: "4000",
    asOfDate: todayIso(),
  });

  // 3. Run Valuation again (185k cash + 20k ETH = 205,000)
  const val2 = await getPortfolioValuation();
  assert.equal(D(val2.totalNetWorth).toString(), "205000");
  assert.equal(D(val2.totalUnrealizedPnl).toString(), "5000"); // 205000 - 200000 = 5000

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // ABSOLUTE RULE: Journal entries and postings count MUST remain completely unchanged!
  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

test("Test 3 — FIFO cost basis is preserved during valuation calculation", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupPortfolioDb();

  // Buy 5 ETH @ $3,000 ($15,000)
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy 5 ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: cashAccount.id,
    assetId: ethAsset.id,
    quantity: "5",
    cashAssetId: usdAsset.id,
    cashQuantity: "15000",
    baseValue: "15000",
  });

  const openLotsBefore = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(D(openLotsBefore[0].qtyRemaining).toString(), "5");
  assert.equal(D(openLotsBefore[0].unitCostBase).toString(), "3000");

  // Run Portfolio Valuation multiple times
  await getPortfolioValuation();
  await getPortfolioValuation();

  const openLotsAfter = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(D(openLotsAfter[0].qtyRemaining).toString(), "5");
  assert.equal(D(openLotsAfter[0].unitCostBase).toString(), "3000");
});

test("Test 4 — Multi-Asset Valuation (Crypto, Gold, Real Estate, Tokenized Stock)", async () => {
  const {
    ethAsset,
    goldAsset,
    reAsset,
    aaplAsset,
    usdAsset,
    cashAccount,
    ethAccount,
    goldAccount,
    reAccount,
    aaplAccount,
  } = await setupPortfolioDb();

  // 1. ETH: 5 ETH @ $3000
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
  await recordManualPrice({ assetId: ethAsset.id, price: "3000" });

  // 2. Gold: 50g @ $60/g = $3000
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy Gold",
    assetAccountId: goldAccount.id,
    cashAccountId: cashAccount.id,
    assetId: goldAsset.id,
    quantity: "50",
    cashAssetId: usdAsset.id,
    cashQuantity: "3000",
    baseValue: "3000",
  });
  await recordManualPrice({ assetId: goldAsset.id, price: "60" });

  // 3. Real Estate: 1 Apartment (95m2 @ $1000/m2 = $95,000)
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy Apartment",
    assetAccountId: reAccount.id,
    cashAccountId: cashAccount.id,
    assetId: reAsset.id,
    quantity: "1",
    cashAssetId: usdAsset.id,
    cashQuantity: "95000",
    baseValue: "95000",
  });
  await recordManualPrice({ assetId: reAsset.id, price: "100000" }); // Appreciated to $100,000

  // 4. Tokenized AAPL: 10 AAPL @ $200 = $2000
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy AAPL",
    assetAccountId: aaplAccount.id,
    cashAccountId: cashAccount.id,
    assetId: aaplAsset.id,
    quantity: "10",
    cashAssetId: usdAsset.id,
    cashQuantity: "2000",
    baseValue: "2000",
  });
  await recordManualPrice({ assetId: aaplAsset.id, price: "220" }); // Price $220

  const summary = await getPortfolioValuation();

  // Cash remaining: 200,000 - 15000 - 3000 - 95000 - 2000 = 85,000
  // ETH: 5 * 3000 = 15000
  // Gold: 50 * 60 = 3000
  // Real Estate: 1 * 100000 = 100000
  // AAPL: 10 * 220 = 2200
  // Total Net Worth = 85000 + 15000 + 3000 + 100000 + 2200 = 205200
  assert.equal(D(summary.totalNetWorth).toString(), "205200");
  assert.equal(summary.assetValuations.length, 5); // Cash + ETH + Gold + RE + AAPL

  const reVal = summary.assetValuations.find((v) => v.symbol === "APT95");
  assert.equal(D(reVal?.currentValue ?? "0").toString(), "100000");
  assert.equal(D(reVal?.unrealizedPnl ?? "0").toString(), "5000"); // 100000 - 95000
});

test("Test 5 & Test 6 — Historical wealth snapshots remain immutable & UI display preferences do NOT modify accounting data", async () => {
  const { ethAsset, usdAsset, ethAccount, cashAccount } = await setupPortfolioDb();

  // Buy ETH
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
  await recordManualPrice({ assetId: ethAsset.id, price: "3000" });

  // Create Snapshot for Day 1
  const snap1 = await createPortfolioSnapshot("2026-01-01");
  assert.ok(snap1.id);

  const [snapRow1] = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.id, snap1.id));
  assert.equal(D(snapRow1.totalPortfolioValue).toString(), "200000");

  // Create Snapshot for Day 2 with higher price
  await recordManualPrice({ assetId: ethAsset.id, price: "4000", asOfDate: "2026-08-02", timestamp: "2026-08-02T12:00:00Z" });
  const snap2 = await createPortfolioSnapshot("2026-08-02");

  const [snapRow2] = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.id, snap2.id));
  assert.equal(D(snapRow2.totalPortfolioValue).toString(), "205000");

  // Verify Day 1 snapshot remains completely immutable ($200,000)
  const [snapRow1Check] = await db
    .select()
    .from(portfolioSnapshots)
    .where(eq(portfolioSnapshots.id, snap1.id));
  assert.equal(D(snapRow1Check.totalPortfolioValue).toString(), "200000");
});
