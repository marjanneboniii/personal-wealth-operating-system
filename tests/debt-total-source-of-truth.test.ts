/**
 * «مانده کل بدهی» vs «مانده اقساط» — single source of truth.
 *
 * USER-REPORTED BUG: the debt overview (/debts, section بدهی‌ها) showed a total
 * debt that disagreed with the installment module (/installments, مانده اقساط):
 *
 *     /debts          «مانده کل بدهی»  ۷۱٬۳۰۰٬۰۰۰ تومان
 *     /installments   «مانده اقساط»    ۸۶٬۸۱۸٬۱۸۰ تومان
 *
 * ROOT CAUSE (see docs/AUDIT-TOTAL-DEBT-VS-INSTALLMENTS.md):
 * `listDebts().outstandingToman` was derived as `principal_toman − Σ(paid)`.
 * That is a *principal amortisation* view, not the remaining obligation:
 *   1. a repayment schedule totals MORE than its principal (interest), so the
 *      interest share silently dropped out of the debt total;
 *   2. `principal_toman` is never written back on payment (`payInstallment`
 *      only flips the installment status and settles the debt), so the figure
 *      was not a maintained balance;
 *   3. once Σ(paid) passed the principal the subtraction went negative and was
 *      clamped to ZERO while unpaid installments were still outstanding.
 *
 * These tests run the REAL service against a REAL (in-memory) schema — no
 * stand-in re-implementation of the aggregation.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";

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

let db: any, createSchemaIfNotExists: any, schema: any, createSession: any;
let eq: any;
let svc: typeof import("../src/features/planning/service");
let sumToman: typeof import("../src/lib/format")["sumToman"];

async function loadModules() {
  ({ eq } = await import("drizzle-orm"));
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  schema = await import("../src/db/schema");
  ({ createSession } = await import("../src/lib/auth"));
  svc = await import("../src/features/planning/service");
  ({ sumToman } = await import("../src/lib/format"));
  await createSchemaIfNotExists();
}

/** Exactly what /debts renders as «مانده کل بدهی». */
function totalDebtToman(rows: any[]): string {
  return sumToman(rows.map((d) => d.outstandingToman));
}

/** Exactly what /installments renders as «مانده اقساط». */
function remainingInstallmentsToman(rows: any[]): string {
  return sumToman(rows.filter((r) => !r.fx.isPaid).map((r) => r.fx.amountToman));
}

const iso = (dayOffset: number) =>
  new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);

/** One debt + its schedule, with explicit paid/pending/overdue control. */
async function makeDebt(opts: {
  userId: string;
  title: string;
  principalToman: string | null;
  principalBase?: string;
  interestRate?: string;
  status?: string;
  installments: Array<{
    seq: number;
    dueDayOffset: number;
    amountToman: string | null;
    amountBase?: string;
    paid?: boolean;
  }>;
}) {
  const principalToman = opts.principalToman;
  const [debt] = await db
    .insert(schema.debts)
    .values({
      userId: opts.userId,
      creditor: "بانک",
      title: opts.title,
      principalBase: opts.principalBase ?? "1000",
      principalToman,
      principalUsdCreated: opts.principalBase ?? "1000",
      interestRate: opts.interestRate ?? "18",
      startDate: iso(-100),
      status: opts.status ?? "active",
    } as any)
    .returning();

  if (opts.installments.length) {
    await db.insert(schema.installments).values(
      opts.installments.map((i) => {
        const base = i.amountBase ?? "100";
        return {
          debtId: debt.id,
          seq: i.seq,
          dueDate: iso(i.dueDayOffset),
          amountBase: base,
          amountToman: i.amountToman,
          amountUsdCreated: base,
          ...(i.paid
            ? {
                status: "paid",
                paidAt: iso(i.dueDayOffset),
                paidToman: i.amountToman ?? base,
                paidUsd: base,
                paidFxRate: "190000",
              }
            : { status: "pending" }),
        };
      }) as any,
    );
  }
  return debt;
}

async function setRate(userId: string, rate: string) {
  const existing = await db
    .select()
    .from(schema.userFxSettings)
    .where(eq(schema.userFxSettings.userId, userId))
    .limit(1);
  if (existing.length) {
    await db
      .update(schema.userFxSettings)
      .set({ currentRate: rate })
      .where(eq(schema.userFxSettings.userId, userId));
  } else {
    await db.insert(schema.userFxSettings).values({ userId, currentRate: rate } as any);
  }
}

async function newUser(name: string, rate = "190000") {
  const [u] = await db.insert(schema.users).values({ name } as any).returning();
  await setRate(u.id, rate);
  return u;
}

/* ------------------------------------------------------------------ */

test("Test 1+2 — one real debt: «مانده کل بدهی» equals the still-unpaid schedule", async () => {
  await loadModules();
  const u = await newUser("T1-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  // Principal 100,000,000 with a 120,000,000 schedule (20,000,000 interest);
  // 1 of 4 installments already paid.
  await makeDebt({
    userId: u.id,
    title: "وام مسکن",
    principalToman: "100000000",
    installments: [
      { seq: 1, dueDayOffset: -30, amountToman: "30000000", paid: true },
      { seq: 2, dueDayOffset: 10, amountToman: "30000000" },
      { seq: 3, dueDayOffset: 60, amountToman: "30000000" },
      { seq: 4, dueDayOffset: 120, amountToman: "30000000" },
    ],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);

  assert.equal(totalDebtToman(debts), "90000000", "remaining payable = 3 × 30,000,000");
  assert.equal(remainingInstallmentsToman(sched.rows), "90000000");
  assert.equal(
    totalDebtToman(debts),
    remainingInstallmentsToman(sched.rows),
    "the two pages must read the same source of truth",
  );
  // Regression on the OLD formula: principal − paid would have said 70,000,000
  // and silently dropped the 20,000,000 interest share.
  assert.notEqual(totalDebtToman(debts), "70000000");
});

test("Test 3 — a PAID installment is excluded from both remaining figures", async () => {
  await loadModules();
  const u = await newUser("T3-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام خودرو",
    principalToman: "60000000",
    installments: [
      { seq: 1, dueDayOffset: -20, amountToman: "20000000", paid: true },
      { seq: 2, dueDayOffset: 15, amountToman: "20000000" },
    ],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);
  assert.equal(remainingInstallmentsToman(sched.rows), "20000000", "paid row must not be counted");
  assert.equal(totalDebtToman(debts), "20000000");
});

test("Test 4 — an UNPAID installment stays in both remaining figures", async () => {
  await loadModules();
  const u = await newUser("T4-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام تجهیز",
    principalToman: "50000000",
    installments: [
      { seq: 1, dueDayOffset: 40, amountToman: "25000000" },
      { seq: 2, dueDayOffset: 70, amountToman: "25000000" },
    ],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);
  assert.equal(remainingInstallmentsToman(sched.rows), "50000000");
  assert.equal(totalDebtToman(debts), "50000000");
});

test("Test 5 — an OVERDUE (past-due, unpaid) installment is still outstanding", async () => {
  await loadModules();
  const u = await newUser("T5-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام معوق",
    principalToman: "45000000",
    installments: [
      { seq: 1, dueDayOffset: -45, amountToman: "15000000" }, // overdue
      { seq: 2, dueDayOffset: -10, amountToman: "15000000" }, // overdue
      { seq: 3, dueDayOffset: 30, amountToman: "15000000" }, // future
    ],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);
  const overdueCount = sched.rows.filter((r: any) => !r.fx.isPaid && r.dueDate < iso(0)).length;
  assert.equal(overdueCount, 2, "two rows are past due and unpaid");
  assert.equal(remainingInstallmentsToman(sched.rows), "45000000", "overdue rows remain outstanding");
  assert.equal(totalDebtToman(debts), "45000000");
});

test("Test 6 — a Loan WITH installments is never double counted", async () => {
  await loadModules();
  const u = await newUser("T6-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام دو‌منظوره",
    principalToman: "100000000",
    installments: [
      { seq: 1, dueDayOffset: 20, amountToman: "60000000" },
      { seq: 2, dueDayOffset: 80, amountToman: "60000000" },
    ],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);
  const total = totalDebtToman(debts);

  assert.equal(total, "120000000", "schedule only");
  // The double-counting mistake: principal + remaining installments.
  assert.notEqual(total, "220000000", "principal must NOT be added on top of its own schedule");
  assert.equal(total, remainingInstallmentsToman(sched.rows));
});

test("Test 6b — near-fully-paid amortising loan no longer clamps to ZERO", async () => {
  await loadModules();
  const u = await newUser("T6b-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  // 3 × 40,000,000 paid = 120,000,000 > principal 100,000,000 → the old
  // `principal − paid` clamped this to 0 while one installment was still due.
  await makeDebt({
    userId: u.id,
    title: "وام استهلاکی",
    principalToman: "100000000",
    installments: [
      { seq: 1, dueDayOffset: -90, amountToman: "40000000", paid: true },
      { seq: 2, dueDayOffset: -60, amountToman: "40000000", paid: true },
      { seq: 3, dueDayOffset: -30, amountToman: "40000000", paid: true },
      { seq: 4, dueDayOffset: 15, amountToman: "40000000" },
    ],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);
  assert.equal(debts[0].outstandingToman, "40000000", "the last unpaid installment must still count");
  assert.equal(totalDebtToman(debts), remainingInstallmentsToman(sched.rows));
});

test("Test 7 — an independent Obligation is NOT debt (separate domain entity)", async () => {
  await loadModules();
  const u = await newUser("T7-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام",
    principalToman: "30000000",
    installments: [{ seq: 1, dueDayOffset: 25, amountToman: "30000000" }],
  });
  await db.insert(schema.obligations).values({
    userId: u.id,
    title: "بیمه عمر",
    amountBase: "12000000",
    dueDate: iso(20),
    recurrence: "yearly",
    status: "pending",
  } as any);

  const debts = await svc.listDebts(u.id);
  const obligations = await svc.listObligations(u.id);

  assert.equal(totalDebtToman(debts), "30000000", "obligation must not inflate Total Debt");
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].amountToman, "12000000");
  // …but it IS a future commitment, and shows up in «تعهدات آینده» only.
  const upcoming = await svc.upcomingInstallments(100, u.id);
  assert.ok(!upcoming.some((i: any) => i.debtTitle === "بیمه عمر"));
});

test("Test 10 — changing the FX rate never moves the Toman debt, only its USD equivalent", async () => {
  await loadModules();
  const u = await newUser("T10-Ali", "210000");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام ارزی",
    principalToman: "100000000",
    installments: [
      { seq: 1, dueDayOffset: 20, amountToman: "50000000" },
      { seq: 2, dueDayOffset: 50, amountToman: "50000000" },
    ],
  });

  const atLow = await svc.listDebts(u.id);
  const usdAtLow = atLow[0].outstandingUsd;
  const tomanAtLow = totalDebtToman(atLow);

  await setRate(u.id, "300000");
  const atHigh = await svc.listDebts(u.id);
  const usdAtHigh = atHigh[0].outstandingUsd;
  const tomanAtHigh = totalDebtToman(atHigh);

  assert.equal(tomanAtLow, "100000000");
  assert.equal(tomanAtHigh, "100000000", "Toman must be frozen against FX moves");
  assert.equal(tomanAtLow, tomanAtHigh);
  assert.notEqual(usdAtLow, usdAtHigh, "only the USD equivalent may move");
  assert.ok(Number(usdAtHigh) < Number(usdAtLow), "a dearer dollar means a smaller USD figure");
});

test("Test 11 — multi-user isolation: another tenant's debt never enters the aggregate", async () => {
  await loadModules();
  const u1 = await newUser("T11-Ali");
  const u2 = await newUser("T11-Sara");
  cookieJar.value = (await createSession(u1.id)).cookieValue;

  await makeDebt({
    userId: u1.id,
    title: "ALI-DEBT",
    principalToman: "30000000",
    installments: [{ seq: 1, dueDayOffset: 20, amountToman: "30000000" }],
  });
  await makeDebt({
    userId: u2.id,
    title: "SARA-DEBT",
    principalToman: "999000000",
    installments: [{ seq: 1, dueDayOffset: 20, amountToman: "999000000" }],
  });

  const debts1 = await svc.listDebts(u1.id);
  const sched1 = await svc.listInstallmentSchedule(u1.id);
  assert.ok(!debts1.some((d: any) => d.title === "SARA-DEBT"));
  assert.ok(!sched1.rows.some((r: any) => r.title === "SARA-DEBT"));
  assert.equal(totalDebtToman(debts1), "30000000");

  const debts2 = await svc.listDebts(u2.id);
  assert.ok(!debts2.some((d: any) => d.title === "ALI-DEBT"));
  assert.equal(totalDebtToman(debts2), "999000000");

  // Fail-closed: with several tenants and no resolved identity, return nothing
  // rather than blending every user's debt into one number.
  cookieJar.value = null;
  assert.deepEqual(await svc.listDebts(undefined), []);
  assert.equal((await svc.listInstallmentSchedule(undefined)).rows.length, 0);
});

test("Test 12 — Overview total reconciles with the installment source of truth across a mixed book", async () => {
  await loadModules();
  const u = await newUser("T12-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  // (a) interest-bearing loan, partially paid
  await makeDebt({
    userId: u.id,
    title: "وام مسکن",
    principalToman: "100000000",
    installments: [
      { seq: 1, dueDayOffset: -30, amountToman: "30000000", paid: true },
      { seq: 2, dueDayOffset: 10, amountToman: "30000000" },
      { seq: 3, dueDayOffset: 40, amountToman: "30000000" },
    ],
  });
  // (b) fully settled loan — must contribute zero
  await makeDebt({
    userId: u.id,
    title: "وام تسویه‌شده",
    principalToman: "50000000",
    status: "settled",
    installments: [{ seq: 1, dueDayOffset: -200, amountToman: "50000000", paid: true }],
  });
  // (c) schedule-less debt — falls back to its own principal
  await makeDebt({
    userId: u.id,
    title: "بدهی بدون اقساط",
    principalToman: "7000000",
    installments: [],
  });

  const debts = await svc.listDebts(u.id);
  const sched = await svc.listInstallmentSchedule(u.id);

  const byTitle = Object.fromEntries(debts.map((d: any) => [d.title, d]));
  assert.equal(byTitle["وام مسکن"].outstandingToman, "60000000");
  assert.equal(byTitle["وام تسویه‌شده"].outstandingToman, "0", "settled loan contributes nothing");
  assert.equal(byTitle["بدهی بدون اقساط"].outstandingToman, "7000000", "no schedule → principal fallback");

  // Overview total = schedule remainder + schedule-less debts.
  assert.equal(totalDebtToman(debts), "67000000");
  assert.equal(remainingInstallmentsToman(sched.rows), "60000000");
  assert.equal(
    Number(totalDebtToman(debts)) - Number(remainingInstallmentsToman(sched.rows)),
    7000000,
    "the only gap is the schedule-less debt, which the installment page never sees",
  );
});

test("Test 12b — «بازپرداخت‌شده» reports what was actually paid, not principal − outstanding", async () => {
  await loadModules();
  const u = await newUser("T12b-Ali");
  cookieJar.value = (await createSession(u.id)).cookieValue;

  await makeDebt({
    userId: u.id,
    title: "وام سوددار",
    principalToman: "100000000",
    installments: [
      { seq: 1, dueDayOffset: -30, amountToman: "30000000", paid: true },
      { seq: 2, dueDayOffset: 30, amountToman: "30000000" },
      { seq: 3, dueDayOffset: 60, amountToman: "30000000" },
      { seq: 4, dueDayOffset: 90, amountToman: "30000000" },
    ],
  });

  const [d] = await svc.listDebts(u.id);
  assert.equal(d.paidToman, "30000000", "actual repaid amount");
  assert.equal(d.outstandingToman, "90000000");
  // principal − outstanding would have claimed only 10,000,000 was repaid.
  assert.notEqual(
    Number(d.principalToman) - Number(d.outstandingToman),
    Number(d.paidToman),
  );
});
