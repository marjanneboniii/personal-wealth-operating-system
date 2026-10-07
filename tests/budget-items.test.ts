import { createReadySession } from "./support/ready-session";
/**
 * ریز اقلام بودجه — a wedding budget split into ring, dress, hall…
 *
 *  • a template budget is created with its lines in one go; each line gets a
 *    tag prefixed with the budget's own («عروسی_حلقه»)
 *  • an expense tagged with a line counts toward the line AND the budget; one
 *    tagged with both counts once toward the budget
 *  • lines are edited / removed only by the budget's owner; deleting the budget
 *    never touches an expense
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, users, userFxSettings } from "../src/db/schema";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("a wedding budget with its lines", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction, createBudgetAction, addBudgetItemAction, updateBudgetItemAction, deleteBudgetItemAction, deleteBudgetAction } = await import(
    "../src/app/actions"
  );
  const { listBudgets } = await import("../src/features/planning/service");
  const { lineTag } = await import("../src/features/planning/budgetItems");
  const { todayIso } = await import("../src/lib/format");
  const { sql } = await import("drizzle-orm");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  const [u] = await db.insert(users).values({ name: "w", username: `bi-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  const [other] = await db.insert(users).values({ name: "o", username: `bio-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
  for (const x of [u, other]) await db.insert(userFxSettings).values({ userId: x.id, currentRate: "100000" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: `cash-bi-${Date.now()}`, name: "نقد" } as any).returning();
  const [irt] = await db.insert(assets).values({ symbol: `IRT`, name: "تومان", classId: cash.id, decimals: 0 } as any).onConflictDoNothing().returning();
  const irtId = irt?.id ?? (await db.select().from(assets)).find((a: any) => a.symbol === "IRT")!.id;
  const [bank] = await db.insert(accounts).values({ userId: u.id, code: "1010", name: "بانک", type: "asset", assetId: irtId } as any).returning();
  await db.insert(accounts).values({ userId: u.id, code: "5900", name: "هزینه", type: "expense", assetId: irtId } as any);
  const food = (await listCategoryTree(u.id)).flatMap((g) => g.children).find((c) => c.code === "FOD-GROCERY-HOME")!;
  const today = todayIso();
  cookie = (await createReadySession(u.id)).token;

  const fd = new FormData();
  for (const [k, v] of Object.entries({
    name: "عروسی ما",
    tag: "عروسی",
    template: "wedding",
    amountBase: "500000000",
    periodStart: today,
    periodEnd: today,
    items: JSON.stringify([
      { title: "حلقه", amountToman: "150000000" },
      { title: "لباس عروس و داماد", amountToman: "80000000" },
      { title: "تالار", amountToman: "0" },
    ]),
  }))
    fd.set(k, v);
  const created = await createBudgetAction(null, fd);
  assert.equal(created.ok, true, created.message);

  let [b] = await listBudgets(u.id);
  assert.equal(b.template, "wedding");
  assert.deepEqual(
    b.items.map((i: any) => i.tag),
    ["عروسی_حلقه", "عروسی_لباس_عروس_و_داماد", "عروسی_تالار"],
    "each line has the budget's tag as its prefix",
  );

  const spend = async (amount: string, tags: string) => {
    const f = new FormData();
    for (const [k, v] of Object.entries({ type: "expense", primaryAccountId: bank.id, categoryId: food.id, irtAmount: amount, entryDate: today, description: "خرید", tags })) f.set(k, v);
    const r = await createTransactionAction(null, f);
    assert.equal(r.ok, true, r.message);
  };
  await spend("120000000", "#عروسی_حلقه");
  await spend("90000000", "#عروسی_لباس_عروس_و_داماد #عروسی");
  await spend("5000000", "#عروسی");
  await spend("1000000", "");

  [b] = await listBudgets(u.id);
  assert.equal(b.spentToman, "215000000", "lines + the budget's own tag; an entry with both counts once");
  const ring = b.items.find((i: any) => i.title === "حلقه")!;
  assert.equal(ring.spentToman, "120000000");
  assert.equal(Math.round(ring.usage), 80);
  const dress = b.items.find((i: any) => i.title === "لباس عروس و داماد")!;
  assert.equal(dress.over, true, "90M on an 80M line is over");
  assert.equal(b.items.find((i: any) => i.title === "تالار")!.usage, 0, "a line without a ceiling has no usage");

  // Edit, add, remove.
  assert.equal((await updateBudgetItemAction(ring.id, { title: "حلقه ازدواج", amountToman: "200000000" })).ok, true);
  assert.equal((await addBudgetItemAction(b.id, { title: "حلقه", amountToman: "0" })).ok, true);
  [b] = await listBudgets(u.id);
  const renamed = b.items.find((i: any) => i.title === "حلقه ازدواج")!;
  assert.equal(renamed.tag, "عروسی_حلقه", "renaming keeps the tag, so past expenses keep counting");
  assert.equal(renamed.spentToman, "120000000");
  assert.equal(b.items.find((i: any) => i.title === "حلقه")!.tag, "عروسی_حلقه_۲", "a new line never reuses a tag");

  // Another tenant can touch nothing.
  cookie = (await createReadySession(other.id)).token;
  assert.equal((await updateBudgetItemAction(renamed.id, { title: "x", amountToman: "1" })).ok, false);
  assert.equal((await addBudgetItemAction(b.id, { title: "x", amountToman: "1" })).ok, false);
  assert.equal((await deleteBudgetAction(b.id)).ok, false);

  cookie = (await createReadySession(u.id)).token;
  assert.equal((await deleteBudgetItemAction(renamed.id)).ok, true);
  [b] = await listBudgets(u.id);
  assert.equal(b.items.length, 3);
  assert.equal(b.spentToman, "95000000", "the removed line's expenses no longer count");

  assert.equal((await deleteBudgetAction(b.id)).ok, true);
  assert.equal((await listBudgets(u.id)).length, 0);

  // A category budget takes no template and no lines.
  const expense = (await db.select().from(accounts)).find((a: any) => a.userId === u.id && a.code === "5900")!;
  const cat = new FormData();
  for (const [k, v] of Object.entries({ name: "خوراک", accountId: expense.id, template: "wedding", amountBase: "10000000", periodStart: today, periodEnd: today, items: JSON.stringify([{ title: "نان", amountToman: "1" }]) }))
    cat.set(k, v);
  assert.equal((await createBudgetAction(null, cat)).ok, true);
  const [c] = await listBudgets(u.id);
  assert.equal(c.template, null);
  assert.equal(c.items.length, 0);

  assert.equal(lineTag("سفر", "بلیت", ["سفر_بلیت", "سفر_بلیت_۲"]), "سفر_بلیت_۳");

  // A database migration 0054 has not reached: budgets still list and save.
  await db.execute(sql`drop table budget_items`);
  await db.execute(sql`alter table budgets drop column template`);
  const [legacy] = await listBudgets(u.id);
  assert.equal(legacy.name, "خوراک");
  assert.deepEqual(legacy.items, []);
  const plain = new FormData();
  for (const [k, v] of Object.entries({ name: "سفر", tag: "سفر", amountBase: "1000000", periodStart: today, periodEnd: today })) plain.set(k, v);
  const saved = await createBudgetAction(null, plain);
  assert.equal(saved.ok, true, saved.message);
  await createSchemaIfNotExists();
});
