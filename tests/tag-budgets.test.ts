/**
 * بودجه روی برچسب — cap everything carrying one #tag (a trip, a renovation).
 *
 *  • exactly one of account / tag; the tag is normalised like every tag
 *  • spend = expenses carrying the tag, inside the period, at their frozen Toman —
 *    a later rate change does not move money already spent
 *  • account budgets are unchanged
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, users, userFxSettings } from "../src/db/schema";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("a budget on a hashtag", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction, createBudgetAction } = await import("../src/app/actions");
  const { listBudgets } = await import("../src/features/planning/service");
  const { invalidateUserFxRateCache } = await import("../src/features/fx/userRate");
  const { todayIso } = await import("../src/lib/format");
  const { eq } = await import("drizzle-orm");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  const [u] = await db.insert(users).values({ name: "t", username: `tb-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [other] = await db.insert(users).values({ name: "o", username: `tbo-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
  await db.insert(userFxSettings).values({ userId: other.id, currentRate: "100000" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: u.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  const [theirBank] = await db.insert(accounts).values({ userId: other.id, code: "1010", name: "بانک", type: "asset", assetId: irt.id } as any).returning();
  for (const x of [u, other]) await db.insert(accounts).values({ userId: x.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
  const food = (await listCategoryTree(u.id)).flatMap((g) => g.children).find((c) => c.code === "FOD-GROCERY-HOME")!;
  const today = todayIso();
  const spend = async (userId: string, accountId: string, amount: string, tags: string, entryDate = today) => {
    cookie = (await createSession(userId)).token;
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: "expense", primaryAccountId: accountId, categoryId: food.id, irtAmount: amount, entryDate, description: "سفر", tags })) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
  };
  await spend(u.id, bank.id, "3000000", "#سفر_مشهد");
  await spend(u.id, bank.id, "2000000", "#سفر_مشهد #خانه");
  await spend(u.id, bank.id, "999000", "");
  await spend(u.id, bank.id, "7000000", "#سفر_مشهد", "2020-01-05");
  await spend(other.id, theirBank.id, "5000000", "#سفر_مشهد");

  cookie = (await createSession(u.id)).token;
  const budget = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: "سفر مشهد", amountBase: "10000000", periodStart: addDays(today, -10), periodEnd: addDays(today, 10), ...fields })) fd.set(k, v);
    return createBudgetAction(null, fd);
  };
  assert.equal((await budget({})).ok, false, "neither account nor tag");
  const expense = (await db.select().from(accounts).where(eq(accounts.userId, u.id))).find((a: any) => a.code === "5900")!;
  assert.equal((await budget({ accountId: expense.id, tag: "سفر" })).ok, false, "not both");
  assert.equal((await budget({ tag: "#سفر مشهد" })).ok, true, "normalised like every tag");

  let [b] = (await listBudgets(u.id)).filter((x) => x.tag);
  assert.equal(b.tag, "سفر_مشهد");
  assert.equal(b.spentToman, "5000000", "both tagged expenses in the period; not the untagged one, the 2020 one or another tenant's");
  assert.equal(b.remainingToman, "5000000");

  await db.update(userFxSettings).set({ currentRate: "300000" }).where(eq(userFxSettings.userId, u.id));
  invalidateUserFxRateCache(u.id);
  [b] = (await listBudgets(u.id)).filter((x) => x.tag);
  assert.equal(b.spentToman, "5000000", "frozen Toman: a new rate does not change money already spent");
  assert.deepEqual((await listBudgets(other.id)).filter((x) => x.tag), [], "another tenant has no such budget");
});

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
