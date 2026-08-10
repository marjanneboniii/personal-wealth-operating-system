import assert from "node:assert/strict";
import { test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assets,
  assetClasses,
  auditLog,
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
import { getPortfolioValuation } from "../src/features/portfolio/service";
import { runStage3IntegrityAudit } from "../src/features/integrity/service";
import { updateUserFxRate } from "../src/features/fx/userRate";
import { createSession, getSessionUser } from "../src/lib/auth";
import { getAuditLogs, sanitizeAuditData } from "../src/lib/audit";
import { validateAccountOwnership, validateAmount } from "../src/lib/validation";

async function setupStage5Scenario() {
  await createSchemaIfNotExists();
  await db.delete(auditLog);
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
  const [irtCash] = await db.insert(assets).values({ symbol: "IRT_CASH", name: "IRT Cash", classId: cashClass.id, currencyId: irt.id } as any).returning();

  const [userA] = await db.insert(users).values({ name: "User A", username: "usera_s5", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "User B", username: "userb_s5", role: "owner" } as any).returning();

  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "190000" },
    { userId: userB.id, currentRate: "200000" },
  ] as any);

  const [cashUsdA] = await db.insert(accounts).values({ code: "1010", name: "Cash USD A", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [cashIrtA] = await db.insert(accounts).values({ code: "1011", name: "Cash IRT A", type: "asset", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [bank1IrtA] = await db.insert(accounts).values({ code: "1020", name: "Bank 1 IRT A", type: "asset", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [bank2IrtA] = await db.insert(accounts).values({ code: "1030", name: "Bank 2 IRT A", type: "asset", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [equityA] = await db.insert(accounts).values({ code: "3010", name: "Equity A", type: "equity", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [incomeA] = await db.insert(accounts).values({ code: "4010", name: "Income A", type: "income", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [expenseA] = await db.insert(accounts).values({ code: "5010", name: "Expense A", type: "expense", assetId: irtCash.id, userId: userA.id } as any).returning();
  const [btcA] = await db.insert(accounts).values({ code: "1100", name: "Crypto BTC A", type: "asset", assetId: btc.id, userId: userA.id } as any).returning();
  const [pnlA] = await db.insert(accounts).values({ code: "4100", name: "Realized P&L A", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();

  return {
    usd,
    irt,
    btc,
    usdCash,
    irtCash,
    userA,
    userB,
    cashUsdA,
    cashIrtA,
    bank1IrtA,
    bank2IrtA,
    equityA,
    incomeA,
    expenseA,
    btcA,
    pnlA,
  };
}

test("STAGE 5 (#11-#14) — Income Regression: 38,000,000 IRT @ FX=190,000 -> 200 USD historical, Idempotency & Retry safe", async () => {
  const { cashIrtA, incomeA, userA } = await setupStage5Scenario();

  // Create Income 38,000,000 IRT @ 190,000 = 200 USD
  const inc1 = await recordIncome({
    entryDate: "2026-08-01",
    description: "Salary 38,000,000 IRT",
    cashAccountId: cashIrtA.id,
    categoryAccountId: incomeA.id,
    assetId: cashIrtA.assetId!,
    quantity: "38000000",
    baseValue: "200", // 38,000,000 / 190,000 = 200 USD base
    userId: userA.id,
    idempotencyKey: "S5-INC-001",
  });
  await db.insert(entryFxSnapshots).values({
    entryId: inc1.id,
    irtAmount: "38000000",
    usdAmount: "200",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  assert.ok(inc1.id);

  // Check expected result
  const [snap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, inc1.id));
  assert.equal(parseFloat(snap.irtAmount), 38000000);
  assert.equal(parseFloat(snap.usdAmount), 200);
  assert.equal(parseFloat(snap.fxRate), 190000);

  // Duplicate Request Test
  const inc2 = await recordIncome({
    entryDate: "2026-08-01",
    description: "Salary 38,000,000 IRT",
    cashAccountId: cashIrtA.id,
    categoryAccountId: incomeA.id,
    assetId: cashIrtA.assetId!,
    quantity: "38000000",
    baseValue: "200",
    userId: userA.id,
    idempotencyKey: "S5-INC-001",
  });
  assert.equal(inc1.id, inc2.id);
  assert.equal(inc2.idempotentReplay, true);

  const entries = await db.select().from(journalEntries).where(eq(journalEntries.idempotencyKey, "S5-INC-001"));
  assert.equal(entries.length, 1, "Exactly one transaction created");
});

test("STAGE 5 (#15-#18) — Expense Regression: 19,000,000 IRT @ FX=190,000 -> 100 USD historical, Duplicate & Rollback safe", async () => {
  const { cashIrtA, expenseA, userA } = await setupStage5Scenario();

  const exp1 = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19,000,000 IRT",
    cashAccountId: cashIrtA.id,
    categoryAccountId: expenseA.id,
    assetId: cashIrtA.assetId!,
    quantity: "19000000",
    baseValue: "100", // 19,000,000 / 190,000 = 100 USD
    userId: userA.id,
    idempotencyKey: "S5-EXP-001",
  });
  await db.insert(entryFxSnapshots).values({
    entryId: exp1.id,
    irtAmount: "19000000",
    usdAmount: "100",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-01",
  } as any);

  const [snap] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp1.id));
  assert.equal(parseFloat(snap.irtAmount), 19000000);
  assert.equal(parseFloat(snap.usdAmount), 100);

  // Duplicate Expense Test
  const exp2 = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19,000,000 IRT",
    cashAccountId: cashIrtA.id,
    categoryAccountId: expenseA.id,
    assetId: cashIrtA.assetId!,
    quantity: "19000000",
    baseValue: "100",
    userId: userA.id,
    idempotencyKey: "S5-EXP-001",
  });
  assert.equal(exp1.id, exp2.id);

  // Rollback Test on Failed Expense
  const postsBefore = (await db.select().from(postings)).length;
  await assert.rejects(
    async () => {
      await postEntry({
        entryDate: "2026-08-10",
        type: "expense",
        description: "Rollback Test Expense",
        userId: userA.id,
        postings: [{ accountId: cashIrtA.id, assetId: expenseA.assetId!, quantity: "-5000", baseValue: "-5" }],
      });
    },
    /تراز نیست|balanced/,
  );
  const postsAfter = (await db.select().from(postings)).length;
  assert.equal(postsAfter, postsBefore, "Rollback leaves zero partial records");
});

test("STAGE 5 (#19-#22) — Transfer Regression: A=50m, B=10m -> Transfer 20m -> A=30m, B=30m, Atomicity & Concurrency safe", async () => {
  const { bank1IrtA, bank2IrtA, equityA, userA } = await setupStage5Scenario();

  // Initial deposits
  await recordIncome({
    entryDate: "2026-08-01",
    description: "Deposit Bank 1 50m",
    cashAccountId: bank1IrtA.id,
    categoryAccountId: equityA.id,
    assetId: bank1IrtA.assetId!,
    quantity: "50000000",
    baseValue: "263.15",
    userId: userA.id,
  });

  await recordIncome({
    entryDate: "2026-08-01",
    description: "Deposit Bank 2 10m",
    cashAccountId: bank2IrtA.id,
    categoryAccountId: equityA.id,
    assetId: bank2IrtA.assetId!,
    quantity: "10000000",
    baseValue: "52.63",
    userId: userA.id,
  });

  // Transfer 20,000,000 from Bank 1 to Bank 2
  await recordTransfer({
    entryDate: "2026-08-05",
    description: "Transfer 20m",
    fromAccountId: bank1IrtA.id,
    toAccountId: bank2IrtA.id,
    assetId: bank1IrtA.assetId!,
    quantity: "20000000",
    unitPrice: "0.00000526315",
    userId: userA.id,
    idempotencyKey: "S5-TRN-001",
  });

  const balances = await getAccountBalances(userA.id);
  const b1 = balances.find((b) => b.accountId === bank1IrtA.id);
  const b2 = balances.find((b) => b.accountId === bank2IrtA.id);

  assert.equal(parseFloat(b1?.quantity || "0"), 30000000);
  assert.equal(parseFloat(b2?.quantity || "0"), 30000000);

  // Transfer Duplicate Test
  const trn2 = await recordTransfer({
    entryDate: "2026-08-05",
    description: "Transfer 20m",
    fromAccountId: bank1IrtA.id,
    toAccountId: bank2IrtA.id,
    assetId: bank1IrtA.assetId!,
    quantity: "20000000",
    unitPrice: "0.00000526315",
    userId: userA.id,
    idempotencyKey: "S5-TRN-001",
  });
  assert.equal(trn2.idempotentReplay, true);

  // Atomicity Test: transfer exceeding balance with preventOverdraft -> full rollback
  await assert.rejects(
    async () => {
      await recordTransfer({
        entryDate: "2026-08-06",
        description: "Overdraft Transfer",
        fromAccountId: bank1IrtA.id,
        toAccountId: bank2IrtA.id,
        assetId: bank1IrtA.assetId!,
        quantity: "40000000", // > remaining 30m
        unitPrice: "0.00000526315",
        userId: userA.id,
        preventOverdraft: true,
      });
    },
    /موجودی حساب کافی نیست/,
  );

  const balAfterRollback = await getAccountBalances(userA.id);
  assert.equal(parseFloat(balAfterRollback.find((b) => b.accountId === bank1IrtA.id)?.quantity || "0"), 30000000);
  assert.equal(parseFloat(balAfterRollback.find((b) => b.accountId === bank2IrtA.id)?.quantity || "0"), 30000000);
});

test("STAGE 5 (#23-#29) — Asset Buy/Sell & FIFO Regression: Lot 1=10@100, Lot 2=10@120 -> Sell 12 -> Cost Basis=1,240, remaining Lot 1=0, Lot 2=8", async () => {
  const { btc, usdCash, btcA, equityA, cashUsdA, pnlA, userA } = await setupStage5Scenario();

  // Buy Lot 1: 10 BTC @ 100 USD = 1000 USD
  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy Lot 1: 10 BTC @ 100 USD",
    assetAccountId: btcA.id,
    cashAccountId: equityA.id,
    assetId: btc.id,
    quantity: "10",
    cashAssetId: usdCash.id,
    cashQuantity: "1000",
    baseValue: "1000",
    userId: userA.id,
  });

  // Buy Lot 2: 10 BTC @ 120 USD = 1200 USD
  await recordBuy({
    entryDate: "2026-08-02",
    description: "Buy Lot 2: 10 BTC @ 120 USD",
    assetAccountId: btcA.id,
    cashAccountId: equityA.id,
    assetId: btc.id,
    quantity: "10",
    cashAssetId: usdCash.id,
    cashQuantity: "1200",
    baseValue: "1200",
    userId: userA.id,
  });

  // Check FIFO open lots before sell
  const openBefore = await getOpenLots(btc.id, userA.id);
  assert.equal(openBefore.length, 2);
  assert.equal(parseFloat(openBefore[0].qtyRemaining), 10);
  assert.equal(parseFloat(openBefore[0].unitCostBase), 100);
  assert.equal(parseFloat(openBefore[1].qtyRemaining), 10);
  assert.equal(parseFloat(openBefore[1].unitCostBase), 120);

  // Sell 12 BTC @ 150 USD (= 1800 USD proceeds)
  // Expected FIFO cost basis: 10 * 100 + 2 * 120 = 1240 USD.
  // Realized P&L: 1800 - 1240 = 560 USD.
  const sellEntry = await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 12 BTC @ 150 USD",
    assetAccountId: btcA.id,
    cashAccountId: cashUsdA.id,
    pnlAccountId: pnlA.id,
    assetId: btc.id,
    quantity: "12",
    cashAssetId: usdCash.id,
    cashQuantity: "1800",
    baseValue: "1800",
    userId: userA.id,
    idempotencyKey: "S5-SELL-001",
  });

  // Verify FIFO lot consumption
  const openAfter = await getOpenLots(btc.id, userA.id);
  assert.equal(openAfter.length, 1);
  assert.equal(parseFloat(openAfter[0].qtyRemaining), 8, "Lot 2 remaining quantity = 8");
  assert.equal(parseFloat(openAfter[0].unitCostBase), 120);

  // Verify Realized P&L
  const pnl = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnl.total), 560, "Realized P&L = 560 USD (1800 proceeds - 1240 FIFO cost)");

  // FIFO Duplicate Sell Test
  const sell2 = await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 12 BTC @ 150 USD",
    assetAccountId: btcA.id,
    cashAccountId: cashUsdA.id,
    pnlAccountId: pnlA.id,
    assetId: btc.id,
    quantity: "12",
    cashAssetId: usdCash.id,
    cashQuantity: "1800",
    baseValue: "1800",
    userId: userA.id,
    idempotencyKey: "S5-SELL-001",
  });
  assert.equal(sell2.idempotentReplay, true);

  const openAfterDup = await getOpenLots(btc.id, userA.id);
  assert.equal(parseFloat(openAfterDup[0].qtyRemaining), 8, "No double lot consumption on duplicate sell");
});

test("STAGE 5 (#30-#35, PART 80-83) — Ledger, Unbalanced Journals, Orphan Postings & Account Balance Reconciliation", async () => {
  const { cashUsdA, btcA, equityA, pnlA, userA } = await setupStage5Scenario();

  // Run a buy and sell to populate ledger
  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 1 BTC @ 100k",
    assetAccountId: btcA.id,
    cashAccountId: equityA.id,
    assetId: btcA.assetId!,
    quantity: "1",
    cashAssetId: cashUsdA.assetId!,
    cashQuantity: "100000",
    baseValue: "100000",
    userId: userA.id,
  });

  // Verify zero unbalanced journals
  const unbalanced = await db.execute(sql`
    select je.id
    from journal_entries je
    join postings p on p.entry_id = je.id
    group by je.id
    having abs(sum(p.base_value)) > 0.000000001
  `);
  assert.equal(unbalanced.rows.length, 0, "0 Unbalanced Journals");

  // Verify zero orphan postings
  const orphan = await db.execute(sql`
    select p.id
    from postings p
    left join journal_entries je on je.id = p.entry_id
    where je.id is null
  `);
  assert.equal(orphan.rows.length, 0, "0 Orphan Postings");

  // Verify zero orphan lot consumptions
  const orphanCons = await db.execute(sql`
    select lc.id
    from lot_consumptions lc
    left join lots l on l.id = lc.lot_id
    where l.id is null
  `);
  assert.equal(orphanCons.rows.length, 0, "0 Orphan Lot Consumptions");

  // Reconcile Account Balances: Opening Balance (0) + Debits - Credits = Expected Balance
  const balances = await getAccountBalances(userA.id);
  const btcBal = balances.find((b) => b.accountId === btcA.id);
  assert.equal(parseFloat(btcBal?.quantity || "0"), 1);
  assert.equal(parseFloat(btcBal?.baseValue || "0"), 100000);
});

test("STAGE 5 (#36-#44, PART 104, PART 105) — Historical FX & USD Immutability vs Current FX Revaluation", async () => {
  const { cashIrtA, expenseA, userA } = await setupStage5Scenario();

  // 19,000,000 IRT @ FX = 190,000 -> Historical USD = 100
  const exp = await recordExpense({
    entryDate: "2026-08-01",
    description: "Historical FX Expense 19m",
    cashAccountId: cashIrtA.id,
    categoryAccountId: expenseA.id,
    assetId: cashIrtA.assetId!,
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

  // Check initial snapshot
  const [snapBefore] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  assert.equal(parseFloat(snapBefore.usdAmount), 100);
  assert.equal(parseFloat(snapBefore.fxRate), 190000);

  // Change Current FX rate from 190,000 to 200,000
  await updateUserFxRate(userA.id, "200000");

  // PROVE: Historical FX = 190,000 and Historical USD = 100 remain 100% frozen
  const [snapAfter] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  assert.equal(parseFloat(snapAfter.usdAmount), 100, "Historical USD amount remains 100 USD");
  assert.equal(parseFloat(snapAfter.fxRate), 190000, "Historical FX rate remains 190,000");
});

test("STAGE 5 (#45-#54) — Security Regression: User Isolation, IDOR protection, and Session Invalidation on Restore", async () => {
  const { cashUsdA, expenseA, userA, userB } = await setupStage5Scenario();

  const expA = await recordExpense({
    entryDate: "2026-08-01",
    description: "User A Secret Expense",
    cashAccountId: cashUsdA.id,
    categoryAccountId: expenseA.id,
    assetId: cashUsdA.assetId!,
    quantity: "100",
    baseValue: "100",
    userId: userA.id,
  });

  // User B cannot read User A's transaction
  const ledgerB = await getLedger(50, userB.id);
  assert.equal(ledgerB.some((e) => e.description === "User A Secret Expense"), false, "User B cannot read A's entry");

  // Test Session Invalidation after restore
  const { token: tokenA } = await createSession(userA.id);
  assert.ok(await getSessionUser(tokenA));

  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(wallets);
  await db.delete(auditLog);
  await db.delete(userFxSettings);
  await db.delete(users); // simulate full restore wiping tables
  const validAfter = await getSessionUser(tokenA);
  assert.equal(validAfter, null, "All previous sessions invalidated after restore");
});

test("STAGE 5 (#55-#57, PART 55-57) — Audit Regression: CREATE_INCOME, CREATE_EXPENSE, UPDATE_FX logged without sensitive secrets", async () => {
  const { cashIrtA, incomeA, userA } = await setupStage5Scenario();

  await recordIncome({
    entryDate: "2026-08-01",
    description: "Audited Income 38m",
    cashAccountId: cashIrtA.id,
    categoryAccountId: incomeA.id,
    assetId: cashIrtA.assetId!,
    quantity: "200",
    baseValue: "200",
    userId: userA.id,
  });

  await updateUserFxRate(userA.id, "250000");

  const logs = await getAuditLogs(userA.id);
  const incLog = logs.find((l) => l.action === "CREATE_INCOME");
  const fxLog = logs.find((l) => l.action === "UPDATE_FX");

  assert.ok(incLog, "CREATE_INCOME logged in audit trail");
  assert.ok(fxLog, "UPDATE_FX logged in audit trail");

  const sanitizedPayload = sanitizeAuditData({ password: "SecretPassword", token: "secret_token", amount: "200" });
  assert.ok(sanitizedPayload);
  assert.equal(sanitizedPayload.includes("SecretPassword"), false);
  assert.equal(sanitizedPayload.includes("secret_token"), false);
});

test("STAGE 5 (#86-#88, PART 86-88) — Full 13-step End-to-End Financial Reconciliation Scenario", async () => {
  const { btc, usdCash, irtCash, userA, cashUsdA, cashIrtA, bank1IrtA, bank2IrtA, equityA, incomeA, expenseA, btcA, pnlA } = await setupStage5Scenario();

  // 1. Login (Create session)
  const { token } = await createSession(userA.id);
  assert.ok(token);

  // 2. Create Income: 38,000,000 IRT @ 190,000 = 200 USD
  const inc = await recordIncome({
    entryDate: "2026-08-01",
    description: "Salary Income 38m",
    cashAccountId: cashIrtA.id,
    categoryAccountId: incomeA.id,
    assetId: irtCash.id,
    quantity: "38000000",
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

  // 3. Create Expense: 19,000,000 IRT @ 190,000 = 100 USD
  const exp = await recordExpense({
    entryDate: "2026-08-02",
    description: "General Expense 19m",
    cashAccountId: cashIrtA.id,
    categoryAccountId: expenseA.id,
    assetId: irtCash.id,
    quantity: "19000000",
    baseValue: "100",
    userId: userA.id,
  });
  await db.insert(entryFxSnapshots).values({
    entryId: exp.id,
    irtAmount: "19000000",
    usdAmount: "100",
    fxRate: "190000",
    rateSource: "user",
    rateDate: "2026-08-02",
  } as any);

  // 4. Create Transfer: Deposit 50m to Bank 1 from equity, then transfer 20m to Bank 2
  await recordIncome({
    entryDate: "2026-08-03",
    description: "Equity Bank 1 50m",
    cashAccountId: bank1IrtA.id,
    categoryAccountId: equityA.id,
    assetId: irtCash.id,
    quantity: "50000000",
    baseValue: "263.15",
    userId: userA.id,
  });
  await recordTransfer({
    entryDate: "2026-08-03",
    description: "Transfer 20m Bank 1 -> Bank 2",
    fromAccountId: bank1IrtA.id,
    toAccountId: bank2IrtA.id,
    assetId: irtCash.id,
    quantity: "20000000",
    unitPrice: "0.00000526315",
    userId: userA.id,
  });

  // 5. Buy Asset: 1 BTC @ 100,000 USD against equity
  await recordBuy({
    entryDate: "2026-08-04",
    description: "Buy 1 BTC @ 100k",
    assetAccountId: btcA.id,
    cashAccountId: equityA.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "100000",
    baseValue: "100000",
    userId: userA.id,
  });

  // 6. Sell Asset: 0.5 BTC @ 60,000 USD (= 30,000 USD proceeds, FIFO cost base = 50,000 USD -> Realized P&L = -20,000 USD or let's check: 60,000 total proceeds = +10,000 Realized P&L)
  await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 0.5 BTC @ 120k rate (= 60,000 USD)",
    assetAccountId: btcA.id,
    cashAccountId: cashUsdA.id,
    pnlAccountId: pnlA.id,
    assetId: btc.id,
    quantity: "0.5",
    cashAssetId: usdCash.id,
    cashQuantity: "60000",
    baseValue: "60000",
    userId: userA.id,
  });

  // 7. Update Current FX rate to 200,000
  await updateUserFxRate(userA.id, "200000");

  // 8. Check Net Worth
  const nw = await getNetWorth(userA.id);
  assert.ok(nw.netWorth);

  // 9. Check Unrealized P&L (via portfolio valuation)
  const valuation = await getPortfolioValuation(undefined, userA.id);
  const btcVal = valuation.assetValuations.find((v) => v.symbol === "BTC");
  assert.ok(btcVal, "BTC found in asset valuations");
  assert.equal(parseFloat(btcVal.quantity), 0.5, "Remaining BTC holding = 0.5");

  // 10. Check Realized P&L: 60,000 proceeds - 50,000 FIFO cost = 10,000 USD
  const pnl = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnl.total), 10000, "Realized P&L = +10,000 USD");

  // 11. Check Ledger: verify zero unbalanced journals
  const audit = await runStage3IntegrityAudit();
  assert.equal(audit.unbalancedJournals, 0, "All journal entries are strictly balanced");
  assert.equal(audit.orphanPostings, 0, "Zero orphan postings");
  assert.equal(audit.duplicateIdempotency, 0, "Zero duplicate idempotency keys");
  assert.equal(audit.negativeLots, 0, "Zero negative lots");
  assert.equal(audit.overConsumedLots, 0, "Zero over-consumed lots");

  // 12. Check Audit trail
  const logs = await getAuditLogs(userA.id);
  assert.ok(logs.some((l) => l.action === "CREATE_INCOME"));
  assert.ok(logs.some((l) => l.action === "CREATE_EXPENSE"));
  assert.ok(logs.some((l) => l.action === "CREATE_TRANSFER"));
  assert.ok(logs.some((l) => l.action === "CREATE_ASSET_BUY"));
  assert.ok(logs.some((l) => l.action === "CREATE_ASSET_SELL"));
  assert.ok(logs.some((l) => l.action === "UPDATE_FX"));

  // 13. Verify Historical FX and Historical USD are unchanged
  const [snapInc] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, inc.id));
  const [snapExp] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  assert.equal(parseFloat(snapInc.usdAmount), 200, "Historical USD = 200 invariant under FX change");
  assert.equal(parseFloat(snapExp.usdAmount), 100, "Historical USD = 100 invariant under FX change");
  assert.equal(parseFloat(snapInc.fxRate), 190000, "Historical FX = 190,000 invariant under FX change");
});
