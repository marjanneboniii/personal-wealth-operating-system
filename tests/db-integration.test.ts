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
  lots,
  lotConsumptions,
  postings,
  prices,
  goals,
  plannedTransactions,
} from "../src/db/schema";
import { recordBuy, recordSell, reverseEntry } from "../src/features/ledger/service";
import { getAccountBalances, getHoldings, getRealizedPnl } from "../src/features/ledger/queries";
import { todayIso } from "../src/lib/format";
import { D } from "../src/domain/decimal";

async function setupTestDb() {
  await createSchemaIfNotExists();

  // Clear test tables
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(prices);
  await db.delete(goals);
  await db.delete(plannedTransactions);
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
    .values({ code: "crypto", name: "Crypto", color: "#c9cafa" })
    .returning();

  const [ethAsset] = await db
    .insert(assets)
    .values({ symbol: "ETH", name: "Ethereum", classId: cls.id, currencyId: usd.id, decimals: 8 })
    .returning();

  const [usdAsset] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "USD Cash", classId: cls.id, currencyId: usd.id, decimals: 2 })
    .returning();

  const [ethAccount] = await db
    .insert(accounts)
    .values({ code: "1200", name: "ETH Wallet", type: "asset", assetId: ethAsset.id })
    .returning();

  const [usdAccount] = await db
    .insert(accounts)
    .values({ code: "1010", name: "USD Cash Account", type: "asset", assetId: usdAsset.id })
    .returning();

  const [pnlAccount] = await db
    .insert(accounts)
    .values({ code: "4100", name: "Realized PnL", type: "income", assetId: usdAsset.id })
    .returning();

  // Price row
  await db.insert(prices).values({
    assetId: ethAsset.id,
    asOf: todayIso(),
    priceBase: "3000",
    source: "manual",
  });

  return { ethAsset, usdAsset, ethAccount, usdAccount, pnlAccount };
}

test("Phase 1 Requirement — Buy 5 ETH @ 3000 USD then Reverse Transaction", async () => {
  const { ethAsset, usdAsset, ethAccount, usdAccount } = await setupTestDb();

  // 1. Buy 5 ETH @ 3000 USD ($15,000)
  const buyTx = await recordBuy({
    entryDate: todayIso(),
    description: "Buy 5 ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: usdAccount.id,
    assetId: ethAsset.id,
    quantity: "5",
    cashAssetId: usdAsset.id,
    cashQuantity: "15000",
    baseValue: "15000",
  });

  // Verify holdings after buy
  let holdings = await getHoldings();
  let ethHolding = holdings.find((h) => h.symbol === "ETH");
  assert.ok(ethHolding);
  assert.equal(D(ethHolding.quantity).toString(), "5");
  assert.equal(D(ethHolding.costBase).toString(), "15000");

  let openLots = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(openLots.length, 1);
  assert.equal(D(openLots[0].qtyRemaining).toString(), "5");

  // 2. Reverse transaction
  await reverseEntry(buyTx.id);

  // Expected outcomes:
  // - ETH quantity restored to 0
  // - Cost basis restored to 0
  // - FIFO lots remaining set to 0
  // - Ledger remains consistent
  holdings = await getHoldings();
  ethHolding = holdings.find((h) => h.symbol === "ETH");
  assert.equal(D(ethHolding?.quantity ?? "0").toString(), "0");
  assert.equal(D(ethHolding?.costBase ?? "0").toString(), "0");

  openLots = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(D(openLots[0].qtyRemaining).toString(), "0");

  const balances = await getAccountBalances();
  const ethBal = balances.find((b) => b.accountId === ethAccount.id);
  const usdBal = balances.find((b) => b.accountId === usdAccount.id);
  assert.equal(D(ethBal?.quantity ?? "0").toString(), "0");
  assert.equal(D(usdBal?.baseValue ?? "0").toString(), "0");
});

test("Phase 1 Requirement — Sell & Reversal restores consumed FIFO lots & PnL", async () => {
  const { ethAsset, usdAsset, ethAccount, usdAccount, pnlAccount } = await setupTestDb();

  // 1. Buy 5 ETH @ 3000 USD
  await recordBuy({
    entryDate: todayIso(),
    description: "Buy 5 ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: usdAccount.id,
    assetId: ethAsset.id,
    quantity: "5",
    cashAssetId: usdAsset.id,
    cashQuantity: "15000",
    baseValue: "15000",
  });

  // 2. Sell 2 ETH @ 3500 USD ($7,000 proceeds, $6,000 cost basis, $1,000 realized PnL)
  const sellTx = await recordSell({
    entryDate: todayIso(),
    description: "Sell 2 ETH",
    assetAccountId: ethAccount.id,
    cashAccountId: usdAccount.id,
    assetId: ethAsset.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "7000",
    baseValue: "7000",
    pnlAccountId: pnlAccount.id,
  });

  let pnl = await getRealizedPnl();
  assert.equal(D(pnl.total).toString(), "1000");

  let openLots = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(D(openLots[0].qtyRemaining).toString(), "3");

  // 3. Reverse Sell transaction
  await reverseEntry(sellTx.id);

  // Check lot quantity restored to 5
  openLots = await db.select().from(lots).where(eq(lots.assetId, ethAsset.id));
  assert.equal(D(openLots[0].qtyRemaining).toString(), "5");

  // Check realized PnL restored to 0
  pnl = await getRealizedPnl();
  assert.equal(D(pnl.total).toString(), "0");

  const holdings = await getHoldings();
  const ethHolding = holdings.find((h) => h.symbol === "ETH");
  assert.equal(D(ethHolding?.quantity ?? "0").toString(), "5");
});

test("Phase 4 System Guarantee — No price update = No Ledger change", async () => {
  const { ethAsset } = await setupTestDb();

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Update price in prices table
  await db
    .insert(prices)
    .values({ assetId: ethAsset.id, asOf: todayIso(), priceBase: "4000", source: "manual" })
    .onConflictDoUpdate({ target: [prices.assetId, prices.asOf], set: { priceBase: "4000" } });

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});

test("Phase 4 System Guarantee — No planning item = No Ledger change", async () => {
  await setupTestDb();

  const entriesBefore = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsBefore = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  // Add goal & planned transaction
  await db.insert(goals).values({
    name: "Buy House",
    targetBase: "100000",
  });

  await db.insert(plannedTransactions).values({
    title: "Monthly Savings",
    plannedDate: todayIso(),
    direction: "outflow",
    amountBase: "500",
  });

  const entriesAfter = await db.select({ c: sql<number>`count(*)::int` }).from(journalEntries);
  const postingsAfter = await db.select({ c: sql<number>`count(*)::int` }).from(postings);

  assert.equal(entriesBefore[0].c, entriesAfter[0].c);
  assert.equal(postingsBefore[0].c, postingsAfter[0].c);
});
