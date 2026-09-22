/**
 * دفتر چک — cheques issued by the user and cheques the user holds.
 *
 * A pending cheque is PLANNING, never ledger: it moves the cash forecast and
 * raises reminders. It posts only when recorded as cleared through the
 * ordinary transaction form — `clearChequeInTx` runs inside that form's
 * database transaction, so a cheque is never «پاس شد» without its entry, nor
 * the entry without the cheque. Reversing that entry returns the cheque to
 * pending (`revertClearedChequeInTx`).
 *
 * Every function takes the owner's id and scopes by it; there is no NULL-owner
 * cheque.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, cheques, debts, installments } from "@/db/schema";
import { D } from "@/domain/decimal";
import { resolveDirection } from "@/features/planning/obligations";

export type ChequeDirection = "issued" | "received";
export type ChequeStatus = "pending" | "cleared" | "bounced" | "cancelled";

export const CHEQUE_STATUS_LABEL: Record<ChequeStatus, string> = {
  pending: "در جریان",
  cleared: "پاس شد",
  bounced: "برگشتی",
  cancelled: "باطل / عودت",
};

/** Transaction types that can settle a cheque, by the way money moves. */
export const CLEARING_TYPES: Record<ChequeDirection, readonly string[]> = {
  issued: ["expense", "debt_repayment", "transfer", "buy"],
  received: ["income", "debt_repayment", "transfer", "sell"],
};

/** Manual state changes. «پاس شد» is not here: it happens only with its entry. */
const TRANSITIONS: Record<ChequeStatus, readonly ChequeStatus[]> = {
  pending: ["bounced", "cancelled"],
  bounced: ["pending", "cancelled"],
  cancelled: ["pending"],
  cleared: [],
};

export type ChequeInput = {
  direction: ChequeDirection;
  counterparty: string;
  amountToman: string;
  dueDate: string;
  accountId?: string | null;
  sayadId?: string | null;
  serial?: string | null;
  bankName?: string | null;
  installmentId?: string | null;
  note?: string | null;
};

export type ChequeRow = {
  id: string;
  direction: ChequeDirection;
  counterparty: string;
  amountToman: string;
  dueDate: string;
  accountId: string | null;
  accountName: string | null;
  sayadId: string | null;
  serial: string | null;
  bankName: string | null;
  installmentId: string | null;
  installmentSeq: number | null;
  debtTitle: string | null;
  debtId: string | null;
  note: string | null;
  status: ChequeStatus;
  statusChangedAt: string | null;
  clearedEntryId: string | null;
  clearedDate: string | null;
};

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t ? t : null;
};

/** Persian/Arabic digits → ASCII, everything else dropped. */
export function normalizeSayadId(v: string | null | undefined): string | null {
  const digits = (v ?? "")
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\D/g, "");
  return digits ? digits : null;
}

async function assertOwnMoneyAccount(userId: string, accountId: string, client: any = db) {
  const [acc] = await client
    .select({ userId: accounts.userId, type: accounts.type, deletedAt: accounts.deletedAt })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!acc || acc.userId !== userId || acc.type !== "asset" || acc.deletedAt) {
    throw new Error("حساب انتخاب‌شده متعلق به شما نیست.");
  }
}

async function assertOwnPayableInstallment(userId: string, installmentId: string) {
  const [row] = await db
    .select({ owner: debts.userId, direction: debts.direction, status: installments.status })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    .where(eq(installments.id, installmentId))
    .limit(1);
  if (!row || row.owner !== userId) throw new Error("قسط انتخاب‌شده متعلق به شما نیست.");
  if (resolveDirection(row.direction) !== "payable") throw new Error("چک صادره فقط به قسطی وصل می‌شود که شما می‌پردازید.");
  if (row.status === "paid") throw new Error("این قسط قبلاً پرداخت شده است.");
}

export async function createCheque(userId: string, input: ChequeInput): Promise<string> {
  const counterparty = clean(input.counterparty);
  if (!counterparty || counterparty.length > 120) throw new Error("نام طرف حساب را وارد کنید.");
  let amount;
  try {
    amount = D(input.amountToman);
  } catch {
    throw new Error("مبلغ چک معتبر نیست.");
  }
  if (!amount.gt(0)) throw new Error("مبلغ چک باید بیشتر از صفر باشد.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || Number.isNaN(Date.parse(`${input.dueDate}T00:00:00Z`))) {
    throw new Error("تاریخ سررسید معتبر نیست.");
  }
  const sayadId = normalizeSayadId(input.sayadId);
  if (sayadId && sayadId.length !== 16) throw new Error("شناسه صیادی باید ۱۶ رقم باشد.");
  const accountId = clean(input.accountId);
  if (input.direction === "issued" && !accountId) throw new Error("حسابی را که چک از آن کشیده شده انتخاب کنید.");
  if (accountId) await assertOwnMoneyAccount(userId, accountId);
  const installmentId = input.direction === "issued" ? clean(input.installmentId) : null;
  if (installmentId) await assertOwnPayableInstallment(userId, installmentId);

  try {
    const [row] = await db
      .insert(cheques)
      .values({
        userId,
        direction: input.direction,
        counterparty,
        amountToman: amount.toFixed(0),
        dueDate: input.dueDate,
        accountId,
        sayadId,
        serial: clean(input.serial)?.slice(0, 40) ?? null,
        bankName: input.direction === "received" ? (clean(input.bankName)?.slice(0, 60) ?? null) : null,
        installmentId,
        note: clean(input.note)?.slice(0, 500) ?? null,
      })
      .returning({ id: cheques.id });
    return row.id;
  } catch (e: any) {
    if (String(e?.message ?? "").includes("cheques_user_sayad_uq") || e?.code === "23505" || e?.cause?.code === "23505") {
      throw new Error("چکی با این شناسه صیادی قبلاً ثبت شده است.");
    }
    throw e;
  }
}

export async function listCheques(userId: string): Promise<ChequeRow[]> {
  const res = await db.execute(sql`
    select c.id, c.direction, c.counterparty, c.amount_toman::text as "amountToman",
           c.due_date::text as "dueDate", c.account_id as "accountId", a.name as "accountName",
           c.sayad_id as "sayadId", c.serial, c.bank_name as "bankName",
           c.installment_id as "installmentId",
           i.seq as "installmentSeq", d.title as "debtTitle",
           d.id as "debtId",
           c.note, c.status, c.status_changed_at::text as "statusChangedAt",
           c.cleared_entry_id as "clearedEntryId", je.entry_date::text as "clearedDate"
    from cheques c
      left join accounts a on a.id = c.account_id
      left join installments i on i.id = c.installment_id
      left join debts d on d.id = i.debt_id
      left join journal_entries je on je.id = c.cleared_entry_id
    where c.user_id = ${userId}
    order by (c.status = 'pending' or c.status = 'bounced') desc, c.due_date asc, c.created_at asc
    limit 500
  `);
  return res.rows as ChequeRow[];
}

export async function getPendingCheque(userId: string, id: string): Promise<ChequeRow | null> {
  const rows = await listCheques(userId);
  return rows.find((r) => r.id === id && r.status === "pending") ?? null;
}

export async function setChequeStatus(userId: string, id: string, next: ChequeStatus, dueDate?: string | null): Promise<void> {
  const [row] = await db
    .select({ status: cheques.status })
    .from(cheques)
    .where(and(eq(cheques.id, id), eq(cheques.userId, userId)))
    .limit(1);
  if (!row) throw new Error("چک پیدا نشد.");
  const current = row.status as ChequeStatus;
  if (!TRANSITIONS[current]?.includes(next)) {
    throw new Error(
      current === "cleared"
        ? "چک پاس‌شده را فقط با ابطال سند آن می‌توان برگرداند."
        : `تغییر وضعیت از «${CHEQUE_STATUS_LABEL[current]}» به «${CHEQUE_STATUS_LABEL[next]}» ممکن نیست.`,
    );
  }
  const patch: Partial<typeof cheques.$inferInsert> = { status: next, statusChangedAt: new Date(), updatedAt: new Date() };
  // A bounced cheque presented again usually gets a new date.
  if (next === "pending" && dueDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) throw new Error("تاریخ سررسید معتبر نیست.");
    patch.dueDate = dueDate;
  }
  await db
    .update(cheques)
    .set(patch)
    .where(and(eq(cheques.id, id), eq(cheques.userId, userId), eq(cheques.status, current)));
}

/** Only a cheque that never posted can be deleted. */
export async function deleteCheque(userId: string, id: string): Promise<void> {
  const res = await db
    .delete(cheques)
    .where(and(eq(cheques.id, id), eq(cheques.userId, userId), sql`${cheques.status} <> 'cleared'`))
    .returning({ id: cheques.id });
  if (!res.length) throw new Error("چک پیدا نشد یا پاس شده است؛ چک پاس‌شده حذف نمی‌شود.");
}

/**
 * Inside the transaction form's database transaction: mark the cheque cleared
 * by `entryId`. Throws (rolling the entry back) when the cheque is not this
 * user's, is not pending, or the entry type moves money the wrong way.
 */
export async function clearChequeInTx(tx: any, p: { chequeId: string; userId: string; entryId: string; type: string }) {
  const [row] = await tx
    .select({ direction: cheques.direction })
    .from(cheques)
    .where(and(eq(cheques.id, p.chequeId), eq(cheques.userId, p.userId), eq(cheques.status, "pending")))
    .for("update")
    .limit(1);
  if (!row) throw new Error("چک پیدا نشد یا قبلاً تعیین تکلیف شده است.");
  const allowed = CLEARING_TYPES[row.direction as ChequeDirection] ?? [];
  if (!allowed.includes(p.type)) {
    throw new Error(row.direction === "issued" ? "چک صادره پول را از حساب شما خارج می‌کند؛ نوع تراکنش را درست انتخاب کنید." : "چک دریافتی پول را به حساب شما وارد می‌کند؛ نوع تراکنش را درست انتخاب کنید.");
  }
  await tx
    .update(cheques)
    .set({ status: "cleared", clearedEntryId: p.entryId, statusChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(cheques.id, p.chequeId));
}

/** Inside a reversal: the cheque that entry cleared is pending again. */
export async function revertClearedChequeInTx(tx: any, entryId: string) {
  await tx
    .update(cheques)
    .set({ status: "pending", clearedEntryId: null, statusChangedAt: new Date(), updatedAt: new Date() })
    .where(eq(cheques.clearedEntryId, entryId));
}

/** Pending cheques for the forecast; one tied to an installment is counted there, not here. */
export async function pendingChequesForForecast(userId: string) {
  return db
    .select({ direction: cheques.direction, amountToman: cheques.amountToman, dueDate: cheques.dueDate })
    .from(cheques)
    .where(and(eq(cheques.userId, userId), eq(cheques.status, "pending"), sql`${cheques.installmentId} is null`))
    .orderBy(asc(cheques.dueDate));
}

/** Pending cheques due up to `until`, and every bounced cheque — for reminders. */
export async function chequesNeedingAttention(userId: string, until: string) {
  return db
    .select({
      id: cheques.id,
      direction: cheques.direction,
      counterparty: cheques.counterparty,
      amountToman: cheques.amountToman,
      dueDate: cheques.dueDate,
      status: cheques.status,
      statusChangedAt: cheques.statusChangedAt,
    })
    .from(cheques)
    .where(
      and(
        eq(cheques.userId, userId),
        sql`((${cheques.status} = 'pending' and ${cheques.dueDate} < ${until}) or ${cheques.status} = 'bounced')`,
      ),
    )
    .orderBy(asc(cheques.dueDate));
}
