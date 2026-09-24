/**
 * خودرو — running costs and due dates.
 *
 *  • each car gets one stable tag («پژو_۲۰۶»), suffixed only on a clash
 *  • running costs = expenses carrying the car's tag + premiums of policies linked
 *    to the car, each entry counted once; untagged spending is not the car's
 *  • a due date is a reminder; «انجام شد» rolls a repeating one forward from its
 *    own date; another tenant can neither add to nor complete it
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, users, userFxSettings, vehicleAssets } from "../src/db/schema";
import { jalaliToIso, todayIso } from "../src/lib/format";
import { addJalaliMonths } from "../src/features/income/recurring";
import { vehicleTag } from "../src/features/vehicles/service";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("vehicle tags", () => {
  assert.equal(vehicleTag("پژو", "۲۰۶", 1, new Set()), "پژو_۲۰۶");
  assert.equal(vehicleTag("پژو", "۲۰۶", 2, new Set(["پژو_۲۰۶"])), "پژو_۲۰۶_۲", "a second identical car");
  assert.equal(addJalaliMonths(jalaliToIso(1403, 12, 30), 12), jalaliToIso(1404, 12, 29), "30 Esfand of leap 1403 → 29 Esfand of common 1404");
});

test("vehicles: costs by tag and linked premiums, due dates, isolation", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { createPolicy, getPremiumPlan, listPolicies } = await import("../src/features/insurance/service");
  const { listVehicleOverview, ensureVehicleTags } = await import("../src/features/vehicles/service");
  const { addDueDateAction, completeDueDateAction } = await import("../src/app/actions/vehicles");
  const { getReminders } = await import("../src/features/notifications/service");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("driver");
  const other = await mk("stranger");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  const [rwa] = await db.insert(assetClasses).values({ code: "vehicle", name: "خودرو" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: owner.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  await db.insert(accounts).values({ userId: owner.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
  await db.insert(accounts).values({ userId: owner.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  const today = todayIso();
  const ownedSince = new Date(`${today}T00:00:00Z`);
  ownedSince.setUTCFullYear(ownedSince.getUTCFullYear() - 1);
  const [carAsset] = await db.insert(assets).values({ symbol: `CAR-V-${Math.random().toString(36).slice(2, 6)}`, name: "پژو", classId: rwa.id, decimals: 0 } as any).returning();
  const [car] = await db
    .insert(vehicleAssets)
    .values({ assetId: carAsset.id, userId: owner.id, brand: "پژو", model: "۲۰۶", year: 1398, userSeq: 1, ownershipDate: ownedSince.toISOString().slice(0, 10), purchasePriceToman: "400000000" } as any)
    .returning();

  cookie = (await createSession(owner.id)).token;
  const tags = await ensureVehicleTags(owner.id);
  assert.equal(tags.get(car.id), "پژو_۲۰۶");
  assert.equal((await ensureVehicleTags(owner.id)).get(car.id), "پژو_۲۰۶", "stable");

  const tree = await listCategoryTree(owner.id);
  const fuel = tree.flatMap((g) => g.children).find((c) => c.code === "TRN-FUEL")!;
  const food = tree.flatMap((g) => g.children).find((c) => c.code === "FOD-GROCERY-HOME")!;
  const incomeLeaf = (await listCategoryTree(owner.id, "income")).flatMap((g) => g.children)[0];
  const post = async (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ entryDate: today, ...fields })) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
  };
  await post({ type: "income", primaryAccountId: bank.id, categoryId: incomeLeaf.id, nativeAmount: "100000000", irtAmount: "100000000", description: "حقوق" });
  await post({ type: "expense", primaryAccountId: bank.id, categoryId: fuel.id, irtAmount: "300000", description: "بنزین", tags: "#پژو_۲۰۶" });
  await post({ type: "expense", primaryAccountId: bank.id, categoryId: fuel.id, irtAmount: "999999", description: "بنزین ماشین دوست" });
  await post({ type: "expense", primaryAccountId: bank.id, categoryId: food.id, irtAmount: "50000", description: "نان" });

  // A third-party premium, paid from its reminder — and ALSO tagged: counted once.
  await createPolicy(owner.id, { kind: "third_party", title: "ثالث پژو", startDate: today, endDate: addJalaliMonths(today, 12), premiumToman: "6000000", premiumFrequency: "annual", payAccountId: bank.id, insuredVehicleId: car.id });
  const [policy] = await listPolicies(owner.id);
  const plan = (await getPremiumPlan(policy.nextPlanId!, owner.id))!;
  await post({ type: "expense", primaryAccountId: bank.id, categoryId: plan.categoryId!, irtAmount: "6000000", description: "حق بیمه ثالث", planId: plan.id, tags: "#پژو_۲۰۶" });

  let [view] = await listVehicleOverview(owner.id, today);
  assert.equal(view.costs.total, "6300000", "fuel with the car's tag + the premium once; the friend's fuel and bread are not the car's");
  assert.equal(view.costs.entries, 2);
  assert.equal(view.costs.last12Months, "6300000");
  assert.ok(view.monthlyCostToman && Number(view.monthlyCostToman) > 0);

  // Due dates.
  const due = new FormData();
  for (const [k, v] of Object.entries({ vehicleId: car.id, kind: "inspection", dueDate: addDays(today, 5), repeatMonths: "12" })) due.set(k, v);
  assert.equal((await addDueDateAction(null, due)).ok, true);
  const reminder = (await getReminders(owner.id)).find((r) => r.kind === "vehicle");
  assert.ok(reminder, "an inspection due in 5 days is a reminder");
  assert.match(reminder!.title, /معاینه فنی/);
  [view] = await listVehicleOverview(owner.id, today);
  const dueId = view.dueDates[0].id;

  cookie = (await createSession(other.id)).token;
  assert.equal((await completeDueDateAction(dueId)).ok, false, "another tenant cannot complete it");
  assert.equal((await addDueDateAction(null, due)).ok, false, "nor add to someone else's car");
  cookie = (await createSession(owner.id)).token;

  assert.equal((await completeDueDateAction(dueId)).ok, true);
  [view] = await listVehicleOverview(owner.id, today);
  assert.deepEqual(view.dueDates.map((d) => d.dueDate), [addJalaliMonths(addDays(today, 5), 12)], "rolled a year forward from its own date");
  assert.equal((await getReminders(owner.id)).some((r) => r.kind === "vehicle"), false, "next year's is not a reminder yet");
});

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
