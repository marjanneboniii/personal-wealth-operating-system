/**
 * خرید اقساطی — the preset is an ordinary debt: four interest-free monthly
 * installments that add up to the price, through the same server path.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { debts, installments, users, userFxSettings } from "../src/db/schema";
import { bnplPreset } from "../src/features/planning/bnpl";
import { addJalaliMonths } from "../src/features/income/recurring";
import { scheduleSubmission } from "../src/components/debts/DebtScheduleFields";
import { generateDueDates } from "../src/features/planning/obligations";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("BNPL preset → four equal interest-free installments", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { createDebtAction } = await import("../src/app/actions");
  const { todayIso } = await import("../src/lib/format");
  await createSchemaIfNotExists();
  const [u] = await db.insert(users).values({ name: "b", username: `bnpl-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
  cookie = (await createSession(u.id)).token;
  const today = todayIso();

  const preset = bnplPreset(today);
  assert.equal(preset.schedule.firstDueDate, addJalaliMonths(today, 1));
  const sub = scheduleSubmission(preset.schedule, "12000000", today);
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    direction: "payable",
    title: "خرید اقساطی اسنپ‌پی",
    creditor: "اسنپ‌پی",
    principalIrt: "12000000",
    interestRate: preset.interestRate,
    startDate: today,
    installmentCount: String(sub.installmentCount),
    intervalMonths: String(sub.intervalMonths),
    customDueDates: sub.customDueDates.join(","),
    installmentIrt: sub.installmentIrt,
    firstDueDate: sub.firstDueDate,
  })) fd.set(k, v);
  const r = await createDebtAction(null, fd);
  assert.equal(r.ok, true, r.message);
  const [debt] = await db.select().from(debts).where(eq(debts.userId, u.id));
  assert.equal(Number(debt.interestRate ?? 0), 0);
  const rows = await db.select().from(installments).where(eq(installments.debtId, debt.id));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((i: any) => Number(i.amountToman)).sort(), [3000000, 3000000, 3000000, 3000000]);
  // The preset sets the first due date; the rest follow the app's one schedule
  // generator, exactly as for any other monthly debt.
  assert.deepEqual(
    rows.map((i: any) => i.dueDate).sort(),
    generateDueDates({ kind: "recurring", count: 4, intervalMonths: 1, firstDueDate: addJalaliMonths(today, 1) }),
  );
});
