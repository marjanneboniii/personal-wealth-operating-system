/**
 * جستجوی داده — the palette finds the user's own records.
 *
 *  • Arabic ي/ك and the ZWNJ match their Persian forms, in the palette and on /transactions
 *  • a typed amount (Persian digits, separators) finds the entry and the cheque
 *  • #tags, cheque Sayad ids, accounts and deposits are found
 *  • another tenant's records never appear
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { accounts, assetClasses, assets, cheques, deposits, users, userFxSettings } from "../src/db/schema";
import { normalizeSearch, searchAmount } from "../src/lib/searchText";

let cookie: string | null = null;
mock.module("next/headers", { namedExports: { cookies: async () => ({ get: () => (cookie ? { value: cookie } : undefined), set: () => {}, delete: () => {} }), headers: async () => new Headers() } });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

test("search text normalisation", () => {
  assert.equal(normalizeSearch("مسكن  ي"), "مسکن ی");
  assert.equal(normalizeSearch("می‌خواهم"), "می خواهم", "ZWNJ is a space");
  assert.equal(normalizeSearch("آب"), "اب");
  assert.equal(searchAmount("۲۵۰٬۰۰۰"), "250000");
  assert.equal(searchAmount("250,000"), "250000");
  assert.equal(searchAmount("12"), null, "two digits are not an amount search");
  assert.equal(searchAmount("سامان"), null);
});

test("search: own records only, normalised, by amount, tag and Sayad id", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction } = await import("../src/app/actions");
  const { searchEverythingAction } = await import("../src/app/actions/search");
  const { getTransactions } = await import("../src/features/ledger/queries");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const mk = async (name: string) => {
    const [u] = await db.insert(users).values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "user" } as any).returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("finder");
  const other = await mk("stranger");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ userId: owner.id, code: "1010", name: "بانک سامان", type: "asset", assetId: irt.id } as any).returning();
  const [theirs] = await db.insert(accounts).values({ userId: other.id, code: "1010", name: "بانک سامان دیگری", type: "asset", assetId: irt.id } as any).returning();
  for (const u of [owner, other]) {
    await db.insert(accounts).values({ userId: u.id, code: "5900", name: "هزینه", type: "expense", assetId: irt.id } as any);
    await db.insert(accounts).values({ userId: u.id, code: "4010", name: "درآمد", type: "income", assetId: irt.id } as any);
  }
  const leaf = (await listCategoryTree(owner.id)).flatMap((g) => g.children).find((c) => c.code === "FOD-GROCERY-HOME")!;
  const today = new Date().toISOString().slice(0, 10);
  const spend = async (userId: string, accountId: string, description: string, amount: string, tags = "") => {
    cookie = (await createSession(userId)).token;
    const fd = new FormData();
    for (const [k, v] of Object.entries({ type: "expense", primaryAccountId: accountId, categoryId: leaf.id, irtAmount: amount, entryDate: today, description, tags })) fd.set(k, v);
    const r = await createTransactionAction(null, fd);
    assert.equal(r.ok, true, r.message);
  };
  // Stored with the ARABIC kaf — typed on an Arabic keyboard layout.
  await spend(owner.id, bank.id, "اجاره مسكن مهر", "18500000", "#خانه");
  await spend(other.id, theirs.id, "اجاره مسکن همسایه", "18500000", "#خانه");
  await db.insert(cheques).values({ userId: owner.id, direction: "issued", counterparty: "علی رضایی", amountToman: "42000000", dueDate: today, accountId: bank.id, sayadId: "1234567890123456" } as any);
  await db.insert(cheques).values({ userId: other.id, direction: "issued", counterparty: "علی رضایی", amountToman: "42000000", dueDate: today, sayadId: "9999567890123456" } as any);
  await db.insert(deposits).values({ userId: owner.id, kind: "bank", title: "سپرده یک‌ساله", institution: "بانک ملت", accountId: bank.id, payoutAccountId: bank.id, principalToman: "100000000", annualRate: "23", startDate: today } as any);

  cookie = (await createSession(owner.id)).token;
  const find = async (q: string) => searchEverythingAction(q);

  const rent = await find("مسکن");
  assert.deepEqual(rent.filter((h) => h.group === "تراکنش‌ها").map((h) => h.label), ["اجاره مسكن مهر"], "Persian ک finds Arabic ك — and only the owner's");
  assert.ok(rent[0].href.startsWith("/transactions?"));
  const onPage = await getTransactions({ q: "مسکن", userId: owner.id });
  assert.equal(onPage.length, 1, "/transactions?q= uses the same normalisation, so the hit opens a non-empty page");

  const byAmount = await find("۱۸٬۵۰۰٬۰۰۰");
  assert.equal(byAmount.filter((h) => h.group === "تراکنش‌ها").length, 1, "a typed Persian amount finds the entry");
  assert.equal((await find("42,000,000")).filter((h) => h.group === "چک‌ها").length, 1);

  const tag = await find("#خانه");
  assert.deepEqual(tag.filter((h) => h.group === "برچسب‌ها").map((h) => h.label), ["#خانه"]);
  assert.match(tag.find((h) => h.group === "برچسب‌ها")!.hint, /۱/, "counts only the owner's tagged entries");

  assert.equal((await find("1234567890")).filter((h) => h.group === "چک‌ها").length, 1, "Sayad id");
  assert.equal((await find("9999567890")).length, 0, "another tenant's cheque is invisible");
  assert.deepEqual((await find("سامان")).filter((h) => h.group === "حساب‌ها").map((h) => h.label), ["بانک سامان"]);
  assert.ok((await find("یک ساله")).some((h) => h.group === "سپرده‌ها"), "a space finds a word stored with a ZWNJ");
  assert.ok((await find("ملت")).some((h) => h.group === "سپرده‌ها"), "a deposit is found by its bank");
  assert.equal((await find("x")).length, 0, "one character is not a search");

  cookie = null;
  assert.deepEqual(await find("مسکن"), [], "signed out: nothing");
});
