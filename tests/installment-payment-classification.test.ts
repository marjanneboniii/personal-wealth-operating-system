/**
 * INSTALLMENT-PAYMENT CLASSIFICATION — «پرداخت اقساط» is a bucket of its own.
 *
 * Closes findings F-1, F-2 and F-3 of
 * docs/AUDIT-INSTALLMENT-PAYMENT-CLASSIFICATION-2026-09-07.md:
 *
 *   F-3  a repayment of a debt that has no ledger liability account must land
 *        on the dedicated expense chart row 5960 «پرداخت اقساط», NEVER on 5900
 *        «هزینه متفرقه» (where it mixed loan payments with groceries);
 *   F-1  the reports KPI is built from ENTRIES with the app's own exclusion
 *        (`je.type not in ('debt_repayment')`), so a payment can no longer
 *        inflate «کل هزینه ثبت‌شده» / sink «نرخ پس‌انداز» — and the excluded
 *        amount is returned (with its frozen contractual Toman) so the report
 *        can disclose it instead of hiding it;
 *   F-2  a budget measures spend from real expenses only. A payment cannot eat
 *        a household budget's ceiling any more — unless the budget was
 *        DELIBERATELY bound to 5960, the one ceiling for which installment
 *        outflow is what is being capped.
 *
 * The legacy shape is pinned too: a `debt_repayment` already booked on 5900 by
 * an older release stays excluded (history is never rewritten, the read paths
 * classify by ENTRY TYPE, not by account).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
  budgets,
  currencies,
  debts,
  entryFxSnapshots,
  installments,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
  users,
  userFxSettings,
} from "../src/db/schema";

const cookieJar: { value: string | null } = { value: null };
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({
      get: (name: string) =>
        name === "pwos_session" && cookieJar.value ? { value: cookieJar.value } : undefined,
      set: () => {},
      delete: () => {},
    }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

let db: any, createSchemaIfNotExists: any;
let createSession: any, createDebtAction: any;
let listInstallmentSchedule: any, payInstallment: any;
let listBudgets: any, getExpenseIncomeTotals: any, getAccountBalances: any;
let postEntry: any, todayIso: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction } = await import("../src/app/actions"));
  ({ listInstallmentSchedule, payInstallment, listBudgets } = await import("../src/features/planning/service"));
  ({ getExpenseIncomeTotals, getAccountBalances } = await import("../src/features/ledger/queries"));
  ({ postEntry } = await import("../src/features/ledger/service"));
  ({ todayIso } = await import("../src/lib/format"));
}
const modulesReady = loadModules();

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
  await db.delete(budgets);
  await db.delete(installments);
  await db.delete(debts);
  await db.delete(postings);
  await db.delete(journalEntries);
  await db.delete(accounts);
  await db.delete(assets);
  await db.delete(assetClasses);
  await db.delete(currencies);
  await db.delete(userFxSettings);
  await db.delete(users);
}

/** One tenant, a USD cash account, an ordinary 5900 expense bucket and — when
 *  asked for — the chart's own 5960 row (provisioned by the payment itself
 *  otherwise, which is exactly what F-3 requires of a fresh install). */
async function fixture() {
  const [user] = await db
    .insert(users)
    .values({ name: "BucketOwner", username: "bucket-owner", role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: "220000" } as any);
  const [usd] = await db
    .insert(currencies)
    .values({ code: "USDB", name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: "cashb", name: "Cash", valuationMethod: "fifo" } as any)
    .returning();
  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: "USD_CASHB", name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any)
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ code: "1010B", name: "Cash", type: "asset", assetId: usdCash.id, userId: user.id } as any)
    .returning();
  const [misc] = await db
    .insert(accounts)
    .values({ code: "5900", name: "هزینه متفرقه", type: "expense", assetId: usdCash.id, userId: user.id } as any)
    .returning();
  // NOTE: deliberately NO 5960 row here — the payment must be able to
  // provision its own bucket (the 5040 precedent), which is what a fresh
  // install without the data migration relies on.
  return { user, cash, misc, usdCash };
}

function debtFormData(principal: string, count: string, installment: string, firstDue = "2026-09-01") {
  const fd = new FormData();
  fd.set("title", "قسط بیمه شخص ثالث");
  fd.set("creditor", "azki");
  fd.set("principalIrt", principal);
  fd.set("interestRate", "0");
  fd.set("startDate", "2026-08-01");
  fd.set("installmentCount", count);
  fd.set("installmentIrt", installment);
  fd.set("firstDueDate", firstDue);
  return fd;
}

async function makeBudget(userId: string, name: string, accountId: string, ceilingToman = "50000000") {
  const [row] = await db
    .insert(budgets)
    .values({
      userId,
      name,
      periodStart: "2000-01-01",
      periodEnd: "2999-12-31",
      accountId,
      amountBase: ceilingToman,
    } as any)
    .returning();
  return row;
}

/** Pay one 909,090-Toman installment of a planning-only debt, end to end. */
async function payOneInstallment(user: any, cash: any) {
  const { token } = await createSession(user.id);
  cookieJar.value = token;
  const created = await createDebtAction(null, debtFormData("1818180", "2", "909090"));
  assert.equal(created.ok, true, created.message);
  const schedule = await listInstallmentSchedule(user.id);
  const first = schedule.rows[0];
  assert.ok(first, "the installment schedule exists");
  const paid = await payInstallment(first.id, cash.id, user.id);
  const [inst] = await db.select().from(installments).where(eq(installments.id, first.id));
  return { paid, inst };
}

/* ------------------------------------------------------------------ */

test("the payment lands on 5960 «پرداخت اقساط», never on 5900", async () => {
  await modulesReady;
  await clean();
  const { user, cash, misc } = await fixture();
  assert.ok(misc, "the tenant owns an ordinary 5900 expense bucket");

  const { paid, inst } = await payOneInstallment(user, cash);
  assert.equal((paid as any).contra, "expense", "a planning-only debt still has no liability leg");

  const lines = await db.select().from(postings).where(eq(postings.entryId, paid.id));
  const contra = lines.find((l: any) => l.accountId !== cash.id)!;
  const [bucket] = await db.select().from(accounts).where(eq(accounts.id, contra.accountId));
  assert.equal(bucket.code, "5960", "the contra row is the installment bucket (F-3)");
  assert.equal(bucket.name, "پرداخت اقساط", "named for what it is, not «متفرقه»");
  assert.equal(bucket.userId, user.id, "and it belongs to THIS tenant");
  assert.notEqual(bucket.id, misc.id, "5900 was not used");

  // The ledger stays append-only and Σ = 0; only the account changed.
  assert.ok(
    D(lines.reduce((a: any, l: any) => a.add(l.baseValue), D("0"))).isZero(),
    "Σ base_value = 0",
  );

  // The payment is visible where a DEBT belongs: /accounts shows the bucket's
  // real balance (that is why the fix is a read-path filter, not a hidden
  // account), and 5900 stayed empty.
  const balances = await getAccountBalances(user.id);
  const bucketBal = balances.find((b: any) => b.accountId === bucket.id)!;
  const paymentUsd = D("909090").div("220000");
  assert.ok(
    D(bucketBal.baseValue).sub(paymentUsd).abs().lt("0.00000001"),
    `bucket balance = ${bucketBal.baseValue}, expected ${paymentUsd.toString()}`,
  );
  const miscBal = balances.find((b: any) => b.accountId === misc.id)!;
  assert.ok(D(miscBal.baseValue).isZero(), "5900 «هزینه متفرقه» received nothing");

  // …and the contractual Toman is still frozen on the installment row.
  assert.equal(D(inst.paidToman!).toFixed(0), "909090");
  assert.equal(D(inst.paidFxRate!).toString(), "220000");
});

test("a fresh chart without 5960 gets it provisioned by the payment itself", async () => {
  await modulesReady;
  // Same database as the previous test: the fixture never created a 5960 row,
  // so the one the payment used proves on-demand provisioning works (the 5040
  // precedent) — an installment never fails because a chart row is missing.
  const rows = await db.select().from(accounts);
  const [user] = await db.select().from(users);
  const created = rows.filter((r: any) => r.code === "5960");
  assert.equal(created.length, 1, "exactly one 5960 row exists, created for this tenant");
  assert.equal(created[0].userId, user.id);
  assert.equal(created[0].type, "expense");
});

test("the expense KPI is built from entries: a repayment is disclosed, not counted", async () => {
  await modulesReady;
  const [user] = await db.select().from(users);
  const lines = await db
    .select()
    .from(postings)
    .innerJoin(journalEntries, eq(journalEntries.id, postings.entryId))
    .where(eq(journalEntries.type, "debt_repayment"));
  assert.ok(lines.length > 0, "a debt_repayment posting exists to be excluded");

  const totals = await getExpenseIncomeTotals(user.id);
  assert.ok(D(totals.expense).isZero(), `expense must exclude the repayment, got ${totals.expense}`);
  assert.ok(D(totals.income).isZero(), "no income was booked in this fixture");
  assert.ok(
    D(totals.repayments).sub(D("909090").div("220000")).abs().lt("0.00000001"),
    `the excluded amount is reported back for disclosure, got ${totals.repayments}`,
  );
  assert.equal(totals.repaymentEntries, 1, "one entry was excluded");
  // The disclosure speaks CONTRACTUAL Toman: taken from the installment row the
  // entry settled (installments.paid_entry_id), so it cannot drift with the
  // dollar the way a ÷rate reconstruction of the USD leg would.
  assert.equal(D(totals.repaymentsToman).toFixed(0), "909090", "frozen Toman of the excluded payment");
  assert.equal(totals.repaymentsTomanEntries, 1, "full frozen coverage → safe to display as Toman");

  // Income and expense are BOTH zero here, which is precisely the point: a
  // payment used to make «نرخ پس‌انداز» negative (0 − 4.13 over 0).
});

test("a household budget is not eaten by an installment payment; an installment budget is", async () => {
  await modulesReady;
  const [user] = await db.select().from(users);
  const rows = await db.select().from(accounts);
  const misc = rows.find((r: any) => r.code === "5900")!;
  const bucket = rows.find((r: any) => r.code === "5960")!;
  await makeBudget(user.id, "خوراک ماه", misc.id);
  await makeBudget(user.id, "سقف اقساط", bucket.id);

  const budgets_ = await listBudgets(user.id);
  assert.equal(budgets_.length, 2, "both budgets are listed");
  const food = budgets_.find((b: any) => b.name === "خوراک ماه")!;
  const cap = budgets_.find((b: any) => b.name === "سقف اقساط")!;

  // F-2: the payment's posting sits on an EXPENSE account, so a bare SUM would
  // have reported 909,090 Toman spent on groceries and fired a false alert.
  assert.equal(D(food.spentToman).toFixed(0), "0", "a repayment is not spend for a household budget");
  assert.equal(food.over, false, "no false overspend alert");
  // The one budget DELIBERATELY bound to «پرداخت اقساط» still measures it.
  assert.equal(D(cap.spentToman).toFixed(0), "909090", "an installment budget caps installment outflow");
  assert.equal(cap.over, false, "the 50,000,000-Toman ceiling is not exceeded");
});

test("a legacy repayment already booked on 5900 is excluded too (history is never rewritten)", async () => {
  await modulesReady;
  const [user] = await db.select().from(users);
  const rows = await db.select().from(accounts);
  const misc = rows.find((r: any) => r.code === "5900")!;
  const cash = rows.find((r: any) => r.code === "1010B")!;
  const usdCash = await db.select().from(assets);

  // Exactly what releases before this change produced: type 'debt_repayment',
  // contra leg on 5900. Posted directly — the read paths must handle data the
  // new writer never creates, because history is append-only.
  const legacy = D("1000000").div("220000");
  await postEntry({
    entryDate: todayIso(),
    type: "debt_repayment",
    description: "پرداخت قسط (قدیمی — روی حساب 5900)",
    userId: user.id,
    postings: [
      {
        accountId: cash.id,
        assetId: usdCash[0].id,
        quantity: "-0.00000455",
        baseValue: legacy.neg().toString(),
      },
      {
        accountId: misc.id,
        assetId: usdCash[0].id,
        quantity: "0.00000455",
        baseValue: legacy.toString(),
      },
    ],
  });

  const totals = await getExpenseIncomeTotals(user.id);
  assert.ok(
    D(totals.expense).isZero(),
    `legacy 5900 repayment must not count as expense, got ${totals.expense}`,
  );
  assert.equal(totals.repaymentEntries, 2, "both repayments are counted as excluded debt movement");
  assert.ok(
    D(totals.repayments).sub(D("909090").div("220000").add(legacy)).abs().lt("0.00000001"),
    `the disclosed USD total covers both the new and the legacy payment, got ${totals.repayments}`,
  );
  // Only ONE of them is backed by an installment row with a frozen Toman, so
  // the Toman figure is PARTIAL — and the report must then fall back to the
  // unconverted ledger amount instead of mixing two bases.
  assert.equal(totals.repaymentsTomanEntries, 1, "partial frozen coverage is detected");

  const budgets_ = await listBudgets(user.id);
  const food = budgets_.find((b: any) => b.name === "خوراک ماه")!;
  assert.equal(D(food.spentToman).toFixed(0), "0", "the legacy payment consumed no household budget");
});
