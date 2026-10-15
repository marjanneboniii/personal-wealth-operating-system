/**
 * Planning links — each future payment counted once, nothing that moved money lost.
 *
 *  • a cancelled debt's open installments leave «upcoming» and the forecast;
 *    a cheque written for one of them then counts itself
 *  • a debt with a payment cannot be deleted, only cancelled
 *  • an event gets its own tag budget; editing the event keeps it in step
 *  • money set aside is a goal's progress and is spoken for in the forecast
 *  • undated debts are listed at their value; another tenant can touch nothing
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, cheques, debts, installments, users, userFxSettings } from "../src/db/schema";
import { todayIso } from "../src/lib/format";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const plusDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("planning links: debts, cheques, events, goals, undated", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { upcomingInstallments, listGoals, projectCashflow } = await import("../src/features/planning/service");
  const { pendingChequesForForecast } = await import("../src/features/cheques/service");
  const p = await import("../src/features/planning/planItems");
  await createSchemaIfNotExists();

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("planner");
  const other = await mk("outsider");
  const [cls] = await db.insert(assetClasses).values({ code: `cash-${Math.random().toString(36).slice(2, 6)}`, name: "نقد" } as any).returning();
  const [irt] = await db.insert(assets).values({ symbol: `IRT${Math.random().toString(36).slice(2, 5)}`, name: "تومان", classId: cls.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: owner.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  const today = todayIso();

  // A debt with one open installment, and a cheque written for it.
  const [debt] = await db
    .insert(debts)
    .values({ userId: owner.id, creditor: "فرش‌فروشی", title: "فرش", principalBase: "0", principalToman: "10000000", startDate: today } as any)
    .returning();
  const [inst] = await db
    .insert(installments)
    .values({ debtId: debt.id, seq: 1, dueDate: plusDays(today, 15), amountBase: "0", amountToman: "10000000" } as any)
    .returning();
  await db.insert(cheques).values({ userId: owner.id, direction: "issued", counterparty: "فرش‌فروشی", amountToman: "10000000", dueDate: plusDays(today, 15), accountId: bank.id, installmentId: inst.id } as any);

  assert.equal((await upcomingInstallments(100, owner.id)).length, 1);
  assert.equal((await pendingChequesForForecast(owner.id)).length, 0, "the installment is counted, not its cheque");

  await assert.rejects(() => p.cancelDebt(other.id, debt.id), "another tenant cannot cancel");
  await p.cancelDebt(owner.id, debt.id);
  assert.equal((await upcomingInstallments(100, owner.id)).length, 0, "a cancelled debt has nothing upcoming");
  assert.equal((await pendingChequesForForecast(owner.id)).length, 1, "its cheque is still real and counts itself");

  // A debt with money against it is cancelled, never deleted.
  const [paidDebt] = await db
    .insert(debts)
    .values({ userId: owner.id, creditor: "بانک", title: "وام", principalBase: "0", principalToman: "5000000", startDate: today } as any)
    .returning();
  await db.insert(installments).values({ debtId: paidDebt.id, seq: 1, dueDate: today, amountBase: "0", amountToman: "5000000", paidToman: "5000000", status: "paid" } as any);
  await assert.rejects(() => p.deleteDebt(owner.id, paidDebt.id), /پرداخت دارد/);

  // An event and its own budget, kept in step.
  await p.createEventWithBudget(owner.id, { name: "عروسی", eventDate: plusDays(today, 20), budgetToman: "80000000", category: "ceremony", today });
  const links = await p.eventBudgetLinks(owner.id);
  assert.equal(links.size, 1);
  const [[eventId, link]] = [...links.entries()];
  assert.equal(link.tag, "عروسی");
  await p.updateEvent(owner.id, eventId, { name: "عروسی", eventDate: plusDays(today, 25), budgetToman: "90000000" });
  await assert.rejects(() => p.updateEvent(other.id, eventId, { name: "x x", eventDate: today, budgetToman: "1" }));
  const outflowNow = async () => (await projectCashflow(3, "base", owner.id)).points.reduce((s: number, pt: any) => s + Number(pt.outflow), 0);
  assert.equal(await outflowNow(), 90000000 + 10000000, "the event's amount (nothing spent yet) and the cheque — once each");

  // A cheque toward the event: counted on its date, and off the event's remainder.
  const { createCheque, listCheques } = await import("../src/features/cheques/service");
  await createCheque(owner.id, { direction: "issued", counterparty: "تالار", amountToman: "30000000", dueDate: plusDays(today, 10), accountId: bank.id, eventId });
  assert.equal(await outflowNow(), 90000000 + 10000000, "the hall cheque does not add to the event — it is part of it");
  const hall = (await listCheques(owner.id)).find((c: any) => c.counterparty === "تالار")!;
  assert.equal(hall.eventTag, "عروسی", "clearing it tags the expense with the event budget");
  await assert.rejects(() => createCheque(other.id, { direction: "issued", counterparty: "x", amountToman: "1", dueDate: today, accountId: bank.id, eventId }));

  // Money set aside: the goal's progress, and spoken for.
  const { goals } = await import("../src/db/schema");
  const [goal] = await db.insert(goals).values({ userId: owner.id, name: "خانه", targetBase: "100000000", fundAccountId: bank.id } as any).returning();
  await p.addGoalContribution(owner.id, goal.id, "30000000", today);
  await assert.rejects(() => p.addGoalContribution(owner.id, goal.id, "-40000000", today), /بیشتر/);
  await assert.rejects(() => p.addGoalContribution(other.id, goal.id, "1", today));
  const g = (await listGoals(owner.id)).find((x: any) => x.id === goal.id)!;
  assert.equal(g.savedToman, "30000000");
  assert.equal(g.earmarked, true);
  assert.equal(await p.earmarkedToman(owner.id), "30000000");
  await p.deleteGoal(owner.id, goal.id);
  assert.equal((await listGoals(owner.id)).some((x: any) => x.id === goal.id), false);
  assert.equal(await p.earmarkedToman(owner.id), "0", "a deleted goal holds nothing back");

  // A fund is a goal of another kind: listed with funds, never with goals.
  const { listFunds } = await import("../src/features/planning/service");
  await p.createFund(owner.id, { name: "اضطراری", kind: "emergency", targetToman: "60000000" });
  assert.equal((await listFunds(owner.id)).length, 1);
  assert.equal((await listGoals(owner.id)).some((x: any) => x.name === "اضطراری"), false);

  // A plain monthly payment (what «تعهدات» held) recurs in every month of the forecast.
  const { plannedTransactions } = await import("../src/db/schema");
  const before = await outflowNow();
  await db.insert(plannedTransactions).values({ userId: owner.id, title: "اجاره", plannedDate: today, direction: "outflow", amountBase: "1000000", recurrence: "monthly" } as any);
  assert.equal((await outflowNow()) - before, 3 * 1000000, "three months, three rents");

  // Toman with an assumed inflation: an estimate from its start date.
  assert.equal(p.inflate("100", "100", "2024-01-01", "2025-01-01"), "200");
  assert.equal(p.inflate("100", "0", "2020-01-01", "2025-01-01"), "100");
  await p.createUndated(owner.id, { direction: "payable", title: "با تورم", unit: "toman", quantity: "100000000", startDate: plusDays(today, -730), inflationPct: "30" });
  const inflated = (await p.listUndated(owner.id)).find((x) => x.title === "با تورم")!;
  assert.equal(inflated.nominalToman, "100000000");
  assert.ok(Number(inflated.valueToman) > 168000000 && Number(inflated.valueToman) < 170000000, inflated.valueToman ?? "");
  await assert.rejects(() => p.createUndated(owner.id, { direction: "payable", title: "بی تاریخ", unit: "toman", quantity: "1", inflationPct: "20" }), /تاریخ/);
  await p.deleteUndated(owner.id, inflated.id);

  // Undated: listed at its value; only its owner can remove it.
  await p.createUndated(owner.id, { direction: "payable", title: "تعهد خانوادگی", unit: "toman", quantity: "500000000" });
  const [row] = await p.listUndated(owner.id);
  assert.equal(row.valueToman, "500000000");
  assert.equal((await p.listUndated(other.id)).length, 0);
  await assert.rejects(() => p.deleteUndated(other.id, row.id));
  await p.deleteUndated(owner.id, row.id);
  assert.equal((await p.listUndated(owner.id)).length, 0);
});
