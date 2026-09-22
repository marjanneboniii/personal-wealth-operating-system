/**
 * نسبت اقساط به درآمد (debt-service ratio) — pure, no DB.
 *
 * The share of a month's income already promised to installments. It is the
 * figure a lender looks at first, and the one debt-to-asset cannot show: a
 * small debt with a heavy schedule strains cash flow long before it moves
 * the balance sheet.
 *
 *  • Numerator: what is still owed on the user's PAYABLE installments due in
 *    the next WINDOW_DAYS, averaged per month. A receivable is money coming
 *    in, never a burden. Overdue rows are left out — they are already
 *    flagged on their own, and this is a forward-looking figure.
 *  • Denominator: average monthly income over the months that had income.
 *    Frozen commit-time Toman when every income entry carries its snapshot;
 *    otherwise the USD total at the current rate, said so via `incomeFrozen`.
 */
import { D, Decimal } from "@/domain/decimal";
import { resolveInstallmentToman, type InstallmentFxRow } from "./installmentFx";
import { isInstallmentOutstanding, remainingToman, resolveDirection } from "./obligations";

export const WINDOW_DAYS = 90;
const WINDOW_MONTHS = 3;

export type DebtServiceInput = {
  today: string;
  /** IRT per USD, for legacy USD-only installments and uncovered income. */
  rate: string | number | null;
  debts: { direction?: string | null; installments: (InstallmentFxRow & { dueDate: string; status: string })[] }[];
  /** getCashflow rows. */
  cashflow: { inflow: string; inflowToman: string | null; inflowEntries: number; inflowEntriesSnap: number }[];
};

export type DebtService = {
  /** Percent, or null when there is no income to divide by. */
  ratioPct: string | null;
  monthlyInstallmentsToman: string;
  monthlyIncomeToman: string | null;
  incomeMonths: number;
  incomeFrozen: boolean;
  installmentsInWindow: number;
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeDebtService({ today, rate, debts, cashflow }: DebtServiceInput): DebtService {
  const end = addDays(today, WINDOW_DAYS);
  let due = Decimal.zero();
  let count = 0;
  for (const debt of debts) {
    if (resolveDirection(debt.direction) !== "payable") continue;
    for (const i of debt.installments) {
      if (!isInstallmentOutstanding(i.status) || i.dueDate < today || i.dueDate >= end) continue;
      const toman = resolveInstallmentToman(i, rate);
      if (toman == null) continue;
      due = due.add(remainingToman({ status: i.status, amountToman: toman, paidToman: i.paidToman }));
      count++;
    }
  }
  const monthlyInstallments = due.div(String(WINDOW_MONTHS));

  const months = cashflow.filter((m) => D(m.inflow).gt(0));
  const incomeFrozen = months.length > 0 && months.every((m) => m.inflowEntries === m.inflowEntriesSnap);
  const rateD = rate != null && D(String(rate)).gt(0) ? D(String(rate)) : null;
  const incomeTotal = incomeFrozen
    ? Decimal.sum(months.map((m) => m.inflowToman ?? "0"))
    : rateD
      ? Decimal.sum(months.map((m) => m.inflow)).mul(rateD)
      : null;
  const monthlyIncome = incomeTotal && months.length ? incomeTotal.div(String(months.length)) : null;

  return {
    ratioPct: monthlyIncome && monthlyIncome.gt(0) ? monthlyInstallments.div(monthlyIncome).mul(100).toFixed(1) : null,
    monthlyInstallmentsToman: monthlyInstallments.toFixed(0),
    monthlyIncomeToman: monthlyIncome ? monthlyIncome.toFixed(0) : null,
    incomeMonths: months.length,
    incomeFrozen,
    installmentsInWindow: count,
  };
}
