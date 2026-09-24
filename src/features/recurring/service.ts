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
 * Read-only. The monthly figure of each item is its per-month equivalent, so
 * an annual premium weighs one twelfth.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { insurancePolicies } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { annualPremium, INSURANCE_KIND_META, type InsuranceKind, type PremiumFrequency } from "@/features/insurance/service";
import { addJalaliMonths } from "@/features/income/recurring";
import { normalizeSearch } from "@/lib/searchText";
import { todayIso, toJalali } from "@/lib/format";

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

export type RecurringOverview = {
  detected: DetectedRecurring[];
  premiums: { id: string; title: string; kind: string; monthlyToman: string; annualToman: string; frequency: PremiumFrequency }[];
  installments: { title: string; monthlyToman: string }[];
  monthlyTotal: string;
};

export async function listRecurringPayments(userId: string, today = todayIso()): Promise<RecurringOverview> {
  const since = addJalaliMonths(today, -6);
  const [samples, policies, loans] = await Promise.all([
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
    db
      .select({ id: insurancePolicies.id, title: insurancePolicies.title, kind: insurancePolicies.kind, premium: insurancePolicies.premiumToman, frequency: insurancePolicies.premiumFrequency })
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, "active"), sql`${insurancePolicies.premiumFrequency} <> 'once'`)),
    // Installments of active debts the user pays: the typical monthly amount per loan.
    db.execute(sql`
      select d.title, percentile_cont(0.5) within group (order by coalesce(i.amount_toman, 0))::text as monthly
      from installments i join debts d on d.id = i.debt_id
      where d.user_id = ${userId}::uuid and d.deleted_at is null and coalesce(d.direction, 'payable') <> 'receivable'
        and i.status <> 'paid' and i.due_date >= ${today}::date
      group by d.id, d.title
    `),
  ]);
  const detected = detectRecurring(samples.rows as ExpenseSample[], today);
  const premiums = policies.map((p) => {
    const annual = annualPremium(p.premium, p.frequency as PremiumFrequency);
    return {
      id: p.id,
      title: p.title,
      kind: INSURANCE_KIND_META[p.kind as InsuranceKind]?.label ?? p.kind,
      annualToman: annual,
      monthlyToman: D(annual).div(12).toFixed(0),
      frequency: p.frequency as PremiumFrequency,
    };
  });
  const installments = (loans.rows as { title: string; monthly: string }[])
    .filter((l) => D(l.monthly ?? "0").gt(0))
    .map((l) => ({ title: l.title, monthlyToman: D(l.monthly).toFixed(0) }));
  const monthlyTotal = Decimal.sum([
    ...detected.map((d) => d.monthlyToman),
    ...premiums.map((p) => p.monthlyToman),
    ...installments.map((i) => i.monthlyToman),
  ]).toFixed(0);
  return { detected: detected, premiums, installments, monthlyTotal };
}
