/**
 * پوشش داده — one score over checks that already exist elsewhere.
 *
 *  • only applicable checks count (no properties → no valuation check)
 *  • an unanswered checklist, a «بله» with nothing registered, an account never
 *    reconciled and an unreviewed import each fail their own check
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, onboardingIntents, users, userFxSettings } from "../src/db/schema";
import { scoreCoverage } from "../src/features/coverage/service";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("score over applicable checks", () => {
  const c = (ok: boolean) => ({ key: String(Math.random()), label: "", ok, detail: null, href: "/", action: "", icon: "check" as const });
  assert.deepEqual([scoreCoverage([c(true), c(false), c(true)]).percent, scoreCoverage([]).percent], [67, 100]);
});

test("data coverage from the user's own records", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { dataCoverage } = await import("../src/features/coverage/service");
  const { recordBalanceCheckpoint } = await import("../src/features/reconcile/service");
  const { ASSET_CATEGORIES } = await import("../src/features/onboarding/categories");
  const { todayIso } = await import("../src/lib/format");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  const [u] = await db.insert(users).values({ name: "c", username: `cov-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: u.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  await db.insert(accounts).values({ userId: u.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  cookie = (await createSession(u.id)).token;
  const today = todayIso();

  let cov = await dataCoverage(u.id, {}, today);
  assert.deepEqual(cov.checks.map((c) => [c.key, c.ok]), [["checklist", false], ["reviewed", true]], "nothing answered, no account with money, no property");

  const incomeLeaf = (await listCategoryTree(u.id, "income")).flatMap((g) => g.children)[0];
  const fd = new FormData();
  for (const [k, v] of Object.entries({ type: "income", primaryAccountId: bank.id, categoryId: incomeLeaf.id, nativeAmount: "5000000", irtAmount: "5000000", entryDate: today, description: "حقوق" })) fd.set(k, v);
  assert.equal((await createTransactionAction(null, fd)).ok, true);
  for (const category of ASSET_CATEGORIES) {
    await db.insert(onboardingIntents).values({ userId: u.id, category, answer: category === "vehicle" ? "yes" : "no", itemsAtAnswer: 0 } as any);
  }
  cov = await dataCoverage(u.id, { stalePrices: 2 }, today);
  const byKey = Object.fromEntries(cov.checks.map((c) => [c.key, c]));
  assert.equal(byKey.checklist.ok, true);
  assert.equal(byKey.registered.ok, false, "said «بله» to a car, registered none");
  assert.match(byKey.registered.detail!, /خودرو/);
  assert.equal(byKey.reconciled.ok, false, "an account with money, never compared with the bank");
  assert.equal(byKey.prices.ok, false);

  await recordBalanceCheckpoint({ userId: u.id, accountId: bank.id, asOf: today, balance: "5000000", source: "manual" });
  cov = await dataCoverage(u.id, { stalePrices: 0 }, today);
  assert.equal(cov.checks.find((c) => c.key === "reconciled")!.ok, true);
  assert.equal(cov.passed, cov.total - 1, "only the missing car remains");
});
