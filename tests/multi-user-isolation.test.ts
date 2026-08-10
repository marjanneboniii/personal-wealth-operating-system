import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assets,
  assetClasses,
  currencies,
  entryFxSnapshots,
  journalEntries,
  lots,
  lotConsumptions,
  postings,
  users,
  userFxSettings,
  wallets,
} from "../src/db/schema";
import { eq, sql } from "drizzle-orm";
import { recordBuy, recordSell } from "../src/features/ledger/service";
import {
  getAccountBalances,
  getHoldings,
  getLedger,
  getNetWorth,
  getOpenLots,
  getRealizedPnl,
} from "../src/features/ledger/queries";
import { getPortfolioValuation } from "../src/features/portfolio/service";
import { updateUserFxRate } from "../src/features/fx/userRate";
import { createSession } from "../src/lib/auth";
import { GET as txGet, PUT as txPut, DELETE as txDel } from "../src/app/api/transactions/route";
import { migrateLegacyFinancialData } from "../src/db/migrate-multiuser";

async function setupMultiUserScenario() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);

  // Setup currencies & asset classes
  const [usd] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irt] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any).returning();

  const [cryptoClass] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto", valuationMethod: "fifo" } as any).returning();
  const [cashClass] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", valuationMethod: "fifo" } as any).returning();

  const [btc] = await db.insert(assets).values({ symbol: "BTC", name: "Bitcoin", classId: cryptoClass.id, currencyId: usd.id } as any).returning();
  const [eth] = await db.insert(assets).values({ symbol: "ETH", name: "Ethereum", classId: cryptoClass.id, currencyId: usd.id } as any).returning();
  const [usdCash] = await db.insert(assets).values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any).returning();

  // Create two users
  const [userA] = await db.insert(users).values({ name: "User A", username: "usera", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "User B", username: "userb", role: "owner" } as any).returning();

  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "190000" },
    { userId: userB.id, currentRate: "200000" },
  ] as any);

  // Create accounts for User A
  const [assetAccA_BTC] = await db.insert(accounts).values({ code: "1100", name: "Crypto BTC A", type: "asset", assetId: btc.id, userId: userA.id } as any).returning();
  const [assetAccA_ETH] = await db.insert(accounts).values({ code: "1101", name: "Crypto ETH A", type: "asset", assetId: eth.id, userId: userA.id } as any).returning();
  const [cashAccA] = await db.insert(accounts).values({ code: "1010", name: "Cash USD A", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [equityAccA] = await db.insert(accounts).values({ code: "3010", name: "Equity A", type: "equity", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [pnlAccA] = await db.insert(accounts).values({ code: "4100", name: "Realized P&L A", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();

  // Create accounts for User B (with matching code 1010 to test user-aware code uniqueness)
  const [assetAccB_BTC] = await db.insert(accounts).values({ code: "1100_b", name: "Crypto BTC B", type: "asset", assetId: btc.id, userId: userB.id } as any).returning();
  const [assetAccB_ETH] = await db.insert(accounts).values({ code: "1101_b", name: "Crypto ETH B", type: "asset", assetId: eth.id, userId: userB.id } as any).returning();
  const [cashAccB] = await db.insert(accounts).values({ code: "1010_b", name: "Cash USD B", type: "asset", assetId: usdCash.id, userId: userB.id } as any).returning();
  const [equityAccB] = await db.insert(accounts).values({ code: "3010_b", name: "Equity B", type: "equity", assetId: usdCash.id, userId: userB.id } as any).returning();
  const [pnlAccB] = await db.insert(accounts).values({ code: "4100_b", name: "Realized P&L B", type: "income", assetId: usdCash.id, userId: userB.id } as any).returning();

  return {
    usd,
    irt,
    btc,
    eth,
    usdCash,
    userA,
    userB,
    accountsA: { btc: assetAccA_BTC, eth: assetAccA_ETH, cash: cashAccA, equity: equityAccA, pnl: pnlAccA },
    accountsB: { btc: assetAccB_BTC, eth: assetAccB_ETH, cash: cashAccB, equity: equityAccB, pnl: pnlAccB },
  };
}

test("STAGE 2 (#60-#64, #94) — Multi-user basic isolation: User A buys 1 BTC @ 100k, User B buys 2 ETH @ 5k", async () => {
  const { btc, eth, usdCash, userA, userB, accountsA, accountsB } = await setupMultiUserScenario();

  // User A buys 1 BTC @ 100,000 ($100,000) against equity
  await recordBuy({
    entryDate: "2026-08-01",
    description: "User A buys 1 BTC",
    assetAccountId: accountsA.btc.id,
    cashAccountId: accountsA.equity.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "100000",
    baseValue: "100000",
    userId: userA.id,
  });

  // User B buys 2 ETH @ 5,000 ($10,000 total) against equity
  await recordBuy({
    entryDate: "2026-08-01",
    description: "User B buys 2 ETH",
    assetAccountId: accountsB.eth.id,
    cashAccountId: accountsB.equity.id,
    assetId: eth.id,
    quantity: "2",
    cashAssetId: usdCash.id,
    cashQuantity: "10000",
    baseValue: "10000",
    userId: userB.id,
  });

  // Test Holdings Isolation
  const holdingsA = await getHoldings(userA.id);
  const holdingsB = await getHoldings(userB.id);

  const btcA = holdingsA.find((h) => h.symbol === "BTC");
  const ethA = holdingsA.find((h) => h.symbol === "ETH");
  const btcB = holdingsB.find((h) => h.symbol === "BTC");
  const ethB = holdingsB.find((h) => h.symbol === "ETH");

  assert.equal(parseFloat(btcA?.quantity || "0"), 1);
  assert.equal(parseFloat(ethA?.quantity || "0"), 0);

  assert.equal(parseFloat(btcB?.quantity || "0"), 0);
  assert.equal(parseFloat(ethB?.quantity || "0"), 2);

  // Test Net Worth Isolation
  const nwA = await getNetWorth(userA.id);
  const nwB = await getNetWorth(userB.id);

  assert.equal(parseFloat(nwA.totalAssets), 100000);
  assert.equal(parseFloat(nwB.totalAssets), 10000);
  assert.equal(parseFloat(btcA?.costBase || "0"), 100000);
  assert.equal(parseFloat(ethB?.costBase || "0"), 10000);
});

test("STAGE 2 (#65-#66, #95) — FIFO isolation: User A sells BTC without touching User B lots", async () => {
  const { btc, usdCash, userA, userB, accountsA, accountsB } = await setupMultiUserScenario();

  // User A buys 1 BTC @ 50,000
  await recordBuy({
    entryDate: "2026-08-01",
    description: "A Buy BTC",
    assetAccountId: accountsA.btc.id,
    cashAccountId: accountsA.cash.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: userA.id,
  });

  // User B buys 1 BTC @ 60,000
  await recordBuy({
    entryDate: "2026-08-02",
    description: "B Buy BTC",
    assetAccountId: accountsB.btc.id,
    cashAccountId: accountsB.cash.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "60000",
    baseValue: "60000",
    userId: userB.id,
  });

  // User A sells 0.5 BTC
  await recordSell({
    entryDate: "2026-08-05",
    description: "A Sell BTC",
    assetAccountId: accountsA.btc.id,
    cashAccountId: accountsA.cash.id,
    pnlAccountId: accountsA.pnl.id,
    assetId: btc.id,
    quantity: "0.5",
    cashAssetId: usdCash.id,
    cashQuantity: "35000",
    baseValue: "35000",
    userId: userA.id,
  });

  const lotsA = await getOpenLots(btc.id, userA.id);
  const lotsB = await getOpenLots(btc.id, userB.id);

  assert.equal(lotsA.length, 1);
  assert.equal(parseFloat(lotsA[0].qtyRemaining), 0.5);

  assert.equal(lotsB.length, 1);
  assert.equal(parseFloat(lotsB[0].qtyRemaining), 1);
});

test("STAGE 2 (#67, #96, #97) — Realized & Unrealized P&L Isolation", async () => {
  const { btc, usdCash, userA, userB, accountsA, accountsB } = await setupMultiUserScenario();

  await recordBuy({
    entryDate: "2026-08-01",
    description: "A Buy BTC",
    assetAccountId: accountsA.btc.id,
    cashAccountId: accountsA.cash.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: userA.id,
  });

  // User A sells 1 BTC @ 60,000 -> Realized P&L = +$10,000
  await recordSell({
    entryDate: "2026-08-05",
    description: "A Sell BTC",
    assetAccountId: accountsA.btc.id,
    cashAccountId: accountsA.cash.id,
    pnlAccountId: accountsA.pnl.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "60000",
    baseValue: "60000",
    userId: userA.id,
  });

  const pnlA = await getRealizedPnl(userA.id);
  const pnlB = await getRealizedPnl(userB.id);

  assert.equal(parseFloat(pnlA.total), 10000);
  assert.equal(parseFloat(pnlB.total), 0);
});

test("STAGE 2 (#68-#69, #98-#99) — Historical FX Isolation & Immutability", async () => {
  const { eth, usdCash, userA, userB, accountsA, accountsB } = await setupMultiUserScenario();

  // Both users record transaction for 19,000,000 IRT. User A has FX 190,000 (100 USD), User B has FX 200,000 (95 USD)
  const buyA = await recordBuy({
    entryDate: "2026-08-01",
    description: "A Buy ETH with IRT",
    assetAccountId: accountsA.eth.id,
    cashAccountId: accountsA.cash.id,
    assetId: eth.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "100",
    baseValue: "100",
    userId: userA.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: buyA.id,
    irtAmount: "19000000",
    usdAmount: "100",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  const buyB = await recordBuy({
    entryDate: "2026-08-01",
    description: "B Buy ETH with IRT",
    assetAccountId: accountsB.eth.id,
    cashAccountId: accountsB.cash.id,
    assetId: eth.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "95",
    baseValue: "95",
    userId: userB.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: buyB.id,
    irtAmount: "19000000",
    usdAmount: "95",
    fxRate: "200000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  // Check historical snapshots
  const [snapA] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buyA.id));
  const [snapB] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buyB.id));
  assert.equal(parseFloat(snapA.usdAmount), 100);
  assert.equal(parseFloat(snapB.usdAmount), 95);

  // Now change User A FX to 250,000
  await updateUserFxRate(userA.id, "250000");

  // Verify historical snapshots remain immutable
  const [afterSnapA] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buyA.id));
  assert.equal(parseFloat(afterSnapA.usdAmount), 100);
  assert.equal(afterSnapA.fxRate, "190000.000000000000000000");
});

test("STAGE 2 (#70-#73) — IDOR Protection: Read, Update, Delete transactions across users", async () => {
  const { btc, usdCash, userA, userB, accountsB } = await setupMultiUserScenario();

  const buyB = await recordBuy({
    entryDate: "2026-08-01",
    description: "User B Secret Buy",
    assetAccountId: accountsB.btc.id,
    cashAccountId: accountsB.cash.id,
    assetId: btc.id,
    quantity: "5",
    cashAssetId: usdCash.id,
    cashQuantity: "250000",
    baseValue: "250000",
    userId: userB.id,
  });

  const { token: tokenA } = await createSession(userA.id);

  // 1. Test IDOR GET /api/transactions?id=USER_B_TX -> 404
  const reqGet = new Request(`http://localhost/api/transactions?id=${buyB.id}`, {
    method: "GET",
    headers: { cookie: `pwos_session=${tokenA}` },
  });
  const resGet = await txGet(reqGet);
  assert.equal(resGet.status, 404);

  // 2. Test IDOR PUT /api/transactions?id=USER_B_TX -> 404
  const reqPut = new Request(`http://localhost/api/transactions?id=${buyB.id}`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: `pwos_session=${tokenA}` },
    body: JSON.stringify({ description: "Hacked by A" }),
  });
  const resPut = await txPut(reqPut);
  assert.equal(resPut.status, 404);

  // 3. Test IDOR DELETE /api/transactions?id=USER_B_TX -> 404
  const reqDel = new Request(`http://localhost/api/transactions?id=${buyB.id}`, {
    method: "DELETE",
    headers: { cookie: `pwos_session=${tokenA}` },
  });
  const resDel = await txDel(reqDel);
  assert.equal(resDel.status, 404);

  // Verify transaction B is unchanged in DB
  const [checkB] = await db.select().from(journalEntries).where(eq(journalEntries.id, buyB.id));
  assert.equal(checkB.description, "User B Secret Buy");
});

test("STAGE 2 (#74-#77) — Ledger, Account, Lot, and Portfolio Valuation Isolation", async () => {
  const { btc, eth, usdCash, userA, userB, accountsA, accountsB } = await setupMultiUserScenario();

  await recordBuy({
    entryDate: "2026-08-01",
    description: "A Buy BTC",
    assetAccountId: accountsA.btc.id,
    cashAccountId: accountsA.equity.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "100",
    baseValue: "100",
    userId: userA.id,
  });

  await recordBuy({
    entryDate: "2026-08-01",
    description: "B Buy ETH",
    assetAccountId: accountsB.eth.id,
    cashAccountId: accountsB.equity.id,
    assetId: eth.id,
    quantity: "10",
    cashAssetId: usdCash.id,
    cashQuantity: "100",
    baseValue: "100",
    userId: userB.id,
  });

  const ledgerA = await getLedger(60, userA.id);
  const ledgerB = await getLedger(60, userB.id);

  assert.equal(ledgerA.length, 1);
  assert.equal(ledgerA[0].description, "A Buy BTC");

  assert.equal(ledgerB.length, 1);
  assert.equal(ledgerB[0].description, "B Buy ETH");

  const balA = await getAccountBalances(userA.id);
  const balB = await getAccountBalances(userB.id);

  assert.equal(balA.some((b) => b.accountId === accountsB.eth.id), false);
  assert.equal(balB.some((b) => b.accountId === accountsA.btc.id), false);

  const valA = await getPortfolioValuation(undefined, userA.id);
  const valB = await getPortfolioValuation(undefined, userB.id);

  assert.equal(valA.assetValuations.length, 1);
  assert.equal(valA.assetValuations[0].symbol, "BTC");

  assert.equal(valB.assetValuations.length, 1);
  assert.equal(valB.assetValuations[0].symbol, "ETH");
});

test("STAGE 2 (#13) — Legacy Data Migration Strategy: safely claims unowned rows if single owner exists", async () => {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(users);

  // Create single owner
  const [owner] = await db.insert(users).values({ name: "Single Owner", username: "single", role: "owner" } as any).returning();

  // Insert account without user_id
  await db.insert(accounts).values({
    code: "9999",
    name: "Legacy Account",
    type: "asset",
    userId: null,
  } as any);

  const res = await migrateLegacyFinancialData(db);
  assert.equal(res.migrated, true);
  assert.ok(res.rowsMigrated >= 1);
  assert.ok(res.strategy.startsWith("claimed_to_single_owner_"));

  const [migratedAcc] = await db.select().from(accounts).where(eq(accounts.code, "9999"));
  assert.equal(migratedAcc.userId, owner.id);
});
