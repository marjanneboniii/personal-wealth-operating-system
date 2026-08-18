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
import { recordFx, recordTransfer } from "../src/features/ledger/service";
import { getAccountBalances } from "../src/features/ledger/queries";
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

  const [usd] = await db.insert(currencies).values({ code: "USD", name: "USD", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irt] = await db.insert(currencies).values({ code: "IRT", name: "IRT", symbol: "T", decimals: 0, isFiat: true } as any).returning();
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", sortOrder: 1 } as any).returning();
  const [usdAsset] = await db.insert(assets).values({ symbol: "USD", name: "USD", classId: cash.id, currencyId: usd.id, decimals: 2 } as any).returning();
  const [irtAsset] = await db.insert(assets).values({ symbol: "IRT", name: "IRT", classId: cash.id, currencyId: irt.id, decimals: 0 } as any).returning();
  await db.insert(prices).values([
    { assetId: usdAsset.id, asOf: "2026-01-01", priceBase: "1", source: "manual" },
    { assetId: irtAsset.id, asOf: "2026-01-01", priceBase: "0.00005", source: "manual" },
  ]);
  const [user] = await db.insert(users).values({ name: "Owner", role: "owner" } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "20000" });
  const [bank] = await db.insert(accounts).values({ code: "1010", name: "Bank IRT", type: "asset", assetId: irtAsset.id, userId: user.id } as any).returning();
  const [cashUsd] = await db.insert(accounts).values({ code: "1020", name: "Cash USD", type: "asset", assetId: usdAsset.id, userId: user.id } as any).returning();
  const [bank2] = await db.insert(accounts).values({ code: "1030", name: "Bank IRT 2", type: "asset", assetId: irtAsset.id, userId: user.id } as any).returning();
  const [equity] = await db.insert(accounts).values({ code: "3010", name: "Equity", type: "equity", assetId: usdAsset.id, userId: user.id } as any).returning();

  const { postEntry } = await import("../src/features/ledger/service");
  await postEntry({
    entryDate: "2026-01-01",
    type: "opening",
    description: "open",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: irtAsset.id, quantity: "200000000", baseValue: "10000" },
      { accountId: cashUsd.id, assetId: usdAsset.id, quantity: "8000", baseValue: "8000" },
      { accountId: equity.id, assetId: usdAsset.id, quantity: "-18000", baseValue: "-18000" },
    ],
  });

  return { user, bank, cashUsd, bank2, irtAsset, usdAsset };
}

test("same-denomination IRT transfer still uses recordTransfer", async () => {
  const fx = await setup();
  await recordTransfer({
    entryDate: "2026-02-01",
    description: "IRT to IRT",
    fromAccountId: fx.bank.id,
    toAccountId: fx.bank2.id,
    assetId: fx.irtAsset.id,
    quantity: "10000000",
    unitPrice: "0.00005",
    userId: fx.user.id,
  });
  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.type, "transfer")).limit(1);
  assert.ok(je);
  const lotsAfter = await db.select().from(lots);
  assert.equal(lotsAfter.length, 0);
});

test("recordTransfer rejects Bank IRT → Cash USD", async () => {
  const fx = await setup();
  await assert.rejects(
    () =>
      recordTransfer({
        entryDate: "2026-02-01",
        description: "bad",
        fromAccountId: fx.bank.id,
        toAccountId: fx.cashUsd.id,
        assetId: fx.irtAsset.id,
        quantity: "100000000",
        unitPrice: "0.00005",
        userId: fx.user.id,
      }),
    /تبدیل ارز/,
  );
});

test("recordFx posts IRT→USD with USD book value and no FIFO lots", async () => {
  const fx = await setup();
  const lotsBefore = (await db.select().from(lots)).length;
  await recordFx({
    entryDate: "2026-02-01",
    description: "Bank IRT to Cash USD",
    fromAccountId: fx.bank.id,
    toAccountId: fx.cashUsd.id,
    fromAssetId: fx.irtAsset.id,
    toAssetId: fx.usdAsset.id,
    fromQuantity: "100000000",
    toQuantity: "5000",
    bookValue: "5000",
    rateIrtPerUsd: "20000",
    userId: fx.user.id,
  });

  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.type, "fx")).limit(1);
  assert.ok(je);
  const lines = await db.select().from(postings).where(eq(postings.entryId, je.id));
  assert.equal(lines.length, 2);
  const sum = lines.reduce((s, p) => s.add(p.baseValue), D("0"));
  assert.equal(sum.isZero(), true);

  const balances = await getAccountBalances(fx.user.id);
  const bank = balances.find((b) => b.accountId === fx.bank.id)!;
  const cash = balances.find((b) => b.accountId === fx.cashUsd.id)!;
  assert.equal(D(bank.quantity).toString(), "100000000");
  assert.equal(D(cash.quantity).toString(), "13000");
  assert.equal(D(bank.baseValue).toString(), "5000");
  assert.equal(D(cash.baseValue).toString(), "13000");

  assert.equal((await db.select().from(lots)).length, lotsBefore);
  assert.equal((await db.select().from(lotConsumptions)).length, 0);
});

test("recordFx rejects inconsistent rate vs amounts", async () => {
  const fx = await setup();
  await assert.rejects(
    () =>
      recordFx({
        entryDate: "2026-02-01",
        description: "bad rate",
        fromAccountId: fx.bank.id,
        toAccountId: fx.cashUsd.id,
        fromAssetId: fx.irtAsset.id,
        toAssetId: fx.usdAsset.id,
        fromQuantity: "100000000",
        toQuantity: "5000",
        bookValue: "5000",
        rateIrtPerUsd: "190000",
        userId: fx.user.id,
      }),
    /سازگار/,
  );
});

test("USD → USD transfer is unchanged recordTransfer", async () => {
  const fx = await setup();
  const [usd2] = await db
    .insert(accounts)
    .values({ code: "1021", name: "Cash USD 2", type: "asset", assetId: fx.usdAsset.id, userId: fx.user.id } as any)
    .returning();
  await recordTransfer({
    entryDate: "2026-02-01",
    description: "USD to USD",
    fromAccountId: fx.cashUsd.id,
    toAccountId: usd2.id,
    assetId: fx.usdAsset.id,
    quantity: "100",
    unitPrice: "1",
    userId: fx.user.id,
  });
  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.description, "USD to USD")).limit(1);
  assert.equal(je.type, "transfer");
});

test("recordFx posts USD → IRT without FIFO", async () => {
  const fx = await setup();
  await recordFx({
    entryDate: "2026-02-02",
    description: "Cash USD to Bank IRT",
    fromAccountId: fx.cashUsd.id,
    toAccountId: fx.bank.id,
    fromAssetId: fx.usdAsset.id,
    toAssetId: fx.irtAsset.id,
    fromQuantity: "100",
    toQuantity: "2000000",
    bookValue: "100",
    rateIrtPerUsd: "20000",
    userId: fx.user.id,
  });
  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.description, "Cash USD to Bank IRT")).limit(1);
  assert.equal(je.type, "fx");
  const sumRes = await db.execute(sql`select coalesce(sum(base_value), 0)::text as s from postings where entry_id = ${je.id}`);
  assert.equal(D((sumRes.rows[0] as any).s).isZero(), true);
  assert.equal((await db.select().from(lots)).length, 0);
});

test("recordFx supports IRT → USDT at 1:1 USD face", async () => {
  const fx = await setup();
  const [stable] = await db.select().from(assetClasses).limit(1);
  const [usdt] = await db
    .insert(assets)
    .values({ symbol: "USDT", name: "Tether", classId: stable.id, decimals: 6 } as any)
    .returning();
  const [usdtAcc] = await db
    .insert(accounts)
    .values({ code: "1100", name: "USDT wallet", type: "asset", assetId: usdt.id, userId: fx.user.id } as any)
    .returning();
  const { resolveFxBookLegs } = await import("../src/features/ledger/service");
  const legs = resolveFxBookLegs({
    fromSymbol: "IRT",
    toSymbol: "USDT",
    rateIrtPerUsd: "20000",
    fromQuantity: "100000000",
  });
  assert.equal(D(legs.toQuantity).toString(), "5000");
  assert.equal(D(legs.bookValue).toString(), "5000");
  await recordFx({
    entryDate: "2026-02-03",
    description: "IRT to USDT",
    fromAccountId: fx.bank.id,
    toAccountId: usdtAcc.id,
    fromAssetId: fx.irtAsset.id,
    toAssetId: usdt.id,
    ...legs,
    rateIrtPerUsd: "20000",
    userId: fx.user.id,
  });
  const [je] = await db.select().from(journalEntries).where(eq(journalEntries.description, "IRT to USDT")).limit(1);
  assert.equal(je.type, "fx");
});

test("recordFx rejects zero amounts", async () => {
  const fx = await setup();
  await assert.rejects(
    () =>
      recordFx({
        entryDate: "2026-02-01",
        description: "zero",
        fromAccountId: fx.bank.id,
        toAccountId: fx.cashUsd.id,
        fromAssetId: fx.irtAsset.id,
        toAssetId: fx.usdAsset.id,
        fromQuantity: "0",
        toQuantity: "0",
        bookValue: "0",
        userId: fx.user.id,
      }),
    /بزرگ‌تر از صفر/,
  );
});

test("resolveFxBookLegs rejects forged client bookValue", async () => {
  const { resolveFxBookLegs } = await import("../src/features/ledger/service");
  assert.throws(
    () =>
      resolveFxBookLegs({
        fromSymbol: "IRT",
        toSymbol: "USD",
        rateIrtPerUsd: "20000",
        fromQuantity: "100000000",
        claimedBookValue: "1",
      }),
    /bookValue/,
  );
});

test("changing user FX rate does not rewrite posted FX journal base_value", async () => {
  const fx = await setup();
  const posted = await recordFx({
    entryDate: "2026-02-01",
    description: "frozen",
    fromAccountId: fx.bank.id,
    toAccountId: fx.cashUsd.id,
    fromAssetId: fx.irtAsset.id,
    toAssetId: fx.usdAsset.id,
    fromQuantity: "100000000",
    toQuantity: "5000",
    bookValue: "5000",
    rateIrtPerUsd: "20000",
    userId: fx.user.id,
  });
  const before = await db.select().from(postings).where(eq(postings.entryId, posted.id));
  await db.update(userFxSettings).set({ currentRate: "999999" }).where(eq(userFxSettings.userId, fx.user.id));
  const after = await db.select().from(postings).where(eq(postings.entryId, posted.id));
  assert.equal(before[0].baseValue, after[0].baseValue);
  assert.equal(before[1].baseValue, after[1].baseValue);
  assert.equal(before[0].quantity, after[0].quantity);
});
