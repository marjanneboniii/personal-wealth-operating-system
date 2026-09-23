/**
 * سپرده‌ها — metadata over money already in the ledger; interest is a monthly reminder.
 *
 *  • monthly interest = principal × rate ÷ 12; the first payout is the next start-day after today
 *  • registering validates accounts (the user's own; interest into a Toman account), rate and dates
 *  • the interest reminder carries the deposit from month to month and stops at maturity
 *  • closing cancels the pending reminder; nothing posts, ever
 *  • maturity is a reminder; another tenant can neither see nor close a deposit
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { and, eq } from "drizzle-orm";
import { D, Decimal } from "../src/domain/decimal";
import { accounts, assetClasses, assets, deposits, journalEntries, plannedTransactions, users, userFxSettings } from "../src/db/schema";
import { firstPayoutDate, monthlyInterest } from "../src/features/deposits/service";
import { jalaliToIso, todayIso } from "../src/lib/format";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) => (name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined),
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("interest and payout dates", () => {
  assert.equal(monthlyInterest("1000000000", "24"), "20000000", "1B × 24% ÷ 12");
  assert.equal(monthlyInterest("150000000", "23.5"), "2937500");
  const today = jalaliToIso(1405, 7, 10);
  // Started on the 5th of a past month: next payout is the 5th of next month.
  assert.equal(firstPayoutDate(jalaliToIso(1405, 3, 5), today), jalaliToIso(1405, 8, 5));
  // Started on the 20th of this month's past: the 20th of this month is still ahead.
  assert.equal(firstPayoutDate(jalaliToIso(1405, 6, 20), today), jalaliToIso(1405, 7, 20));
  // Starting in the future: one month after the start.
  assert.equal(firstPayoutDate(jalaliToIso(1405, 7, 15), today), jalaliToIso(1405, 8, 15));
  // The 31st in a 30-day month lands on its last day.
  assert.equal(firstPayoutDate(jalaliToIso(1405, 6, 31), today), jalaliToIso(1405, 7, 30));
  // Nothing after maturity.
  assert.equal(firstPayoutDate(jalaliToIso(1405, 3, 5), today, jalaliToIso(1405, 8, 1)), null);
});

test("deposits: register, remind monthly, stop at maturity, close, isolate", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog } = await import("../src/features/categories/service");
  const { createDepositAction, closeDepositAction, deleteDepositAction } = await import("../src/app/actions/deposits");
  const { listDeposits } = await import("../src/features/deposits/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { projectCashflow } = await import("../src/features/planning/service");
  const { getReminders } = await import("../src/features/notifications/service");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("saver");
  const other = await mk("stranger");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  const [stable] = await db.insert(assetClasses).values({ code: "stable", name: "استیبل" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [usdt] = await db.insert(assets).values({ symbol: "USDT", name: "تتر", classId: stable.id, decimals: 6 } as any).returning();
  const [depositAcc] = await db.insert(accounts).values({ code: "1020", name: "سپرده ملت", type: "asset", assetId: irt.id, userId: owner.id } as any).returning();
  const [wallet] = await db.insert(accounts).values({ code: "1110", name: "کیف تتر", type: "asset", assetId: usdt.id, userId: owner.id } as any).returning();
  const [foreignAcc] = await db.insert(accounts).values({ code: "1020", name: "حساب دیگری", type: "asset", assetId: irt.id, userId: other.id } as any).returning();

  const today = todayIso();
  const addDays = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const form = (f: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ kind: "bank", title: "سپرده یک‌ساله", principalToman: "1000000000", annualRate: "24", startDate: addDays(-40), accountId: depositAcc.id, ...f })) fd.set(k, v);
    return fd;
  };

  // ── Validation ──
  assert.equal((await createDepositAction(null, form({}))).ok, false, "anonymous cannot register");
  cookieJar.value = (await createSession(owner.id)).token;
  assert.equal((await createDepositAction(null, form({ accountId: foreignAcc.id }))).ok, false, "a foreign account is refused");
  assert.equal((await createDepositAction(null, form({ payoutAccountId: wallet.id }))).ok, false, "interest goes to a Toman account");
  assert.equal((await createDepositAction(null, form({ annualRate: "120" }))).ok, false, "rate is at most 100%");
  assert.equal((await createDepositAction(null, form({ maturityDate: addDays(-50) }))).ok, false, "maturity after start");

  // ── Register: one reminder, in Toman, tied to the deposit ──
  // Maturity 35 days after the first payout: exactly one more payout fits before it.
  const first = firstPayoutDate(addDays(-40), today)!;
  const maturity = (() => {
    const d = new Date(`${first}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 35);
    return d.toISOString().slice(0, 10);
  })();
  const created = await createDepositAction(null, form({ annualRate: "۲۴", maturityDate: maturity }));
  assert.equal(created.ok, true, created.message);
  const [dep] = await listDeposits(owner.id);
  assert.equal(dep.monthlyInterestToman, "20000000");
  assert.equal(dep.nextPayoutDate, firstPayoutDate(dep.startDate, today, dep.maturityDate));
  const plans = await db.select().from(plannedTransactions).where(eq(plannedTransactions.depositId, dep.id));
  assert.equal(plans.length, 1);
  assert.equal(D(plans[0].amountBase).toFixed(0), "20000000", "Toman — the forecast's unit");
  assert.equal(plans[0].toAccountId, depositAcc.id);
  assert.equal((await db.select().from(journalEntries)).length, 0, "registering posts nothing");

  const projection = await projectCashflow(3, "base", owner.id);
  assert.ok(Decimal.sum(projection.points.map((p: any) => p.inflow)).gte("20000000"), "the interest is in the forecast");

  // ── Recording this month's interest schedules the next, same deposit ──
  const record = async (planId: string) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: "income", entryDate: today, feeMode: "irt", description: "سود سپرده", primaryAccountId: depositAcc.id, categoryId: plans[0].categoryId!, nativeAmount: "20000000", irtAmount: "20000000", planId })) fd.set(k, v);
    return createTransactionAction(null, fd);
  };
  const r1 = await record(plans[0].id);
  assert.equal(r1.ok, true, r1.message);
  let pending = await db.select().from(plannedTransactions).where(and(eq(plannedTransactions.depositId, dep.id), eq(plannedTransactions.status, "pending")));
  assert.equal(pending.length, 1, "next month's reminder, still tied to the deposit");
  assert.ok(pending[0].plannedDate > first && pending[0].plannedDate <= maturity);
  const r2 = await record(pending[0].id);
  assert.equal(r2.ok, true, r2.message);
  pending = await db.select().from(plannedTransactions).where(and(eq(plannedTransactions.depositId, dep.id), eq(plannedTransactions.status, "pending")));
  assert.equal(pending.length, 0, "the month after falls past maturity: the chain stops");

  // ── Maturity is a reminder when it is close ──
  await db.update(deposits).set({ maturityDate: addDays(4) }).where(eq(deposits.id, dep.id));
  const reminders = await getReminders(owner.id, today);
  assert.ok(reminders.some((r: any) => r.kind === "deposit" && r.title.includes("سپرده یک‌ساله")));
  assert.ok(!(await getReminders(other.id, today)).some((r: any) => r.kind === "deposit"), "not another tenant's");

  // ── Isolation and closing ──
  cookieJar.value = (await createSession(other.id)).token;
  assert.equal((await closeDepositAction(dep.id)).ok, false, "another user cannot close it");
  assert.equal((await listDeposits(other.id)).length, 0);
  cookieJar.value = (await createSession(owner.id)).token;
  const closed = await closeDepositAction(dep.id);
  assert.equal(closed.ok, true, closed.message);
  pending = await db.select().from(plannedTransactions).where(and(eq(plannedTransactions.depositId, dep.id), eq(plannedTransactions.status, "pending")));
  assert.equal(pending.length, 0, "closing cancels the pending interest reminder");
  assert.equal((await closeDepositAction(dep.id)).ok, false, "a closed deposit stays closed");

  // Entries recorded as interest stay; deleting the deposit never touches the ledger.
  const entriesBefore = (await db.select().from(journalEntries)).length;
  assert.equal((await deleteDepositAction(dep.id)).ok, true);
  assert.equal((await db.select().from(journalEntries)).length, entriesBefore);
  assert.equal((await listDeposits(owner.id)).length, 0);
});
