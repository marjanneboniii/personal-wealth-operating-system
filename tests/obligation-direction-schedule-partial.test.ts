/**
 * تعهدات مالی — direction, flexible schedules and partial settlement.
 *
 * This file pins the rules the obligation model added on top of the existing
 * debt domain. It is deliberately split into a PURE half (no database: the
 * money invariants of the brief's §18, which must hold without a server) and a
 * WIRED half (the real payment transaction, the real ledger, real tenants).
 *
 * The invariants under test:
 *
 *   DIRECTION   بدهی من  → cash ↓ , entry type debt_repayment
 *               طلب من   → cash ↑ , same type (a collection is not income)
 *               and the direction is read from the OBLIGATION ROW, never from
 *               the caller — a client cannot flip the sign of a cash leg.
 *
 *   SCHEDULE    recurring steps by its interval («هر ۳ ماه» is ONE step of 3)
 *               custom keeps each date exactly as entered, with NO interval
 *               inferred — the brief's 3/2/4-month example is the case a
 *               cadence cannot produce.
 *
 *   SPLIT       Σ(installments) === principal, to the Toman, remainder and all.
 *
 *   PARTIAL     paid accumulates, remaining shrinks, status becomes `partial`,
 *               the parent obligation does NOT settle, and an over-payment is
 *               refused rather than absorbed.
 *
 *   FX          a paid installment's snapshot is never recomputed at a later
 *               rate — including across a PARTIAL settlement.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  debts,
  entryFxSnapshots,
  installments,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  users,
  userFxSettings,
} from "../src/db/schema";
import {
  INSTALLMENT_PARTIAL,
  applyPartialPayment,
  deriveObligationState,
  generateDueDates,
  isReceivable,
  remainingToman,
  resolveDirection,
  settlementSign,
  splitPrincipal,
  validateSchedule,
} from "../src/features/planning/obligations";

/* ══════════════════════════════════════════════════════════════════════
   PURE — no database, no clock, no FX.
   ══════════════════════════════════════════════════════════════════════ */

test("direction is explicit, and an unknown/legacy value reads as payable", () => {
  assert.equal(resolveDirection("receivable"), "receivable");
  assert.equal(resolveDirection("payable"), "payable");
  // Every row written before the receivable model carries NULL and was, by
  // construction, money the user owed.
  assert.equal(resolveDirection(null), "payable");
  assert.equal(resolveDirection(undefined), "payable");
  assert.equal(resolveDirection("nonsense"), "payable");

  // The sign is the whole point: reversing a caption must not be able to
  // reverse the money.
  assert.equal(settlementSign("payable"), -1);
  assert.equal(settlementSign("receivable"), 1);
  assert.equal(settlementSign(null), -1, "fail-safe: an unknown direction never pays the user");
  assert.equal(isReceivable("receivable"), true);
  assert.equal(isReceivable("payable"), false);
});

test("recurring schedules step by their interval — «هر ۳ ماه» is one step of 3", () => {
  const quarterly = generateDueDates({
    kind: "recurring",
    count: 4,
    intervalMonths: 3,
    firstDueDate: "2026-01-20",
  });
  assert.deepEqual(quarterly, ["2026-01-20", "2026-04-20", "2026-07-20", "2026-10-20"]);

  const bimonthly = generateDueDates({
    kind: "recurring",
    count: 3,
    intervalMonths: 2,
    firstDueDate: "2026-01-31",
  });
  // End-of-month clamping: 31 Jan + 2 months is 31 Mar, + 4 is 31 May.
  assert.deepEqual(bimonthly, ["2026-01-31", "2026-03-31", "2026-05-31"]);

  // The clamp must not silently walk the day forward on a short month.
  const monthlyFrom31 = generateDueDates({
    kind: "recurring",
    count: 3,
    intervalMonths: 1,
    firstDueDate: "2026-01-31",
  });
  assert.deepEqual(monthlyFrom31, ["2026-01-31", "2026-02-28", "2026-03-31"]);
});

test("a custom schedule keeps every date as entered — no interval is inferred", () => {
  // The brief's own example: gaps of 3, 2 and 4 months. No cadence produces it.
  const dates = ["2026-10-12", "2027-01-10", "2027-03-11", "2027-07-11"];
  const generated = generateDueDates({ kind: "custom", dueDates: dates });
  assert.deepEqual(generated, dates, "the dates are stored, never regenerated");

  // Order is normalised (the form lets a user fill row 3 before row 2) but no
  // value is changed.
  const shuffled = generateDueDates({
    kind: "custom",
    dueDates: ["2027-03-11", "2026-10-12", "2027-07-11", "2027-01-10"],
  });
  assert.deepEqual(shuffled, dates);
});

test("invalid schedules are refused before anything is written", () => {
  const start = "2026-01-01";
  assert.equal(validateSchedule({ kind: "custom", dueDates: dates3() }, start), null);

  // A due date before the obligation started.
  assert.ok(validateSchedule({ kind: "custom", dueDates: ["2025-12-31"] }, start));
  // A date that does not exist on the calendar.
  assert.ok(validateSchedule({ kind: "custom", dueDates: ["2026-02-31"] }, start));
  // Two installments on the same day — «قسط بعدی» would be ambiguous forever.
  assert.ok(validateSchedule({ kind: "custom", dueDates: ["2026-03-01", "2026-03-01"] }, start));
  // An empty custom schedule.
  assert.ok(validateSchedule({ kind: "custom", dueDates: [] }, start));
  // An interval outside the offered cadences.
  assert.ok(
    validateSchedule({ kind: "recurring", count: 3, intervalMonths: 7, firstDueDate: "2026-02-01" }, start),
  );
  // A zero-length recurring schedule.
  assert.ok(
    validateSchedule({ kind: "recurring", count: 0, intervalMonths: 1, firstDueDate: "2026-02-01" }, start),
  );
  // First due date before the start.
  assert.ok(
    validateSchedule({ kind: "recurring", count: 3, intervalMonths: 1, firstDueDate: "2025-11-01" }, start),
  );

  function dates3() {
    return ["2026-03-01", "2026-06-01", "2026-09-15"];
  }
});

test("splitting a principal is EXACT — Σ(installments) always equals the principal", () => {
  // The case naive rounding loses a Toman on: 1,000,000 ÷ 3.
  const three = splitPrincipal("1000000", 3);
  assert.deepEqual(three, ["333334", "333333", "333333"]);
  assert.equal(
    three.reduce((sum, a) => sum.add(D(a)), D("0")).toFixed(0),
    "1000000",
    "the remainder is distributed, never rounded away",
  );

  // A remainder of 2 lands on the first TWO rows, one unit each.
  const seven = splitPrincipal("500000000", 7);
  assert.equal(seven.length, 7);
  assert.equal(seven.reduce((sum, a) => sum.add(D(a)), D("0")).toFixed(0), "500000000");
  assert.equal(new Set(seven).size <= 2, true, "at most two distinct amounts — base and base+1");

  // An even split has no remainder to place.
  assert.deepEqual(splitPrincipal("900000", 3), ["300000", "300000", "300000"]);

  // Degenerate inputs are refused, not clamped.
  assert.throws(() => splitPrincipal("1000000", 0));
  assert.throws(() => splitPrincipal("0", 3));
  assert.throws(() => splitPrincipal("-500", 3));
});

test("partial settlement accumulates, and an over-payment is refused, not absorbed", () => {
  const row = { status: "pending", amountToman: "50000000", paidToman: null };
  assert.equal(remainingToman(row).toFixed(0), "50000000");

  // The brief's example: pay 30 of 50.
  const first = applyPartialPayment(row, "30000000");
  assert.equal(first.status, INSTALLMENT_PARTIAL);
  assert.equal(first.paidToman, "30000000");
  assert.equal(first.remainingToman, "20000000");

  const afterFirst = { status: first.status, amountToman: "50000000", paidToman: first.paidToman };
  assert.equal(remainingToman(afterFirst).toFixed(0), "20000000");

  // Settling the rest closes the row exactly.
  const second = applyPartialPayment(afterFirst, "20000000");
  assert.equal(second.status, "paid");
  assert.equal(second.paidToman, "50000000");
  assert.equal(second.remainingToman, "0");

  // Over-payment: 30 more against a 20 remainder would push Σ(paid) past the
  // contract with no record of where the excess went.
  assert.throws(() => applyPartialPayment(afterFirst, "30000000"), /بیشتر/);
  // Zero and negative amounts are never a payment.
  assert.throws(() => applyPartialPayment(row, "0"));
  assert.throws(() => applyPartialPayment(row, "-1"));
  // A settled row cannot be settled again.
  assert.throws(() => applyPartialPayment({ status: "paid", amountToman: "50000000", paidToman: "50000000" }, "1"));
});

test("obligation state is DERIVED — «paid debt with unpaid installments» is unrepresentable", () => {
  const today = "2026-06-15";

  // A stored status of "settled" is NOT trusted while a row is still owed.
  assert.equal(
    deriveObligationState({
      status: "settled",
      installments: [{ status: "pending", amountToman: "100", paidToman: null }],
      nextDueDate: "2026-09-01",
      todayIso: today,
    }),
    "active",
  );

  assert.equal(
    deriveObligationState({
      status: "active",
      installments: [{ status: "paid", amountToman: "100", paidToman: "100" }],
      nextDueDate: null,
      todayIso: today,
    }),
    "settled",
  );

  // Overdue outranks everything except cancellation.
  assert.equal(
    deriveObligationState({
      status: "active",
      installments: [{ status: "partial", amountToman: "100", paidToman: "40" }],
      nextDueDate: "2026-05-01",
      todayIso: today,
    }),
    "overdue",
  );

  // A part-paid row that is not yet late reads as «بخشی پرداخت شده».
  assert.equal(
    deriveObligationState({
      status: "active",
      installments: [{ status: "partial", amountToman: "100", paidToman: "40" }],
      nextDueDate: "2026-12-01",
      todayIso: today,
    }),
    "partially-paid",
  );

  assert.equal(
    deriveObligationState({
      status: "active",
      installments: [{ status: "pending", amountToman: "100", paidToman: null }],
      nextDueDate: "2026-06-20",
      todayIso: today,
    }),
    "due-soon",
  );

  // A soft-deleted obligation is cancelled regardless of its schedule.
  assert.equal(
    deriveObligationState({
      status: "active",
      deletedAt: new Date(),
      installments: [{ status: "pending", amountToman: "100", paidToman: null }],
      nextDueDate: "2026-06-20",
      todayIso: today,
    }),
    "cancelled",
  );

  // A scheduleless obligation with a balance is active, not settled.
  assert.equal(
    deriveObligationState({
      status: "active",
      installments: [],
      outstandingToman: "500000000",
      todayIso: today,
    }),
    "active",
  );
});

/* ══════════════════════════════════════════════════════════════════════
   WIRED — the real payment transaction, the real ledger, real tenants.
   ══════════════════════════════════════════════════════════════════════ */

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
let createSession: any, createDebtAction: any;
let listDebts: any, listInstallmentSchedule: any, payInstallment: any;
let getCurrentNetWorth: any, getExpenseIncomeTotals: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction } = await import("../src/app/actions"));
  ({ listDebts, listInstallmentSchedule, payInstallment } = await import(
    "../src/features/planning/service"
  ));
  ({ getCurrentNetWorth } = await import("../src/features/portfolio/service"));
  ({ getExpenseIncomeTotals } = await import("../src/features/ledger/queries"));
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

async function makeCashAccount(userId: string, suffix: string) {
  const [usd] = await db
    .insert(currencies)
    .values({ code: `USD${suffix}`, name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: `cash${suffix}`, name: "Cash", valuationMethod: "fifo" } as any)
    .returning();
  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: `USD_CASH${suffix}`, name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any)
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ code: `1010${suffix}`, name: "Cash", type: "asset", assetId: usdCash.id, userId } as any)
    .returning();
  return { cash, usdCash };
}

/** The form payload the debt screen submits. */
function obligationForm(input: {
  direction?: string;
  principal: string;
  count?: string;
  intervalMonths?: string;
  installment?: string;
  firstDue?: string;
  customDueDates?: string;
}) {
  const fd = new FormData();
  fd.set("title", input.direction === "receivable" ? "طلب از شرکت ایکس" : "بدهی به علی");
  fd.set("creditor", input.direction === "receivable" ? "شرکت ایکس" : "علی");
  fd.set("principalIrt", input.principal);
  fd.set("interestRate", "0");
  fd.set("startDate", "2026-08-01");
  fd.set("direction", input.direction ?? "payable");
  fd.set("installmentCount", input.count ?? "0");
  fd.set("intervalMonths", input.intervalMonths ?? "1");
  fd.set("installmentIrt", input.installment ?? "");
  fd.set("firstDueDate", input.firstDue ?? "");
  fd.set("customDueDates", input.customDueDates ?? "");
  return fd;
}

async function entryOf(entryId: string) {
  const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId));
  const lines = await db.select().from(postings).where(eq(postings.entryId, entryId));
  return { entry, lines };
}

test("a receivable settles the OTHER WAY: cash ↑, and it is never counted as income", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("ReceivableOwner", "220000");
  const { cash } = await makeCashAccount(user.id, "R");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  const created = await createDebtAction(
    null,
    obligationForm({ direction: "receivable", principal: "300000000", count: "2", firstDue: "2026-09-01" }),
  );
  assert.equal(created.ok, true, created.message);

  const [row] = await db.select().from(debts);
  assert.equal(row.direction, "receivable", "the direction is persisted on the obligation");
  assert.equal(row.accountId, null, "a receivable is planning-only too — no journal entry on creation");

  const schedule = await listInstallmentSchedule(user.id);
  assert.equal(schedule.rows[0].direction, "receivable", "the schedule carries the direction to the UI");

  const collected = await payInstallment(schedule.rows[0].id, cash.id, user.id);
  assert.equal((collected as any).direction, "receivable");

  const { entry, lines } = await entryOf(collected.id);
  assert.equal(entry.type, "debt_repayment", "the same excluded type — a collection is not income");
  assert.equal(lines.length, 2, "double entry stays two-legged");
  assert.ok(
    lines.reduce((a: any, l: any) => a.add(l.baseValue), D("0")).isZero(),
    "Σ base_value = 0 — direction never breaks the balance",
  );

  const cashLeg = lines.find((l: any) => l.accountId === cash.id)!;
  assert.ok(
    D(cashLeg.baseValue).gt(0),
    "THE POINT: collecting a receivable puts money IN. A reversed caption alone would have drained it.",
  );

  // The contra landed on the income-typed 4960 bucket…
  const contraLeg = lines.find((l: any) => l.accountId !== cash.id)!;
  const [contraAccount] = await db.select().from(accounts).where(eq(accounts.id, contraLeg.accountId));
  assert.equal(contraAccount.code, "4960");
  assert.equal(contraAccount.type, "income");

  // …and is STILL excluded from the income KPI, because the exclusion was
  // already symmetric on entry type. No new filter was needed.
  const totals = await getExpenseIncomeTotals(undefined, undefined, user.id);
  assert.equal(D(totals.income).toFixed(0), "0", "a collection never inflates «کل درآمد»");
  assert.equal(D(totals.expense).toFixed(0), "0", "and it is not an expense either");
});

test("a payable still settles the way it always did: cash ↓ onto 5960", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("PayableOwner", "220000");
  const { cash } = await makeCashAccount(user.id, "PY");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  await createDebtAction(null, obligationForm({ principal: "500000000", count: "2", firstDue: "2026-09-01" }));
  const schedule = await listInstallmentSchedule(user.id);
  const paid = await payInstallment(schedule.rows[0].id, cash.id, user.id);

  const { lines } = await entryOf(paid.id);
  const cashLeg = lines.find((l: any) => l.accountId === cash.id)!;
  assert.ok(D(cashLeg.baseValue).isNegative(), "a debt payment takes money OUT — unchanged");
  const contraLeg = lines.find((l: any) => l.accountId !== cash.id)!;
  const [contraAccount] = await db.select().from(accounts).where(eq(accounts.id, contraLeg.accountId));
  assert.equal(contraAccount.code, "5960", "still the installment-payment bucket, never 5900");
});

test("«کل بدهی‌ها» excludes receivables, and «کل مطالبات» reports them separately", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("MixedBookOwner", "220000");
  await makeCashAccount(user.id, "MB");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  await createDebtAction(null, obligationForm({ principal: "500000000" }));
  await createDebtAction(null, obligationForm({ direction: "receivable", principal: "300000000" }));

  const nw = await getCurrentNetWorth(user.id);
  assert.equal(
    D(nw.totalDebtToman).toFixed(0),
    "500000000",
    "the receivable is NOT added to, and not netted against, what the user owes",
  );
  assert.equal(D((nw as any).totalReceivableToman).toFixed(0), "300000000");

  // Neither side has been booked in the ledger yet, so net worth is untouched
  // by both — the liability-separation invariant, mirrored.
  assert.equal(D(nw.totalLiabilitiesToman).toFixed(0), "0");
  assert.equal(D(nw.netWorthToman).toFixed(0), "0");

  const book = await listDebts(user.id);
  assert.equal(book.filter((d: any) => isReceivable(d.direction)).length, 1);
  assert.equal(book.filter((d: any) => !isReceivable(d.direction)).length, 1);
});

test("a custom schedule is written with its own irregular dates and an exact split", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("CustomScheduleOwner", "220000");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  // Gaps of 3, 2 and 4 months — the brief's example. No cadence produces this.
  const dates = "2026-10-12,2027-01-10,2027-03-11,2027-07-11";
  const created = await createDebtAction(
    null,
    obligationForm({ principal: "1000000", customDueDates: dates }),
  );
  assert.equal(created.ok, true, created.message);

  const [debt] = await db.select().from(debts);
  assert.equal(debt.scheduleKind, "custom", "provenance is recorded — custom, not a 3-month cadence");
  assert.equal(debt.scheduleIntervalMonths, null, "a custom schedule has no interval to record");

  const rows = await db.select().from(installments).orderBy(installments.seq);
  assert.deepEqual(
    rows.map((r: any) => r.dueDate),
    dates.split(","),
    "every date is stored exactly as entered",
  );
  assert.deepEqual(
    rows.map((r: any) => r.seq),
    [1, 2, 3, 4],
  );
  rows.forEach((r: any) => assert.equal(r.debtId, debt.id, "every installment has its parent obligation"));

  // Σ(installments) === principal, remainder included.
  const total = rows.reduce((sum: any, r: any) => sum.add(D(r.amountToman)), D("0"));
  assert.equal(total.toFixed(0), "1000000");
  assert.deepEqual(
    rows.map((r: any) => D(r.amountToman).toFixed(0)),
    ["250000", "250000", "250000", "250000"],
  );
});

test("a recurring schedule honours its interval end to end («هر ۳ ماه»)", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("QuarterlyOwner", "220000");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  await createDebtAction(
    null,
    obligationForm({ principal: "1200000", count: "4", intervalMonths: "3", firstDue: "2026-09-20" }),
  );

  const [debt] = await db.select().from(debts);
  assert.equal(debt.scheduleKind, "recurring");
  assert.equal(debt.scheduleIntervalMonths, 3);

  const rows = await db.select().from(installments).orderBy(installments.seq);
  assert.deepEqual(
    rows.map((r: any) => r.dueDate),
    ["2026-09-20", "2026-12-20", "2027-03-20", "2027-06-20"],
    "one step of three months, not three steps of one",
  );
});

test("a partial payment leaves the installment — and its obligation — outstanding", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("PartialPayer", "200000");
  const { cash } = await makeCashAccount(user.id, "PP");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  // One 50,000,000-Toman installment.
  await createDebtAction(
    null,
    obligationForm({ principal: "50000000", count: "1", firstDue: "2026-09-01" }),
  );
  const schedule = await listInstallmentSchedule(user.id);
  const instId = schedule.rows[0].id;

  // Pay 30 of 50.
  const first = await payInstallment(instId, cash.id, user.id, "30000000");
  assert.equal((first as any).status, INSTALLMENT_PARTIAL);
  assert.equal((first as any).remainingToman, "20000000");

  const [afterFirst] = await db.select().from(installments).where(eq(installments.id, instId));
  assert.equal(afterFirst.status, "partial");
  assert.equal(D(afterFirst.paidToman).toFixed(0), "30000000");
  assert.equal(
    D(afterFirst.amountToman).toFixed(0),
    "50000000",
    "the CONTRACT is untouched — only what has been paid against it changed",
  );

  // The parent obligation must NOT settle.
  const [debtRow] = await db.select().from(debts);
  assert.equal(debtRow.status, "active", "«paid debt with unpaid installments» must be impossible");

  // The schedule reports what is LEFT, not the contractual amount.
  const midway = await listInstallmentSchedule(user.id);
  assert.equal(midway.rows[0].dueToman, "20000000");
  assert.equal(midway.rows[0].paidSoFarToman, "30000000");
  assert.equal(midway.rows[0].status, "partial");

  // And so does the debt card's outstanding balance.
  const book = await listDebts(user.id);
  assert.equal(D(book[0].outstandingToman).toFixed(0), "20000000");
  assert.equal(D(book[0].paidToman).toFixed(0), "30000000");

  // Over-paying the remainder is refused outright.
  await assert.rejects(() => payInstallment(instId, cash.id, user.id, "30000000"), /بیشتر/);

  // Settling the rest closes both the row and the obligation.
  const second = await payInstallment(instId, cash.id, user.id, "20000000");
  assert.equal((second as any).status, "paid");
  const [afterSecond] = await db.select().from(installments).where(eq(installments.id, instId));
  assert.equal(afterSecond.status, "paid");
  assert.equal(D(afterSecond.paidToman).toFixed(0), "50000000");
  const [settledDebt] = await db.select().from(debts);
  assert.equal(settledDebt.status, "settled");

  // TWO journal entries, one per settlement — the ledger is the record of both,
  // and neither was rewritten by the other.
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 2, "each partial payment posted its own entry; none was overwritten");
  for (const e of entries) {
    const { lines } = await entryOf(e.id);
    assert.ok(
      lines.reduce((a: any, l: any) => a.add(l.baseValue), D("0")).isZero(),
      "every entry balances on its own",
    );
  }
});

test("a settled installment's FX snapshot survives a later rate change", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("FxFreezeOwner", "200000");
  const { cash } = await makeCashAccount(user.id, "FF");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  await createDebtAction(
    null,
    obligationForm({ principal: "40000000", count: "1", firstDue: "2026-09-01" }),
  );
  const schedule = await listInstallmentSchedule(user.id);
  const instId = schedule.rows[0].id;

  await payInstallment(instId, cash.id, user.id);
  const [paidRow] = await db.select().from(installments).where(eq(installments.id, instId));
  const frozenToman = D(paidRow.paidToman).toFixed(0);
  const frozenRate = D(paidRow.paidFxRate).toString();
  const frozenUsd = D(paidRow.paidUsd).toString();
  assert.equal(frozenToman, "40000000");
  assert.equal(frozenRate, "200000");

  // The rate doubles afterwards.
  await db.update(userFxSettings).set({ currentRate: "400000" }).where(eq(userFxSettings.userId, user.id));

  const after = await listInstallmentSchedule(user.id);
  const row = after.rows[0];
  assert.equal(row.fx.isPaid, true);
  assert.equal(D(row.fx.paidToman!).toFixed(0), frozenToman, "the Toman paid is history");
  assert.equal(D(row.fx.paidFxRate!).toString(), frozenRate, "so is the rate it was paid at");
  assert.equal(D(row.fx.paidUsdEquivalent!).toString(), frozenUsd, "and so is the dollar equivalent");
  assert.equal(row.fx.currentUsdEquivalent, null, "a settled row does no current-rate arithmetic at all");
});

test("tenant isolation: one user's obligations never reach another's book or payment path", async () => {
  await modulesReady;
  await clean();
  const alice = await makeUser("AliceObligations", "200000");
  const bob = await makeUser("BobObligations", "200000");
  const { cash: bobCash } = await makeCashAccount(bob.id, "BOB");

  const aliceSession = await createSession(alice.id);
  cookieJar.value = aliceSession.token;
  await createDebtAction(null, obligationForm({ principal: "500000000", count: "1", firstDue: "2026-09-01" }));
  await createDebtAction(null, obligationForm({ direction: "receivable", principal: "300000000" }));

  // Bob's book is empty in BOTH directions.
  const bobBook = await listDebts(bob.id);
  assert.equal(bobBook.length, 0, "Alice's debt and receivable are invisible to Bob");
  const bobSchedule = await listInstallmentSchedule(bob.id);
  assert.equal(bobSchedule.rows.length, 0);

  const bobNw = await getCurrentNetWorth(bob.id);
  assert.equal(D(bobNw.totalDebtToman).toFixed(0), "0");
  assert.equal(D((bobNw as any).totalReceivableToman).toFixed(0), "0");

  // And Bob cannot settle Alice's installment even holding its id — ownership
  // is re-checked at the DB query level inside the payment transaction.
  const aliceSchedule = await listInstallmentSchedule(alice.id);
  const aliceInstallment = aliceSchedule.rows[0].id;
  cookieJar.value = (await createSession(bob.id)).token;
  await assert.rejects(
    () => payInstallment(aliceInstallment, bobCash.id, bob.id),
    /یافت نشد|متعلق/,
    "a guessed installment id is refused, not silently paid",
  );

  // Nothing was posted by the attempt.
  const entries = await db.select().from(journalEntries);
  assert.equal(entries.length, 0);
});

/**
 * THE SECOND SETTLEMENT PATH — `createTransactionAction`'s `debt_repayment`
 * branch, reached from «پرداخت بدهی» / «ثبت دریافت» on an obligation card and
 * from «باز کردن در فرم» on the schedule.
 *
 * These are SOURCE-level assertions rather than end-to-end ones, and that is a
 * deliberate, disclosed limitation: `createTransactionAction`'s happy path has
 * no executable coverage anywhere in this repo (it does not complete under the
 * test harness), so the behavioural guarantees below are proven end-to-end on
 * the `payInstallment` path instead — the two now share the SAME helpers, which
 * is exactly what these assertions pin.
 *
 * What they defend, and why each mattered:
 *   1. The branch used to hardcode `cash ↓`. Reached with a RECEIVABLE, it
 *      drained the wallet by the amount the user had just been paid.
 *   2. It used to flip an installment to `paid` whatever amount was entered,
 *      so a part payment made the unpaid balance vanish from every total.
 */
test("the transaction-form settlement path derives its sign from the OBLIGATION", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/actions.ts"), "utf-8");
  const branch = src.slice(
    src.indexOf('} else if (input.type === "debt_repayment") {'),
    src.indexOf("if (!entry?.id)"),
  );
  assert.ok(branch.length > 0, "the debt_repayment branch is found");

  // The sign comes from the obligation row the server loaded, through the one
  // shared helper — never from a client-supplied field, and never hardcoded.
  assert.ok(
    /const sign = settlementSign\(linkedDebt\?\.direction\)/.test(branch),
    "the cash-leg sign is resolved from linkedDebt.direction via settlementSign",
  );
  assert.ok(
    !/baseValue: amount\.neg\(\)\.toString\(\)/.test(branch),
    "the hardcoded `cash ↓` leg is gone — it drained the wallet on a collection",
  );
  assert.ok(
    /baseValue: amount\.mul\(String\(sign\)\)\.toString\(\)/.test(branch),
    "the cash leg is signed by the direction",
  );
  assert.ok(
    /baseValue: amount\.mul\(String\(-sign\)\)\.toString\(\)/.test(branch),
    "…and the contra leg carries the opposite sign, so Σ stays zero either way",
  );
  // A collection resolves the income-typed 4960 bucket, and never accepts an
  // expense counter-account the form may have prefilled.
  assert.ok(
    /collecting[\s\S]{0,20}\?[\s\S]{0,20}ensureReceivableCollectionAccount/.test(branch),
    "a collection resolves «دریافت مطالبات» server-side, ignoring the client's counter account",
  );
  // Both directions keep the entry type every aggregation already excludes.
  assert.equal(
    (branch.match(/type: "debt_repayment"/g) ?? []).length,
    2,
    "both legs of the branch post the excluded type — neither is income nor expense",
  );
});

test("the transaction-form installment path uses the shared partial-payment helper", () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/actions.ts"), "utf-8");
  const linkage = src.slice(src.indexOf("if (linkedInst) {"), src.indexOf("} else if (linkedDebt"));
  assert.ok(linkage.length > 0, "the installment-linkage block is found");

  assert.ok(
    /applyPartialPayment\(/.test(linkage),
    "the resulting state comes from the SAME helper Quick Pay uses, so the two agree",
  );
  assert.ok(
    !/status: "paid",/.test(linkage),
    "the unconditional flip to `paid` is gone — it erased the unpaid balance of a part payment",
  );
  assert.ok(
    /status: nextState\.status/.test(linkage) && /paidToman: nextState\.paidToman/.test(linkage),
    "status and the running paid total both come from the helper",
  );
  assert.ok(
    /status\} <> 'paid'/.test(linkage),
    "the parent settles only when NOTHING is outstanding — `partial` counts as outstanding",
  );
  assert.ok(
    !/eq\(installments\.status, "pending"\)/.test(linkage),
    "the old `= 'pending'` count would have settled a debt with part-paid rows left",
  );
});

test("an obligation registered in either direction posts NO journal entry", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("PlanningOnlyBoth", "200000");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  await createDebtAction(null, obligationForm({ principal: "500000000", count: "3", firstDue: "2026-09-01" }));
  await createDebtAction(
    null,
    obligationForm({ direction: "receivable", principal: "300000000", count: "2", firstDue: "2026-09-01" }),
  );

  const entries = await db.select().from(journalEntries);
  assert.equal(
    entries.length,
    0,
    "planning stays planning: recording an expectation is not a movement, in either direction",
  );
  const postingRows = await db.select().from(postings);
  assert.equal(postingRows.length, 0);
});
