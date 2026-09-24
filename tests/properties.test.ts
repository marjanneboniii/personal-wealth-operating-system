/**
 * ملک: اجاره و بازده خالص.
 *
 *  • each property gets one stable tag from its area, suffixed only on a clash
 *  • rent = tagged income; costs = tagged expenses + premiums of linked policies
 *  • gross and net yield over 12 months against the property's current value
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, realEstateProperties, users, userFxSettings } from "../src/db/schema";
import { propertyTag, yields } from "../src/features/properties/service";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("property tags and yields", () => {
  assert.equal(propertyTag("ونک", 1, new Set()), "ونک");
  assert.equal(propertyTag("ونک", 2, new Set(["ونک"])), "ونک_۲", "a second property in the same area");
  assert.match(propertyTag(null, 3, new Set()), /^ملک_/, "no area → «ملک_n»");
  assert.deepEqual(yields("600000000", "100000000", "10000000000"), { gross: "6.0", net: "5.0" });
  assert.deepEqual(yields("1", "0", null), { gross: null, net: null });
});

test("rent, costs and yield of a property", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { createPolicy, getPremiumPlan, listPolicies } = await import("../src/features/insurance/service");
  const { listPropertyEconomics, ensurePropertyTags } = await import("../src/features/properties/service");
  const { todayIso } = await import("../src/lib/format");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  const [u] = await db.insert(users).values({ name: "landlord", username: `ll-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [other] = await db.insert(users).values({ name: "o", username: `llo-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  const [rwa] = await db.insert(assetClasses).values({ code: "real_estate", name: "ملک" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: u.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  await db.insert(accounts).values({ userId: u.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
  await db.insert(accounts).values({ userId: u.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  const [homeAsset] = await db.insert(assets).values({ symbol: `P-${Math.random().toString(36).slice(2, 6)}`, name: "آپارتمان", classId: rwa.id, decimals: 0 } as any).returning();
  const [home] = await db.insert(realEstateProperties).values({ assetId: homeAsset.id, userId: u.id, area: "ونک", city: "تهران", currentValueToman: "10000000000", userSeq: 1 } as any).returning();
  cookie = (await createSession(u.id)).token;
  const today = todayIso();
  const tag = (await ensurePropertyTags(u.id)).get(home.id)!;
  assert.equal(tag, "ونک");

  const tree = await listCategoryTree(u.id);
  const charge = tree.flatMap((g) => g.children).find((c) => c.code.startsWith("HSG-") && c.code !== "HSG-RENT")!;
  const rent = (await listCategoryTree(u.id, "income")).flatMap((g) => g.children).find((c) => c.code === "INC-INV-RENT")!;
  const post = async (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ entryDate: today, ...fields })) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
  };
  for (let i = 0; i < 3; i++) await post({ type: "income", primaryAccountId: bank.id, categoryId: rent.id, nativeAmount: "50000000", irtAmount: "50000000", description: "اجاره ونک", tags: `#${tag}` });
  await post({ type: "income", primaryAccountId: bank.id, categoryId: rent.id, nativeAmount: "9000000", irtAmount: "9000000", description: "حقوق — بی‌ربط" });
  await post({ type: "expense", primaryAccountId: bank.id, categoryId: charge.id, irtAmount: "4000000", description: "شارژ ونک", tags: `#${tag}` });
  await createPolicy(u.id, { kind: "fire", title: "آتش‌سوزی ونک", startDate: today, endDate: addYear(today), premiumToman: "1000000", premiumFrequency: "annual", payAccountId: bank.id, insuredPropertyId: home.id });
  const [policy] = await listPolicies(u.id);
  const plan = (await getPremiumPlan(policy.nextPlanId!, u.id))!;
  await post({ type: "expense", primaryAccountId: bank.id, categoryId: plan.categoryId!, irtAmount: "1000000", description: "حق بیمه آتش‌سوزی", planId: plan.id });

  const [e] = await listPropertyEconomics(u.id, today);
  assert.equal(e.rent12, "150000000", "three rents; untagged income is not the property's");
  assert.equal(e.costs12, "5000000", "the tagged charge + the linked premium");
  assert.equal(e.net12, "145000000");
  assert.deepEqual([e.grossYield, e.netYield], ["1.5", "1.5"]);
  assert.deepEqual(await listPropertyEconomics(other.id, today), [], "another tenant sees nothing");
});

function addYear(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d.toISOString().slice(0, 10);
}
