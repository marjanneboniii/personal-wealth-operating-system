import assert from "node:assert/strict";
import { test } from "node:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import {
  accounts,
  assetClasses,
  assets,
  currencies,
  debts,
  expenseCategories,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  prices,
  users,
} from "../src/db/schema";
import {
  EXPENSE_CATEGORY_CATALOG,
  EXPENSE_CATEGORY_LEAVES,
  EXPENSE_CATEGORY_NODE_COUNT,
} from "../src/features/categories/catalog";
import {
  addCustomCategory,
  ensureCategoryCatalog,
  ensureReserveAccount,
  getCategoryByCode,
  getFlowByCategory,
  listCategoryTree,
  RESERVE_ACCOUNT_CODE,
} from "../src/features/categories/service";
import { postEntry, recordExpense } from "../src/features/ledger/service";
import { getAccountBalances, getCashflow, getFlowByAccount } from "../src/features/ledger/queries";
import { todayIso } from "../src/lib/format";

async function resetDb() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(debts);
  await db.delete(expenseCategories);
  await db.delete(accounts);
  await db.delete(prices);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(users);
}

/** Minimal tenant fixture: one user, USD base asset, bank + expense + liability accounts. */
async function fixture() {
  await resetDb();
  await ensureCategoryCatalog();

  const [user] = await db.insert(users).values({ name: "کاربر تست", role: "user" }).returning();
  const [cur] = await db
    .insert(currencies)
    .values({ code: "USD", name: "دلار آمریکا", symbol: "$", decimals: 2, isFiat: true })
    .returning();
  const [cls] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک", color: "#38bdf8" }).returning();
  const [usd] = await db
    .insert(assets)
    .values({ symbol: "USD", name: "دلار", classId: cls.id, currencyId: cur.id, decimals: 2 })
    .returning();
  await db.insert(prices).values({ assetId: usd.id, asOf: todayIso(), priceBase: "1", source: "manual" });

  const [bank] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "1010", name: "بانک تست", type: "asset", assetId: usd.id })
    .returning();
  const [expAcct] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "5010", name: "خوراک و خانه", type: "expense", assetId: usd.id })
    .returning();
  const [liab] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "2010", name: "وام تست", type: "liability", assetId: usd.id })
    .returning();
  const [equity] = await db
    .insert(accounts)
    .values({ userId: user.id, code: "3010", name: "سرمایه افتتاحیه", type: "equity", assetId: usd.id })
    .returning();

  return { user, usd, bank, expAcct, liab, equity };
}

/* ------------------------------------------------------------------ */

test("standard catalog — 16 parents, hierarchical, unique codes/names, non-cash flag", async () => {
  await resetDb();
  await ensureCategoryCatalog();

  // Static taxonomy invariants
  assert.equal(EXPENSE_CATEGORY_CATALOG.length, 16, "16 top-level categories");
  const leafCodes = EXPENSE_CATEGORY_LEAVES.map((l) => l.code);
  assert.equal(new Set(leafCodes).size, leafCodes.length, "leaf codes unique");
  const leafNames = EXPENSE_CATEGORY_LEAVES.map((l) => l.name);
  assert.equal(new Set(leafNames).size, leafNames.length, "leaf names unique (no overlapping categories)");
  const depr = EXPENSE_CATEGORY_LEAVES.find((l) => l.code === "TRN-DEPR");
  assert.ok(depr, "vehicle depreciation reserve leaf exists");
  assert.equal(depr!.nature, "non_cash", "depreciation is non-cash");

  // DB bootstrap
  const tree = await listCategoryTree();
  assert.equal(tree.length, 16);
  const totalNodes = tree.length + tree.reduce((s, p) => s + p.children.length, 0);
  assert.equal(totalNodes, EXPENSE_CATEGORY_NODE_COUNT);
  const allCodes = await db.select({ code: expenseCategories.code }).from(expenseCategories);
  assert.equal(new Set(allCodes.map((r) => r.code)).size, allCodes.length, "codes unique in DB");

  // Idempotent bootstrap — running it again must not duplicate anything
  await ensureCategoryCatalog();
  const after = await db.select({ code: expenseCategories.code }).from(expenseCategories);
  assert.equal(after.length, allCodes.length, "ensureCategoryCatalog is idempotent");
});

test("expense entry carries its category and feeds the category report", async () => {
  const { user, usd, bank, expAcct } = await fixture();
  const fuel = (await getCategoryByCode("TRN-FUEL"))!;
  const rent = (await getCategoryByCode("HSG-RENT"))!;

  await recordExpense({
    entryDate: todayIso(),
    description: "بنزین",
    cashAccountId: bank.id,
    categoryAccountId: expAcct.id,
    assetId: usd.id,
    quantity: "30",
    baseValue: "30",
    categoryId: fuel.id,
    userId: user.id,
  });
  await recordExpense({
    entryDate: todayIso(),
    description: "اجاره",
    cashAccountId: bank.id,
    categoryAccountId: expAcct.id,
    assetId: usd.id,
    quantity: "70",
    baseValue: "70",
    categoryId: rent.id,
    userId: user.id,
  });

  const entries = await db.select().from(journalEntries).where(eq(journalEntries.userId, user.id));
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.categoryId), "category persisted on the journal entry");

  const flows = await getFlowByCategory(6, user.id);
  const fuelRow = flows.find((f) => f.code === "TRN-FUEL");
  const rentRow = flows.find((f) => f.code === "HSG-RENT");
  assert.ok(fuelRow && rentRow);
  assert.equal(Number(fuelRow!.total), 30);
  assert.equal(Number(rentRow!.total), 70);
  assert.equal(fuelRow!.parentCode, "TRN");
  assert.equal(rentRow!.parentName, "مسکن و ساختمان");

  // Cash expense shows up in the cash-flow outflow
  const flow = await getCashflow(6, user.id);
  const month = flow.at(-1)!;
  assert.equal(Number(month.outflow), 100);
});

test("non-cash depreciation — expense in reports, never a cash outflow", async () => {
  const { user, usd, bank, expAcct } = await fixture();
  const depr = (await getCategoryByCode("TRN-DEPR"))!;
  const reserve = await ensureReserveAccount(user.id);
  assert.equal(reserve.code, RESERVE_ACCOUNT_CODE);
  assert.equal(reserve.type, "equity");

  // A real cash expense first, then a non-cash depreciation entry
  await recordExpense({
    entryDate: todayIso(),
    description: "بنزین",
    cashAccountId: bank.id,
    categoryAccountId: expAcct.id,
    assetId: usd.id,
    quantity: "40",
    baseValue: "40",
    categoryId: (await getCategoryByCode("TRN-FUEL"))!.id,
    userId: user.id,
  });
  await postEntry({
    entryDate: todayIso(),
    type: "expense",
    description: "استهلاک خودرو — ذخیره تعمیرات",
    categoryId: depr.id,
    userId: user.id,
    postings: [
      { accountId: reserve.id, assetId: usd.id, quantity: "-25", baseValue: "-25", memo: "ثبت غیرنقدی" },
      { accountId: expAcct.id, assetId: usd.id, quantity: "25", baseValue: "25" },
    ],
  });

  // Category report: depreciation visible, flagged non-cash
  const flows = await getFlowByCategory(6, user.id);
  const deprRow = flows.find((f) => f.code === "TRN-DEPR");
  assert.ok(deprRow, "depreciation present in category report");
  assert.equal(deprRow!.nature, "non_cash");
  assert.equal(Number(deprRow!.total), 25);

  // Cash flow: ONLY the cash expense counts as outflow
  const flow = await getCashflow(6, user.id);
  assert.equal(Number(flow.at(-1)!.outflow), 40, "non-cash entry excluded from cash outflow");

  // The bank balance never moved because of the depreciation entry
  const balances = await getAccountBalances(user.id);
  const bankBal = balances.find((b) => b.accountId === bank.id)!;
  assert.equal(Number(bankBal.baseValue), -40, "cash account reflects only the real cash expense");
});

test("debt repayment is never counted as an expense", async () => {
  const { user, usd, bank, expAcct, liab, equity } = await fixture();

  // Opening cash (balanced against opening equity)
  await postEntry({
    entryDate: todayIso(),
    type: "opening",
    description: "افتتاحیه",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: usd.id, quantity: "500", baseValue: "500" },
      { accountId: equity.id, assetId: usd.id, quantity: "-500", baseValue: "-500" },
    ],
  });

  // (a) Debt WITH a ledger liability account: cash ↓ / liability ↓ — no expense leg
  await postEntry({
    entryDate: todayIso(),
    type: "debt_repayment",
    description: "بازپرداخت اصل وام",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: usd.id, quantity: "-120", baseValue: "-120" },
      { accountId: liab.id, assetId: usd.id, quantity: "120", baseValue: "120", memo: "کاهش مانده بدهی" },
    ],
  });

  // (b) Planning-only debt (no liability account): booked against an expense
  // account for money tracking, but still NOT an expense in reports.
  await postEntry({
    entryDate: todayIso(),
    type: "debt_repayment",
    description: "بازپرداخت بدهی بدون حساب بدهی",
    userId: user.id,
    postings: [
      { accountId: bank.id, assetId: usd.id, quantity: "-30", baseValue: "-30" },
      { accountId: expAcct.id, assetId: usd.id, quantity: "30", baseValue: "30" },
    ],
  });

  // Expense breakdown must be EMPTY — no real expense happened
  const expFlows = await getFlowByAccount("expense", 6, user.id);
  assert.equal(expFlows.length, 0, "debt repayments excluded from expense aggregations");

  // Cash-flow outflow also empty
  const flow = await getCashflow(6, user.id);
  assert.equal(Number(flow.at(-1)!.outflow ?? 0), 0, "debt repayment is not a cash expense");

  // Liability balance decreased by the repayment
  const balances = await getAccountBalances(user.id);
  const liabBal = balances.find((b) => b.accountId === liab.id)!;
  assert.equal(Number(liabBal.baseValue), 120, "liability increased on the credit side (balance decreased)");

  // Bank balance reflects opening minus both repayments
  const bankBal = balances.find((b) => b.accountId === bank.id)!;
  assert.equal(Number(bankBal.baseValue), 350);
});

test("custom sub-categories — extensible, duplicate siblings rejected (overlap prevention)", async () => {
  const { user } = await fixture();
  const tree = await listCategoryTree(user.id);
  const misc = tree.find((p) => p.code === "MSC")!;

  const created = await addCustomCategory(user.id, { name: "هزینه باشگاه", parentId: misc.id });
  assert.equal(created.level, 1);
  assert.equal(created.isSystem, false);
  assert.equal(created.userId, user.id);

  // Visible in the tenant tree
  const tree2 = await listCategoryTree(user.id);
  const misc2 = tree2.find((p) => p.code === "MSC")!;
  assert.ok(misc2.children.some((c) => c.id === created.id));

  // Duplicate sibling name rejected (overlap prevention)
  await assert.rejects(
    addCustomCategory(user.id, { name: "هزینه باشگاه", parentId: misc.id }),
    /هم‌پوشان|همین نام/,
  );
  // Same name under a DIFFERENT parent is allowed (different domain)
  const hsg = tree.find((p) => p.code === "HSG")!;
  const okElsewhere = await addCustomCategory(user.id, { name: "هزینه باشگاه", parentId: hsg.id });
  assert.ok(okElsewhere.id);

  // Invalid parents rejected
  await assert.rejects(addCustomCategory(user.id, { name: "x جدید", parentId: created.id }), /دسته‌های اصلی/);
});
