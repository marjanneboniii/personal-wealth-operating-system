/**
 * Phase 2 — FX Architecture tests.
 *
 * Pins the single-authoritative-FX rule:
 *   - user_fx_settings.currentRate is the per-user FX source of truth.
 *   - prices.IRT is NEVER used to convert Toman ↔ USD book value.
 *   - 1 native IRT unit = 1 Toman (quantity = amount × user rate).
 *   - per-user isolation (User A 190k vs User B 200k).
 *   - historical transactions / realized P&L remain immutable on FX change.
 *   - unrealized valuation remains dynamic.
 *   - ledger stays balanced.
 *   - portfolio valuation fails closed (no global read without identity).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { eq, sql } from "drizzle-orm";
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
  postings,
  prices,
  userFxSettings,
  users,
} from "../src/db/schema";
import { nativeUnitPriceUsd } from "../src/features/fx/unitPrice";
import { recordBuy, recordSell, unitsFor } from "../src/features/ledger/service";
import { getRealizedPnl } from "../src/features/ledger/queries";
import { getPortfolioValuation } from "../src/features/portfolio/service";
import { D } from "../src/domain/decimal";

async function setup() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(userFxSettings);
  await db.delete(users);
  await db.delete(currencies);

  const [usdCur] = await db.insert(currencies).values({ code: "USD", name: "USD", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irtCur] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any).returning();
  const [cashCls] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", sortOrder: 1 } as any).returning();
  const [cryptoCls] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto", sortOrder: 3 } as any).returning();
  const [usdAsset] = await db.insert(assets).values({ symbol: "USD", name: "USD", classId: cashCls.id, currencyId: usdCur.id, decimals: 2, pricingMethod: "face_value" } as any).returning();
  const [irtAsset] = await db.insert(assets).values({ symbol: "IRT", name: "Toman", classId: cashCls.id, currencyId: irtCur.id, decimals: 0, pricingMethod: "manual" } as any).returning();
  const [btcAsset] = await db.insert(assets).values({ symbol: "BTC", name: "Bitcoin", classId: cryptoCls.id, currencyId: usdCur.id, decimals: 8, pricingMethod: "manual" } as any).returning();

  // NOTE: prices.IRT is deliberately a WRONG FX-style value (0.00005 → rate 20,000)
  // to prove it is NOT consulted for FX conversion anymore. Market prices for
  // USD and BTC are legitimate global market data.
  await db.insert(prices).values([
    { assetId: usdAsset.id, asOf: "2026-01-01", priceBase: "1", source: "manual" },
    { assetId: irtAsset.id, asOf: "2026-01-01", priceBase: "0.00005", source: "manual" },
    { assetId: btcAsset.id, asOf: "2026-01-01", priceBase: "50000", source: "manual" },
  ]);

  const [userA] = await db.insert(users).values({ name: "FX A", username: "fx-a", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "FX B", username: "fx-b", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "190000" },
    { userId: userB.id, currentRate: "200000" },
  ] as any);

  const [bankA] = await db.insert(accounts).values({ code: "1010", name: "Bank IRT A", type: "asset", assetId: irtAsset.id, userId: userA.id } as any).returning();
  const [bankB] = await db.insert(accounts).values({ code: "1010", name: "Bank IRT B", type: "asset", assetId: irtAsset.id, userId: userB.id } as any).returning();
  const [usdCashA] = await db.insert(accounts).values({ code: "1020", name: "Cash USD A", type: "asset", assetId: usdAsset.id, userId: userA.id } as any).returning();
  const [btcAccA] = await db.insert(accounts).values({ code: "1200", name: "BTC A", type: "asset", assetId: btcAsset.id, userId: userA.id } as any).returning();
  const [pnlA] = await db.insert(accounts).values({ code: "4100", name: "P&L A", type: "income", assetId: usdAsset.id, userId: userA.id } as any).returning();
  const [equityA] = await db.insert(accounts).values({ code: "3010", name: "Equity A", type: "equity", assetId: usdAsset.id, userId: userA.id } as any).returning();

  return { userA, userB, usdAsset, irtAsset, btcAsset, bankA, bankB, usdCashA, btcAccA, pnlA, equityA };
}

test("FX-A: per-user FX is isolated (190k vs 200k)", async () => {
  const fx = await setup();
  const unitA = await nativeUnitPriceUsd(fx.irtAsset.id, fx.userA.id);
  const unitB = await nativeUnitPriceUsd(fx.irtAsset.id, fx.userB.id);
  assert.ok(D(unitA).sub(D("1").div("190000")).isZero(), `unitA=${unitA}`);
  assert.ok(D(unitB).sub(D("1").div("200000")).isZero(), `unitB=${unitB}`);
  assert.ok(D(unitA).gt(unitB), "A's rate is lower so A's unit USD is higher");
});

test("FX-B: 1 native IRT unit = 1 Toman; quantity = amount × user rate", async () => {
  const fx = await setup();
  // 190 USD at 190,000 → 36,100,000 Toman (NOT 190 / prices.IRT(0.00005) = 3,800,000).
  const { quantity } = await unitsFor(fx.bankA.id, "190", undefined, fx.userA.id);
  assert.ok(
    D(quantity).sub("36100000").abs().lt("0.001"),
    `quantity=${quantity} must be ≈ 36,100,000 Toman`,
  );
  assert.ok(
    D(quantity).sub("3800000").abs().gt("1000000"),
    `quantity=${quantity} must NOT follow prices.IRT (3,800,000)`,
  );
});

test("FX-B2: same amount, different user → different Toman quantity", async () => {
  const fx = await setup();
  const qA = await unitsFor(fx.bankA.id, "100", undefined, fx.userA.id);
  const qB = await unitsFor(fx.bankB.id, "100", undefined, fx.userB.id);
  assert.ok(D(qA.quantity).sub("19000000").abs().lt("0.001"));
  assert.ok(D(qB.quantity).sub("20000000").abs().lt("0.001"));
  assert.ok(D(qA.quantity).lt(qB.quantity));
});

test("FX-C: market asset unit price still comes from `prices` (market data)", async () => {
  const fx = await setup();
  const btcUnit = await nativeUnitPriceUsd(fx.btcAsset.id, fx.userA.id);
  const usdUnit = await nativeUnitPriceUsd(fx.usdAsset.id, fx.userA.id);
  assert.ok(D(btcUnit).sub("50000").isZero(), `btcUnit=${btcUnit}`);
  assert.ok(D(usdUnit).sub("1").isZero(), `usdUnit=${usdUnit}`);
});

test("FX-D: realized P&L is immutable across FX updates", async () => {
  const fx = await setup();
  await recordBuy({
    entryDate: "2026-08-01",
    description: "buy btc",
    assetAccountId: fx.btcAccA.id,
    cashAccountId: fx.usdCashA.id,
    assetId: fx.btcAsset.id,
    quantity: "1",
    cashAssetId: fx.usdAsset.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: fx.userA.id,
  });
  await recordSell({
    entryDate: "2026-08-05",
    description: "sell btc",
    assetAccountId: fx.btcAccA.id,
    cashAccountId: fx.usdCashA.id,
    pnlAccountId: fx.pnlA.id,
    assetId: fx.btcAsset.id,
    quantity: "1",
    cashAssetId: fx.usdAsset.id,
    cashQuantity: "60000",
    baseValue: "60000",
    userId: fx.userA.id,
  });

  const before = await getRealizedPnl(fx.userA.id);
  assert.ok(D(before.total).sub("10000").isZero(), `realized=${before.total}`);

  await db.update(userFxSettings).set({ currentRate: "999999" }).where(eq(userFxSettings.userId, fx.userA.id));

  const after = await getRealizedPnl(fx.userA.id);
  assert.ok(D(after.total).sub("10000").isZero(), "realized P&L must not change with FX");
});

test("FX-E: unrealized USD valuation dynamic, Toman re-derived from user FX", async () => {
  const fx = await setup();
  const { postEntry } = await import("../src/features/ledger/service");
  await postEntry({
    entryDate: "2026-08-01",
    type: "opening",
    description: "usd opening",
    userId: fx.userA.id,
    postings: [
      { accountId: fx.usdCashA.id, assetId: fx.usdAsset.id, quantity: "1000", baseValue: "1000" },
      { accountId: fx.equityA.id, assetId: fx.usdAsset.id, quantity: "-1000", baseValue: "-1000" },
    ],
  });

  const v1 = await getPortfolioValuation(undefined, fx.userA.id);
  const usdHolding = v1.assetValuations.find((a) => a.symbol === "USD")!;
  assert.ok(D(usdHolding.currentValue).sub("1000").isZero());
  assert.ok(D(usdHolding.currentValueToman).sub(D("1000").mul("190000")).abs().lt("1"));

  await db.update(userFxSettings).set({ currentRate: "200000" }).where(eq(userFxSettings.userId, fx.userA.id));

  const v2 = await getPortfolioValuation(undefined, fx.userA.id);
  const usdHolding2 = v2.assetValuations.find((a) => a.symbol === "USD")!;
  assert.ok(D(usdHolding2.currentValue).sub("1000").isZero(), "USD market value unchanged");
  assert.ok(D(usdHolding2.currentValueToman).sub(D("1000").mul("200000")).abs().lt("1"), "Toman equivalent moved with FX");
});

test("FX-F: ledger stays balanced across FX flows", async () => {
  const fx = await setup();
  const { recordFx } = await import("../src/features/ledger/service");
  await recordFx({
    entryDate: "2026-02-01",
    description: "IRT→USD",
    fromAccountId: fx.bankA.id,
    toAccountId: fx.usdCashA.id,
    fromAssetId: fx.irtAsset.id,
    toAssetId: fx.usdAsset.id,
    fromQuantity: "19000000",
    toQuantity: "100",
    bookValue: "100",
    rateIrtPerUsd: "190000",
    userId: fx.userA.id,
  });
  const unbalanced = await db.execute(sql`
    select je.id from journal_entries je join postings p on p.entry_id = je.id
    group by je.id having abs(sum(p.base_value)) > 0.000000001
  `);
  assert.equal(unbalanced.rows.length, 0, "every entry must remain balanced");
});

test("FX-H/I: portfolio valuation fails closed without identity in a multi-tenant DB", async () => {
  await setup();
  // Two users exist, no explicit id and no session → empty, never global.
  const valuation = await getPortfolioValuation();
  assert.equal(valuation.assetValuations.length, 0);
  assert.equal(D(valuation.totalNetWorth).isZero(), true);
});
