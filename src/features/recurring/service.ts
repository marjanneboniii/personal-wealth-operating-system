/**
 * پرداخت‌های تکراری — what leaves every month without a decision.
 *
 * Three sources, all already in the system, nothing typed twice:
 *   1. DETECTED from the ledger: expenses with the same description (month
 *      names and digits ignored) in at least three different Jalali months of
 *      the last six, at a stable amount, and seen recently — a streaming plan,
 *      a phone bill, a gym, a direct debit;
 *   2. insurance premiums (planned outflows linked to a policy);
 *   3. loan installments.
 * Read-only.
 *
 * NO «× 12». Commitments are not a constant: a loan ends, a new one starts, a
 * premium is due once a year, an installment may be every three months. So the
 * page is a SCHEDULE — every outstanding installment on its own due date, every
 * premium on its own date until the policy ends — summed per Jalali month for
 * the next twelve months. Only the detected subscriptions are an estimate
 * (they have no contract), assumed to continue monthly, and are marked so.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { insurancePolicies } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { followingPremiumDate, INSURANCE_KIND_META, type InsuranceKind, type PremiumFrequency } from "@/features/insurance/service";
import { addJalaliMonths } from "@/features/income/recurring";
import { normalizeSearch } from "@/lib/searchText";
import { JALALI_MONTHS, jalaliToIso, todayIso, toJalali } from "@/lib/format";

export type ExpenseSample = { description: string; entryDate: string; toman: string; category: string | null; accountName: string | null };

export type DetectedRecurring = {
  key: string;
  label: string;
  category: string | null;
  accountName: string | null;
  /** Median of the occurrences, Toman. */
  monthlyToman: string;
  months: number;
  lastDate: string;
  nextExpected: string;
};

/**
 * Jalali month names in their NORMALISED spelling (آبان → ابان), matched as
 * whole words only — «دی» must not be cut out of «دیجی‌کالا», nor «مهر» out of
 * «مهرسا».
 */
const MONTH_NAMES = /(?<=^|\s)(?:فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|ابان|اذر|دی|بهمن|اسفند)(?=\s|$)/g;

/** «اشتراک فیلیمو مهر ۱۴۰۵» and «اشتراک فیلیمو آبان» are one payment. PURE. */
export function recurringKey(description: string): string {
  const words = normalizeSearch(description).replace(/[0-9]+/g, " ").replace(/[^\p{L}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return words.replace(MONTH_NAMES, " ").replace(/\s+/g, " ").trim();
}

function median(values: Decimal[]): Decimal {
  const s = [...values].sort((a, b) => a.cmp(b));
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : s[mid - 1].add(s[mid]).div(2);
}

/**
 * Recurring expenses among `rows` (the last ~6 months). A group qualifies when
 * it appears in ≥ 3 distinct Jalali months, every amount is within 15 % of the
 * median, and its last occurrence is at most 45 days old. PURE.
 */
export function detectRecurring(rows: ExpenseSample[], today: string): DetectedRecurring[] {
  const groups = new Map<string, ExpenseSample[]>();
  for (const r of rows) {
    const key = recurringKey(r.description);
    if (key.length < 3 || !D(r.toman).gt(0)) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: DetectedRecurring[] = [];
  for (const [key, list] of groups) {
    const months = new Set(list.map((r) => { const j = toJalali(r.entryDate); return `${j.y}-${j.m}`; }));
    if (months.size < 3) continue;
    const amounts = list.map((r) => D(r.toman));
    const mid = median(amounts);
    if (amounts.some((a) => a.sub(mid).abs().gt(mid.mul("0.15")))) continue;
    const sorted = [...list].sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const last = sorted[sorted.length - 1];
    const age = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.entryDate}T00:00:00Z`)) / 86_400_000;
    if (age > 45) continue;
    // Several charges in one month (a weekly habit) are not a monthly bill: take one per month.
    const perMonth = mid.mul(list.length).div(months.size);
    out.push({
      key,
      label: last.description,
      category: last.category,
      accountName: last.accountName,
      monthlyToman: perMonth.toFixed(0),
      months: months.size,
      lastDate: last.entryDate,
      nextExpected: addJalaliMonths(last.entryDate, 1),
    });
  }
  return out.sort((a, b) => D(b.monthlyToman).cmp(a.monthlyToman));
}

export type CommitmentKind = "installment" | "premium" | "subscription";

/** One payment on one date. */
export type Occurrence = { key: string; kind: CommitmentKind; title: string; date: string; toman: string };

export type MonthBucket = {
  /** «1405-7» */
  key: string;
  /** First day of the Jalali month, ISO. */
  start: string;
  label: string;
  year: number;
  totalToman: string;
  parts: Record<CommitmentKind, string>;
  /** What is due that month, largest first. */
  items: { key: string; kind: CommitmentKind; title: string; toman: string; estimated: boolean }[];
  /** Overdue installments folded into the current month. */
  overdueToman: string;
};

export const HORIZON_MONTHS = 12;

/** The Jalali month `k` months after the one containing `today`. PURE. */
function monthAt(today: string, k: number) {
  const j = toJalali(today);
  const idx = j.m - 1 + k;
  const y = j.y + Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return { y, m, key: `${y}-${m}`, start: jalaliToIso(y, m, 1) };
}

/**
 * Sum the payments per Jalali month over the next `horizon` months. An
 * occurrence before the current month is overdue — it is still owed, so it
 * weighs on THIS month. Subscriptions (an estimate, no contract) are added to
 * every month — except the current one when already charged in it: every
 * figure is what is still TO PAY, like a paid installment that drops out. PURE.
 */
export function buildSchedule(
  occurrences: Occurrence[],
  subscriptions: { key: string; title: string; monthlyToman: string; lastDate?: string }[],
  today: string,
  horizon = HORIZON_MONTHS,
): MonthBucket[] {
  const months = Array.from({ length: horizon }, (_, k) => monthAt(today, k));
  const first = months[0];
  const byKey = new Map(months.map((m, i) => [m.key, i]));
  const buckets = months.map((m) => ({
    key: m.key,
    start: m.start,
    label: JALALI_MONTHS[m.m - 1],
    year: m.y,
    parts: { installment: D("0"), premium: D("0"), subscription: D("0") } as Record<CommitmentKind, Decimal>,
    items: new Map<string, { key: string; kind: CommitmentKind; title: string; toman: Decimal; estimated: boolean }>(),
    overdue: D("0"),
  }));
  const add = (i: number, o: { key: string; kind: CommitmentKind; title: string; toman: string }, estimated: boolean) => {
    const b = buckets[i];
    const amount = D(o.toman);
    b.parts[o.kind] = b.parts[o.kind].add(amount);
    const prev = b.items.get(o.key);
    b.items.set(o.key, { key: o.key, kind: o.kind, title: o.title, toman: (prev?.toman ?? D("0")).add(amount), estimated });
  };
  for (const o of occurrences) {
    if (!D(o.toman).gt(0)) continue;
    if (o.date < first.start) {
      add(0, o, false);
      buckets[0].overdue = buckets[0].overdue.add(o.toman);
      continue;
    }
    const j = toJalali(o.date);
    const i = byKey.get(`${j.y}-${j.m}`);
    if (i != null) add(i, o, false);
  }
  for (const sub of subscriptions) {
    const paidThisMonth = !!sub.lastDate && sub.lastDate >= first.start;
    for (let i = paidThisMonth ? 1 : 0; i < buckets.length; i++) add(i, { ...sub, kind: "subscription", toman: sub.monthlyToman }, true);
  }
  return buckets.map((b) => ({
    key: b.key,
    start: b.start,
    label: b.label,
    year: b.year,
    totalToman: Decimal.sum(Object.values(b.parts)).toFixed(0),
    parts: { installment: b.parts.installment.toFixed(0), premium: b.parts.premium.toFixed(0), subscription: b.parts.subscription.toFixed(0) },
    items: [...b.items.values()].map((it) => ({ ...it, toman: it.toman.toFixed(0) })).sort((a, b2) => D(b2.toman).cmp(a.toman)),
    overdueToman: b.overdue.toFixed(0),
  }));
}

export type InstallmentCommitment = {
  debtId: string;
  title: string;
  nextDueDate: string;
  nextToman: string;
  remainingCount: number;
  remainingToman: string;
  lastDueDate: string;
  overdueCount: number;
  /** Months between installments when regular (1 = monthly), else null. */
  intervalMonths: number | null;
};

export type PremiumCommitment = {
  id: string;
  title: string;
  kind: string;
  frequency: PremiumFrequency;
  perPaymentToman: string;
  nextDate: string | null;
  endDate: string | null;
};

export type RecurringOverview = {
  detected: DetectedRecurring[];
  premiums: PremiumCommitment[];
  installments: InstallmentCommitment[];
  /** The next twelve Jalali months, the current one first. */
  months: MonthBucket[];
  /** Σ of the twelve months — the schedule, never «this month × 12». */
  next12Toman: string;
  /** Installment plans whose last payment falls in the current month. */
  endingThisMonth: string[];
  /** Installment plans whose first payment falls next month. */
  startingNextMonth: string[];
};

export async function listRecurringPayments(userId: string, today = todayIso()): Promise<RecurringOverview> {
  const since = addJalaliMonths(today, -6);
  const horizonEnd = monthAt(today, HORIZON_MONTHS).start;
  const [samples, plans, loans] = await Promise.all([
    db.execute(sql`
      select je.description, je.entry_date::text as "entryDate",
        coalesce((select s.irt_amount from entry_fx_snapshots s where s.entry_id = je.id limit 1), 0)::text as toman,
        ec.name as category,
        (select a.name from postings p join accounts a on a.id = p.account_id and a.type = 'asset'
           where p.entry_id = je.id and p.quantity < 0 limit 1) as "accountName"
      from journal_entries je left join expense_categories ec on ec.id = je.category_id
      where je.user_id = ${userId}::uuid and je.status = 'posted' and je.type = 'expense'
        and je.entry_date >= ${since}::date and je.entry_date <= ${today}::date
        -- A premium paid from its reminder is listed under «بیمه»; never count it twice.
        and not exists (select 1 from planned_transactions pt where pt.executed_entry_id = je.id and pt.insurance_policy_id is not null)
    `),
    // Each active policy's pending premium (or down payment); later ones follow the policy's own cadence.
    db
      .select({
        id: insurancePolicies.id,
        title: insurancePolicies.title,
        kind: insurancePolicies.kind,
        premium: insurancePolicies.premiumToman,
        frequency: insurancePolicies.premiumFrequency,
        startDate: insurancePolicies.startDate,
        endDate: insurancePolicies.endDate,
        nextDate: sql<string | null>`(select pt.planned_date::text from planned_transactions pt where pt.insurance_policy_id = "insurance_policies"."id" and pt.status = 'pending' and pt.deleted_at is null order by pt.planned_date limit 1)`,
        nextToman: sql<string | null>`(select pt.amount_base::text from planned_transactions pt where pt.insurance_policy_id = "insurance_policies"."id" and pt.status = 'pending' and pt.deleted_at is null order by pt.planned_date limit 1)`,
      })
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, "active"))),
    // Every outstanding installment the user owes, on its own due date, for what is still left on it.
    db.execute(sql`
      select d.id as "debtId", d.title, d.schedule_interval_months as "intervalMonths", i.due_date::text as "dueDate",
             (coalesce(i.amount_toman, 0) - coalesce(i.paid_toman, 0))::text as toman
      from installments i join debts d on d.id = i.debt_id
      where d.user_id = ${userId}::uuid and d.deleted_at is null and d.status = 'active'
        and coalesce(d.direction, 'payable') <> 'receivable' and i.status <> 'paid'
      order by i.due_date
    `),
  ]);
  const detected = detectRecurring(samples.rows as ExpenseSample[], today);

  const occurrences: Occurrence[] = [];
  const premiums: PremiumCommitment[] = [];
  for (const p of plans) {
    const frequency = p.frequency as PremiumFrequency;
    if (p.nextDate && p.nextToman) {
      occurrences.push({ key: `p:${p.id}`, kind: "premium", title: p.title, date: p.nextDate, toman: p.nextToman });
      for (let d = followingPremiumDate(p.startDate, frequency, p.nextDate, p.endDate); d && d < horizonEnd; d = followingPremiumDate(p.startDate, frequency, d, p.endDate)) {
        occurrences.push({ key: `p:${p.id}`, kind: "premium", title: p.title, date: d, toman: p.premium });
      }
    }
    // A policy paid through a debt shows under اقساط; one paid in full has nothing ahead.
    if (!p.nextDate) continue;
    premiums.push({
      id: p.id,
      title: p.title,
      kind: INSURANCE_KIND_META[p.kind as InsuranceKind]?.label ?? p.kind,
      frequency,
      perPaymentToman: D(p.nextToman ?? p.premium).toFixed(0),
      nextDate: p.nextDate,
      endDate: p.endDate,
    });
  }

  const byDebt = new Map<string, { title: string; interval: number | null; rows: { dueDate: string; toman: string }[] }>();
  for (const r of loans.rows as { debtId: string; title: string; intervalMonths: number | null; dueDate: string; toman: string }[]) {
    if (!D(r.toman).gt(0)) continue;
    const g = byDebt.get(r.debtId) ?? { title: r.title, interval: r.intervalMonths, rows: [] };
    g.rows.push({ dueDate: r.dueDate, toman: r.toman });
    byDebt.set(r.debtId, g);
    occurrences.push({ key: `d:${r.debtId}`, kind: "installment", title: r.title, date: r.dueDate, toman: r.toman });
  }
  const months = buildSchedule(
    occurrences,
    detected.map((d) => ({ key: `s:${d.key}`, title: d.label, monthlyToman: d.monthlyToman, lastDate: d.lastDate })),
    today,
  );
  const thisStart = months[0].start;
  const nextStart = months[1].start;
  const afterNext = months[2].start;
  const installments: InstallmentCommitment[] = [...byDebt.entries()].map(([debtId, g]) => {
    const upcoming = g.rows.find((r) => r.dueDate >= thisStart) ?? g.rows[0];
    return {
      debtId,
      title: g.title,
      nextDueDate: g.rows[0].dueDate,
      nextToman: D(upcoming.toman).toFixed(0),
      remainingCount: g.rows.length,
      remainingToman: Decimal.sum(g.rows.map((r) => r.toman)).toFixed(0),
      lastDueDate: g.rows[g.rows.length - 1].dueDate,
      overdueCount: g.rows.filter((r) => r.dueDate < today).length,
      intervalMonths: g.interval,
    };
  }).sort((a, b) => a.lastDueDate.localeCompare(b.lastDueDate));

  return {
    detected,
    premiums,
    installments,
    months,
    next12Toman: Decimal.sum(months.map((m) => m.totalToman)).toFixed(0),
    endingThisMonth: installments.filter((i) => i.lastDueDate < nextStart).map((i) => i.title),
    startingNextMonth: installments.filter((i) => i.nextDueDate >= nextStart && i.nextDueDate < afterNext).map((i) => i.title),
  };
}
