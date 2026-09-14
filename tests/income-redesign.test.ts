/**
 * درآمد — sources, units, occupations and monthly reminders.
 *
 *  • a source is an income CATEGORY (salary, bank interest, rent…), never a ledger account
 *  • the amount is booked in the receiving account's own unit — Toman, Tether
 *  • a database that already holds the expense tree receives the income tree
 *  • a monthly income is a reminder, recorded only on a tap, then rescheduled
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
  expenseCategories,
  journalEntries,
  plannedTransactions,
  postings,
  users,
  userFxSettings,
  wallexAssetCatalog,
} from "../src/db/schema";
import { EXPENSE_CATEGORY_CATALOG, INCOME_CATEGORY_CATALOG } from "../src/features/categories/catalog";
import { normalizeOccupations, suggestedIncomeCodes } from "../src/features/income/occupations";
import { nextMonthlyDate } from "../src/features/income/recurring";
import { jalaliToIso } from "../src/lib/format";

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

let db: any, createSchemaIfNotExists: any, createSession: any, createTransactionAction: any;
let ensureCategoryCatalog: any, listCategoryTree: any, getFlowByCategory: any;
let listDueIncomePlans: any, closeIncomeOccurrence: any, recordPlannedIncomeAction: any;
let getAccountBalances: any, getEntryFxSnapshots: any, setUserOccupations: any, getUserOccupations: any;

const modulesReady = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createTransactionAction } = await import("../src/app/actions"));
  ({ ensureCategoryCatalog, listCategoryTree, getFlowByCategory } = await import("../src/features/categories/service"));
  ({ listDueIncomePlans, closeIncomeOccurrence } = await import("../src/features/income/service"));
  ({ recordPlannedIncomeAction } = await import("../src/app/actions/income"));
  ({ getAccountBalances } = await import("../src/features/ledger/queries"));
  ({ getEntryFxSnapshots } = await import("../src/features/ledger/fxSnapshots"));
  ({ setUserOccupations, getUserOccupations } = await import("../src/features/preferences/service"));
})();

const TODAY = "2026-09-14"; // 1405/06/23

test("the income catalogue is complete, unique and separate from expenses", () => {
  const codes = INCOME_CATEGORY_CATALOG.flatMap((g) => [g.code, ...(g.children ?? []).map((c) => c.code)]);
  assert.equal(new Set(codes).size, codes.length, "no duplicate income code");
  assert.ok(codes.every((c) => c.startsWith("INC-")));
  const expenseCodes = new Set(EXPENSE_CATEGORY_CATALOG.flatMap((g) => [g.code, ...(g.children ?? []).map((c) => c.code)]));
  assert.ok(codes.every((c) => !expenseCodes.has(c)), "no overlap with the expense tree");
  for (const leaf of ["INC-SAL-NET", "INC-INV-INTEREST", "INC-INV-DIVIDEND", "INC-INV-RENT", "INC-PEN-PENSION", "INC-SUP-SUBSIDY", "INC-BIZ-FREELANCE", "INC-OTH-MISC"]) {
    assert.ok(codes.includes(leaf), leaf);
  }
  const investment = INCOME_CATEGORY_CATALOG.find((g) => g.code === "INC-INV")!;
  assert.match(investment.description ?? "", /فروش دارایی/, "asset-sale profit is booked by the trade module, not here");
});

test("occupations: several at once, invalid codes dropped, suggestions follow them", () => {
  assert.deepEqual(normalizeOccupations(["retired", "freelancer", "bogus", "retired"]), ["freelancer", "retired"]);
  assert.deepEqual(normalizeOccupations("employee_government,student"), ["employee_government", "student"]);
  const suggestions = suggestedIncomeCodes(["retired", "freelancer"]);
  assert.equal(suggestions[0], "INC-BIZ-FREELANCE");
  assert.ok(suggestions.includes("INC-PEN-PENSION"));
  assert.deepEqual(suggestedIncomeCodes([]), ["INC-INV-INTEREST", "INC-SUP-SUBSIDY"]);
});

test("monthly dates follow the Jalali month and clamp to its length", () => {
  assert.equal(nextMonthlyDate(TODAY, 25), jalaliToIso(1405, 7, 25));
  assert.equal(nextMonthlyDate(TODAY, 31), jalaliToIso(1405, 7, 30), "Mehr has 30 days");
  assert.equal(nextMonthlyDate(jalaliToIso(1405, 12, 10), 5), jalaliToIso(1406, 1, 5));
});

async function fixture() {
  await createSchemaIfNotExists();
  await db.execute(sql`truncate journal_entries, lots, accounts, assets, asset_classes, user_fx_settings, wallex_asset_catalog, planned_transactions restart identity cascade`);
  // An existing install: the expense tree is there, the income tree is not yet.
  await ensureCategoryCatalog();
  await db.delete(expenseCategories).where(eq(expenseCategories.kind, "income"));

  const [user] = await db
    .insert(users)
    .values({ name: "Earner", username: `earner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "100000" } as any);
  await db.insert(wallexAssetCatalog).values({ symbol: "USDT", displayName: "تتر", latinName: "Tether", kind: "stablecoin", priceTmn: "105000", priceUsdt: "1" } as any);
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک" } as any).returning();
  const [stable] = await db.insert(assetClasses).values({ code: "stable", name: "استیبل‌کوین" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [usdt] = await db.insert(assets).values({ symbol: "USDT", name: "تتر", classId: stable.id, decimals: 6 } as any).returning();
  const [bank] = await db.insert(accounts).values({ code: "1010", name: "بانک ملت", type: "asset", assetId: irt.id, userId: user.id } as any).returning();
  const [wallet] = await db.insert(accounts).values({ code: "1110", name: "کیف تتر", type: "asset", assetId: usdt.id, userId: user.id } as any).returning();

  const { token } = await createSession(user.id);
  cookieJar.value = token;
  return { user, bank, wallet };
}

const income = (fields: Record<string, string>) => {
  const fd = new FormData();
  fd.set("type", "income");
  fd.set("entryDate", TODAY);
  fd.set("feeMode", "irt");
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

const qtyOf = async (userId: string, accountId: string) =>
  D((await getAccountBalances(userId)).find((b: any) => b.accountId === accountId)?.quantity ?? "0");

const leafId = async (userId: string, code: string, kind = "income") => {
  const tree = await listCategoryTree(userId, kind);
  for (const group of tree) for (const child of group.children) if (child.code === code) return child.id as string;
  throw new Error(`no ${kind} leaf ${code}`);
};

test("salary in Toman and freelance income in Tether, by source, with a monthly reminder", async () => {
  await modulesReady;
  const f = await fixture();

  const incomeTree = await listCategoryTree(f.user.id, "income");
  assert.deepEqual(incomeTree.map((g: any) => g.code), INCOME_CATEGORY_CATALOG.map((g) => g.code), "the income tree reached an existing install");
  const expenseTree = await listCategoryTree(f.user.id);
  assert.ok(expenseTree.every((g: any) => !g.code.startsWith("INC-")), "the expense picker never shows income sources");

  // ۱. Net salary into the bank, repeating on the 25th.
  const salary = await createTransactionAction(
    null,
    income({
      description: "حقوق شهریور",
      primaryAccountId: f.bank.id,
      categoryId: await leafId(f.user.id, "INC-SAL-NET"),
      nativeAmount: "45000000",
      irtAmount: "45000000",
      recurring: "monthly",
      recurringDay: "25",
    }),
  );
  assert.equal(salary.ok, true, salary.message);
  assert.equal((await qtyOf(f.user.id, f.bank.id)).toString(), "45000000");

  const [salaryEntry] = await db.select().from(journalEntries).where(eq(journalEntries.type, "income"));
  assert.equal(salaryEntry.categoryId, await leafId(f.user.id, "INC-SAL-NET"));
  const legs = await db
    .select({ code: accounts.code, type: accounts.type })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(eq(postings.entryId, salaryEntry.id));
  assert.ok(legs.some((l: any) => l.code === "4010" && l.type === "income"), "the income account is resolved on the server");

  const [plan] = await db.select().from(plannedTransactions).where(eq(plannedTransactions.userId, f.user.id));
  assert.equal(plan.status, "pending");
  assert.equal(plan.plannedDate, jalaliToIso(1405, 7, 25));
  assert.equal(D(plan.amountNative).toFixed(0), "45000000");

  // ۲. 250 USDT into the Tether wallet — exactly 250 USDT, frozen at the Tether rate.
  const freelance = await createTransactionAction(
    null,
    income({
      description: "پروژهٔ طراحی",
      primaryAccountId: f.wallet.id,
      categoryId: await leafId(f.user.id, "INC-BIZ-FREELANCE"),
      nativeAmount: "250",
      irtAmount: "26250000",
    }),
  );
  assert.equal(freelance.ok, true, freelance.message);
  assert.equal((await qtyOf(f.user.id, f.wallet.id)).toString(), "250");
  const [usdtEntry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.type, "income"), eq(journalEntries.description, "پروژهٔ طراحی")));
  assert.equal(D((await getEntryFxSnapshots([usdtEntry.id])).get(usdtEntry.id)!.irtAmount).toFixed(0), "26250000", "250 × 105,000");

  // ۳. An expense category is not an income source.
  const wrongKind = await createTransactionAction(
    null,
    income({ description: "اشتباه", primaryAccountId: f.bank.id, categoryId: await leafId(f.user.id, "MSC-MISC", "expense"), nativeAmount: "1000", irtAmount: "1000" }),
  );
  assert.equal(wrongKind.ok, false);

  // ۴. Reports break income down by source.
  const flows = await getFlowByCategory(6, f.user.id, "income");
  const salaryFlow = flows.find((r: any) => r.code === "INC-SAL-NET");
  assert.ok(salaryFlow && D(salaryFlow.total).gt(0), "income totals are positive");
  assert.equal(D(salaryFlow.totalToman).toFixed(0), "45000000");
  assert.ok(flows.some((r: any) => r.code === "INC-BIZ-FREELANCE"));
  assert.ok((await getFlowByCategory(6, f.user.id)).every((r: any) => !r.code.startsWith("INC-")), "expense report unchanged");

  // ۵. The reminder comes due and is recorded with one tap.
  await db.update(plannedTransactions).set({ plannedDate: TODAY }).where(eq(plannedTransactions.id, plan.id));
  const due = await listDueIncomePlans(f.user.id);
  assert.equal(due.length, 1);
  assert.equal(due[0].categoryName, "حقوق ماهانه");
  const tapped = await recordPlannedIncomeAction(plan.id);
  assert.equal(tapped.ok, true, tapped.message);
  assert.equal((await qtyOf(f.user.id, f.bank.id)).toString(), "90000000");
  const [closed] = await db.select().from(plannedTransactions).where(eq(plannedTransactions.id, plan.id));
  assert.equal(closed.status, "executed");
  assert.ok(closed.executedEntryId);
  const pending = await db
    .select()
    .from(plannedTransactions)
    .where(and(eq(plannedTransactions.userId, f.user.id), eq(plannedTransactions.status, "pending")));
  assert.equal(pending.length, 1, "next month is scheduled");
  assert.equal(pending[0].plannedDate, nextMonthlyDate(TODAY, 25));
  assert.equal((await recordPlannedIncomeAction(plan.id)).ok, false, "a recorded reminder cannot be recorded twice");

  // ۶. «این ماه دریافت نشد» posts nothing and still schedules the next one.
  const entriesBefore = (await db.select().from(journalEntries)).length;
  await closeIncomeOccurrence({ planId: pending[0].id, userId: f.user.id, entryId: null });
  assert.equal((await db.select().from(journalEntries)).length, entriesBefore);
  const [skipped] = await db.select().from(plannedTransactions).where(eq(plannedTransactions.id, pending[0].id));
  assert.equal(skipped.status, "cancelled");
  assert.equal(
    (await db.select().from(plannedTransactions).where(and(eq(plannedTransactions.userId, f.user.id), eq(plannedTransactions.status, "pending")))).length,
    1,
  );

  // ۷. Occupations persist per user.
  await setUserOccupations(f.user.id, ["retired", "freelancer", "bogus"]);
  assert.deepEqual(await getUserOccupations(f.user.id), ["freelancer", "retired"]);
});

test("concurrent requests seed the category catalogue once — no group appears twice", async () => {
  await modulesReady;
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();
  await db.delete(expenseCategories).where(eq(expenseCategories.kind, "income"));

  // The transaction form loads the expense and income trees in parallel.
  await Promise.all([
    listCategoryTree(undefined, "income"),
    listCategoryTree(undefined, "expense"),
    ensureCategoryCatalog(),
    ensureCategoryCatalog(),
  ]);

  const systemIncome = await db
    .select({ code: expenseCategories.code })
    .from(expenseCategories)
    .where(and(eq(expenseCategories.kind, "income"), sql`${expenseCategories.userId} is null`));
  const codes = systemIncome.map((r: { code: string }) => r.code);
  assert.equal(new Set(codes).size, codes.length, "every income code is stored once");

  const tree = await listCategoryTree(undefined, "income");
  const names = tree.map((g: { name: string }) => g.name);
  assert.equal(names.filter((n: string) => n === "حقوق و دستمزد").length, 1);
  assert.equal(tree.length, INCOME_CATEGORY_CATALOG.length);
});
