/**
 * Quick Pay on a PLANNING-ONLY debt — «حساب بدهی تعریف نشده است» must be gone.
 *
 * Every debt created in «بدهی‌ها» is stored with `account_id IS NULL` on
 * purpose (createDebtAction keeps the ledger untouched until a real movement
 * happens). `payInstallment` used to refuse exactly that shape with
 * «حساب بدهی تعریف نشده است», which made the one-click «پرداخت سریع» button on
 * the installment schedule dead for every debt the UI can even create.
 *
 * The rule this file pins — and it is the rule the Payment Form already
 * follows (createTransactionAction → debt_repayment branch):
 *
 *   debt WITH a liability account   → cash ↓ / liability ↓, type 'installment'
 *   debt WITHOUT one (planning-only) → cash ↓ / «پرداخت اقساط» (5960) ↑, type
 *                                     'debt_repayment', bucket resolved
 *                                     server-side by CODE (the tenant's own
 *                                     row, else a fresh one) — never 5900
 *                                     «هزینه متفرقه», see the 2026-09-07
 *                                     classification audit F-3
 *
 * `debt_repayment` is the type getCashflow / getFlowByAccount exclude, so
 * paying an installment never enters the expense report — and the wallet still
 * really moves, because the money did leave it.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq } from "drizzle-orm";
import { D } from "../src/domain/decimal";
import {
  accounts,
  assetClasses,
  assets,
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
let getAccountBalances: any, getCashflow: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction } = await import("../src/app/actions"));
  ({ listInstallmentSchedule, payInstallment } = await import("../src/features/planning/service"));
  ({ getAccountBalances, getCashflow } = await import("../src/features/ledger/queries"));
}
const modulesReady = loadModules();

async function clean() {
  await createSchemaIfNotExists();
  await db.delete(lotConsumptions);
  await db.delete(lots);
  await db.delete(entryFxSnapshots);
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
async function makeUser(name: string, rate: string) {
  const [user] = await db
    .insert(users)
    .values({ name, username: name.toLowerCase().replace(/\s+/g, "-"), role: "owner" } as any)
    .returning();
  await db.insert(userFxSettings).values({ userId: user.id, currentRate: rate } as any);
  return user;
}

/** Cash + liability accounts on a USD asset (the fx-freeze fixture shape). */
async function makeLedgerAccounts(userId: string, suffix: string) {
  const [usd] = await db
    .insert(currencies)
    .values({ code: `USD${suffix}`, name: "US Dollar", symbol: "$", decimals: 2, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: `cash${suffix}`, name: "Cash", valuationMethod: "fifo" } as any)
    .returning();
  const [usdCash] = await db
    .insert(assets)
    .values({ symbol: `USD_CASH${suffix}`, name: "USD Cash", classId: cashClass.id, currencyId: usd.id } as any)
    .returning();
  const [cash] = await db
    .insert(accounts)
    .values({ code: `1010${suffix}`, name: "Cash", type: "asset", assetId: usdCash.id, userId } as any)
    .returning();
  const [liability] = await db
    .insert(accounts)
    .values({ code: `2010${suffix}`, name: "Loan", type: "liability", assetId: usdCash.id, userId } as any)
    .returning();
  return { cash, liability, usdCash };
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

async function entryOf(entryId: string) {
  const [entry] = await db.select().from(journalEntries).where(eq(journalEntries.id, entryId));
  const lines = await db.select().from(postings).where(eq(postings.entryId, entryId));
  return { entry, lines };
}

/* ------------------------------------------------------------------ */

test("quick pay on a planning-only debt books the outflow instead of erroring", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("PlanningOnlyOwner", "220000");
  const { cash } = await makeLedgerAccounts(user.id, "P");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  // The debt the UI creates: schedule in planning, no ledger account at all.
  const created = await createDebtAction(null, debtFormData("1818180", "2", "909090"));
  assert.equal(created.ok, true, created.message);
  const [debt] = await db.select().from(debts);
  assert.equal(debt.accountId, null, "the debt is planning-only by construction");

  const schedule = await listInstallmentSchedule(user.id);
  const first = schedule.rows[0];
  assert.ok(first, "the installment schedule exists");

  const paid = await payInstallment(first.id, cash.id, user.id);
  assert.ok(paid.id, "quick pay returns its journal entry — no «حساب بدهی تعریف نشده است»");
  assert.equal((paid as any).contra, "expense", "the counter leg is the expense bucket, and the UI is told so");

  const { entry, lines } = await entryOf(paid.id);
  assert.equal(entry.type, "debt_repayment", "type keeps it out of every expense aggregation");
  assert.equal(lines.length, 2, "double entry stays two-legged");
  assert.ok(
    D(lines.reduce((a: any, l: any) => a.add(l.baseValue), D("0"))).isZero(),
    "Σ base_value = 0",
  );
  const cashLeg = lines.find((l: any) => l.accountId === cash.id)!;
  // The payment-rate USD (909,090 ÷ 220,000), never the creation-time figure.
  assert.ok(
    D(cashLeg.baseValue).add(D("909090").div("220000")).abs().lt("0.00000001"),
    `cash leg=${cashLeg.baseValue}`,
  );

  const bucket = lines.find((l: any) => l.accountId !== cash.id)!;
  const [bucketRow] = await db.select().from(accounts).where(eq(accounts.id, bucket.accountId));
  assert.equal(bucketRow.code, "5960", "the dedicated installment bucket, not a generic expense row");
  assert.equal(bucketRow.name, "پرداخت اقساط", "which is what the report and the message will call it");
  assert.equal(bucketRow.type, "expense", "the contra row is an expense-type account of THIS tenant");
  assert.equal(bucketRow.userId, user.id, "and never another tenant's bucket");

  // The installment really is paid, with the same frozen snapshot as before.
  const [inst] = await db.select().from(installments).where(eq(installments.id, first.id));
  assert.equal(inst.status, "paid");
  assert.equal(D(inst.paidToman!).toFixed(0), "909090", "contractual Toman is untouched by the new leg");
  assert.equal(D(inst.paidFxRate!).toString(), "220000");
  assert.equal(inst.paidEntryId, paid.id);

  // The wallet moved — that is the whole point of paying from an account.
  const balances = await getAccountBalances(user.id);
  const cashBal = balances.find((b: any) => b.accountId === cash.id)!;
  assert.ok(D(cashBal.baseValue).isNegative(), `cash balance after paying: ${cashBal.baseValue}`);
});

test("the installment bucket is provisioned when the tenant has no expense row", async () => {
  await modulesReady;
  // Same DB as the previous test: the fixture owned NO expense account at all,
  // so the row below was created by the payment — on its OWN code, the way 5040
  // is provisioned. The point of the 2026-09-07 fix: a repayment gets a bucket
  // with meaning, and «هزینه متفرقه» is never invented as a dumping ground.
  const rows = await db.select().from(accounts);
  const [user] = await db.select().from(users);
  const bucket = rows.find((r: any) => r.userId === user.id && r.type === "expense" && r.code === "5960");
  assert.ok(bucket, "5960 «پرداخت اقساط» exists for the tenant and received the posting");
  assert.ok(
    !rows.some((r: any) => r.code === "5900"),
    "no 5900 «هزینه متفرقه» row was created to absorb a loan payment (F-3)",
  );
});

test("paying again is a no-op, not a second journal entry", async () => {
  await modulesReady;
  const [user] = await db.select().from(users);
  const [cash] = await db.select().from(accounts).where(eq(accounts.type, "asset"));
  const [inst] = await db
    .select()
    .from(installments)
    .where(eq(installments.status, "paid"))
    .limit(1);
  assert.ok(inst, "the paid installment from the previous test is still here");
  const before = await db.select().from(journalEntries);
  const again: any = await payInstallment(inst.id, cash.id, user.id);
  assert.equal(again.alreadyPaid, true);
  assert.equal(again.contra, null, "a replay resolves no new contra");
  const after = await db.select().from(journalEntries);
  assert.equal(after.length, before.length, "double payment must never post twice");
});

test("a debt WITH a liability account is unchanged: type 'installment', liability leg", async () => {
  await modulesReady;
  const user = await makeUser("LedgerBackedOwner", "220000");
  const { cash, liability } = await makeLedgerAccounts(user.id, "L");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  const created = await createDebtAction(null, debtFormData("2200000", "2", "1100000", "2026-09-05"));
  assert.equal(created.ok, true, created.message);
  await db.update(debts).set({ accountId: liability.id }).where(eq(debts.userId, user.id));

  const schedule = await listInstallmentSchedule(user.id);
  const row = schedule.rows.find((r: any) => r.fx && !r.fx.isPaid)!;
  const paid: any = await payInstallment(row.id, cash.id, user.id);
  assert.equal(paid.contra, "liability", "the classical settlement path keeps its contra");
  const { entry, lines } = await entryOf(paid.id);
  assert.equal(entry.type, "installment", "the pre-existing entry type is untouched");
  assert.ok(
    lines.some((l: any) => l.accountId === liability.id),
    "and the payment still reduces the debt's own liability account",
  );
});

test("an installment payment never inflates the expense report", async () => {
  await modulesReady;
  const [user] = await db.select().from(users).where(eq(users.name, "PlanningOnlyOwner"));
  const flow = await getCashflow(24, user.id);
  const outflow = flow.reduce((a: any, m: any) => a.add(m.outflow ?? "0"), D("0"));
  assert.ok(
    outflow.isZero(),
    `cash-flow outflow must ignore debt_repayment entries, got ${outflow.toString()}`,
  );
});
