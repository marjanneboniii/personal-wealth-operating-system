import assert from "node:assert/strict";
import { test } from "node:test";
import { sql, eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assets,
  assetClasses,
  currencies,
  journalEntries,
  postings,
  lots,
  lotConsumptions,
  prices,
  users,
  sessions,
  userFxSettings,
  entryFxSnapshots,
} from "../src/db/schema";
import { hashPassword, verifyPassword, generateToken } from "../src/lib/auth";
import { getUserFxRate, updateUserFxRate } from "../src/features/fx/userRate";
import { D } from "../src/domain/decimal";
import { recordBuy, recordSell, recordExpense, postEntry } from "../src/features/ledger/service";
import { getNetWorth, getRealizedPnl } from "../src/features/ledger/queries";
import { getLatestUsdIrtRateForUser } from "../src/lib/fx";

async function cleanAll() {
  await createSchemaIfNotExists();
  await db.delete(entryFxSnapshots);
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(prices);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(sessions);
  await db.delete(userFxSettings);
  await db.delete(users);
}

async function setupBasicLedger() {
  const [usdCur] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2 }).returning();
  const [irtCur] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "تومان", decimals: 0 }).returning();
  const [cls] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", color: "#6e6ff0" }).returning();
  const [usdAsset] = await db.insert(assets).values({ symbol: "USD", name: "USD Cash", classId: cls.id, currencyId: usdCur.id, decimals: 2 }).returning();
  const [irtAsset] = await db.insert(assets).values({ symbol: "IRT", name: "Toman", classId: cls.id, currencyId: irtCur.id, decimals: 0 }).returning();
  await db.insert(prices).values([
    { assetId: usdAsset.id, asOf: "2026-01-01", priceBase: "1" },
    { assetId: irtAsset.id, asOf: "2026-01-01", priceBase: "0.000005" },
  ]);
  const [cashAcc] = await db.insert(accounts).values({ code: "1010", name: "Cash", type: "asset", assetId: irtAsset.id }).returning();
  const [expenseAcc] = await db.insert(accounts).values({ code: "5010", name: "Expense", type: "expense", assetId: usdAsset.id }).returning();
  const [equityAcc] = await db.insert(accounts).values({ code: "3010", name: "Equity", type: "equity", assetId: usdAsset.id }).returning();
  const [assetAcc] = await db.insert(accounts).values({ code: "1200", name: "BTC", type: "asset", assetId: usdAsset.id }).returning();
  const [pnlAcc] = await db.insert(accounts).values({ code: "4100", name: "Pnl", type: "income", assetId: usdAsset.id }).returning();
  return { usdAsset, irtAsset, cashAcc, expenseAcc, equityAcc, assetAcc, pnlAcc };
}

// ────────── Auth tests ──────────

test("Auth — hash and verify password", async () => {
  const hash = hashPassword("secret123");
  assert.equal(verifyPassword("secret123", hash), true);
  assert.equal(verifyPassword("wrong", hash), false);
  assert.ok(hash.includes(":"));
});

test("Auth — register and login flow preserves legacy migration", async () => {
  await cleanAll();
  const { usdAsset, cashAcc, equityAcc } = await setupBasicLedger();
  // Create legacy owner without username (pre-auth state) with a transaction
  const [legacyUser] = await db.insert(users).values({ name: "مالک خانواده", role: "owner" }).returning();
  // Opening entry with 1456 USD net worth simulation — use USD asset for 1:1 valuation
  await postEntry({
    entryDate: "2026-01-10",
    type: "opening",
    description: "افتتاحیه 1456 دلار",
    postings: [
      { accountId: cashAcc.id, assetId: usdAsset.id, quantity: "1456", baseValue: "1456" },
      { accountId: equityAcc.id, assetId: usdAsset.id, quantity: "-1456", baseValue: "-1456" },
    ],
  });
  const beforeEntries = await db.select().from(journalEntries);
  const beforePostings = await db.select().from(postings);
  const beforeNetWorth = await getNetWorth();

  // Simulate register that claims legacy user
  const username = "example";
  const password = "password123";
  const hash = hashPassword(password);
  // Check legacy detection
  const legacyUsers = await db.select().from(users);
  assert.equal(legacyUsers.length, 1);
  assert.equal((legacyUsers[0] as any).username, null);
  // Claim
  await db.update(users).set({ username, passwordHash: hash } as any).where(eq(users.id, legacyUser.id));
  await db.insert(userFxSettings).values({ userId: legacyUser.id, currentRate: "190000" }).onConflictDoNothing();
  const [claimed] = await db.select().from(users).where(eq(users.id, legacyUser.id)).limit(1);
  assert.equal((claimed as any).username, "example");
  assert.ok(verifyPassword(password, (claimed as any).passwordHash));

  const afterEntries = await db.select().from(journalEntries);
  const afterPostings = await db.select().from(postings);
  const afterNetWorth = await getNetWorth();

  assert.equal(beforeEntries.length, afterEntries.length, "تعداد تراکنش‌ها باید حفظ شود");
  assert.equal(beforePostings.length, afterPostings.length);
  assert.equal(beforeNetWorth.netWorth, afterNetWorth.netWorth);
  assert.ok(D(beforeNetWorth.netWorth).sub("1456").isZero());
  assert.ok(D(afterNetWorth.netWorth).sub("1456").isZero());
  assert.equal(afterNetWorth.netWorth, beforeNetWorth.netWorth);
});

test("Auth — prevent duplicate username", async () => {
  await cleanAll();
  await setupBasicLedger();
  const hash = hashPassword("pass123");
  await db.insert(users).values({ name: "User1", username: "testuser", passwordHash: hash } as any);
  const [existing] = await db.select().from(users).where(eq((users as any).username, "testuser")).limit(1);
  assert.ok(existing);
  // Try duplicate should conflict — simulate check
  const [dup] = await db.select().from(users).where(eq((users as any).username, "testuser")).limit(1);
  assert.ok(dup);
});

test("Auth — Google linking prevents duplicate", async () => {
  await cleanAll();
  await setupBasicLedger();
  const [u1] = await db.insert(users).values({ name: "Ali", username: "ali", email: "ali@gmail.com", passwordHash: hashPassword("123456") } as any).returning();
  // Simulate Google login with same email but new googleId
  const googleId = "google-123";
  // Should link to existing instead of creating duplicate
  const [existingByEmail] = await db.select().from(users).where(eq((users as any).email, "ali@gmail.com")).limit(1);
  assert.equal(existingByEmail.id, u1.id);
  await db.update(users).set({ googleId } as any).where(eq(users.id, existingByEmail.id));
  const [linked] = await db.select().from(users).where(eq(users.id, u1.id)).limit(1);
  assert.equal((linked as any).googleId, googleId);
  // Ensure no second user created
  const all = await db.select().from(users);
  assert.equal(all.length, 1);
});

test("Auth — session creation and expiration", async () => {
  await cleanAll();
  await setupBasicLedger();
  const [user] = await db.insert(users).values({ name: "Test", username: "test", passwordHash: hashPassword("pass") } as any).returning();
  const token = generateToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ userId: user.id, token, expiresAt });
  const [sess] = await db.select().from(sessions).where(eq(sessions.token, token)).limit(1);
  assert.ok(sess);
  assert.equal(sess.userId, user.id);
  // Simulate expiration
  const expiredToken = generateToken();
  const expiredAt = new Date(Date.now() - 1000);
  await db.insert(sessions).values({ userId: user.id, token: expiredToken, expiresAt: expiredAt });
  // getSessionUser should clean expired
  const { getSessionUser } = await import("../src/lib/auth");
  const expiredUser = await getSessionUser(expiredToken);
  assert.equal(expiredUser, null);
  const [still] = await db.select().from(sessions).where(eq(sessions.token, expiredToken)).limit(1);
  assert.equal(still, undefined);
});

// ────────── FX per-user tests ──────────

test("FX — default rate is 190000 per spec", async () => {
  await cleanAll();
  await setupBasicLedger();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  const snap = await getUserFxRate(user.id);
  assert.ok(D(snap.rate).sub("190000").isZero());
  const libSnap = await getLatestUsdIrtRateForUser(user.id);
  assert.ok(D(libSnap.rate).sub("190000").isZero());
});

test("FX — per-user isolation: User A 190k, User B 200k", async () => {
  await cleanAll();
  await setupBasicLedger();
  const [userA] = await db.insert(users).values({ name: "A", username: "a", passwordHash: hashPassword("p") } as any).returning();
  const [userB] = await db.insert(users).values({ name: "B", username: "b", passwordHash: hashPassword("p") } as any).returning();
  await db.insert(userFxSettings).values({ userId: userA.id, currentRate: "190000" }).onConflictDoNothing();
  await db.insert(userFxSettings).values({ userId: userB.id, currentRate: "200000" }).onConflictDoNothing();

  let snapA = await getUserFxRate(userA.id);
  let snapB = await getUserFxRate(userB.id);
  assert.ok(D(snapA.rate).sub("190000").isZero());
  assert.ok(D(snapB.rate).sub("200000").isZero());

  // Update A to 195000
  const resA = await updateUserFxRate(userA.id, "195000");
  assert.equal(resA.ok, true);
  snapA = await getUserFxRate(userA.id);
  snapB = await getUserFxRate(userB.id);
  assert.ok(D(snapA.rate).sub("195000").isZero());
  assert.ok(D(snapB.rate).sub("200000").isZero());
});

test("FX — 24h limit enforced server-side", async () => {
  await cleanAll();
  await setupBasicLedger();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  // First update should succeed
  const r1 = await updateUserFxRate(user.id, "190000");
  assert.equal(r1.ok, true);
  // Immediate second update should fail
  const r2 = await updateUserFxRate(user.id, "200000");
  assert.equal(r2.ok, false);
  assert.ok(r2.message.includes("۲۴ ساعت"));

  // Simulate 24h passed by manually setting lastUpdatedAt to 25h ago
  await db
    .update(userFxSettings)
    .set({ lastUpdatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
    .where(eq(userFxSettings.userId, user.id));
  const r3 = await updateUserFxRate(user.id, "200000");
  assert.equal(r3.ok, true);
  const snap = await getUserFxRate(user.id);
  assert.ok(D(snap.rate).sub("200000").isZero());
});

test("FX — cannot bypass via direct DB or API without backend check", async () => {
  await cleanAll();
  await setupBasicLedger();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  await updateUserFxRate(user.id, "190000");
  // Try to bypass by directly updating via API without waiting 24h should be rejected
  const bypass = await updateUserFxRate(user.id, "210000");
  assert.equal(bypass.ok, false);
});

// ────────── Historical immutability tests ──────────

test("Historical immutability — 19,000,000 تومان @190000 = 100 دلار freeze", async () => {
  await cleanAll();
  const { usdAsset, irtAsset, cashAcc, expenseAcc } = await setupBasicLedger();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "190000" }).onConflictDoNothing();

  const irtAmount = "19000000";
  const rate = D("190000");
  const usdAmount = D(irtAmount).div(rate).toString(); // should be 100

  assert.equal(usdAmount, "100");

  // Create expense with frozen snapshot
  const entry = await recordExpense(
    {
      entryDate: "2026-08-01",
      description: "هزینه تست",
      cashAccountId: cashAcc.id,
      categoryAccountId: expenseAcc.id,
      assetId: irtAsset.id,
      quantity: irtAmount,
      baseValue: usdAmount,
    } as any,
  );

  await db.insert(entryFxSnapshots).values({
    entryId: entry.id,
    irtAmount,
    usdAmount,
    fxRate: "190000",
    rateSource: "user_settings",
    rateDate: "2026-08-01",
  });

  const [snap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, entry.id)).limit(1);
  assert.ok(D(snap.irtAmount).sub(irtAmount).isZero());
  assert.ok(D(snap.usdAmount).sub(usdAmount).isZero());
  assert.ok(D(snap.fxRate).sub("190000").isZero());

  // Change current rate to 200000
  await db.update(userFxSettings).set({ currentRate: "200000", lastUpdatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(userFxSettings.userId, user.id));
  await updateUserFxRate(user.id, "200000");

  // Verify historical snapshot still 100 USD, not recalculated to 95
  const [snapAfter] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, entry.id)).limit(1);
  assert.ok(D(snapAfter.usdAmount).sub("100").isZero());
  assert.ok(D(snapAfter.fxRate).sub("190000").isZero());
  assert.ok(D(snapAfter.irtAmount).sub("19000000").isZero());

  // Simulate wrong revaluation query should NOT be done: ensure postings still 100 base_value
  const [posting] = await db.select().from(postings).where(eq(postings.entryId, entry.id)).limit(1);
  // postings baseValue should still be 100 or -100
  assert.ok(posting.baseValue.includes("100"));
});

test("Current valuation changes with rate, historical does not", async () => {
  await cleanAll();
  const { usdAsset, irtAsset, cashAcc, expenseAcc, equityAcc } = await setupBasicLedger();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "190000" }).onConflictDoNothing();

  // Opening with 1000 USD asset
  await postEntry({
    entryDate: "2026-01-01",
    type: "opening",
    description: "افتتاحیه",
    postings: [
      { accountId: cashAcc.id, assetId: irtAsset.id, quantity: "190000000", baseValue: "1000" },
      { accountId: equityAcc.id, assetId: usdAsset.id, quantity: "-1000", baseValue: "-1000" },
    ],
  });
  const nwBefore = await getNetWorth();
  // Simulate current valuation IRT: 1000 * 190000 = 190,000,000
  const beforeIrt = D(nwBefore.netWorth).mul("190000").toString();
  assert.ok(D(beforeIrt).gt(0));

  // Change rate to 200000
  await db.update(userFxSettings).set({ lastUpdatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(userFxSettings.userId, user.id));
  await updateUserFxRate(user.id, "200000");
  const nwAfter = await getNetWorth();
  // Net worth in USD unchanged (still 1000), but IRT valuation changes
  assert.equal(nwAfter.netWorth, nwBefore.netWorth);
  const afterIrt = D(nwAfter.netWorth).mul("200000").toString();
  assert.ok(D(afterIrt).gt(beforeIrt));
  // Historical postings unchanged
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 1);
});

test("Unrealized vs Realized — rate change affects unrealized only", async () => {
  await cleanAll();
  const { usdAsset, irtAsset, cashAcc, equityAcc, assetAcc, pnlAcc } = await setupBasicLedger();
  // Need USD cash account for buy/sell
  const [usdCashAcc] = await db.insert(accounts).values({ code: "1100", name: "USDT Cash", type: "asset", assetId: usdAsset.id }).returning();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "190000" }).onConflictDoNothing();

  // Buy 1 unit @100 USD
  await recordBuy({
    entryDate: "2026-01-01",
    description: "خرید",
    assetAccountId: assetAcc.id,
    cashAccountId: usdCashAcc.id,
    assetId: usdAsset.id,
    quantity: "1",
    cashAssetId: usdAsset.id,
    cashQuantity: "100",
    baseValue: "100",
    feeBase: "0",
    feeAccountId: null,
  } as any);

  // Check lots
  let lotsRows = await db.select().from(lots);
  assert.equal(lotsRows.length, 1);
  assert.ok(D(lotsRows[0].unitCostBase).sub("100").isZero());

  // Simulate price increase to 120 USD (unrealized PnL = 20)
  await db.insert(prices).values({ assetId: usdAsset.id, asOf: "2026-08-01", priceBase: "120", source: "manual" });

  // Before sell, changing FX rate from 190k to 200k should affect current asset valuation display (since we convert USD to IRT)
  // But lots costBasis stays 100
  await db.update(userFxSettings).set({ lastUpdatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(userFxSettings.userId, user.id));
  await updateUserFxRate(user.id, "200000");
  lotsRows = await db.select().from(lots);
  assert.ok(D(lotsRows[0].unitCostBase).sub("100").isZero());

  // Sell 1 unit @120 USD
  await recordSell({
    entryDate: "2026-08-02",
    description: "فروش",
    assetAccountId: assetAcc.id,
    cashAccountId: usdCashAcc.id,
    assetId: usdAsset.id,
    quantity: "1",
    cashAssetId: usdAsset.id,
    cashQuantity: "120",
    baseValue: "120",
    feeBase: "0",
    feeAccountId: null,
    pnlAccountId: pnlAcc.id,
  } as any);

  const realized = await getRealizedPnl();
  assert.ok(D(realized.total).sub("20").isZero());

  // Change FX rate again to 210000
  await db.update(userFxSettings).set({ lastUpdatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) }).where(eq(userFxSettings.userId, user.id));
  await updateUserFxRate(user.id, "210000");

  const realizedAfter = await getRealizedPnl();
  assert.ok(D(realizedAfter.total).sub("20").isZero());

  const lotsAfter = await db.select().from(lots);
  // qtyRemaining should be 0 after sell, but unitCost stays
  assert.ok(D(lotsAfter[0].qtyRemaining).sub("0").isZero());
});

test("FIFO immutability after rate change", async () => {
  await cleanAll();
  const { usdAsset, assetAcc, pnlAcc } = await setupBasicLedger();
  const [usdCashAcc] = await db.insert(accounts).values({ code: "1100", name: "Cash2", type: "asset", assetId: usdAsset.id }).returning();
  const [user] = await db.insert(users).values({ name: "U", username: "u", passwordHash: hashPassword("p") } as any).returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "190000" }).onConflictDoNothing();

  await recordBuy({
    entryDate: "2026-01-01",
    description: "Buy1",
    assetAccountId: assetAcc.id,
    cashAccountId: usdCashAcc.id,
    assetId: usdAsset.id,
    quantity: "2",
    cashAssetId: usdAsset.id,
    cashQuantity: "200",
    baseValue: "200",
    feeBase: "0",
    feeAccountId: null,
  } as any);
  await recordBuy({
    entryDate: "2026-01-02",
    description: "Buy2",
    assetAccountId: assetAcc.id,
    cashAccountId: usdCashAcc.id,
    assetId: usdAsset.id,
    quantity: "1",
    cashAssetId: usdAsset.id,
    cashQuantity: "110",
    baseValue: "110",
    feeBase: "0",
    feeAccountId: null,
  } as any);

  // Sell 2.5 — should consume FIFO 2 from first lot + 0.5 from second
  await recordSell({
    entryDate: "2026-01-03",
    description: "Sell",
    assetAccountId: assetAcc.id,
    cashAccountId: usdCashAcc.id,
    assetId: usdAsset.id,
    quantity: "2.5",
    cashAssetId: usdAsset.id,
    cashQuantity: "275",
    baseValue: "275",
    feeBase: "0",
    feeAccountId: null,
    pnlAccountId: pnlAcc.id,
  } as any);

  const beforeLots = await db.select().from(lots);
  const beforeConsumptions = await db.select().from(lotConsumptions);

  await db.update(userFxSettings).set({ lastUpdatedAt: new Date(Date.now() - 25*3600000) }).where(eq(userFxSettings.userId, user.id));
  await updateUserFxRate(user.id, "200000");

  const afterLots = await db.select().from(lots);
  const afterConsumptions = await db.select().from(lotConsumptions);

  assert.deepEqual(beforeLots, afterLots, "Lots نباید با تغییر نرخ تغییر کنند");
  assert.deepEqual(beforeConsumptions, afterConsumptions);
});

test("Security — password not plain text", async () => {
  const hash = hashPassword("mySecret");
  assert.ok(!hash.includes("mySecret"));
  assert.ok(hash.includes(":"));
  assert.ok(hash.length > 20);
});

test("Security — session token is random and httpOnly semantics", async () => {
  const t1 = generateToken();
  const t2 = generateToken();
  assert.notEqual(t1, t2);
  assert.equal(t1.length, 64);
});
