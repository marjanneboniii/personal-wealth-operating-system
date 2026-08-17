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
  institutions,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  users,
  wallets,
} from "../src/db/schema";
import { registerMoneyAccount } from "../src/features/accounts/service";
import { getAccountBalances, getLedger } from "../src/features/ledger/queries";
import { D } from "../src/domain/decimal";

async function setupFreshDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(institutions);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);
}

type Fixture = {
  userA: { id: string };
  userB: { id: string };
  usdCash: { id: string };
  irt: { id: string };
  usdt: { id: string };
  btc: { id: string };
};

async function setupFixture(): Promise<Fixture> {
  await setupFreshDb();

  const [usd] = await db
    .insert(currencies)
    .values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [irt] = await db
    .insert(currencies)
    .values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any)
    .returning();

  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "Cash", sortOrder: 1 } as any)
    .returning();
  const [stableClass] = await db
    .insert(assetClasses)
    .values({ code: "stable", name: "Stablecoin", sortOrder: 2 } as any)
    .returning();
  const [cryptoClass] = await db
    .insert(assetClasses)
    .values({ code: "crypto", name: "Crypto", sortOrder: 3 } as any)
    .returning();

  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id, decimals: 2 } as any)
    .returning();
  const [irtAsset] = await db
    .insert(assets)
    .values({ symbol: "IRT", name: "Toman", classId: cashClass.id, currencyId: irt.id, decimals: 0 } as any)
    .returning();
  const [usdt] = await db
    .insert(assets)
    .values({ symbol: "USDT", name: "Tether", classId: stableClass.id, currencyId: usd.id, decimals: 6 } as any)
    .returning();
  const [btc] = await db
    .insert(assets)
    .values({ symbol: "BTC", name: "Bitcoin", classId: cryptoClass.id, currencyId: usd.id, decimals: 8 } as any)
    .returning();

  await db.insert(prices).values([
    { assetId: usdCash.id, asOf: "2026-01-01", priceBase: "1", source: "manual" },
    { assetId: irtAsset.id, asOf: "2026-01-01", priceBase: "0.00001", source: "manual" },
    { assetId: usdt.id, asOf: "2026-01-01", priceBase: "1", source: "manual" },
    { assetId: btc.id, asOf: "2026-01-01", priceBase: "95000", source: "manual" },
  ]);

  const [userA] = await db.insert(users).values({ name: "User A", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "User B", role: "owner" } as any).returning();

  // Opening-equity account (3010) per tenant, as the setup wizard would create.
  await db.insert(accounts).values([
    { code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: usdCash.id, userId: userA.id } as any,
    { code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: usdCash.id, userId: userB.id } as any,
  ]);

  return {
    userA: { id: userA.id },
    userB: { id: userB.id },
    usdCash: { id: usdCash.id },
    irt: { id: irtAsset.id },
    usdt: { id: usdt.id },
    btc: { id: btc.id },
  };
}

test("Money account: bank account with opening balance is registered, balanced and visible", async () => {
  const fx = await setupFixture();

  const result = await registerMoneyAccount({
    name: "بانک ملت — حساب جاری",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "50000000", // 50M toman
    userId: fx.userA.id,
  });

  assert.equal(result.ok, true);
  assert.ok(result.accountId);
  assert.ok(result.entryId);

  // base value = 50,000,000 toman * 0.00001 USD/toman = 500 USD
  assert.equal(D(result.baseValue!).toString(), "500");

  // Ledger control sum must remain zero (double-entry invariant).
  const sumRes = await db.execute(sql`select coalesce(sum(base_value), 0)::text as s from postings`);
  assert.equal(D((sumRes.rows[0] as any).s).isZero(), true);

  // The account shows up with the correct balance, and is linked to its wallet.
  const balances = await getAccountBalances(fx.userA.id);
  const acc = balances.find((b) => b.accountId === result.accountId);
  assert.ok(acc);
  assert.equal(acc.type, "asset");
  assert.equal(acc.walletName, "بانک ملت — حساب جاری");
  assert.equal(D(acc.baseValue).toString(), "500");
  assert.equal(D(acc.quantity).toString(), "50000000");
});

test("Money account: crypto wallet opens a FIFO lot", async () => {
  const fx = await setupFixture();

  const result = await registerMoneyAccount({
    name: "کیف سرد بیت‌کوین",
    kind: "cold",
    assetId: fx.btc.id,
    openingQty: "0.35",
    userId: fx.userA.id,
  });

  assert.equal(result.ok, true);
  // base value = 0.35 * 95000 = 33250
  assert.equal(D(result.baseValue!).toString(), "33250");

  const openLots = await db
    .select({ qtyOpened: lots.qtyOpened, unitCostBase: lots.unitCostBase })
    .from(lots)
    .where(eq(lots.accountId, result.accountId!));
  assert.equal(openLots.length, 1);
  assert.equal(D(openLots[0].qtyOpened).toString(), "0.35");
  assert.equal(D(openLots[0].unitCostBase).toString(), "95000");
});

test("Money account: cash/stable assets do NOT open a FIFO lot", async () => {
  const fx = await setupFixture();

  const result = await registerMoneyAccount({
    name: "تتر نوبیتکس",
    kind: "exchange",
    assetId: fx.usdt.id,
    openingQty: "8000",
    userId: fx.userA.id,
  });

  assert.equal(result.ok, true);
  const openLots = await db
    .select({ id: lots.id })
    .from(lots)
    .where(eq(lots.accountId, result.accountId!));
  assert.equal(openLots.length, 0);
});

test("Money account: multi-user isolation — User B cannot see User A's account or ledger", async () => {
  const fx = await setupFixture();

  await registerMoneyAccount({
    name: "حساب محرمانه A",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "1000000",
    userId: fx.userA.id,
  });

  const balancesB = await getAccountBalances(fx.userB.id);
  assert.equal(balancesB.some((b) => b.name === "حساب محرمانه A"), false);

  const ledgerB = await getLedger(50, fx.userB.id);
  assert.equal(ledgerB.some((l) => l.description.includes("حساب محرمانه A")), false);

  const balancesA = await getAccountBalances(fx.userA.id);
  assert.equal(balancesA.some((b) => b.name === "حساب محرمانه A"), true);
});

test("Money account: bank name is NOT stored in the shared institutions table", async () => {
  const fx = await setupFixture();

  await registerMoneyAccount({
    name: "بانک خصوصی من",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "1000000",
    userId: fx.userA.id,
  });

  const instRows = await db.select().from(institutions);
  assert.equal(instRows.length, 0);

  // The name lives only in the user-scoped wallet + account rows.
  const walletRows = await db.select().from(wallets).where(eq(wallets.name, "بانک خصوصی من"));
  assert.equal(walletRows.length, 1);
  assert.equal(walletRows[0].userId, fx.userA.id);
});

test("Money account: per-user account code uniqueness", async () => {
  const fx = await setupFixture();

  const a1 = await registerMoneyAccount({
    name: "حساب A1",
    kind: "bank",
    assetId: fx.irt.id,
    userId: fx.userA.id,
  });
  const a2 = await registerMoneyAccount({
    name: "حساب A2",
    kind: "cash",
    assetId: fx.irt.id,
    userId: fx.userA.id,
  });
  const b1 = await registerMoneyAccount({
    name: "حساب B1",
    kind: "bank",
    assetId: fx.irt.id,
    userId: fx.userB.id,
  });

  // Same user → distinct codes.
  assert.notEqual(a1.accountCode, a2.accountCode);
  // Different users may share a code (uniqueness is per (userId, code)).
  assert.equal(a1.accountCode, b1.accountCode);
});

test("Money account: multiple wallets, even with the same label, stay independent", async () => {
  const fx = await setupFixture();

  const first = await registerMoneyAccount({
    name: "حساب پس‌انداز",
    kind: "bank",
    assetId: fx.irt.id,
    openingQty: "1000000",
    userId: fx.userA.id,
  });
  const second = await registerMoneyAccount({
    name: "حساب پس‌انداز",
    kind: "fund",
    assetId: fx.irt.id,
    openingQty: "2000000",
    userId: fx.userA.id,
  });

  assert.notEqual(first.walletId, second.walletId);
  assert.notEqual(first.accountId, second.accountId);
  assert.notEqual(first.accountCode, second.accountCode);

  const balances = await getAccountBalances(fx.userA.id);
  assert.equal(balances.filter((b) => b.name === "حساب پس‌انداز").length, 2);
  const total = balances
    .filter((b) => b.name === "حساب پس‌انداز")
    .reduce((sum, row) => sum.add(row.quantity), D("0"));
  assert.equal(total.toString(), "3000000");
});

test("Money account: zero-balance account is created without an opening entry", async () => {
  const fx = await setupFixture();

  const result = await registerMoneyAccount({
    name: "صندوق خالی",
    kind: "cash",
    assetId: fx.irt.id,
    userId: fx.userA.id,
  });

  assert.equal(result.ok, true);
  assert.equal(result.entryId, undefined);
  const balances = await getAccountBalances(fx.userA.id);
  const acc = balances.find((b) => b.accountId === result.accountId);
  assert.ok(acc);
  assert.equal(D(acc.quantity).isZero(), true);
});

test("Money account: missing opening-equity metadata is provisioned without bypassing the ledger", async () => {
  await setupFreshDb();

  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: "cash", name: "Cash", sortOrder: 1 } as any)
    .returning();
  const [irtAsset] = await db
    .insert(assets)
    .values({ symbol: "IRT", name: "Toman", classId: cashClass.id, decimals: 0 } as any)
    .returning();
  await db.insert(prices).values([{ assetId: irtAsset.id, asOf: "2026-01-01", priceBase: "0.00001", source: "manual" }]);
  const [userA] = await db.insert(users).values({ name: "User A", role: "owner" } as any).returning();

  const result = await registerMoneyAccount({
    name: "بانک بدون راه‌اندازی قبلی",
    kind: "bank",
    assetId: irtAsset.id,
    openingQty: "1000",
    userId: userA.id,
  });
  assert.equal(result.ok, true);

  const equity = await db
    .select()
    .from(accounts)
    .where(eq(accounts.userId, userA.id));
  assert.equal(equity.some((a) => a.code === "3010" && a.type === "equity"), true);

  const entryRows = await db.select().from(journalEntries);
  assert.equal(entryRows.length, 1, "opening balance still uses exactly one journal entry");
  const sumRes = await db.execute(sql`select coalesce(sum(base_value), 0)::text as s from postings`);
  assert.equal(D((sumRes.rows[0] as any).s).isZero(), true, "double-entry control sum remains zero");
});
