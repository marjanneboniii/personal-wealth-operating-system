/**
 * Debt + Planning modules — Toman is AUTHORITATIVE, USD is display-only.
 *
 * Pins the user-reported bug: raising the USD/IRT rate must NEVER inflate
 * contractual Toman amounts (debt principal, installments, obligations,
 * goals, funds, budgets, planned transactions, events). Only the USD
 * equivalent line may move.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";

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
mock.module("next/cache", {
  namedExports: { revalidatePath: () => {} },
});

let db: any, createSchemaIfNotExists: any;
let debts: any, installments: any, users: any, userFxSettings: any;
let goals: any, budgets: any, obligations: any, events: any, plannedTransactions: any, funds: any;
let createSession: any;
let createDebtAction: any, createGoalAction: any, createBudgetAction: any;
let createEventAction: any, createPlannedAction: any;
let listDebts: any, listGoals: any, listBudgets: any, listObligations: any;
let listEvents: any, listPlanned: any, listFunds: any, upcomingInstallments: any;
let projectCashflow: any;
let format: typeof import("../src/lib/format");

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({
    debts,
    installments,
    users,
    userFxSettings,
    goals,
    budgets,
    obligations,
    events,
    plannedTransactions,
    funds,
  } = await import("../src/db/schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({
    createDebtAction,
    createGoalAction,
    createBudgetAction,
    createEventAction,
    createPlannedAction,
  } = await import("../src/app/actions"));
  ({
    listDebts,
    listGoals,
    listBudgets,
    listObligations,
    listEvents,
    listPlanned,
    listFunds,
    upcomingInstallments,
    projectCashflow,
  } = await import("../src/features/planning/service"));
  format = await import("../src/lib/format");
}
const modulesReady = loadModules();

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(plannedTransactions);
  await db.delete(obligations);
  await db.delete(events);
  await db.delete(goals);
  await db.delete(funds);
  await db.delete(budgets);
  await db.delete(userFxSettings);
  await db.delete(users);
}

async function loginAs(name: string, rate = "280000") {
  const [user] = await db
    .insert(users)
    .values({ name, username: name.toLowerCase().replace(/\s+/g, "-"), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: rate } as any);
  const { token } = await createSession(user.id);
  cookieJar.value = token;
  return user;
}

async function bumpRate(userId: string, rate: string) {
  await db.update(userFxSettings).set({ currentRate: rate }).where(eq(userFxSettings.userId, userId));
}

test("format helpers: Toman primary never multiplies by FX; USD is ÷ rate only", async () => {
  await modulesReady;
  const a = format.formatTomanPrimary("909090", "280000");
  const b = format.formatTomanPrimary("909090", "350000");
  // Primary Toman label is identical across rates.
  assert.equal(a.primary, b.primary);
  assert.match(a.primary, /تومان/);
  // USD equivalent shrinks when the dollar gets more expensive.
  assert.ok(D(a.usd!).gt(D(b.usd!)));
  // resolveTomanAmount prefers explicit Toman and ignores USD fallback.
  assert.equal(format.resolveTomanAmount("909090", "999", "350000"), "909090");
  // Legacy-only path (no Toman) converts USD×rate once — still a fallback.
  assert.equal(format.resolveTomanAmount(null, "3", "300000"), "900000");
});

test("Debt + installments: FX rise leaves Toman fixed, only USD moves", async () => {
  await modulesReady;
  await clean();
  const user = await loginAs("DebtFx", "280000");

  const fd = new FormData();
  fd.set("title", "قسط مبل");
  fd.set("creditor", "فروشگاه");
  fd.set("principalIrt", "6363630");
  fd.set("interestRate", "0");
  fd.set("startDate", "2026-08-01");
  fd.set("installmentCount", "7");
  fd.set("installmentIrt", "909090");
  fd.set("firstDueDate", "2026-09-01");
  const res = await createDebtAction(null, fd);
  assert.equal(res.ok, true, res.message);
  cookieJar.value = null;

  const before = await listDebts(user.id);
  assert.equal(before.length, 1);
  assert.ok(D(before[0].principalToman).sub("6363630").isZero());
  assert.ok(D(before[0].outstandingToman).sub("6363630").isZero());
  const usdBefore = D(before[0].outstandingBase);

  const upcoming = await upcomingInstallments(10, user.id);
  assert.equal(upcoming.length, 7);
  for (const i of upcoming) {
    assert.ok(D(i.amountToman).sub("909090").isZero(), `inst toman=${i.amountToman}`);
  }

  // Raise FX 280k → 350k
  await bumpRate(user.id, "350000");

  const after = await listDebts(user.id);
  assert.ok(D(after[0].principalToman).sub("6363630").isZero(), "principal Toman MUST stay fixed");
  assert.ok(D(after[0].outstandingToman).sub("6363630").isZero(), "outstanding Toman MUST stay fixed");
  const usdAfter = D(after[0].outstandingBase);
  assert.ok(usdAfter.lt(usdBefore), `USD equivalent must shrink: ${usdBefore} → ${usdAfter}`);
  assert.ok(usdAfter.sub(D("6363630").div("350000")).abs().lt("0.0001"));

  const upcomingAfter = await upcomingInstallments(10, user.id);
  for (const i of upcomingAfter) {
    assert.ok(D(i.amountToman).sub("909090").isZero(), "installment Toman MUST stay fixed");
    // Live USD = toman ÷ new rate
    assert.ok(D(i.amountUsd).sub(D("909090").div("350000")).abs().lt("0.0001"));
  }

  // DB row itself is untouched.
  const [row] = await db.select().from(debts).where(eq(debts.userId, user.id));
  assert.ok(D(row.principalToman).sub("6363630").isZero());
  const instRows = await db.select().from(installments).where(eq(installments.debtId, row.id));
  for (const i of instRows) {
    assert.ok(D(i.amountToman).sub("909090").isZero());
  }
});

test("Planning module (goal/event/plan/obligation): Toman fixed across FX change", async () => {
  await modulesReady;
  await clean();
  const user = await loginAs("PlanFx", "200000");

  // Goal
  {
    const fd = new FormData();
    fd.set("name", "خرید خانه");
    fd.set("targetBase", "1200000000");
    fd.set("priority", "1");
    const r = await createGoalAction(null, fd);
    assert.equal(r.ok, true, r.message);
  }
  // Event
  {
    const fd = new FormData();
    fd.set("name", "سفر");
    fd.set("eventDate", "2026-12-01");
    fd.set("budgetBase", "30000000");
    fd.set("category", "trip");
    const r = await createEventAction(null, fd);
    assert.equal(r.ok, true, r.message);
  }
  // Planned txn
  {
    const fd = new FormData();
    fd.set("title", "پس‌انداز ماهانه");
    fd.set("plannedDate", "2026-09-01");
    fd.set("direction", "outflow");
    fd.set("amountBase", "5000000");
    fd.set("recurrence", "none");
    const r = await createPlannedAction(null, fd);
    assert.equal(r.ok, true, r.message);
  }
  // Obligation (direct insert — no dedicated action)
  await db.insert(obligations).values({
    userId: user.id,
    title: "اجاره",
    amountBase: "15000000",
    dueDate: "2026-09-01",
    recurrence: "monthly",
    status: "pending",
  } as any);

  cookieJar.value = null;

  const g1 = await listGoals(user.id);
  const e1 = await listEvents(user.id);
  const p1 = await listPlanned(user.id);
  const o1 = await listObligations(user.id);

  assert.ok(D(g1[0].targetToman).sub("1200000000").isZero());
  assert.ok(D(e1[0].budgetToman).sub("30000000").isZero());
  assert.ok(D(p1[0].amountToman).sub("5000000").isZero());
  assert.ok(D(o1[0].amountToman).sub("15000000").isZero());

  const goalUsdBefore = D(g1[0].targetUsd);
  const eventUsdBefore = D(e1[0].budgetUsd);

  await bumpRate(user.id, "400000"); // double the rate

  const g2 = await listGoals(user.id);
  const e2 = await listEvents(user.id);
  const p2 = await listPlanned(user.id);
  const o2 = await listObligations(user.id);

  // Toman unchanged
  assert.ok(D(g2[0].targetToman).sub("1200000000").isZero());
  assert.ok(D(e2[0].budgetToman).sub("30000000").isZero());
  assert.ok(D(p2[0].amountToman).sub("5000000").isZero());
  assert.ok(D(o2[0].amountToman).sub("15000000").isZero());

  // USD halved (rate doubled)
  assert.ok(D(g2[0].targetUsd).sub(goalUsdBefore.div(2)).abs().lt("0.01"));
  assert.ok(D(e2[0].budgetUsd).sub(eventUsdBefore.div(2)).abs().lt("0.01"));

  // DB rows still hold the original Toman figures in *Base columns.
  const [gRow] = await db.select().from(goals).where(eq(goals.userId, user.id));
  assert.ok(D(gRow.targetBase).sub("1200000000").isZero());
  const [eRow] = await db.select().from(events).where(eq(events.userId, user.id));
  assert.ok(D(eRow.budgetBase).sub("30000000").isZero());
});

test("projectCashflow: scheduled Toman outflows do not scale with FX", async () => {
  await modulesReady;
  await clean();
  const user = await loginAs("ProjFx", "200000");

  // One planned outflow of 10_000_000 Toman next month
  const fd = new FormData();
  fd.set("title", "خرج برنامه‌ای");
  fd.set("plannedDate", "2026-09-15");
  fd.set("direction", "outflow");
  fd.set("amountBase", "10000000");
  fd.set("recurrence", "none");
  await createPlannedAction(null, fd);
  cookieJar.value = null;

  const before = await projectCashflow(3, "base", user.id);
  const outBefore = before.points.reduce((s: any, p: any) => s.add(D(p.outflow)), D("0"));

  await bumpRate(user.id, "500000");
  const after = await projectCashflow(3, "base", user.id);
  const outAfter = after.points.reduce((s: any, p: any) => s.add(D(p.outflow)), D("0"));

  // Total scheduled Toman outflow is identical across rates.
  assert.ok(outBefore.sub(outAfter).abs().lt("1"), `outflow toman drifted: ${outBefore} vs ${outAfter}`);
  assert.ok(outBefore.gte("10000000"));
});

test("formatTomanPrimary / sumToman: display helpers keep Toman fixed", async () => {
  await modulesReady;
  const total = format.sumToman(["909090", "909090", null, "0"]);
  assert.equal(total, "1818180");
  const d1 = format.formatTomanPrimary(total, "190000");
  const d2 = format.formatTomanPrimary(total, "380000");
  assert.equal(d1.primary, d2.primary);
  assert.ok(D(d1.usd!).gt(D(d2.usd!)));
});
