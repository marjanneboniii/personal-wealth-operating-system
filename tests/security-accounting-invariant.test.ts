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
} from "../src/db/schema";
import { eq } from "drizzle-orm";
import { recordBuy, recordSell } from "../src/features/ledger/service";
import { getRealizedPnl } from "../src/features/ledger/queries";
import { updateUserFxRate } from "../src/features/fx/userRate";

async function setupAccountingScenario() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);

  // Setup basic currencies and asset classes
  const [usd] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  await db.insert(currencies).values({ code: "IRT", name: "Iranian Toman", symbol: "T", decimals: 0, isFiat: true } as any);

  const [cryptoClass] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto", valuationMethod: "fifo" } as any).returning();
  const [cashClass] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", valuationMethod: "fifo" } as any).returning();

  const [eth] = await db.insert(assets).values({ symbol: "ETH", name: "Ethereum", classId: cryptoClass.id, currencyId: usd.id } as any).returning();
  const [usdCash] = await db.insert(assets).values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any).returning();

  // Create accounts
  const [assetAcc] = await db.insert(accounts).values({ code: "1100", name: "Crypto Asset", type: "asset", assetId: eth.id } as any).returning();
  const [cashAcc] = await db.insert(accounts).values({ code: "1010", name: "Cash USD", type: "asset", assetId: usdCash.id } as any).returning();
  const [pnlAcc] = await db.insert(accounts).values({ code: "4100", name: "Realized P&L", type: "income", assetId: usdCash.id } as any).returning();

  const [u] = await db.insert(users).values({ name: "Tester", username: "tester", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "190000" } as any);

  return { eth, usdCash, assetAcc, cashAcc, pnlAcc, user: u };
}

test("Section 24 — Regression Scenario 1: Buy -> FIFO Lot -> Ledger", async () => {
  const { eth, usdCash, assetAcc, cashAcc } = await setupAccountingScenario();

  const buyEntry = await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 2 ETH @ $3000",
    assetAccountId: assetAcc.id,
    cashAccountId: cashAcc.id,
    assetId: eth.id,
    quantity: "2",
    cashAssetId: usdCash.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });

  // Assert Journal Entry created
  assert.ok(buyEntry.id);
  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.id, buyEntry.id));
  assert.equal(je.description, "Buy 2 ETH @ $3000");

  // Assert 2 Postings created (Debit Asset, Credit Cash)
  const posts = await db.select().from(postings).where(eq(postings.entryId, buyEntry.id));
  assert.equal(posts.length, 2);

  // Assert FIFO lot created
  const createdLots = await db.select().from(lots).where(eq(lots.openEntryId, buyEntry.id));
  assert.equal(createdLots.length, 1);
  assert.equal(createdLots[0].qtyRemaining, "2.000000000000000000");
  assert.equal(createdLots[0].unitCostBase, "3000.000000000000000000");
});

test("Section 24 — Regression Scenario 2: Sell -> FIFO consumption -> Realized P&L -> Ledger", async () => {
  const { eth, usdCash, assetAcc, cashAcc, pnlAcc } = await setupAccountingScenario();

  // Buy 2 ETH @ 3000 ($6,000)
  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 2 ETH @ $3000",
    assetAccountId: assetAcc.id,
    cashAccountId: cashAcc.id,
    assetId: eth.id,
    quantity: "2",
    cashAssetId: usdCash.id,
    cashQuantity: "6000",
    baseValue: "6000",
  });

  // Sell 1 ETH @ 4000 ($4,000) -> Cost basis = 3000 -> Realized P&L = +$1,000
  const sellEntry = await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 1 ETH @ $4000",
    assetAccountId: assetAcc.id,
    cashAccountId: cashAcc.id,
    pnlAccountId: pnlAcc.id,
    assetId: eth.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "4000",
    baseValue: "4000",
  });

  assert.ok(sellEntry.id);

  // Assert FIFO consumption created
  const consumptions = await db.select().from(lotConsumptions).where(eq(lotConsumptions.entryId, sellEntry.id));
  assert.equal(consumptions.length, 1);
  assert.equal(consumptions[0].quantity, "1.000000000000000000");

  // Assert remaining lot quantity reduced to 1
  const allLots = await db.select().from(lots);
  assert.equal(allLots[0].qtyRemaining, "1.000000000000000000");

  // Assert Realized P&L recorded correctly (+1000)
  const pnl = await getRealizedPnl();
  assert.equal(pnl.total, "1000");
});

test("Section 24 — Regression Scenario 3: Historical FX snapshot immutability (19,000,000 IRT / 190,000 = 100 USD)", async () => {
  const { eth, usdCash, assetAcc, cashAcc, user } = await setupAccountingScenario();

  const buyEntry = await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy asset with 19,000,000 IRT",
    assetAccountId: assetAcc.id,
    cashAccountId: cashAcc.id,
    assetId: eth.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "100",
    baseValue: "100",
  });

  // Create historical FX snapshot: 19,000,000 IRT @ 190,000 = 100 USD
  await db.insert(entryFxSnapshots).values({
    entryId: buyEntry.id,
    irtAmount: "19000000",
    usdAmount: "100",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  // Verify historical snapshot USD amount
  const [beforeSnap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buyEntry.id));
  assert.equal(parseFloat(beforeSnap.usdAmount), 100);
  assert.equal(beforeSnap.fxRate, "190000.000000000000000000");

  // Now change current FX rate to 200,000
  await updateUserFxRate(user.id, "200000");

  // Expect: Historical USD = 100 remains unchanged
  const [afterSnap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, buyEntry.id));
  assert.equal(parseFloat(afterSnap.usdAmount), 100);
  assert.equal(afterSnap.fxRate, "190000.000000000000000000");
});

test("Section 24 — Regression Scenario 4: Realized P&L unchanged after FX rate change", async () => {
  const { eth, usdCash, assetAcc, cashAcc, pnlAcc, user } = await setupAccountingScenario();

  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 1 ETH @ $3000",
    assetAccountId: assetAcc.id,
    cashAccountId: cashAcc.id,
    assetId: eth.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "3000",
    baseValue: "3000",
  });

  await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 1 ETH @ $4500",
    assetAccountId: assetAcc.id,
    cashAccountId: cashAcc.id,
    pnlAccountId: pnlAcc.id,
    assetId: eth.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "4500",
    baseValue: "4500",
  });

  const pnlBefore = await getRealizedPnl();
  assert.equal(pnlBefore.total, "1500");

  // Change FX rate from 190,000 to 250,000
  await updateUserFxRate(user.id, "250000");

  // Verify Realized P&L is completely unchanged
  const pnlAfter = await getRealizedPnl();
  assert.equal(pnlAfter.total, pnlBefore.total);
  assert.equal(pnlAfter.total, "1500");
});
