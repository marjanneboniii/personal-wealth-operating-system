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
import {
  postEntry,
  recordBuy,
  recordExpense,
  recordIncome,
  recordSell,
  recordTransfer,
} from "../src/features/ledger/service";
import {
  getAccountBalances,
  getHoldings,
  getLedger,
  getNetWorth,
  getOpenLots,
  getRealizedPnl,
} from "../src/features/ledger/queries";
import { runStage3IntegrityAudit } from "../src/features/integrity/service";
import { updateUserFxRate } from "../src/features/fx/userRate";
import { createSession } from "../src/lib/auth";
import { POST as txPost, GET as txGet } from "../src/app/api/transactions/route";

async function setupStage3Scenario() {
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

  const [usd] = await db.insert(currencies).values({ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any).returning();
  const [irt] = await db.insert(currencies).values({ code: "IRT", name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any).returning();

  const [cryptoClass] = await db.insert(assetClasses).values({ code: "crypto", name: "Crypto", valuationMethod: "fifo" } as any).returning();
  const [cashClass] = await db.insert(assetClasses).values({ code: "cash", name: "Cash", valuationMethod: "fifo" } as any).returning();

  const [btc] = await db.insert(assets).values({ symbol: "BTC", name: "Bitcoin", classId: cryptoClass.id, currencyId: usd.id } as any).returning();
  const [usdCash] = await db.insert(assets).values({ symbol: "USD_CASH", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any).returning();

  const [userA] = await db.insert(users).values({ name: "User A", username: "usera", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "User B", username: "userb", role: "owner" } as any).returning();

  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "190000" },
    { userId: userB.id, currentRate: "200000" },
  ] as any);

  const [cashAcc] = await db.insert(accounts).values({ code: "1010", name: "Cash USD", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [bankAcc1] = await db.insert(accounts).values({ code: "1020", name: "Bank 1", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [bankAcc2] = await db.insert(accounts).values({ code: "1030", name: "Bank 2", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [equityAcc] = await db.insert(accounts).values({ code: "3010", name: "Equity", type: "equity", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [expenseAcc] = await db.insert(accounts).values({ code: "5010", name: "General Expense", type: "expense", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [incomeAcc] = await db.insert(accounts).values({ code: "4010", name: "Salary Income", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [btcAcc] = await db.insert(accounts).values({ code: "1100", name: "Crypto BTC", type: "asset", assetId: btc.id, userId: userA.id } as any).returning();
  const [pnlAcc] = await db.insert(accounts).values({ code: "4100", name: "Realized P&L", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();

  // Create accounts for User B
  const [cashAccB] = await db.insert(accounts).values({ code: "1010", name: "Cash B", type: "asset", assetId: usdCash.id, userId: userB.id } as any).returning();

  return {
    usd,
    irt,
    btc,
    usdCash,
    userA,
    userB,
    cashAcc,
    bankAcc1,
    bankAcc2,
    equityAcc,
    expenseAcc,
    incomeAcc,
    btcAcc,
    pnlAcc,
    cashAccB,
  };
}

test("STAGE 3 Matrix #1, #2 — Expense & Income Atomicity: no partial records on failure", async () => {
  const { cashAcc, expenseAcc, incomeAcc, userA } = await setupStage3Scenario();

  const countBeforeJE = (await db.select().from(journalEntries)).length;
  const countBeforePosts = (await db.select().from(postings)).length;

  // Simulate an unbalanced / invalid expense posting that throws inside transaction
  await assert.rejects(
    async () => {
      await postEntry({
        entryDate: "2026-08-10",
        type: "expense",
        description: "Bad Expense Atomicity Test",
        userId: userA.id,
        postings: [
          { accountId: cashAcc.id, assetId: expenseAcc.assetId!, quantity: "-100", baseValue: "-100" },
          // Missing counter posting -> assertBalanced throws
        ],
      });
    },
    /تراز نیست|balanced/,
  );

  const countAfterJE = (await db.select().from(journalEntries)).length;
  const countAfterPosts = (await db.select().from(postings)).length;

  assert.equal(countAfterJE, countBeforeJE, "No orphan journal entry created on failure");
  assert.equal(countAfterPosts, countBeforePosts, "No orphan posting created on failure");
});

test("STAGE 3 Matrix #3, #4, PART 100, PART 101 — Transfer Atomicity & Rollback: A=50m, B=10m -> Transfer 20m -> A=30m, B=30m; Rollback preserves balance", async () => {
  const { bankAcc1, bankAcc2, equityAcc, userA } = await setupStage3Scenario();

  // Deposit Initial A=50m, B=10m against equity
  await recordIncome({
    entryDate: "2026-08-01",
    description: "Initial deposit Bank 1",
    cashAccountId: bankAcc1.id,
    categoryAccountId: equityAcc.id,
    assetId: bankAcc1.assetId!,
    quantity: "50000000",
    baseValue: "50000000",
    userId: userA.id,
  });

  await recordIncome({
    entryDate: "2026-08-01",
    description: "Initial deposit Bank 2",
    cashAccountId: bankAcc2.id,
    categoryAccountId: equityAcc.id,
    assetId: bankAcc2.assetId!,
    quantity: "10000000",
    baseValue: "10000000",
    userId: userA.id,
  });

  // Execute Transfer 20,000,000 from Bank 1 to Bank 2
  await recordTransfer({
    entryDate: "2026-08-05",
    description: "Transfer 20m A to B",
    fromAccountId: bankAcc1.id,
    toAccountId: bankAcc2.id,
    assetId: bankAcc1.assetId!,
    quantity: "20000000",
    unitPrice: "1",
    userId: userA.id,
  });

  const balances = await getAccountBalances(userA.id);
  const balA = balances.find((b) => b.accountId === bankAcc1.id);
  const balB = balances.find((b) => b.accountId === bankAcc2.id);

  assert.equal(parseFloat(balA?.quantity || "0"), 30000000);
  assert.equal(parseFloat(balB?.quantity || "0"), 30000000);

  // Test Rollback: try to transfer 40,000,000 with preventOverdraft -> must fail & preserve A=30m, B=30m
  await assert.rejects(
    async () => {
      await recordTransfer({
        entryDate: "2026-08-06",
        description: "Overdraft Transfer",
        fromAccountId: bankAcc1.id,
        toAccountId: bankAcc2.id,
        assetId: bankAcc1.assetId!,
        quantity: "40000000",
        unitPrice: "1",
        userId: userA.id,
        preventOverdraft: true,
      });
    },
    /موجودی حساب کافی نیست/,
  );

  const balancesAfterFail = await getAccountBalances(userA.id);
  const balAAfter = balancesAfterFail.find((b) => b.accountId === bankAcc1.id);
  const balBAfter = balancesAfterFail.find((b) => b.accountId === bankAcc2.id);

  assert.equal(parseFloat(balAAfter?.quantity || "0"), 30000000);
  assert.equal(parseFloat(balBAfter?.quantity || "0"), 30000000);
});

test("STAGE 3 Matrix #5, #6, #7, #8 — Idempotency & Retry: Duplicate Expense, Income, Transfer with Idempotency-Key return existing without duplicate postings", async () => {
  const { cashAcc, expenseAcc, incomeAcc, bankAcc1, bankAcc2, userA } = await setupStage3Scenario();

  // 1. Duplicate Expense Test
  const exp1 = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19,000,000",
    cashAccountId: cashAcc.id,
    categoryAccountId: expenseAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "19000000",
    baseValue: "19000000",
    userId: userA.id,
    idempotencyKey: "EXP-ABC-123",
  });

  const exp2 = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19,000,000",
    cashAccountId: cashAcc.id,
    categoryAccountId: expenseAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "19000000",
    baseValue: "19000000",
    userId: userA.id,
    idempotencyKey: "EXP-ABC-123",
  });

  assert.equal(exp1.id, exp2.id);
  assert.equal(exp2.idempotentReplay, true);

  const allJE = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, "EXP-ABC-123"));
  assert.equal(allJE.length, 1, "Exactly one expense journal entry created");

  // 2. Duplicate Income Test
  const inc1 = await recordIncome({
    entryDate: "2026-08-01",
    description: "Income 38,000,000",
    cashAccountId: cashAcc.id,
    categoryAccountId: incomeAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "38000000",
    baseValue: "38000000",
    userId: userA.id,
    idempotencyKey: "INC-ABC-123",
  });

  const inc2 = await recordIncome({
    entryDate: "2026-08-01",
    description: "Income 38,000,000",
    cashAccountId: cashAcc.id,
    categoryAccountId: incomeAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "38000000",
    baseValue: "38000000",
    userId: userA.id,
    idempotencyKey: "INC-ABC-123",
  });
  assert.equal(inc1.id, inc2.id);

  // 3. Duplicate Transfer Test
  const trn1 = await recordTransfer({
    entryDate: "2026-08-01",
    description: "Transfer 5,000,000",
    fromAccountId: bankAcc1.id,
    toAccountId: bankAcc2.id,
    assetId: bankAcc1.assetId!,
    quantity: "5000000",
    unitPrice: "1",
    userId: userA.id,
    idempotencyKey: "TRN-ABC-123",
  });

  const trn2 = await recordTransfer({
    entryDate: "2026-08-01",
    description: "Transfer 5,000,000",
    fromAccountId: bankAcc1.id,
    toAccountId: bankAcc2.id,
    assetId: bankAcc1.assetId!,
    quantity: "5000000",
    unitPrice: "1",
    userId: userA.id,
    idempotencyKey: "TRN-ABC-123",
  });
  assert.equal(trn1.id, trn2.id);
  assert.equal(trn2.idempotentReplay, true);
});

test("STAGE 3 Matrix #9 — Same Key + Different Payload: throws 409 Conflict", async () => {
  const { cashAcc, expenseAcc, userA } = await setupStage3Scenario();

  await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19,000,000",
    cashAccountId: cashAcc.id,
    categoryAccountId: expenseAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "19000000",
    baseValue: "19000000",
    userId: userA.id,
    idempotencyKey: "EXP-CONFLICT-001",
  });

  // Same key, different amount -> 409 Conflict
  await assert.rejects(
    async () => {
      await recordExpense({
        entryDate: "2026-08-01",
        description: "Expense 25,000,000",
        cashAccountId: cashAcc.id,
        categoryAccountId: expenseAcc.id,
        assetId: cashAcc.assetId!,
        quantity: "25000000",
        baseValue: "25000000",
        userId: userA.id,
        idempotencyKey: "EXP-CONFLICT-001",
      });
    },
    (err: any) => err.status === 409 || err.code === "IDEMPOTENCY_CONFLICT",
  );
});

test("STAGE 3 Matrix #10 — Concurrent Expense Test (PART 70): Initial 100m, Expense A=60m, Expense B=50m -> One success, One failure, balance=40m", async () => {
  const { cashAcc, expenseAcc, equityAcc, userA } = await setupStage3Scenario();

  // Deposit 100,000,000 initial cash
  await recordIncome({
    entryDate: "2026-08-01",
    description: "Initial 100m Cash",
    cashAccountId: cashAcc.id,
    categoryAccountId: equityAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "100000000",
    baseValue: "100000000",
    userId: userA.id,
  });

  // Run Expense A (60m) and Expense B (50m) concurrently with preventOverdraft: true
  const results = await Promise.allSettled([
    recordExpense({
      entryDate: "2026-08-05",
      description: "Expense A 60m",
      cashAccountId: cashAcc.id,
      categoryAccountId: expenseAcc.id,
      assetId: cashAcc.assetId!,
      quantity: "60000000",
      baseValue: "60000000",
      userId: userA.id,
      preventOverdraft: true,
    }),
    recordExpense({
      entryDate: "2026-08-05",
      description: "Expense B 50m",
      cashAccountId: cashAcc.id,
      categoryAccountId: expenseAcc.id,
      assetId: cashAcc.assetId!,
      quantity: "50000000",
      baseValue: "50000000",
      userId: userA.id,
      preventOverdraft: true,
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "Exactly one expense succeeded");
  assert.equal(rejected.length, 1, "Exactly one expense failed due to overdraft prevention");

  const balances = await getAccountBalances(userA.id);
  const bal = balances.find((b) => b.accountId === cashAcc.id);
  const finalQuantity = parseFloat(bal?.quantity || "0");

  assert.ok(finalQuantity === 40000000 || finalQuantity === 50000000, "Final balance is positive and correct");
  assert.ok(finalQuantity >= 0, "No negative balance created");
});

test("STAGE 3 Matrix #11, #12 — Concurrent Transfer Test & Ledger Balance (PART 21, 24): Total Debit = Total Credit invariant", async () => {
  const { bankAcc1, bankAcc2, equityAcc, userA } = await setupStage3Scenario();

  await recordIncome({
    entryDate: "2026-08-01",
    description: "Bank 1 start 50m",
    cashAccountId: bankAcc1.id,
    categoryAccountId: equityAcc.id,
    assetId: bankAcc1.assetId!,
    quantity: "50000000",
    baseValue: "50000000",
    userId: userA.id,
  });

  // Execute two concurrent transfers
  await Promise.all([
    recordTransfer({
      entryDate: "2026-08-02",
      description: "Concurrent Transfer 1",
      fromAccountId: bankAcc1.id,
      toAccountId: bankAcc2.id,
      assetId: bankAcc1.assetId!,
      quantity: "10000000",
      unitPrice: "1",
      userId: userA.id,
    }),
    recordTransfer({
      entryDate: "2026-08-02",
      description: "Concurrent Transfer 2",
      fromAccountId: bankAcc1.id,
      toAccountId: bankAcc2.id,
      assetId: bankAcc1.assetId!,
      quantity: "15000000",
      unitPrice: "1",
      userId: userA.id,
    }),
  ]);

  const balances = await getAccountBalances(userA.id);
  const b1 = balances.find((b) => b.accountId === bankAcc1.id);
  const b2 = balances.find((b) => b.accountId === bankAcc2.id);

  assert.equal(parseFloat(b1?.quantity || "0"), 25000000);
  assert.equal(parseFloat(b2?.quantity || "0"), 25000000);

  // Check Ledger Invariant: sum(base_value) == 0 across every single journal entry
  const unbalancedRes = await db.execute(sql`
    select je.id
    from journal_entries je
    join postings p on p.entry_id = je.id
    group by je.id
    having abs(sum(p.base_value)) > 0.000000001
  `);
  assert.equal(unbalancedRes.rows.length, 0, "All journal entries are strictly balanced (Total Debit = Total Credit)");
});

test("STAGE 3 Matrix #13, #14, #16, PART 98, PART 99 — Historical FX & USD Immutability: 19m @ 190k = 100 USD remains 100 USD when FX becomes 200k", async () => {
  const { cashAcc, expenseAcc, incomeAcc, userA } = await setupStage3Scenario();

  // Expense: 19,000,000 @ 190,000 = 100 USD historical
  const exp = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19m",
    cashAccountId: cashAcc.id,
    categoryAccountId: expenseAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "100",
    baseValue: "100",
    userId: userA.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: exp.id,
    irtAmount: "19000000",
    usdAmount: "100",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  // Income: 38,000,000 @ 190,000 = 200 USD historical
  const inc = await recordIncome({
    entryDate: "2026-08-01",
    description: "Income 38m",
    cashAccountId: cashAcc.id,
    categoryAccountId: incomeAcc.id,
    assetId: cashAcc.assetId!,
    quantity: "200",
    baseValue: "200",
    userId: userA.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: inc.id,
    irtAmount: "38000000",
    usdAmount: "200",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  // Check before FX update
  const [snapExpBefore] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  const [snapIncBefore] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, inc.id));
  assert.equal(parseFloat(snapExpBefore.usdAmount), 100);
  assert.equal(parseFloat(snapIncBefore.usdAmount), 200);

  // Update current FX rate from 190,000 to 200,000
  await updateUserFxRate(userA.id, "200000");

  // Verify Historical FX and USD amounts are 100% frozen / immutable
  const [snapExpAfter] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  const [snapIncAfter] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, inc.id));

  assert.equal(parseFloat(snapExpAfter.usdAmount), 100);
  assert.equal(parseFloat(snapExpAfter.fxRate), 190000);
  assert.equal(parseFloat(snapIncAfter.usdAmount), 200);
  assert.equal(parseFloat(snapIncAfter.fxRate), 190000);
});

test("STAGE 3 Matrix #15 — Realized P&L Immutability after FX Rate Change", async () => {
  const { btc, usdCash, btcAcc, cashAcc, pnlAcc, equityAcc, userA } = await setupStage3Scenario();

  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 1 BTC @ 50k",
    assetAccountId: btcAcc.id,
    cashAccountId: equityAcc.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: userA.id,
  });

  await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 1 BTC @ 60k",
    assetAccountId: btcAcc.id,
    cashAccountId: cashAcc.id,
    pnlAccountId: pnlAcc.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "60000",
    baseValue: "60000",
    userId: userA.id,
  });

  const pnlBefore = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnlBefore.total), 10000);

  // Change FX rate
  await updateUserFxRate(userA.id, "250000");

  // Realized P&L is unchanged
  const pnlAfter = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnlAfter.total), 10000);
});

test("STAGE 3 Matrix #17, #18 — User Isolation & API Tampering Protection: client-sent realizedPnl/costBasis/historicalUsd ignored", async () => {
  const { cashAcc, incomeAcc, userA, userB } = await setupStage3Scenario();
  const { token: tokenA } = await createSession(userA.id);

  // 1. API Tampering: send POST /api/transactions with injected realizedPnl, costBasis, historicalUsd
  const tamperedBody = {
    type: "income",
    entryDate: "2026-08-01",
    description: "Tampered Income Test",
    primaryAccountId: cashAcc.id,
    counterAccountId: incomeAcc.id,
    amount: "1000",
    realizedPnl: "999999999",
    costBasis: "0",
    historicalUsd: "999999999",
    fifoCost: "999999999",
  };

  const req = new Request("http://localhost/api/transactions", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${tokenA}` },
    body: JSON.stringify(tamperedBody),
  });

  const res = await txPost(req);
  assert.equal(res.status, 201);
  const json = await res.json();
  assert.ok(json.id);

  // Verify ledger recorded real base_value 1000, not 999999999
  const ledger = await getLedger(10, userA.id);
  assert.equal(ledger[0].description, "Tampered Income Test");
  assert.equal(parseFloat(ledger[0].lines[0].baseValue), 1000);

  // 2. User Isolation: User B cannot GET User A's transaction
  const { token: tokenB } = await createSession(userB.id);
  const reqGet = new Request(`http://localhost/api/transactions?id=${json.id}`, {
    method: "GET",
    headers: { cookie: `pwos_session=${tokenB}` },
  });
  const resGet = await txGet(reqGet);
  assert.equal(resGet.status, 404);
});

test("STAGE 3 Matrix #19, #20, PART 41, PART 42 — FIFO Concurrency & Over-consumption: two concurrent sells of 1 unit when only 1 available -> One success, One failure, no negative lots", async () => {
  const { btc, usdCash, btcAcc, cashAcc, pnlAcc, equityAcc, userA } = await setupStage3Scenario();

  // Buy exactly 1 BTC
  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 1 BTC for FIFO Concurrency Test",
    assetAccountId: btcAcc.id,
    cashAccountId: equityAcc.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: userA.id,
  });

  // Execute TWO concurrent sells of 1 BTC each
  const results = await Promise.allSettled([
    recordSell({
      entryDate: "2026-08-05",
      description: "Sell A",
      assetAccountId: btcAcc.id,
      cashAccountId: cashAcc.id,
      pnlAccountId: pnlAcc.id,
      assetId: btc.id,
      quantity: "1",
      cashAssetId: usdCash.id,
      cashQuantity: "60000",
      baseValue: "60000",
      userId: userA.id,
    }),
    recordSell({
      entryDate: "2026-08-05",
      description: "Sell B",
      assetAccountId: btcAcc.id,
      cashAccountId: cashAcc.id,
      pnlAccountId: pnlAcc.id,
      assetId: btc.id,
      quantity: "1",
      cashAssetId: usdCash.id,
      cashQuantity: "60000",
      baseValue: "60000",
      userId: userA.id,
    }),
  ]);

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");

  assert.equal(fulfilled.length, 1, "Exactly one sell succeeded");
  assert.equal(rejected.length, 1, "Exactly one sell failed due to insufficient open lots");

  const openLots = await getOpenLots(btc.id, userA.id);
  assert.equal(openLots.length, 0, "All lots consumed cleanly without negative remaining");

  // Check Negative Lots Audit SQL
  const negLots = await db.execute(sql`SELECT * FROM lots WHERE qty_remaining < 0`);
  assert.equal(negLots.rows.length, 0, "Zero negative lots in database");
});

test("STAGE 3 Matrix PART 102 — Final Integrity Audit: runStage3IntegrityAudit() -> all 0 and ok === true", async () => {
  const audit = await runStage3IntegrityAudit();
  assert.equal(audit.unbalancedJournals, 0);
  assert.equal(audit.orphanPostings, 0);
  assert.equal(audit.duplicateIdempotency, 0);
  assert.equal(audit.negativeLots, 0);
  assert.equal(audit.overConsumedLots, 0);
  assert.equal(audit.historicalFxMutations, 0);
  assert.equal(audit.historicalUsdMutations, 0);
  assert.equal(audit.realizedPnlMutations, 0);
  assert.equal(audit.ok, true);
});
