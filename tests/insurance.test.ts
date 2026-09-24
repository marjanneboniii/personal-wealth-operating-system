/**
 * بیمه‌نامه‌ها — metadata over money; premiums are reminders recorded with a tap.
 *
 *  • premium dates step in Jalali months from the start; past premiums count as paid
 *  • registering posts nothing; the pending premium reaches reminders and the forecast
 *  • paying from the reminder is an expense in the insurance category, closes that
 *    occurrence in the same DB transaction and schedules the next — and cannot be paid twice
 *  • a life policy with a cash value: premiums are TRANSFERS into its savings account,
 *    so net worth keeps the money and no expense is reported
 *  • coverage gaps: a car without third-party cover, an uninsured or under-insured home
 *  • renewal and expiry reminders; another tenant can neither link nor cancel
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { accounts, assetClasses, assets, insurancePolicies, journalEntries, plannedTransactions, realEstateProperties, users, userFxSettings, vehicleAssets } from "../src/db/schema";
import { D } from "../src/domain/decimal";
import { jalaliToIso, todayIso } from "../src/lib/format";
import { addJalaliMonths, annualPremium, followingPremiumDate, nextPremiumDate } from "../src/features/insurance/service";
import { transferDestinationError } from "../src/features/trade/venues";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("premium dates in Jalali months", () => {
  assert.equal(addJalaliMonths(jalaliToIso(1405, 6, 31), 1), jalaliToIso(1405, 7, 30), "31 Shahrivar + 1 → last day of Mehr");
  assert.equal(addJalaliMonths(jalaliToIso(1405, 11, 10), 3), jalaliToIso(1406, 2, 10), "across the year");
  const today = jalaliToIso(1405, 7, 10);
  assert.equal(nextPremiumDate(jalaliToIso(1405, 1, 5), "monthly", today), jalaliToIso(1405, 8, 5), "mid-term: the next one, no arrears");
  assert.equal(nextPremiumDate(jalaliToIso(1405, 1, 5), "quarterly", today), jalaliToIso(1405, 10, 5));
  assert.equal(nextPremiumDate(jalaliToIso(1405, 1, 5), "annual", today, jalaliToIso(1406, 1, 5)), null, "no premium at or after the end of the term");
  assert.equal(nextPremiumDate(today, "once", today), today);
  assert.equal(nextPremiumDate(jalaliToIso(1405, 1, 5), "once", today), null, "a single premium in the past was paid");
  assert.equal(followingPremiumDate(jalaliToIso(1405, 1, 5), "monthly", jalaliToIso(1405, 8, 5)), jalaliToIso(1405, 9, 5));
  assert.equal(annualPremium("1500000", "monthly"), "18000000");
  assert.equal(annualPremium("3000000", "quarterly"), "12000000");
  const bank = { symbol: "IRT", walletKind: "bank", name: "بانک ملت" };
  assert.equal(transferDestinationError(bank, { symbol: "IRT", walletKind: "insurance", name: "اندوخته بیمه عمر" }), null, "a premium's saved part goes into the policy's savings");
  assert.ok(transferDestinationError(bank, { symbol: "IRT", walletKind: "fund", name: "صندوق نقد" }), "a generic fund wallet is still refused");
});

test("insurance: register, remind, pay once, savings stay in net worth, gaps, renewal, isolation", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog } = await import("../src/features/categories/service");
  const { createPolicyAction, cancelPolicyAction, renewPolicyAction } = await import("../src/app/actions/insurance");
  const { listPolicies, coverageGaps, getPremiumPlan } = await import("../src/features/insurance/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { projectCashflow } = await import("../src/features/planning/service");
  const { getReminders } = await import("../src/features/notifications/service");
  const { getNetWorth, getExpenseIncomeTotals } = await import("../src/features/ledger/queries");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("insured");
  const other = await mk("stranger");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  const [rwa] = await db.insert(assetClasses).values({ code: "real_estate", name: "ملک" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: owner.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  const [foreignBank] = await db.insert(accounts).values({ userId: other.id, code: "1010", name: "بانک دیگری", type: "asset", assetId: irt.id } as any).returning();
  for (const u of [owner, other]) {
    await db.insert(accounts).values({ userId: u.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
    await db.insert(accounts).values({ userId: u.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  }
  const [carAsset] = await db.insert(assets).values({ symbol: `CAR-${Math.random().toString(36).slice(2, 6)}`, name: "پژو", classId: rwa.id, decimals: 0 } as any).returning();
  const [car] = await db.insert(vehicleAssets).values({ assetId: carAsset.id, userId: owner.id, brand: "پژو", model: "۲۰۶", year: 1400 } as any).returning();
  const [homeAsset] = await db.insert(assets).values({ symbol: `HOME-${Math.random().toString(36).slice(2, 6)}`, name: "آپارتمان", classId: rwa.id, decimals: 0 } as any).returning();
  const [home] = await db.insert(realEstateProperties).values({ assetId: homeAsset.id, userId: owner.id, area: "سعادت‌آباد", city: "تهران", currentValueToman: "10000000000" } as any).returning();

  // Fund the bank so premiums can leave it.
  cookie = (await createSession(owner.id)).token;
  const today = todayIso();
  const fund = new FormData();
  const { listCategoryTree } = await import("../src/features/categories/service");
  const incomeLeaf = (await listCategoryTree(owner.id, "income")).flatMap((g) => g.children)[0];
  for (const [k, v] of Object.entries({ type: "income", primaryAccountId: bank.id, nativeAmount: "100000000", irtAmount: "100000000", entryDate: today, description: "حقوق", categoryId: incomeLeaf.id })) fund.set(k, v);
  assert.equal((await createTransactionAction(null, fund)).ok, true);

  let gaps = await coverageGaps(owner.id, today);
  assert.deepEqual(gaps.map((g) => g.kind).sort(), ["property_uninsured", "vehicle_no_third_party"]);

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ startDate: today, premiumFrequency: "annual", payAccountId: bank.id, ...fields })) fd.set(k, v);
    return fd;
  };
  const entriesBefore = (await db.select().from(journalEntries)).length;
  const created = await createPolicyAction(null, form({ kind: "third_party", title: "ثالث پژو", premiumToman: "6000000", insuredVehicleId: car.id, endDate: addYear(today) }));
  assert.equal(created.ok, true, created.message);
  assert.equal((await db.select().from(journalEntries)).length, entriesBefore, "registering posts nothing");

  let [policy] = await listPolicies(owner.id);
  assert.ok(policy.nextPlanId, "the first premium (due today) is pending");
  assert.equal(policy.nextPremiumDate, today);
  const reminder = (await getReminders(owner.id)).find((r) => r.kind === "insurance" && r.key.startsWith("premium:"));
  assert.ok(reminder, "the premium is a reminder");
  assert.equal(reminder!.amountToman, "6000000");
  assert.match(reminder!.href, /^\/new\?type=expense&planId=/);
  const projection = await projectCashflow(12, "base", owner.id);
  assert.ok(projection.points.some((p: any) => D(p.outflow).gte("6000000")), "the premium is in the forecast");

  // Pay from the reminder: expense in «بیمه شخص ثالث خودرو».
  const plan = (await getPremiumPlan(policy.nextPlanId!, owner.id))!;
  assert.ok(plan.categoryId, "the insurance category is resolved");
  const pay = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: "expense", primaryAccountId: bank.id, categoryId: plan.categoryId!, irtAmount: "6000000", entryDate: today, description: "حق بیمه ثالث", planId: plan.id })) fd.set(k, v);
    return createTransactionAction(null, fd);
  };
  const paid = await pay();
  assert.equal(paid.ok, true, paid.message);
  const again = await pay();
  assert.equal(again.ok, false, "the same reminder cannot be paid twice");
  const premiumEntries = await db.execute(sql`select je.id, ec.code from journal_entries je join expense_categories ec on ec.id = je.category_id where je.user_id = ${owner.id}::uuid and je.type = 'expense'`);
  assert.deepEqual(premiumEntries.rows.map((r: any) => r.code), ["TRN-INS-TP"], "one entry, in the third-party category; the failed retry rolled back");
  [policy] = await listPolicies(owner.id);
  assert.equal(policy.nextPlanId, null, "annual, one-year term: nothing after the only premium");
  gaps = await coverageGaps(owner.id, today);
  assert.deepEqual(gaps.map((g) => g.kind), ["property_uninsured"], "the car is covered now");

  // Home under-insured: 5 billion cover on a 10 billion home.
  assert.equal((await createPolicyAction(null, form({ kind: "fire", title: "آتش‌سوزی منزل", premiumToman: "900000", coverageToman: "5000000000", insuredPropertyId: home.id, endDate: addYear(today) }))).ok, true);
  gaps = await coverageGaps(owner.id, today);
  assert.deepEqual(gaps.map((g) => g.kind), ["property_underinsured"]);
  assert.match(gaps[0].title, /۵۰٪/);

  // Life with a cash value: a savings account, premiums are transfers.
  const nwBefore = D((await getNetWorth(owner.id)).netWorth);
  const expBefore = D((await getExpenseIncomeTotals(owner.id)).expense);
  assert.equal((await createPolicyAction(null, form({ kind: "life", title: "عمر و سرمایه‌گذاری", premiumToman: "2000000", premiumFrequency: "monthly", withSavings: "yes", endDate: addYear(addYear(today)) }))).ok, true);
  const life = (await listPolicies(owner.id)).find((p) => p.kind === "life")!;
  assert.ok(life.savingsAccountId, "a savings account was opened");
  const lifePlan = (await getPremiumPlan(life.nextPlanId!, owner.id))!;
  assert.equal(lifePlan.savingsAccountId, life.savingsAccountId);
  assert.equal(lifePlan.categoryId, null, "a transfer has no expense category");
  const transfer = new FormData();
  for (const [k, v] of Object.entries({ type: "transfer", primaryAccountId: bank.id, counterAccountId: life.savingsAccountId!, irtAmount: "2000000", entryDate: today, description: "حق بیمه عمر", planId: lifePlan.id })) transfer.set(k, v);
  const moved = await createTransactionAction(null, transfer);
  assert.equal(moved.ok, true, moved.message);
  assert.equal(D((await getNetWorth(owner.id)).netWorth).sub(nwBefore).abs().lt("0.01"), true, "net worth keeps the saved premium");
  assert.equal(D((await getExpenseIncomeTotals(owner.id)).expense).sub(expBefore).abs().lt("0.01"), true, "no expense reported");
  const lifeAfter = (await listPolicies(owner.id)).find((p) => p.kind === "life")!;
  assert.equal(D(lifeAfter.savingsBalanceToman!).toString(), "2000000");
  assert.ok(lifeAfter.nextPremiumDate && lifeAfter.nextPremiumDate > today, "next month's premium is scheduled");
  const [nextLifePlan] = await db.select().from(plannedTransactions).where(and(eq(plannedTransactions.insurancePolicyId, life.id), eq(plannedTransactions.status, "pending")));
  assert.equal(nextLifePlan.toAccountId, life.savingsAccountId, "still into savings");

  // Expiry: a term ending in 10 days is a renewal reminder; renewing replaces it.
  assert.equal((await createPolicyAction(null, form({ kind: "health", title: "درمان تکمیلی", premiumToman: "1000000", startDate: addDays(today, -355), endDate: addDays(today, 10) }))).ok, true);
  const health = (await listPolicies(owner.id)).find((p) => p.kind === "health")!;
  assert.ok((await getReminders(owner.id)).some((r) => r.key.startsWith(`renewal:${health.id}`)));
  const renew = new FormData();
  for (const [k, v] of Object.entries({ id: health.id, startDate: addDays(today, 10), endDate: addDays(today, 375), premiumToman: "1300000" })) renew.set(k, v);
  const renewed = await renewPolicyAction(null, renew);
  assert.equal(renewed.ok, true, renewed.message);
  const all = await db.select().from(insurancePolicies).where(eq(insurancePolicies.userId, owner.id));
  assert.equal(all.find((p) => p.id === health.id)!.status, "renewed");
  const successor = all.find((p) => p.renewedFromId === health.id)!;
  assert.equal(D(successor.premiumToman).toString(), "1300000");
  assert.equal((await getReminders(owner.id)).some((r) => r.key.startsWith(`renewal:${health.id}`)), false, "renewed: the reminder is gone");

  // Isolation.
  cookie = (await createSession(other.id)).token;
  assert.equal((await createPolicyAction(null, form({ kind: "third_party", title: "x", premiumToman: "1", payAccountId: bank.id }))).ok, false, "cannot pay from another tenant's account");
  assert.equal((await createPolicyAction(null, form({ kind: "third_party", title: "x", premiumToman: "1", payAccountId: foreignBank.id, insuredVehicleId: car.id }))).ok, false, "cannot insure another tenant's car");
  assert.equal((await cancelPolicyAction(policy.id)).ok, false);
  assert.deepEqual(await listPolicies(other.id), []);
});

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addYear(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
