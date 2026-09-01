/**
 * Installment FX freeze — the pending/paid business rule.
 *
 *   PENDING → Toman FROZEN, USD equivalent DYNAMIC (÷ current rate)
 *   PAID    → Toman FROZEN, USD equivalent FROZEN (payment snapshot)
 *
 * Pins:
 *   - creation stores the original FX snapshot (rate + captured_at + USD);
 *   - an FX change never mutates amount_toman (Invariant 1);
 *   - a pending row's USD equivalent follows the current rate (Invariant 2);
 *   - paying freezes paid_toman / paid_fx_rate / paid_usd atomically;
 *   - later FX changes never rewrite those paid values (Invariants 3-5);
 *   - the reduction/increase insight is computed from original vs current USD;
 *   - tenant isolation of schedules, rates and paid snapshots (Invariant 6).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  buildInstallmentFxView,
  buildInstallmentPaymentSnapshot,
  computeUsdEquivalentChange,
  summarizePendingUsdChange,
} from "../src/features/planning/installmentFx";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any;
let debts: any, installments: any, users: any, userFxSettings: any;
let accounts: any, assets: any, assetClasses: any, currencies: any;
let journalEntries: any, postings: any, entryFxSnapshots: any, lots: any, lotConsumptions: any;
let createSession: any, createDebtAction: any;
let listInstallmentSchedule: any, payInstallment: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({
    debts,
    installments,
    users,
    userFxSettings,
    accounts,
    assets,
    assetClasses,
    currencies,
    journalEntries,
    postings,
    entryFxSnapshots,
    lots,
    lotConsumptions,
  } = await import("../src/db/schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction } = await import("../src/app/actions"));
  ({ listInstallmentSchedule, payInstallment } = await import("../src/features/planning/service"));
}
const modulesReady = loadModules();

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);
}

async function makeUser(name: string, rate: string) {
  const [user] = await db
    .insert(users)
    .values({ name, username: name.toLowerCase().replace(/\s+/g, "-"), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: rate } as any);
  return user;
}

async function setRate(userId: string, rate: string) {
  await db.update(userFxSettings).set({ currentRate: rate }).where(eq(userFxSettings.userId, userId));
}

function debtFormData(principal: string, count: string, installment: string, firstDue = "2026-09-01") {
  const fd = new FormData();
  fd.set("title", "بدهی تست");
  fd.set("creditor", "بستانکار تست");
  fd.set("principalIrt", principal);
  fd.set("interestRate", "0");
  fd.set("startDate", "2026-08-01");
  fd.set("installmentCount", count);
  fd.set("installmentIrt", installment);
  fd.set("firstDueDate", firstDue);
  return fd;
}

/** Minimal chart of accounts so the existing payInstallment path can post. */
async function makeLedgerAccounts(userId: string, codeSuffix: string) {
  const [usd] = await db
    .insert(currencies)
    .values({ code: `USD${codeSuffix}`, name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: `cash${codeSuffix}`, name: "Cash", valuationMethod: "fifo" } as any)
    .returning();
  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: `USD_CASH${codeSuffix}`, name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any)
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ code: `1010${codeSuffix}`, name: "Cash", type: "asset", assetId: usdCash.id, userId } as any)
    .returning();
  const [liability] = await db
    .insert(accounts)
    .values({ code: `2010${codeSuffix}`, name: "Loan", type: "liability", assetId: usdCash.id, userId } as any)
    .returning();
  return { cash, liability };
}

/* ------------------------------------------------------------------ */
/* Pure rule tests (no database)                                        */
/* ------------------------------------------------------------------ */

test("§36 pending — Toman frozen, USD equivalent follows the current rate", async () => {
  await modulesReady;
  const row = {
    status: "pending",
    amountToman: "30000000",
    amountUsdCreated: D("30000000").div("210000").toString(),
    originalFxRate: "210000",
    originalFxRateCapturedAt: new Date("2026-08-01T00:00:00Z"),
  };

  const atOriginal = buildInstallmentFxView(row, "210000");
  assert.equal(atOriginal.amountToman, "30000000");
  assert.ok(D(atOriginal.originalUsdEquivalent!).sub("142.857142857142857142").abs().lt("0.0001"));
  assert.ok(D(atOriginal.currentUsdEquivalent!).sub(atOriginal.originalUsdEquivalent!).abs().lt("0.0001"));
  assert.equal(atOriginal.usdChange!.direction, "unchanged");

  const atNewRate = buildInstallmentFxView(row, "250000");
  assert.equal(atNewRate.amountToman, "30000000", "Toman MUST NOT move with FX");
  assert.ok(D(atNewRate.currentUsdEquivalent!).sub("120").abs().lt("0.0001"));
  // Original snapshot is untouched by the new rate.
  assert.ok(D(atNewRate.originalUsdEquivalent!).sub("142.857142857142857142").abs().lt("0.0001"));
  assert.equal(atNewRate.usdChange!.direction, "decrease");
  assert.ok(D(atNewRate.usdChange!.amountUsd).sub("22.857142857142857142").abs().lt("0.0001"));
  assert.ok(D(atNewRate.usdChange!.percent).sub("16").abs().lt("0.01"));
});

test("§39/§40 pending — rate decrease reads as increase; equal rates read as unchanged", async () => {
  await modulesReady;
  const row = {
    status: "pending",
    amountToman: "30000000",
    amountUsdCreated: D("30000000").div("210000").toString(),
    originalFxRate: "210000",
  };
  const cheaper = buildInstallmentFxView(row, "180000");
  assert.equal(cheaper.amountToman, "30000000");
  assert.ok(D(cheaper.currentUsdEquivalent!).sub("166.666666666666666666").abs().lt("0.0001"));
  assert.equal(cheaper.usdChange!.direction, "increase");

  const same = buildInstallmentFxView(row, "210000");
  assert.equal(same.usdChange!.direction, "unchanged");
  assert.equal(same.usdChange!.amountUsd, "0");
  assert.equal(computeUsdEquivalentChange(null, "120"), null);
});

test("§37 paid — payment snapshot is immutable across any future rate", async () => {
  await modulesReady;
  const snapshot = buildInstallmentPaymentSnapshot({ paidToman: "30000000", fxRate: "220000" });
  assert.equal(snapshot.paidToman, "30000000");
  assert.equal(snapshot.paidFxRate, "220000");
  assert.ok(D(snapshot.paidUsd).sub("136.363636363636363636").abs().lt("0.0001"));

  const row = {
    status: "paid",
    amountToman: "30000000",
    amountUsdCreated: D("30000000").div("210000").toString(),
    originalFxRate: "210000",
    paidToman: snapshot.paidToman,
    paidUsd: snapshot.paidUsd,
    paidFxRate: snapshot.paidFxRate,
    paidAt: "2026-09-01",
  };
  for (const currentRate of ["250000", "300000", "350000"]) {
    const view = buildInstallmentFxView(row, currentRate);
    assert.equal(view.isPaid, true);
    assert.equal(view.amountToman, "30000000");
    assert.equal(view.currentUsdEquivalent, null, "a paid row exposes NO current-rate equivalent");
    assert.ok(D(view.displayUsd!).sub("136.363636363636363636").abs().lt("0.0001"), `rate ${currentRate}`);
    assert.equal(view.usdChange, null, "the insight never runs on a paid row");
  }
  // A missing rate must never be silently treated as a valid payment rate.
  assert.throws(() => buildInstallmentPaymentSnapshot({ paidToman: "30000000", fxRate: "0" }), /نرخ/);
});

test("insight aggregate — only pending rows contribute", async () => {
  await modulesReady;
  const pending = buildInstallmentFxView(
    { status: "pending", amountToman: "30000000", amountUsdCreated: D("30000000").div("210000").toString() },
    "250000",
  );
  const paid = buildInstallmentFxView(
    {
      status: "paid",
      amountToman: "30000000",
      amountUsdCreated: D("30000000").div("210000").toString(),
      paidToman: "30000000",
      paidUsd: "120",
      paidFxRate: "250000",
    },
    "300000",
  );
  const insight = summarizePendingUsdChange([pending, paid])!;
  assert.equal(insight.count, 1);
  assert.equal(insight.direction, "decrease");
  assert.ok(D(insight.percent).sub("16").abs().lt("0.01"));
  assert.equal(summarizePendingUsdChange([paid]), null);
});

/* ------------------------------------------------------------------ */
/* Integration — creation, schedule, payment                            */
/* ------------------------------------------------------------------ */

test("§38 create → pending schedule → pay → freeze (end to end)", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("FreezeOwner", "210000");
  const { cash, liability } = await makeLedgerAccounts(user.id, "F");
  const { token } = await createSession(user.id);
  cookieJar.value = token;
  const created = await createDebtAction(null, debtFormData("30000000", "1", "30000000"));
  assert.equal(created.ok, true, created.message);
  cookieJar.value = null;

  // Creation-time FX snapshot is persisted.
  const [instRow] = await db.select().from(installments);
  assert.ok(D(instRow.amountToman).sub("30000000").isZero());
  assert.ok(D(instRow.originalFxRate).sub("210000").isZero());
  assert.ok(instRow.originalFxRateCapturedAt != null, "original_fx_rate_captured_at must be set");
  assert.ok(D(instRow.amountUsdCreated).sub(D("30000000").div("210000")).abs().lt("0.0001"));

  // Rate moves 210k → 250k BEFORE payment: Toman frozen, USD equivalent moves.
  await setRate(user.id, "250000");
  const pendingSchedule = await listInstallmentSchedule(user.id);
  assert.equal(pendingSchedule.rows.length, 1);
  const pendingView = pendingSchedule.rows[0].fx;
  assert.equal(pendingView.amountToman, "30000000");
  assert.ok(D(pendingView.currentUsdEquivalent!).sub("120").abs().lt("0.0001"));
  assert.equal(pendingSchedule.pendingUsdInsight.direction, "decrease");
  assert.ok(D(pendingSchedule.pendingUsdInsight.percent).sub("16").abs().lt("0.01"));

  // Pay at 250,000 through the existing atomic payment path.
  await db.update(debts).set({ accountId: liability.id }).where(eq(debts.userId, user.id));
  const entry = await payInstallment(instRow.id, cash.id, user.id);
  assert.ok(entry.id);

  const [afterPay] = await db.select().from(installments).where(eq(installments.id, instRow.id));
  assert.equal(afterPay.status, "paid");
  assert.ok(D(afterPay.paidToman).sub("30000000").isZero(), "paid_toman frozen");
  assert.ok(D(afterPay.paidFxRate).sub("250000").isZero(), "payment_fx_rate frozen");
  assert.ok(D(afterPay.paidUsd).sub("120").abs().lt("0.0001"), "paid_usd frozen");
  assert.ok(afterPay.paidAt != null);
  assert.ok(afterPay.paidUsd != null, "a PAID row can never carry a NULL USD snapshot");

  // Every later rate leaves the historical values untouched.
  for (const rate of ["300000", "350000", "180000"]) {
    await setRate(user.id, rate);
    const schedule = await listInstallmentSchedule(user.id);
    const view = schedule.rows[0].fx;
    assert.equal(view.isPaid, true);
    assert.equal(view.amountToman, "30000000");
    assert.ok(D(view.displayUsd!).sub("120").abs().lt("0.0001"), `paid USD drifted at rate ${rate}`);
    assert.equal(view.currentUsdEquivalent, null);
    assert.equal(schedule.pendingUsdInsight, null);
    const [dbRow] = await db.select().from(installments).where(eq(installments.id, instRow.id));
    assert.ok(D(dbRow.amountToman).sub("30000000").isZero(), "amount_toman rewritten by FX!");
    assert.ok(D(dbRow.paidUsd).sub("120").abs().lt("0.0001"), "paid_usd rewritten by FX!");
    assert.ok(D(dbRow.paidFxRate).sub("250000").isZero(), "paid_fx_rate rewritten by FX!");
  }
});

test("§41 multi-user — schedules, rates and paid snapshots stay isolated", async () => {
  await modulesReady;
  await clean();
  const userA = await makeUser("IsoA", "210000");
  const userB = await makeUser("IsoB", "210000");
  const ledgerA = await makeLedgerAccounts(userA.id, "A");
  await makeLedgerAccounts(userB.id, "B");

  const { token: tokenA } = await createSession(userA.id);
  cookieJar.value = tokenA;
  await createDebtAction(null, debtFormData("30000000", "1", "30000000"));
  cookieJar.value = null;
  const { token: tokenB } = await createSession(userB.id);
  cookieJar.value = tokenB;
  await createDebtAction(null, debtFormData("50000000", "1", "50000000"));
  cookieJar.value = null;

  const scheduleA = await listInstallmentSchedule(userA.id);
  const scheduleB = await listInstallmentSchedule(userB.id);
  assert.equal(scheduleA.rows.length, 1);
  assert.equal(scheduleB.rows.length, 1);
  assert.equal(scheduleA.rows[0].fx.amountToman, "30000000");
  assert.equal(scheduleB.rows[0].fx.amountToman, "50000000");

  // A pays at its own rate; B then changes ITS rate.
  const [debtA] = await db.select().from(debts).where(eq(debts.userId, userA.id));
  await db.update(debts).set({ accountId: ledgerA.cash.id }).where(eq(debts.id, debtA.id));
  await db.update(debts).set({ accountId: ledgerA.liability.id }).where(eq(debts.id, debtA.id));
  await payInstallment(scheduleA.rows[0].id, ledgerA.cash.id, userA.id);
  await setRate(userB.id, "400000");

  const paidA = (await listInstallmentSchedule(userA.id)).rows[0].fx;
  assert.ok(D(paidA.paidUsdEquivalent!).sub(D("30000000").div("210000")).abs().lt("0.0001"));
  const pendingB = (await listInstallmentSchedule(userB.id)).rows[0].fx;
  assert.equal(pendingB.amountToman, "50000000");
  assert.ok(D(pendingB.currentUsdEquivalent!).sub(D("50000000").div("400000")).abs().lt("0.0001"));

  // B cannot pay A's installment.
  await assert.rejects(
    payInstallment(scheduleA.rows[0].id, ledgerA.cash.id, userB.id),
    /متعلق به شما نیست|یافت نشد/,
  );
});

test("backfill — legacy pending row recovers its original rate deterministically", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("LegacyOwner", "250000");
  const [debt] = await db
    .insert(debts)
    .values({
      userId: user.id,
      title: "بدهی قدیمی",
      creditor: "بستانکار",
      principalBase: D("30000000").div("210000").toString(),
      principalToman: "30000000",
      startDate: "2026-01-01",
    } as any)
    .returning();
  await db.insert(installments).values({
    debtId: debt.id,
    seq: 1,
    dueDate: "2026-09-01",
    amountBase: D("30000000").div("210000").toString(),
    amountToman: "30000000",
    amountUsdCreated: D("30000000").div("210000").toString(),
    status: "pending",
  } as any);

  // The additive migration derives the historical rate from the two frozen
  // creation-time figures — never from the current rate.
  await createSchemaIfNotExists();
  const [row] = await db.select().from(installments);
  assert.ok(D(row.originalFxRate).sub("210000").abs().lt("0.001"), `backfilled rate=${row.originalFxRate}`);
  assert.ok(D(row.amountToman).sub("30000000").isZero(), "backfill must not touch the Toman amount");

  const schedule = await listInstallmentSchedule(user.id);
  assert.ok(D(schedule.rows[0].fx.currentUsdEquivalent!).sub("120").abs().lt("0.0001"));
  assert.equal(schedule.pendingUsdInsight.direction, "decrease");
});
