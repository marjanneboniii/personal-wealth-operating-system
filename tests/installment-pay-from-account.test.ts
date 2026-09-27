/**
 * Quick Pay pays from the account the USER chose — «پرداخت از کدام حساب؟».
 *
 * The installment sheet used to pay silently from the lowest-coded asset
 * account, so a Toman bank balance never moved when the user settled a debt
 * from it. The sheet now asks, and a Toman / Rial account moves by exactly the
 * settled Toman (no USD round-trip residue).
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
let listInstallmentSchedule: any, payInstallmentAction: any;
let getAccountBalances: any, getCashflow: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction, payInstallmentAction } = await import("../src/app/actions"));
  ({ listInstallmentSchedule } = await import("../src/features/planning/service"));
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

async function makeTomanBank(userId: string, suffix: string) {
  const [irt] = await db
    .insert(currencies)
    .values({ code: `IRT${suffix}`, name: "Toman", symbol: "T", decimals: 0, isFiat: true } as any)
    .returning();
  const [cashClass] = await db
    .insert(assetClasses)
    .values({ code: `cashT${suffix}`, name: "Cash", valuationMethod: "fifo" } as any)
    .returning();
  const [irtAsset] = await db
    .insert(assets)
    .values({ symbol: "IRT", name: "تومان", classId: cashClass.id, currencyId: irt.id, decimals: 0 } as any)
    .returning();
  const [bank] = await db
    .insert(accounts)
    .values({ code: `1110${suffix}`, name: "بانک ملت", type: "asset", assetId: irtAsset.id, userId } as any)
    .returning();
  return bank;
}

test("quick pay from a chosen Toman bank account lowers THAT balance by exactly the installment", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("TomanBankOwner", "220000");
  const { cash: usdCash } = await makeLedgerAccounts(user.id, "B");
  const bank = await makeTomanBank(user.id, "B");
  const { token } = await createSession(user.id);
  cookieJar.value = token;

  const created = await createDebtAction(null, debtFormData("1818180", "2", "909090"));
  assert.equal(created.ok, true, created.message);
  const schedule = await listInstallmentSchedule(user.id);
  const first = schedule.rows[0];

  const res = await payInstallmentAction(first.id, bank.id);
  assert.equal(res.ok, true, res.message);
  assert.match(res.message, /بانک ملت/, "the message names the account the money left");

  const balances = await getAccountBalances(user.id);
  const bankBal = balances.find((b: any) => b.accountId === bank.id)!;
  assert.equal(D(bankBal.quantity).toFixed(0), "-909090", "the bank's Toman moved by the exact installment");
  assert.ok(
    !balances.some((b: any) => b.accountId === usdCash.id && !D(b.quantity).isZero()),
    "no other account was touched",
  );

  const [inst] = await db.select().from(installments).where(eq(installments.id, first.id));
  assert.equal(inst.status, "paid");
  const lines = await db.select().from(postings).where(eq(postings.entryId, inst.paidEntryId!));
  const bankLeg = lines.find((l: any) => l.accountId === bank.id)!;
  assert.equal(D(bankLeg.quantity).toString(), "-909090", "no USD round-trip residue on the Toman leg");
});

test("a partial payment moves only the entered Toman", async () => {
  await modulesReady;
  const [user] = await db.select().from(users).where(eq(users.name, "TomanBankOwner"));
  const [bank] = await db.select().from(accounts).where(eq(accounts.name, "بانک ملت"));
  const schedule = await listInstallmentSchedule(user.id);
  const second = schedule.rows.find((r: any) => !r.fx.isPaid)!;
  const res = await payInstallmentAction(second.id, bank.id, "400000");
  assert.equal(res.ok, true, res.message);
  const balances = await getAccountBalances(user.id);
  const bankBal = balances.find((b: any) => b.accountId === bank.id)!;
  assert.equal(D(bankBal.quantity).toFixed(0), "-1309090");
});

test("paying from an account that is not a money account is refused", async () => {
  await modulesReady;
  const [user] = await db.select().from(users).where(eq(users.name, "TomanBankOwner"));
  const [liability] = await db.select().from(accounts).where(eq(accounts.type, "liability"));
  const schedule = await listInstallmentSchedule(user.id);
  const open = schedule.rows.find((r: any) => !r.fx.isPaid)!;
  const res = await payInstallmentAction(open.id, liability.id);
  assert.equal(res.ok, false, "a liability row can never be the paying account");
});
