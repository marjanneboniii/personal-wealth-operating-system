/**
 * یادآورها — reminders DERIVED on every read, never stored.
 *
 * Each one is something with a date that needs the user's hand: an
 * installment to pay, an installment owed TO the user, a cheque coming due
 * or bounced, a recurring income to record, imported transactions to review. When the underlying row changes
 * (paid, recorded, reviewed) the reminder simply stops being derived.
 *
 * Only the "seen" marker is stored (notification_reads). A key embeds the
 * date it is about, so a rescheduled installment or a new import batch is
 * unread again.
 *
 * This is a read model: it never writes a journal entry, posting or plan.
 */
import { and, asc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { debts, installments, notificationReads } from "@/db/schema";
import { D } from "@/domain/decimal";
import { hasMultipleUsers, resolveQueryUserId } from "@/features/ledger/queries";
import { listDueIncomePlans } from "@/features/income/service";
import { chequesNeedingAttention } from "@/features/cheques/service";
import { depositsNearMaturity } from "@/features/deposits/service";
import { resolveInstallmentToman } from "@/features/planning/installmentFx";
import { remainingToman, resolveDirection } from "@/features/planning/obligations";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { currencyLabel, faCount, formatQty, todayIso } from "@/lib/format";

/** How far ahead an installment is worth a reminder. */
export const INSTALLMENT_HORIZON_DAYS = 7;
/** Recurring incomes are reminded a little ahead, as on the overview. */
const INCOME_HORIZON_DAYS = 3;

export type ReminderKind = "installment" | "receivable" | "cheque" | "bounced" | "deposit" | "income" | "review";

export type Reminder = {
  /** Stable identity of this reminder occurrence (the seen-marker key). */
  key: string;
  kind: ReminderKind;
  title: string;
  /** ISO date the reminder is about, when it has one. */
  date: string | null;
  /** Whole days from today (negative = overdue). */
  days: number | null;
  /** Toman figure to show, when there is one. */
  amountToman: string | null;
  /** Non-Toman amount label (a Tether income), when the Toman is not the unit. */
  amountLabel?: string | null;
  href: string;
  action: string;
  read: boolean;
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Every reminder of the tenant, most urgent first. Read state requires a user. */
export async function getReminders(userId?: string, today = todayIso()): Promise<Reminder[]> {
  const u = await resolveQueryUserId(userId);
  if (!u && (await hasMultipleUsers())) return [];

  const horizon = addDays(today, INSTALLMENT_HORIZON_DAYS);
  const [instRows, fx, incomes, review, chequeRows, maturing] = await Promise.all([
    db
      .select({
        id: installments.id,
        seq: installments.seq,
        dueDate: installments.dueDate,
        status: installments.status,
        amountToman: installments.amountToman,
        amountBase: installments.amountBase,
        paidToman: installments.paidToman,
        debtTitle: debts.title,
        direction: debts.direction,
      })
      .from(installments)
      .innerJoin(debts, eq(debts.id, installments.debtId))
      .where(
        and(
          sql`${installments.status} <> 'paid'`,
          sql`${debts.deletedAt} is null`,
          sql`${debts.status} <> 'cancelled'`,
          lt(installments.dueDate, horizon),
          // Same tenancy as the planning reads: NULL-owner legacy debts belong
          // to the single-user workspace.
          u ? sql`(${debts.userId} = ${u} or ${debts.userId} is null)` : sql`1=1`,
        ),
      )
      .orderBy(asc(installments.dueDate))
      .limit(100),
    getLatestUsdIrtRateForUser(u ?? null),
    u ? listDueIncomePlans(u, INCOME_HORIZON_DAYS) : Promise.resolve([]),
    db.execute(sql`
      select count(*)::int as n, max(je.entry_date)::text as newest
      from journal_entries je
      where je.source = 'import' and je.status = 'posted'
        ${u ? sql`and je.user_id = ${u}` : sql``}
        and not exists (select 1 from entry_reviews er where er.entry_id = je.id)
    `),
    u ? chequesNeedingAttention(u, horizon) : Promise.resolve([]),
    u ? depositsNearMaturity(u, horizon) : Promise.resolve([]),
  ]);

  const out: Omit<Reminder, "read">[] = [];

  for (const i of instRows) {
    const toman = resolveInstallmentToman(i, fx.rate);
    const left = toman == null ? null : remainingToman({ status: i.status, amountToman: toman, paidToman: i.paidToman });
    if (left && left.isZero()) continue;
    const receivable = resolveDirection(i.direction) === "receivable";
    out.push({
      key: `${receivable ? "receivable" : "installment"}:${i.id}:${i.dueDate}`,
      kind: receivable ? "receivable" : "installment",
      title: receivable ? `دریافت قسط ${faCount(i.seq)} «${i.debtTitle}»` : `قسط ${faCount(i.seq)} «${i.debtTitle}»`,
      date: i.dueDate,
      days: daysBetween(today, i.dueDate),
      amountToman: left ? left.toFixed(0) : null,
      href: receivable ? "/debts/obligations" : "/debts/installments",
      action: receivable ? "مشاهده طلب" : "پرداخت",
    });
  }

  for (const c of chequeRows) {
    const issued = c.direction === "issued";
    const amountToman = D(c.amountToman).toFixed(0);
    if (c.status === "bounced") {
      out.push({
        // A cheque that bounces again after being re-presented is new again.
        key: `bounced:${c.id}:${c.statusChangedAt ? new Date(c.statusChangedAt).toISOString().slice(0, 10) : c.dueDate}`,
        kind: "bounced",
        title: issued ? `چک برگشتی شما به «${c.counterparty}»` : `چک برگشتی از «${c.counterparty}»`,
        date: c.dueDate,
        days: daysBetween(today, c.dueDate),
        amountToman,
        href: "/debts/cheques",
        action: "پیگیری",
      });
      continue;
    }
    out.push({
      key: `cheque:${c.id}:${c.dueDate}`,
      kind: "cheque",
      title: issued ? `چک به «${c.counterparty}» — موجودی حساب را آماده کنید` : `وصول چک «${c.counterparty}»`,
      date: c.dueDate,
      days: daysBetween(today, c.dueDate),
      amountToman,
      href: "/debts/cheques",
      action: "دفتر چک",
    });
  }

  for (const d of maturing) {
    if (!d.maturityDate) continue;
    out.push({
      key: `deposit:${d.id}:${d.maturityDate}`,
      kind: "deposit",
      title: `سررسید ${d.kind === "fund" ? "صندوق" : "سپرده"} «${d.title}» — تمدید یا بستن`,
      date: d.maturityDate,
      days: daysBetween(today, d.maturityDate),
      amountToman: D(d.principalToman).toFixed(0),
      href: "/deposits",
      action: "سپرده‌ها",
    });
  }

  for (const p of incomes) {
    const isToman = p.symbol === "IRT";
    out.push({
      key: `income:${p.id}:${p.plannedDate}`,
      kind: "income",
      title: `درآمد «${p.title}»`,
      date: p.plannedDate,
      days: daysBetween(today, p.plannedDate),
      amountToman: isToman ? D(p.amountNative).toFixed(0) : null,
      amountLabel: isToman ? null : `${formatQty(p.amountNative, 6)} ${currencyLabel(p.symbol)}`,
      href: `/new?type=income&planId=${p.id}`,
      action: "ثبت دریافت",
    });
  }

  const r = review.rows[0] as { n: number; newest: string | null } | undefined;
  if (r && r.n > 0) {
    out.push({
      // A new import batch (a newer date) is unread again; reviewing some of
      // the same batch is not.
      key: `review:${r.newest}`,
      kind: "review",
      title: `${faCount(r.n)} تراکنش درون‌ریزی‌شده بررسی نشده است`,
      date: null,
      days: null,
      amountToman: null,
      href: "/transactions?review=unreviewed",
      action: "بررسی",
    });
  }

  // Overdue first, then by date; undated items last.
  out.sort((a, b) => (a.days ?? Number.POSITIVE_INFINITY) - (b.days ?? Number.POSITIVE_INFINITY));

  const seen = new Set<string>();
  if (u && out.length) {
    const reads = await db
      .select({ key: notificationReads.key })
      .from(notificationReads)
      .where(and(eq(notificationReads.userId, u), inArray(notificationReads.key, out.map((o) => o.key))));
    for (const row of reads) seen.add(row.key);
  }
  return out.map((o) => ({ ...o, read: seen.has(o.key) }));
}

export async function countUnreadReminders(userId?: string): Promise<number> {
  return (await getReminders(userId)).filter((r) => !r.read).length;
}

/** Mark reminder keys as seen by this user. Unknown keys are harmless. */
export async function markRemindersRead(userId: string, keys: string[]): Promise<void> {
  const clean = [...new Set(keys.filter((k) => typeof k === "string" && k.length > 0 && k.length <= 200))].slice(0, 200);
  if (!clean.length) return;
  await db
    .insert(notificationReads)
    .values(clean.map((key) => ({ userId, key })))
    .onConflictDoNothing();
  // Prune old markers. A reminder still live after 180 days (an installment
  // that long overdue) shows as new again, which it deserves.
  await db.execute(sql`delete from notification_reads where user_id = ${userId} and read_at < now() - interval '180 days'`);
}
