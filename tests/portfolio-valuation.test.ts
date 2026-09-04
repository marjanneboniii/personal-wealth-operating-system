import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { eq, sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  entryFxSnapshots,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  userFxSettings,
  users,
} from "../src/db/schema";
import { postEntry, recordBuy, recordSell } from "../src/features/ledger/service";
import { getAccountBalances, getRealizedPnl } from "../src/features/ledger/queries";
import { getPortfolioValuation } from "../src/features/portfolio/service";
import { D } from "../src/domain/decimal";
import { clearCoinGeckoPriceCache } from "../src/features/pricing/service";
import { calculateMarketValuation } from "../src/features/valuation/service";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCoinGeckoPriceCache();
});

function mockCoinGeckoPrice(price: () => number) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ bitcoin: { usd: price(), last_updated_at: 1_786_406_400 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

async function resetDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(userFxSettings);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);
}

async function setupBtcHolding() {
  await resetDb();
  const [user] = await db.insert(users).values({ name: "Valuation User", username: "valuation-user" }).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" });
  const [usd] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$" }).returning();
  const [cashClass] = await db.insert(assetClasses).values({ code: "cash", name: "Cash" }).returning();
  const [cryptoClass] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto" }).returning();
  const [usdAsset] = await db.insert(assets).values({
    symbol: "USD",
    name: "US Dollar",
    classId: cashClass.id,
    currencyId: usd.id,
    decimals: 2,
    pricingMethod: "face_value",
  }).returning();
  const [btc] = await db.insert(assets).values({
    symbol: "BTC",
    name: "Bitcoin",
    classId: cryptoClass.id,
    decimals: 8,
    pricingMethod: "coingecko",
    priceSource: "coingecko",
    coingeckoId: "bitcoin",
    logoUrl: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  }).returning();

  const [cash] = await db.insert(accounts).values({ userId: user.id, code: "1010", name: "Cash", type: "asset", assetId: usdAsset.id }).returning();
  const [btcAccount] = await db.insert(accounts).values({ userId: user.id, code: "1200", name: "BTC", type: "asset", assetId: btc.id }).returning();
  const [equity] = await db.insert(accounts).values({ userId: user.id, code: "3010", name: "Equity", type: "equity", assetId: usdAsset.id }).returning();
  const [pnl] = await db.insert(accounts).values({ userId: user.id, code: "4100", name: "Realized P&L", type: "income", assetId: usdAsset.id }).returning();

  await postEntry({
    userId: user.id,
    entryDate: "2026-08-01",
    type: "opening",
    description: "Opening cash",
    postings: [
      { accountId: cash.id, assetId: usdAsset.id, quantity: "100000", baseValue: "100000" },
      { accountId: equity.id, assetId: usdAsset.id, quantity: "-100000", baseValue: "-100000" },
    ],
  });

  const buy = await recordBuy({
    userId: user.id,
    entryDate: "2026-08-02",
    description: "Buy 1 BTC",
    assetAccountId: btcAccount.id,
    cashAccountId: cash.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdAsset.id,
    cashQuantity: "50000",
    baseValue: "50000",
  });
  await db.insert(entryFxSnapshots).values({
    entryId: buy.id,
    irtAmount: "5000000000",
    usdAmount: "50000",
    fxRate: "100000",
    rateSource: "test",
    rateDate: "2026-08-02",
  });

  return { user, btc, btcAccount, cash, usdAsset, pnl };
}

async function accountingState(userId: string) {
  const [entryCount, postingCount, lotCount, consumptionCount, balances, realized, openLots] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(journalEntries),
    db.select({ count: sql<number>`count(*)::int` }).from(postings),
    db.select({ count: sql<number>`count(*)::int` }).from(lots),
    db.select({ count: sql<number>`count(*)::int` }).from(lotConsumptions),
    getAccountBalances(userId),
    getRealizedPnl(userId),
    db.select().from(lots).where(eq(lots.userId, userId)),
  ]);
  return { entryCount, postingCount, lotCount, consumptionCount, balances, realized, openLots };
}

test("FX-A / FX-B — current Toman value and NAV move; historical accounting is unchanged", async () => {
  const { user, btc } = await setupBtcHolding();
  let currentPrice = 100000;
  mockCoinGeckoPrice(() => currentPrice);

  const beforeAccounting = await accountingState(user.id);
  const fxA = await getPortfolioValuation("2026-08-11", user.id);
  const btcA = fxA.assetValuations.find((row) => row.assetId === btc.id)!;
  assert.equal(btcA.currentValue, "100000");
  assert.equal(btcA.currentValueToman, "10000000000");
  assert.equal(btcA.costBasis, "50000");
  assert.equal(btcA.historicalCostToman, "5000000000");
  assert.equal(btcA.unrealizedPnlToman, "5000000000");
  assert.equal(fxA.totalNetWorthToman, "15000000000"); // 50k cash + 100k BTC

  await db.update(userFxSettings).set({ currentRate: "150000", updatedAt: new Date() }).where(eq(userFxSettings.userId, user.id));
  clearCoinGeckoPriceCache();
  const fxB = await getPortfolioValuation("2026-08-11", user.id);
  const btcB = fxB.assetValuations.find((row) => row.assetId === btc.id)!;
  assert.equal(btcB.currentValue, "100000");
  assert.equal(btcB.currentValueToman, "15000000000");
  assert.equal(btcB.costBasis, "50000");
  assert.equal(btcB.historicalCostToman, "5000000000");
  assert.equal(btcB.unrealizedPnlToman, "10000000000");
  assert.equal(fxB.totalNetWorthToman, "22500000000");

  assert.deepEqual(await accountingState(user.id), beforeAccounting);
});

test("CoinGecko price change updates current/unrealized value only", async () => {
  const { user, btc } = await setupBtcHolding();
  let currentPrice = 100000;
  mockCoinGeckoPrice(() => currentPrice);
  const accountingBefore = await accountingState(user.id);

  const first = await getPortfolioValuation("2026-08-11", user.id);
  currentPrice = 110000;
  clearCoinGeckoPriceCache();
  const second = await getPortfolioValuation("2026-08-11", user.id);
  const btcFirst = first.assetValuations.find((row) => row.assetId === btc.id)!;
  const btcSecond = second.assetValuations.find((row) => row.assetId === btc.id)!;

  assert.equal(btcFirst.currentValue, "100000");
  assert.equal(btcSecond.currentValue, "110000");
  assert.equal(btcFirst.unrealizedPnl, "50000");
  assert.equal(btcSecond.unrealizedPnl, "60000");
  assert.equal(btcSecond.costBasis, "50000");
  assert.deepEqual(await accountingState(user.id), accountingBefore);
});

test("sale realization remains FIFO/accounting-derived, never CoinGecko-derived", async () => {
  const { user, btc, btcAccount, cash, usdAsset, pnl } = await setupBtcHolding();
  await recordSell({
    userId: user.id,
    entryDate: "2026-08-10",
    description: "Sell half BTC",
    assetAccountId: btcAccount.id,
    cashAccountId: cash.id,
    pnlAccountId: pnl.id,
    assetId: btc.id,
    quantity: "0.5",
    cashAssetId: usdAsset.id,
    cashQuantity: "55000",
    baseValue: "55000",
  });
  const realizedBefore = await getRealizedPnl(user.id);
  assert.equal(realizedBefore.total, "30000"); // 55k proceeds - 25k FIFO cost

  let currentPrice = 110000;
  mockCoinGeckoPrice(() => currentPrice);
  await getPortfolioValuation("2026-08-11", user.id);
  currentPrice = 250000;
  clearCoinGeckoPriceCache();
  await getPortfolioValuation("2026-08-11", user.id);

  assert.deepEqual(await getRealizedPnl(user.id), realizedBefore);
});

test("read-model Toman totals are internally consistent (value = cost + unrealized P&L)", async () => {
  const { user } = await setupBtcHolding();
  mockCoinGeckoPrice(() => 100000);
  const s = await getPortfolioValuation("2026-08-11", user.id);

  // Headline identity that the «سبد دارایی» metrics rely on — no value/cost/
  // unrealized combination may ever contradict one another.
  const net = D(s.totalNetWorthToman);
  const cost = D(s.totalCostBasisToman);
  const pnl = D(s.totalUnrealizedPnlToman);
  const residual = net.sub(cost).sub(pnl).abs().toNumber();
  assert.ok(residual <= 1, `value ≠ cost + P&L in Toman (residual ${residual})`);

  // Per-row canonical Toman cost basis must equal current − unrealized P&L.
  for (const a of s.assetValuations) {
    const expected = D(a.currentValueToman).sub(a.unrealizedPnlToman).toFixed(0);
    assert.equal(D(a.costBasisToman).toFixed(0), expected, `row cost basis mismatch: ${a.symbol}`);
  }
});

test("pure FX calculation never rewrites USD cost basis", () => {
  const a = calculateMarketValuation({
    quantity: "1",
    currentPriceUsd: "100000",
    costBasisUsd: "50000",
    currentTomanPerUsd: "100000",
    historicalCostToman: "5000000000",
  });
  const b = calculateMarketValuation({
    quantity: "1",
    currentPriceUsd: "100000",
    costBasisUsd: "50000",
    currentTomanPerUsd: "150000",
    historicalCostToman: "5000000000",
  });
  assert.equal(a.currentValueUsd, b.currentValueUsd);
  assert.equal(a.costBasisUsd, b.costBasisUsd);
  assert.equal(a.currentValueToman, "10000000000");
  assert.equal(b.currentValueToman, "15000000000");
  assert.equal(a.unrealizedPnlToman, "5000000000");
  assert.equal(b.unrealizedPnlToman, "10000000000");
});
