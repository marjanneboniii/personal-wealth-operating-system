import { createReadySession, clearSetupReceipts } from "./support/ready-session";
/**
 * «اصلاح پرداخت» — installments paid before Quick Pay asked for an account
 * took the money from the lowest-coded asset account, so the Toman bank never
 * moved. The repair finds them and re-posts the payment from the bank the
 * user names: the wrong account is restored, the bank drops by the exact
 * Toman, and the installment stays paid.
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
let listInstallmentSchedule: any, payInstallment: any, repairInstallmentPaymentAction: any, listUnsettledInstallmentPayments: any;
let getAccountBalances: any, getCashflow: any;

async function loadModules() {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ createSession } = await import("../src/lib/auth"));
  ({ createDebtAction, repairInstallmentPaymentAction } = await import("../src/app/actions"));
  ({ listUnsettledInstallmentPayments } = await import("../src/features/planning/repairPayments"));
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
  await clearSetupReceipts(); await db.delete(users);
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

const qty = (balances: any[], id: string) => D(balances.find((b: any) => b.accountId === id)?.quantity ?? "0").toFixed(0);

test("a payment taken from the wrong account is moved to the chosen Toman bank", async () => {
  await modulesReady;
  await clean();
  const user = await makeUser("RepairOwner", "220000");
  const { cash: usdCash } = await makeLedgerAccounts(user.id, "R");
  const bank = await makeTomanBank(user.id, "R");
  const { token } = await createReadySession(user.id);
  cookieJar.value = token;

  const created = await createDebtAction(null, debtFormData("1818180", "2", "909090"));
  assert.equal(created.ok, true, created.message);
  const first = (await listInstallmentSchedule(user.id)).rows[0];

  // The old Quick Pay: the money left the first asset account, not the bank.
  const old = await payInstallment(first.id, usdCash.id, user.id);
  assert.notEqual(qty(await getAccountBalances(user.id), usdCash.id), "0");

  const found = await listUnsettledInstallmentPayments(user.id);
  assert.equal(found.length, 1);
  assert.equal(found[0].problem, "wrong-account");
  assert.equal(found[0].amountToman, "909090");
  assert.equal(found[0].fromAccountName, "Cash");

  const res = await repairInstallmentPaymentAction(first.id, bank.id);
  assert.equal(res.ok, true, res.message);

  const balances = await getAccountBalances(user.id);
  assert.equal(qty(balances, bank.id), "-909090", "the bank drops by the exact installment");
  assert.equal(qty(balances, usdCash.id), "0", "the wrong account is restored");

  const [inst] = await db.select().from(installments).where(eq(installments.id, first.id));
  assert.equal(inst.status, "paid", "the installment stays paid");
  assert.notEqual(inst.paidEntryId, old.id);
  const { entry: oldEntry } = await entryOf(old.id);
  assert.equal(oldEntry.status, "void", "the wrong entry is reversed, never edited");
  const { entry, lines } = await entryOf(inst.paidEntryId!);
  assert.equal(entry.entryDate, oldEntry.entryDate, "same payment date");
  assert.equal(entry.type, "debt_repayment", "still out of the expense report");
  assert.ok(lines.reduce((s: any, l: any) => s.add(l.baseValue), D(0)).isZero(), "balanced");

  assert.equal((await listUnsettledInstallmentPayments(user.id)).length, 0, "nothing left to repair");
  const again = await repairInstallmentPaymentAction(first.id, bank.id);
  assert.equal(again.ok, false, "a repaired payment is never posted twice");
});

test("a paid installment with no entry is posted from the chosen bank", async () => {
  await modulesReady;
  const [user] = await db.select().from(users).where(eq(users.name, "RepairOwner"));
  const [bank] = await db.select().from(accounts).where(eq(accounts.name, "بانک ملت"));
  const second = (await listInstallmentSchedule(user.id)).rows.find((r: any) => !r.fx.isPaid)!;
  await db
    .update(installments)
    .set({ status: "paid", paidToman: "909090", paidAt: "2026-09-05", paidEntryId: null } as any)
    .where(eq(installments.id, second.id));

  const found = await listUnsettledInstallmentPayments(user.id);
  assert.equal(found.length, 1);
  assert.equal(found[0].problem, "no-entry");

  const res = await repairInstallmentPaymentAction(second.id, bank.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(qty(await getAccountBalances(user.id), bank.id), "-1818180");
  const [inst] = await db.select().from(installments).where(eq(installments.id, second.id));
  const { entry } = await entryOf(inst.paidEntryId!);
  assert.equal(entry.entryDate, "2026-09-05", "posted on the day it was paid");
});

test("a non-bank account cannot be the repair target", async () => {
  await modulesReady;
  const [user] = await db.select().from(users).where(eq(users.name, "RepairOwner"));
  const [usdCash] = await db.select().from(accounts).where(eq(accounts.name, "Cash"));
  const [inst] = await db.select().from(installments).limit(1);
  const res = await repairInstallmentPaymentAction(inst.id, usdCash.id);
  assert.equal(res.ok, false);
  void user;
});
