import { D, Decimal } from "@/domain/decimal";
import { normalizeBankText } from "./parser";

export type ConfirmedBankRow = {
  entryDate: string;
  type: string;
  status: string;
  reviewed: boolean;
  description: string;
  categoryId?: string | null;
  categoryNonCash?: boolean;
  fxIrtAmount?: string | null;
};

/** Suggestions are drawn only from this user's reviewed, unambiguous history. */
export function suggestBankCategory(description: string, type: string, history: ConfirmedBankRow[]): string {
  const text = normalizeBankText(description);
  if (text.length < 3) return "";
  const matches = history.filter((r) => r.reviewed && r.status === "posted" && r.type === type && !r.categoryNonCash && r.categoryId && normalizeBankText(r.description) === text);
  const categories = new Set(matches.map((r) => r.categoryId!));
  return matches.length >= 2 && categories.size === 1 ? [...categories][0] : "";
}

/** Summarize the supplied observed window; missing frozen amounts are explicitly counted. */
export function summarizeBankHabits(history: ConfirmedBankRow[]) {
  const reviewed = history.filter((r) => r.reviewed && r.status === "posted" && !r.categoryNonCash && ["income", "expense"].includes(r.type));
  const covered = reviewed.filter((r) => r.fxIrtAmount && D(r.fxIrtAmount).gt(0));
  const expenses = covered.filter((r) => r.type === "expense");
  const income = Decimal.sum(covered.filter((r) => r.type === "income").map((r) => r.fxIrtAmount!));
  const spending = Decimal.sum(expenses.map((r) => r.fxIrtAmount!));
  const days = new Map<string, Decimal>();
  for (const r of expenses) days.set(r.entryDate, (days.get(r.entryDate) ?? Decimal.zero()).add(r.fxIrtAmount!));
  const values = [...days.values()].sort((a, b) => a.lt(b) ? -1 : a.gt(b) ? 1 : 0);
  const middle = Math.floor(values.length / 2);
  const typical = values.length ? values.length % 2 ? values[middle] : values[middle - 1].add(values[middle]).div(2) : null;
  return {
    count: covered.length,
    missing: reviewed.length - covered.length,
    income: income.toString(), spending: spending.toString(),
    net: income.sub(spending).toString(),
    typicalSpendingDay: typical?.toFixed(0) ?? null,
    smallExpenseCount: expenses.filter((r) => D(r.fxIrtAmount!).lte("100000")).length,
  };
}
