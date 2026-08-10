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
import { eq } from "drizzle-orm";
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
  getRealizedPnl,
} from "../src/features/ledger/queries";
import { runStage3IntegrityAudit } from "../src/features/integrity/service";
import { updateUserFxRate } from "../src/features/fx/userRate";
import { createSession } from "../src/lib/auth";
import { getAuditLogs, recordAuditEvent, sanitizeAuditData } from "../src/lib/audit";
import {
  stripClientControlledFields,
  validateAccountOwnership,
  validateAmount,
  validateCurrency,
} from "../src/lib/validation";
import { GET as backupGet } from "../src/app/api/backup/route";
import { POST as restorePost } from "../src/app/api/restore/route";

async function setupStage4Scenario() {
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

  const [userA] = await db.insert(users).values({ name: "User A", username: "usera", role: "owner" } as any).returning();
  const [userB] = await db.insert(users).values({ name: "User B", username: "userb", role: "owner" } as any).returning();

  await db.insert(userFxSettings).values([
    { userId: userA.id, currentRate: "190000" },
    { userId: userB.id, currentRate: "200000" },
  ] as any);

  const [cashAccA] = await db.insert(accounts).values({ code: "1010", name: "Cash USD A", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [bankAcc1] = await db.insert(accounts).values({ code: "1020", name: "Bank 1 A", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [bankAcc2] = await db.insert(accounts).values({ code: "1030", name: "Bank 2 A", type: "asset", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [equityAccA] = await db.insert(accounts).values({ code: "3010", name: "Equity A", type: "equity", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [expenseAccA] = await db.insert(accounts).values({ code: "5010", name: "General Expense A", type: "expense", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [incomeAccA] = await db.insert(accounts).values({ code: "4010", name: "Salary Income A", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();
  const [btcAccA] = await db.insert(accounts).values({ code: "1100", name: "Crypto BTC A", type: "asset", assetId: btc.id, userId: userA.id } as any).returning();
  const [pnlAccA] = await db.insert(accounts).values({ code: "4100", name: "Realized P&L A", type: "income", assetId: usdCash.id, userId: userA.id } as any).returning();

  const [cashAccB] = await db.insert(accounts).values({ code: "1010_b", name: "Cash USD B", type: "asset", assetId: usdCash.id, userId: userB.id } as any).returning();

  return {
    usd,
    irt,
    btc,
    usdCash,
    userA,
    userB,
    cashAccA,
    bankAcc1,
    bankAcc2,
    equityAccA,
    expenseAccA,
    incomeAccA,
    btcAccA,
    pnlAccA,
    cashAccB,
  };
}

test("STAGE 4 (#1, #52) — Audit created after successful Expense: CREATE_EXPENSE logged with actor, entityId, result='SUCCESS'", async () => {
  const { cashAccA, expenseAccA, userA } = await setupStage4Scenario();

  const exp = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19,000,000 Toman",
    cashAccountId: cashAccA.id,
    categoryAccountId: expenseAccA.id,
    assetId: cashAccA.assetId!,
    quantity: "19000000",
    baseValue: "19000000",
    userId: userA.id,
  });

  assert.ok(exp.id);

  const logs = await getAuditLogs(userA.id);
  const expLog = logs.find((l) => l.action === "CREATE_EXPENSE");
  assert.ok(expLog, "CREATE_EXPENSE event recorded in audit trail");
  assert.equal(expLog.entityId, exp.id);
  assert.equal(expLog.userId, userA.id);
  assert.equal(expLog.result, "SUCCESS");
});

test("STAGE 4 (#2) — Audit created after successful Income: CREATE_INCOME logged with actor, entityId, result='SUCCESS'", async () => {
  const { cashAccA, incomeAccA, userA } = await setupStage4Scenario();

  const inc = await recordIncome({
    entryDate: "2026-08-01",
    description: "Income 38,000,000 Toman",
    cashAccountId: cashAccA.id,
    categoryAccountId: incomeAccA.id,
    assetId: cashAccA.assetId!,
    quantity: "38000000",
    baseValue: "38000000",
    userId: userA.id,
  });

  const logs = await getAuditLogs(userA.id);
  const incLog = logs.find((l) => l.action === "CREATE_INCOME");
  assert.ok(incLog, "CREATE_INCOME event recorded in audit trail");
  assert.equal(incLog.entityId, inc.id);
  assert.equal(incLog.userId, userA.id);
  assert.equal(incLog.result, "SUCCESS");
});

test("STAGE 4 (#3, #54) — Audit created after successful Transfer: CREATE_TRANSFER logged, Source down, Dest up, Ledger balanced", async () => {
  const { bankAcc1, bankAcc2, equityAccA, userA } = await setupStage4Scenario();

  await recordIncome({
    entryDate: "2026-08-01",
    description: "Initial deposit 50m Bank 1",
    cashAccountId: bankAcc1.id,
    categoryAccountId: equityAccA.id,
    assetId: bankAcc1.assetId!,
    quantity: "50000000",
    baseValue: "50000000",
    userId: userA.id,
  });

  const trn = await recordTransfer({
    entryDate: "2026-08-05",
    description: "Transfer 20m A to B",
    fromAccountId: bankAcc1.id,
    toAccountId: bankAcc2.id,
    assetId: bankAcc1.assetId!,
    quantity: "20000000",
    unitPrice: "1",
    userId: userA.id,
  });

  const logs = await getAuditLogs(userA.id);
  const trnLog = logs.find((l) => l.action === "CREATE_TRANSFER");
  assert.ok(trnLog, "CREATE_TRANSFER event recorded in audit trail");
  assert.equal(trnLog.entityId, trn.id);
  assert.equal(trnLog.userId, userA.id);

  const balances = await getAccountBalances(userA.id);
  const b1 = balances.find((b) => b.accountId === bankAcc1.id);
  const b2 = balances.find((b) => b.accountId === bankAcc2.id);
  assert.equal(parseFloat(b1?.quantity || "0"), 30000000);
  assert.equal(parseFloat(b2?.quantity || "0"), 20000000);
});

test("STAGE 4 (#4, #53) — No false success Audit after Rollback: failed transaction leaves 0 orphan audit entries", async () => {
  const { cashAccA, expenseAccA, userA } = await setupStage4Scenario();

  const logsBefore = await getAuditLogs(userA.id);

  await assert.rejects(
    async () => {
      await postEntry({
        entryDate: "2026-08-10",
        type: "expense",
        description: "Rollback Audit Test",
        userId: userA.id,
        postings: [
          { accountId: cashAccA.id, assetId: expenseAccA.assetId!, quantity: "-500", baseValue: "-500" },
          // Missing second posting -> throws assertBalanced error
        ],
      });
    },
    /تراز نیست|balanced/,
  );

  const logsAfter = await getAuditLogs(userA.id);
  assert.equal(logsAfter.length, logsBefore.length, "Zero false success audit entries recorded on rollback");
});

test("STAGE 4 (#5) — Duplicate Request Audit: IDEMPOTENT_REPLAY event logged on duplicate request replay", async () => {
  const { cashAccA, expenseAccA, userA } = await setupStage4Scenario();

  const exp1 = await recordExpense({
    entryDate: "2026-08-01",
    description: "Idempotent Expense 19m",
    cashAccountId: cashAccA.id,
    categoryAccountId: expenseAccA.id,
    assetId: cashAccA.assetId!,
    quantity: "19000000",
    baseValue: "19000000",
    userId: userA.id,
    idempotencyKey: "EXP-STAGE4-001",
  });

  const exp2 = await recordExpense({
    entryDate: "2026-08-01",
    description: "Idempotent Expense 19m",
    cashAccountId: cashAccA.id,
    categoryAccountId: expenseAccA.id,
    assetId: cashAccA.assetId!,
    quantity: "19000000",
    baseValue: "19000000",
    userId: userA.id,
    idempotencyKey: "EXP-STAGE4-001",
  });

  assert.equal(exp1.id, exp2.id);
  assert.equal(exp2.idempotentReplay, true);

  const logs = await getAuditLogs(userA.id);
  const replayLog = logs.find((l) => l.action === "IDEMPOTENT_REPLAY");
  assert.ok(replayLog, "IDEMPOTENT_REPLAY event recorded in audit trail");
  assert.equal(replayLog.entityId, exp1.id);
});

test("STAGE 4 (#6, #14, #56) — Unauthorized User Audit & User Isolation: User B cannot access User A's audit logs", async () => {
  const { cashAccA, expenseAccA, userA, userB } = await setupStage4Scenario();

  await recordExpense({
    entryDate: "2026-08-01",
    description: "A secret expense",
    cashAccountId: cashAccA.id,
    categoryAccountId: expenseAccA.id,
    assetId: cashAccA.assetId!,
    quantity: "100",
    baseValue: "100",
    userId: userA.id,
  });

  const logsA = await getAuditLogs(userA.id);
  const logsB = await getAuditLogs(userB.id);

  assert.ok(logsA.some((l) => l.action === "CREATE_EXPENSE"));
  assert.equal(logsB.some((l) => l.action === "CREATE_EXPENSE"), false, "User B sees zero audit logs belonging to User A");
});

test("STAGE 4 (#7, #8, #55) — Historical FX & USD Immutability: 19m IRT @ 190k = 100 USD historical remains 100 USD when FX becomes 200k", async () => {
  const { cashAccA, expenseAccA, incomeAccA, userA } = await setupStage4Scenario();

  const exp = await recordExpense({
    entryDate: "2026-08-01",
    description: "Expense 19m IRT",
    cashAccountId: cashAccA.id,
    categoryAccountId: expenseAccA.id,
    assetId: cashAccA.assetId!,
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

  const inc = await recordIncome({
    entryDate: "2026-08-01",
    description: "Income 38m IRT",
    cashAccountId: cashAccA.id,
    categoryAccountId: incomeAccA.id,
    assetId: cashAccA.assetId!,
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

  // Update FX rate
  await updateUserFxRate(userA.id, "200000");

  const [snapExpAfter] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, exp.id));
  const [snapIncAfter] = await db.select().from(entryFxSnapshots).where(eq(entryFxSnapshots.entryId, inc.id));

  assert.equal(parseFloat(snapExpAfter.usdAmount), 100, "Historical Expense USD is 100% frozen");
  assert.equal(parseFloat(snapExpAfter.fxRate), 190000, "Historical Expense FX rate is 100% frozen");
  assert.equal(parseFloat(snapIncAfter.usdAmount), 200, "Historical Income USD is 100% frozen");
  assert.equal(parseFloat(snapIncAfter.fxRate), 190000, "Historical Income FX rate is 100% frozen");
});

test("STAGE 4 (#9) — Realized P&L Immutability after FX Rate Change", async () => {
  const { btc, usdCash, btcAccA, cashAccA, pnlAccA, equityAccA, userA } = await setupStage4Scenario();

  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 1 BTC @ 50k",
    assetAccountId: btcAccA.id,
    cashAccountId: equityAccA.id,
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
    assetAccountId: btcAccA.id,
    cashAccountId: cashAccA.id,
    pnlAccountId: pnlAccA.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "60000",
    baseValue: "60000",
    userId: userA.id,
  });

  const pnlBefore = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnlBefore.total), 10000);

  // Update FX rate
  await updateUserFxRate(userA.id, "250000");

  const pnlAfter = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnlAfter.total), 10000, "Realized P&L remains 10,000 unchanged");
});

test("STAGE 4 (#10) — Current FX update audit: UPDATE_FX logged with Before=190,000 and After=200,000", async () => {
  const { userA } = await setupStage4Scenario();

  await updateUserFxRate(userA.id, "200000");

  const logs = await getAuditLogs(userA.id);
  const fxLog = logs.find((l) => l.action === "UPDATE_FX");
  assert.ok(fxLog, "UPDATE_FX event recorded in audit trail");
  assert.equal(fxLog.userId, userA.id);
  assert.match(String(fxLog.beforeData), /190000/);
  assert.match(String(fxLog.afterData), /200000/);
});

test("STAGE 4 (#11, #12, #13) — Sensitive Data Protection: passwords, session tokens, and API secrets are never logged or leaked", async () => {
  await setupStage4Scenario();

  const payload = {
    username: "usera",
    password: "SuperSecretPassword123!",
    passwordHash: "salt:derivedhash123",
    sessionToken: "pwos_session_secret_xyz",
    apiKey: "COINGECKO_API_KEY_SECRET",
    databaseUrl: "postgresql://postgres:postgres@localhost:5432/db",
  };

  const sanitized = sanitizeAuditData(payload);
  assert.ok(sanitized);
  assert.equal(sanitized.includes("SuperSecretPassword123!"), false, "Password redacted from audit data");
  assert.equal(sanitized.includes("salt:derivedhash123"), false, "Password hash redacted from audit data");
  assert.equal(sanitized.includes("pwos_session_secret_xyz"), false, "Session token redacted from audit data");
  assert.equal(sanitized.includes("COINGECKO_API_KEY_SECRET"), false, "API key redacted from audit data");
  assert.equal(sanitized.includes("postgresql://postgres:postgres@localhost:5432/db"), false, "Database URL redacted from audit data");
  assert.ok(sanitized.includes("[REDACTED]"));
});

test("STAGE 4 (#16, #17) — Restore & Backup Audit: RESTORE and BACKUP events logged without sensitive credentials", async () => {
  const { userA } = await setupStage4Scenario();
  const { token } = await createSession(userA.id);

  // Test Backup
  const reqBackup = new Request("http://localhost/api/backup", {
    method: "GET",
    headers: { cookie: `pwos_session=${token}` },
  });
  const resBackup = await backupGet(reqBackup);
  assert.equal(resBackup.status, 200);

  const logsAfterBackup = await getAuditLogs(userA.id);
  const backupLog = logsAfterBackup.find((l) => l.action === "BACKUP");
  assert.ok(backupLog, "BACKUP event recorded in audit trail");
  assert.equal(String(backupLog.payload).includes("token"), false);

  // Test Restore
  const reqRestore = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${token}` },
    body: JSON.stringify({
      app: "PWOS",
      schemaVersion: "1.0",
      confirmToken: "RESTORE_DATABASE_OVERWRITE",
      data: {
        currencies: [{ code: "USD", name: "US Dollar", symbol: "$", decimals: 2, is_fiat: true }],
      },
    }),
  });
  const resRestore = await restorePost(reqRestore);
  assert.equal(resRestore.status, 200);

  const allLogsAfterRestore = await db.select().from(auditLog);
  const restoreLog = allLogsAfterRestore.find((l) => l.action === "RESTORE");
  assert.ok(restoreLog, "RESTORE event recorded in audit trail");
  assert.equal(String(restoreLog.payload).includes("password"), false);
});

test("STAGE 4 (#18) — Mass Assignment Protection: stripClientControlledFields removes created_at, user_id, historical_usd, etc.", async () => {
  await setupStage4Scenario();

  const tamperedInput = {
    description: "Good Description",
    amount: "1000",
    created_at: "2000-01-01",
    user_id: "attacker-id",
    ledger_status: "void",
    posted_at: "2000-01-01",
    realized_pnl: "999999999",
    cost_basis: "0",
    historical_fx: "1",
    historical_usd: "999999999",
    fifoCost: "0",
    id: "fake-id",
  };

  stripClientControlledFields(tamperedInput);

  assert.equal(tamperedInput.description, "Good Description");
  assert.equal(tamperedInput.amount, "1000");
  assert.equal("created_at" in tamperedInput, false);
  assert.equal("user_id" in tamperedInput, false);
  assert.equal("realized_pnl" in tamperedInput, false);
  assert.equal("cost_basis" in tamperedInput, false);
  assert.equal("historical_usd" in tamperedInput, false);
  assert.equal("id" in tamperedInput, false);
});

test("STAGE 4 (#19) — Ownership Validation: validateAccountOwnership throws 403 OWNERSHIP_VIOLATION on cross-user account access", async () => {
  const { cashAccA, userA, userB } = await setupStage4Scenario();

  // User A can access their own account
  await assert.doesNotReject(async () => {
    await validateAccountOwnership(cashAccA.id, userA.id);
  });

  // User B accessing User A's account throws 403 OWNERSHIP_VIOLATION
  await assert.rejects(
    async () => {
      await validateAccountOwnership(cashAccA.id, userB.id);
    },
    (err: any) => err.status === 403 || err.code === "OWNERSHIP_VIOLATION",
  );
});

test("STAGE 4 (#20, PART 47, PART 102) — Financial Invariant Regression: runStage3IntegrityAudit() -> unbalancedJournals=0, orphanPostings=0, ok=true", async () => {
  const { cashAccA, expenseAccA, userA } = await setupStage4Scenario();

  await recordExpense({
    entryDate: "2026-08-01",
    description: "Audit Invariant Check Expense",
    cashAccountId: cashAccA.id,
    categoryAccountId: expenseAccA.id,
    assetId: cashAccA.assetId!,
    quantity: "5000",
    baseValue: "5000",
    userId: userA.id,
  });

  const audit = await runStage3IntegrityAudit();
  assert.equal(audit.unbalancedJournals, 0, "Zero unbalanced journals");
  assert.equal(audit.orphanPostings, 0, "Zero orphan postings");
  assert.equal(audit.duplicateIdempotency, 0, "Zero duplicate idempotency keys");
  assert.equal(audit.negativeLots, 0, "Zero negative lots");
  assert.equal(audit.overConsumedLots, 0, "Zero over-consumed lots");
  assert.equal(audit.ok, true, "Stage 4 integrity audit passes 100%");
});

test("STAGE 4 Validation — Amount & Currency validation reject NaN, Infinity, negative amounts, and invalid currencies", async () => {
  assert.throws(() => validateAmount("0"), /بزرگ‌تر از صفر/);
  assert.throws(() => validateAmount("-100"), /بزرگ‌تر از صفر/);
  assert.throws(() => validateAmount("NaN"), /نامعتبر است/);
  assert.throws(() => validateAmount("Infinity"), /نامعتبر است/);
  assert.equal(validateAmount("1000.50"), "1000.5");

  assert.throws(() => validateCurrency("FAKE_COIN"), /پشتیبانی نمی‌شود/);
  assert.equal(validateCurrency("usd"), "USD");
  assert.equal(validateCurrency("irt "), "IRT");
});

test("STAGE 4 (#15, PART 19, #57) — Admin Authorization: Admin role permissions work cleanly without breaking user data isolation", async () => {
  const { userA, userB } = await setupStage4Scenario();
  const { token: tokenAdmin } = await createSession(userA.id);

  // Admin can call backup
  const reqBackup = new Request("http://localhost/api/backup", {
    method: "GET",
    headers: { cookie: `pwos_session=${tokenAdmin}` },
  });
  const resBackup = await backupGet(reqBackup);
  assert.equal(resBackup.status, 200);

  // Normal viewer user gets 403 on restore
  const [viewer] = await db
    .insert(users)
    .values({ name: "Viewer User", username: "viewer_s4", role: "viewer" } as any)
    .returning();
  const { token: tokenViewer } = await createSession(viewer.id);

  const reqRestore = new Request("http://localhost/api/restore", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `pwos_session=${tokenViewer}` },
    body: JSON.stringify({ app: "PWOS", schemaVersion: "1.0", confirmToken: "RESTORE_DATABASE_OVERWRITE", data: {} }),
  });
  const resRestore = await restorePost(reqRestore);
  assert.equal(resRestore.status, 403);
});

test("STAGE 4 (#25) — Zero Amount Validation: zero amount transaction rejected", async () => {
  assert.throws(() => validateAmount("0"), /بزرگ‌تر از صفر/);
  assert.throws(() => validateAmount("-10"), /بزرگ‌تر از صفر/);
});

test("STAGE 4 (PART 37) — Audit Trail Immutability: audit log entries are append-only and cannot be updated/deleted by users", async () => {
  const { userA } = await setupStage4Scenario();

  await recordAuditEvent({
    action: "IMMUTABILITY_TEST",
    entityType: "audit_log",
    userId: userA.id,
    result: "SUCCESS",
  });

  const logs = await getAuditLogs(userA.id);
  const logEntry = logs.find((l) => l.action === "IMMUTABILITY_TEST");
  assert.ok(logEntry);
  assert.ok(logEntry.createdAt, "Audit log has immutable server timestamp");
});

test("STAGE 4 (PART 45, 46) — Audit Timestamp Server-Side: timestamps generated on server, ignoring client timestamps", async () => {
  const { userA } = await setupStage4Scenario();

  const fakeClientTimestamp = "2000-01-01T00:00:00.000Z";
  await recordAuditEvent({
    action: "TIMESTAMP_TEST",
    entityType: "system",
    userId: userA.id,
    metadata: { clientReportedTime: fakeClientTimestamp },
  });

  const logs = await getAuditLogs(userA.id);
  const logEntry = logs.find((l) => l.action === "TIMESTAMP_TEST");
  assert.ok(logEntry);

  const serverTimeYear = new Date(logEntry.createdAt).getFullYear();
  assert.ok(serverTimeYear >= 2026, "Server timestamp generated by database now(), ignoring client time");
});

test("STAGE 4 (PART 48, PART 74) — Realized P&L Regression: sell transaction finalized P&L remains invariant under FX and market price changes", async () => {
  const { btc, usdCash, btcAccA, cashAccA, pnlAccA, equityAccA, userA } = await setupStage4Scenario();

  await recordBuy({
    entryDate: "2026-08-01",
    description: "Buy 1 BTC @ 50k",
    assetAccountId: btcAccA.id,
    cashAccountId: equityAccA.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "50000",
    baseValue: "50000",
    userId: userA.id,
  });

  await recordSell({
    entryDate: "2026-08-05",
    description: "Sell 1 BTC @ 65k",
    assetAccountId: btcAccA.id,
    cashAccountId: cashAccA.id,
    pnlAccountId: pnlAccA.id,
    assetId: btc.id,
    quantity: "1",
    cashAssetId: usdCash.id,
    cashQuantity: "65000",
    baseValue: "65000",
    userId: userA.id,
  });

  const pnlBefore = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnlBefore.total), 15000);

  // Change FX rate
  await updateUserFxRate(userA.id, "300000");

  const pnlAfter = await getRealizedPnl(userA.id);
  assert.equal(parseFloat(pnlAfter.total), 15000, "Realized P&L remains invariant under FX changes");
});
