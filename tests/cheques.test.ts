/**
 * دفتر چک — a pending cheque is a plan; it posts only when cleared.
 *
 *  • registering: the account must be the user's, a Sayad ID is 16 digits and unique per user
 *  • a pending cheque moves the forecast, never the ledger; one tied to an installment is not counted twice
 *  • clearing goes through the transaction form, atomically: wrong direction or a foreign
 *    cheque rolls the entry back; a cheque clears once
 *  • reversing the clearing entry makes the cheque pending again
 *  • bounced cheques and due cheques surface as reminders; a cleared cheque cannot be deleted
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { eq, sql } from "drizzle-orm";
import { D, Decimal } from "../src/domain/decimal";
import { accounts, assetClasses, assets, cheques, debts, installments, journalEntries, users, userFxSettings } from "../src/db/schema";
import { todayIso } from "../src/lib/format";

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

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

test("cheques: register, forecast, clear atomically, reverse, remind", async () => {
  const { db } = await import("../src/db");
  const { createSchemaIfNotExists } = await import("../src/db/init-schema");
  const { createSession } = await import("../src/lib/auth");
  const { ensureCategoryCatalog, listCategoryTree } = await import("../src/features/categories/service");
  const { createTransactionAction, reverseEntryAction } = await import("../src/app/actions");
  const { createChequeAction, setChequeStatusAction, deleteChequeAction } = await import("../src/app/actions/cheques");
  const { projectCashflow } = await import("../src/features/planning/service");
  const { getReminders } = await import("../src/features/notifications/service");
  await createSchemaIfNotExists();
  await ensureCategoryCatalog();

  const today = todayIso();
  const mk = async (name: string) => {
    const [u] = await db
      .insert(users)
      .values({ name, username: `${name}-${Math.random().toString(36).slice(2, 8)}`, role: "owner" } as any)
      .returning();
    await db.insert(userFxSettings).values({ userId: u.id, currentRate: "100000" } as any);
    return u;
  };
  const owner = await mk("drawer");
  const other = await mk("stranger");
  const [cash] = await db.insert(assetClasses).values({ code: "cash", name: "نقد و بانک" } as any).returning();
  await db.insert(assets).values({ symbol: "USD", name: "دلار", classId: cash.id, decimals: 2 } as any);
  const [irt] = await db.insert(assets).values({ symbol: "IRT", name: "تومان", classId: cash.id, decimals: 0 } as any).returning();
  const [bank] = await db.insert(accounts).values({ code: "1010", name: "بانک", type: "asset", assetId: irt.id, userId: owner.id } as any).returning();
  const [otherBank] = await db.insert(accounts).values({ code: "1010", name: "بانک دیگری", type: "asset", assetId: irt.id, userId: other.id } as any).returning();
  for (const u of [owner, other]) {
    await db.insert(accounts).values({ code: "5900", name: "هزینه", type: "expense", assetId: irt.id, userId: u.id } as any);
  }
  const leaf = (await listCategoryTree(owner.id)).flatMap((g: any) => g.children).find((c: any) => c.code === "FOD-GROCERY-HOME");

  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const cheque = (fields: Record<string, string>) =>
    createChequeAction(null, form({ direction: "issued", counterparty: "صاحب‌خانه", amountToman: "20000000", dueDate: addDays(today, 10), accountId: bank.id, ...fields }));

  // ── Registering ──
  assert.equal((await cheque({})).ok, false, "anonymous cannot register");
  cookieJar.value = (await createSession(owner.id)).token;
  assert.equal((await cheque({ accountId: otherBank.id })).ok, false, "a foreign account is refused");
  assert.equal((await cheque({ accountId: "" })).ok, false, "an issued cheque needs its account");
  assert.equal((await cheque({ sayadId: "12345" })).ok, false, "Sayad ID is 16 digits");
  const rent = await cheque({ sayadId: "۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶", amountToman: "۲۰٬۰۰۰٬۰۰۰" });
  assert.equal(rent.ok, true, rent.message);
  assert.equal((await cheque({ sayadId: "1234567890123456" })).ok, false, "the same Sayad ID twice is refused");
  const [rentRow] = await db.select().from(cheques).where(eq(cheques.sayadId, "1234567890123456"));
  assert.equal(D(rentRow.amountToman).toFixed(0), "20000000", "Persian digits and separators are read");

  // One tied to a scheduled installment is forecast once, through the installment.
  const [loan] = await db.insert(debts).values({ userId: owner.id, creditor: "بانک", title: "وام", principalBase: "0", startDate: today } as any).returning();
  const [inst] = await db.insert(installments).values({ debtId: loan.id, seq: 1, dueDate: addDays(today, 12), amountBase: "0", amountToman: "5000000" } as any).returning();
  assert.equal((await cheque({ counterparty: "بانک", amountToman: "5000000", dueDate: addDays(today, 12), installmentId: inst.id })).ok, true);
  const held = await createChequeAction(null, form({ direction: "received", counterparty: "خریدار", amountToman: "8000000", dueDate: addDays(today, 5), bankName: "ملت" }));
  assert.equal(held.ok, true, held.message);

  const entriesBefore = (await db.select().from(journalEntries)).length;
  assert.equal(entriesBefore, 0, "registering cheques never posts");
  const projection = await projectCashflow(3, "base", owner.id);
  const outflow = Decimal.sum(projection.points.map((p: any) => p.outflow));
  const inflow = Decimal.sum(projection.points.map((p: any) => p.inflow));
  assert.equal(D(outflow).toFixed(0), "25000000", "20M rent cheque + 5M installment — the installment's cheque is not added again");
  assert.equal(D(inflow).toFixed(0), "8000000");

  // ── Clearing ──
  const clear = (fields: Record<string, string>) =>
    createTransactionAction(
      null,
      form({ type: "expense", entryDate: today, feeMode: "irt", primaryAccountId: bank.id, categoryId: leaf.id, irtAmount: "20000000", description: "اجاره", chequeId: rentRow.id, ...fields }),
    );
  // A held (received) cheque cannot clear as an expense — refused by the cheque
  // guard itself, after the entry was written, so the entry must roll back.
  const [heldRow] = await db.select().from(cheques).where(eq(cheques.counterparty, "خریدار"));
  const wrongWay = await clear({ chequeId: heldRow.id, irtAmount: "8000000" });
  assert.equal(wrongWay.ok, false, "a received cheque cannot clear as an expense");
  assert.match(wrongWay.message, /چک دریافتی/);
  assert.equal((await db.select().from(journalEntries)).length, 0, "the refused entry was rolled back");

  cookieJar.value = (await createSession(other.id)).token;
  const stolen = await clear({ primaryAccountId: otherBank.id });
  assert.equal(stolen.ok, false, "another user cannot clear my cheque");
  assert.match(stolen.message, /چک پیدا نشد/);
  assert.equal((await db.select().from(journalEntries)).length, 0);

  cookieJar.value = (await createSession(owner.id)).token;
  const cleared = await clear({});
  assert.equal(cleared.ok, true, cleared.message);
  let [row] = await db.select().from(cheques).where(eq(cheques.id, rentRow.id));
  assert.equal(row.status, "cleared");
  assert.ok(row.clearedEntryId);
  assert.equal((await clear({})).ok, false, "a cheque clears once");
  assert.equal((await db.select().from(journalEntries)).length, 1);
  assert.equal((await setChequeStatusAction(rentRow.id, "bounced")).ok, false, "a cleared cheque cannot bounce by hand");
  assert.equal((await deleteChequeAction(rentRow.id)).ok, false, "a cleared cheque cannot be deleted");

  // Reversing the clearing entry returns the cheque to pending.
  const reversed = await reverseEntryAction(row.clearedEntryId!);
  assert.equal(reversed.ok, true, reversed.message);
  [row] = await db.select().from(cheques).where(eq(cheques.id, rentRow.id));
  assert.equal(row.status, "pending");
  assert.equal(row.clearedEntryId, null);

  // ── Bounced, reminders, delete ──
  assert.equal((await setChequeStatusAction(heldRow.id, "bounced")).ok, true);
  const reminders = await getReminders(owner.id, today);
  assert.ok(reminders.some((r: any) => r.kind === "bounced" && r.title.includes("خریدار")), "a bounced cheque is a reminder");
  assert.ok(!reminders.some((r: any) => r.kind === "cheque" && r.title.includes("صاحب‌خانه")), "10 days out is beyond the 7-day horizon");
  await db.update(cheques).set({ dueDate: addDays(today, 3) }).where(eq(cheques.id, rentRow.id));
  assert.ok((await getReminders(owner.id, today)).some((r: any) => r.kind === "cheque" && r.title.includes("صاحب‌خانه")));
  assert.equal((await getReminders(other.id, today)).length, 0, "reminders stay inside the tenant");

  assert.equal((await deleteChequeAction(heldRow.id)).ok, true, "a bounced cheque never posted and can be deleted");
  cookieJar.value = (await createSession(other.id)).token;
  assert.equal((await deleteChequeAction(rentRow.id)).ok, false, "another user cannot delete it");

  const balanced = await db.execute(sql`select coalesce(sum(base_value), 0)::text as s from postings`);
  assert.equal(D(balanced.rows[0].s as string).toString(), "0", "the ledger stayed balanced");
});
