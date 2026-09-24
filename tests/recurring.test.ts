/**
 * پرداخت‌های تکراری — detected from the ledger, never typed twice.
 *
 *  • the same description (month names, digits, ي/ك ignored) in ≥ 3 Jalali months,
 *    at a stable amount, seen in the last 45 days, is a monthly payment
 *  • a one-off, an unstable amount or a lapsed subscription is not
 *  • premiums paid from their reminder are listed once, under insurance
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, users, userFxSettings } from "../src/db/schema";
import { detectRecurring, recurringKey, type ExpenseSample } from "../src/features/recurring/service";
import { addJalaliMonths } from "../src/features/income/recurring";
import { jalaliToIso } from "../src/lib/format";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const at = (y: number, m: number, d: number) => jalaliToIso(y, m, d);
const s = (description: string, entryDate: string, toman: string): ExpenseSample => ({ description, entryDate, toman, category: null, accountName: null });

test("recurring detection", () => {
  assert.equal(recurringKey("اشتراک فیلیمو مهر ۱۴۰۵"), recurringKey("اشتراك فيليمو آبان 1405"));
  assert.equal(recurringKey("خرید دیجی‌کالا دی"), "خرید دیجی کالا", "a month name is a whole word, never cut out of another");
  assert.equal(recurringKey("مهرسا تیرماه"), "مهرسا تیرماه");
  const today = at(1405, 7, 20);
  const found = detectRecurring(
    [
      s("اشتراک فیلیمو مرداد", at(1405, 5, 12), "199000"),
      s("اشتراک فیلیمو شهریور", at(1405, 6, 12), "199000"),
      s("اشتراك فيليمو مهر", at(1405, 7, 12), "209000"),
      // unstable amount → not a bill
      s("خرید آنلاین", at(1405, 5, 3), "100000"),
      s("خرید آنلاین", at(1405, 6, 3), "900000"),
      s("خرید آنلاین", at(1405, 7, 3), "300000"),
      // lapsed: last one > 45 days ago
      s("باشگاه", at(1405, 3, 1), "500000"),
      s("باشگاه", at(1405, 4, 1), "500000"),
      s("باشگاه", at(1405, 5, 1), "500000"),
      // two months only
      s("قبض برق", at(1405, 6, 5), "80000"),
      s("قبض برق", at(1405, 7, 5), "80000"),
      // weekly habit: 4 a month × 3 months → one monthly figure
      ...[5, 12, 19, 26].flatMap((d) => [s("نان", at(1405, 5, d), "50000"), s("نان", at(1405, 6, d), "50000")]),
      ...[5, 12, 19].map((d) => s("نان", at(1405, 7, d), "50000")),
    ],
    today,
  );
  assert.deepEqual(found.map((f) => f.label).sort(), ["اشتراك فيليمو مهر", "نان"].sort());
  const filimo = found.find((f) => f.label.startsWith("اشتراك"))!;
  assert.equal(filimo.monthlyToman, "199000", "the median, not the latest");
  assert.equal(filimo.months, 3);
  assert.equal(filimo.nextExpected, addJalaliMonths(at(1405, 7, 12), 1));
  assert.equal(found.find((f) => f.label === "نان")!.monthlyToman, "183333", "a weekly habit: 11 × 50,000 over 3 months");
});

test("recurring payments from the ledger, premiums once", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { createPolicy, getPremiumPlan, listPolicies } = await import("../src/features/insurance/service");
  const { listRecurringPayments } = await import("../src/features/recurring/service");
  const { todayIso } = await import("../src/lib/format");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const [u] = await db.insert(users).values({ name: "sub", username: `sub-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [other] = await db.insert(users).values({ name: "o", username: `o-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: u.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  await db.insert(accounts).values({ userId: u.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
  await db.insert(accounts).values({ userId: u.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  cookie = (await createSession(u.id)).token;
  const today = todayIso();
  const sub = (await listCategoryTree(u.id)).flatMap((g) => g.children).find((c) => c.code === "COM-SUB")!;
  const incomeLeaf = (await listCategoryTree(u.id, "income")).flatMap((g) => g.children)[0];
  const post = async (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
  };
  await post({ type: "income", primaryAccountId: bank.id, categoryId: incomeLeaf.id, nativeAmount: "100000000", irtAmount: "100000000", entryDate: addJalaliMonths(today, -3), description: "حقوق" });
  for (const back of [2, 1, 0]) await post({ type: "expense", primaryAccountId: bank.id, categoryId: sub.id, irtAmount: "250000", entryDate: addJalaliMonths(today, -back), description: "اشتراک اسپاتیفای" });

  // A monthly premium paid three times from its reminder: an expense with the same description each month.
  await createPolicy(u.id, { kind: "health", title: "درمان تکمیلی", startDate: addJalaliMonths(today, -2), endDate: addJalaliMonths(today, 10), premiumToman: "1200000", premiumFrequency: "monthly", payAccountId: bank.id }, addJalaliMonths(today, -2));
  for (let i = 0; i < 3; i++) {
    const [policy] = await listPolicies(u.id);
    const plan = (await getPremiumPlan(policy.nextPlanId!, u.id))!;
    await post({ type: "expense", primaryAccountId: bank.id, categoryId: plan.categoryId!, irtAmount: "1200000", entryDate: plan.plannedDate <= today ? plan.plannedDate : today, description: "حق بیمه درمان", planId: plan.id });
  }

  const data = await listRecurringPayments(u.id, today);
  assert.deepEqual(data.detected.map((d) => d.label), ["اشتراک اسپاتیفای"], "the premium is not detected a second time");
  assert.equal(data.detected[0].monthlyToman, "250000");
  assert.deepEqual(data.premiums.map((p) => [p.title, p.monthlyToman]), [["درمان تکمیلی", "1200000"]]);
  assert.equal(data.monthlyTotal, "1450000");
  assert.deepEqual((await listRecurringPayments(other.id, today)).detected, [], "another tenant sees nothing");
});
