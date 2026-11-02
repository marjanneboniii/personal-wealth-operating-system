/**
 * «گزارش ماهانه» — one Jalali month of transactions summed for the printable
 * report on /transactions/report.
 *
 * Every Toman figure follows the list's own rule (txAmountLabel): the native
 * Toman leg or the commit-time snapshot first — frozen, never re-derived — and
 * only an entry with neither is converted at today's rate and counted in
 * `approxCount`, so the report can say how many figures are «≈».
 *
 * What counts where:
 *   income        type income
 *   expense       type expense with a cash category
 *   nonCash       type expense with a non-cash category (depreciation) —
 *                 an expense in the books, never money that left an account
 *   debtPaid      debt repayments and installments — cash out, not an expense
 *   everything else (transfers, buys, sells…) is listed, never summed.
 */
import { D, Decimal } from "@/domain/decimal";
import type { TxRow } from "@/features/ledger/queries";
import { jalaliMonthLength, jalaliToIso, toJalali } from "@/lib/format";
import { humanizeEntry, moneyFlowLabel, type HumanTx } from "@/lib/tx";

export type ReportMonth = { y: number; m: number };

/** «1405-08» → {y: 1405, m: 8}; anything else → null. */
export function parseReportMonth(value: string | undefined | null): ReportMonth | null {
  const match = /^(\d{4})-(\d{1,2})$/.exec(value ?? "");
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  return y >= 1300 && y <= 1500 && m >= 1 && m <= 12 ? { y, m } : null;
}

export function reportMonthKey({ y, m }: ReportMonth): string {
  return `${y}-${String(m).padStart(2, "0")}`;
}

export function shiftReportMonth({ y, m }: ReportMonth, by: number): ReportMonth {
  const index = y * 12 + (m - 1) + by;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

/** The month as an inclusive ISO range, ۱ to the last day. */
export function reportMonthRange({ y, m }: ReportMonth): { from: string; to: string; days: number } {
  const days = jalaliMonthLength(y, m);
  return { from: jalaliToIso(y, m, 1), to: jalaliToIso(y, m, days), days };
}

export type ReportRow = {
  id: string;
  entryDate: string;
  /** Jalali day of month, 1-based */
  day: number;
  type: string;
  typeLabel: string;
  description: string;
  category: string | null;
  flow: string | null;
  sign: HumanTx["sign"];
  /** Toman, whole; null when neither a frozen figure nor a rate exists */
  toman: string | null;
  approx: boolean;
  nonCash: boolean;
};

export type CategoryShare = { name: string; toman: string; share: number; count: number; leaves: { name: string; toman: string; count: number }[] };

export type MonthlyReport = {
  rows: ReportRow[];
  income: string;
  expense: string;
  nonCash: string;
  debtPaid: string;
  /** income − expense */
  net: string;
  /** (income − expense) / income, null without income */
  savingsRate: number | null;
  expenseCount: number;
  incomeCount: number;
  approxCount: number;
  /** rows whose amount could not be put in Toman at all */
  missingCount: number;
  expenseByGroup: CategoryShare[];
  incomeByCategory: CategoryShare[];
  /** cash expense per day of the month, index 0 = day ۱ */
  dailyExpense: string[];
  topExpenses: ReportRow[];
};

const DEBT_TYPES = new Set(["debt_repayment", "installment"]);
const TOP_EXPENSES = 5;

function tomanOf(h: HumanTx, rate: string | null): { toman: Decimal | null; approx: boolean } {
  if (h.nativeIrt) return { toman: D(h.nativeIrt), approx: false };
  if (rate && D(rate).gt(0)) return { toman: D(D(h.amountExact).mul(rate).toFixed(0)), approx: true };
  return { toman: null, approx: false };
}

function shares(entries: { group: string; leaf: string; toman: Decimal }[]): CategoryShare[] {
  const total = entries.reduce((s, e) => s.add(e.toman), Decimal.zero());
  const groups = new Map<string, { toman: Decimal; count: number; leaves: Map<string, { toman: Decimal; count: number }> }>();
  for (const e of entries) {
    const g = groups.get(e.group) ?? { toman: Decimal.zero(), count: 0, leaves: new Map() };
    g.toman = g.toman.add(e.toman);
    g.count += 1;
    const leaf = g.leaves.get(e.leaf) ?? { toman: Decimal.zero(), count: 0 };
    leaf.toman = leaf.toman.add(e.toman);
    leaf.count += 1;
    g.leaves.set(e.leaf, leaf);
    groups.set(e.group, g);
  }
  return [...groups.entries()]
    .map(([name, g]) => ({
      name,
      toman: g.toman.toFixed(0),
      share: total.gt(0) ? Number(g.toman.div(total).toFixed(4)) : 0,
      count: g.count,
      leaves: [...g.leaves.entries()]
        .map(([leafName, l]) => ({ name: leafName, toman: l.toman.toFixed(0), count: l.count }))
        .sort((a, b) => D(b.toman).cmp(D(a.toman))),
    }))
    .sort((a, b) => D(b.toman).cmp(D(a.toman)));
}

export function buildMonthlyReport(txs: TxRow[], month: ReportMonth, rate: string | null): MonthlyReport {
  const { days } = reportMonthRange(month);
  let income = Decimal.zero();
  let expense = Decimal.zero();
  let nonCash = Decimal.zero();
  let debtPaid = Decimal.zero();
  let approxCount = 0;
  let missingCount = 0;
  let expenseCount = 0;
  let incomeCount = 0;
  const daily = Array.from({ length: days }, () => Decimal.zero());
  const expenseParts: { group: string; leaf: string; toman: Decimal }[] = [];
  const incomeParts: { group: string; leaf: string; toman: Decimal }[] = [];

  const rows: ReportRow[] = txs.map((tx) => {
    const h = humanizeEntry(tx);
    const { toman, approx } = tomanOf(h, rate);
    if (approx) approxCount += 1;
    if (!toman) missingCount += 1;
    const day = toJalali(tx.entryDate).d;
    const nonCashRow = tx.type === "expense" && !!tx.categoryNonCash;
    const leaf = tx.categoryName?.trim() || null;

    if (toman) {
      if (tx.type === "income") {
        income = income.add(toman);
        incomeCount += 1;
        incomeParts.push({ group: leaf ?? "بدون دسته", leaf: leaf ?? "بدون دسته", toman });
      } else if (tx.type === "expense" && nonCashRow) {
        nonCash = nonCash.add(toman);
      } else if (tx.type === "expense") {
        expense = expense.add(toman);
        expenseCount += 1;
        if (day >= 1 && day <= days) daily[day - 1] = daily[day - 1].add(toman);
        expenseParts.push({ group: tx.categoryParentName?.trim() || "بدون دسته", leaf: leaf ?? "بدون دسته", toman });
      } else if (DEBT_TYPES.has(tx.type)) {
        debtPaid = debtPaid.add(toman);
      }
    }

    return {
      id: tx.id,
      entryDate: tx.entryDate,
      day,
      type: tx.type,
      typeLabel: h.typeLabel,
      description: tx.description,
      category: leaf ? (tx.categoryParentName ? `${tx.categoryParentName} › ${leaf}` : leaf) : null,
      flow: moneyFlowLabel(h.from, tx.type === "expense" ? null : h.to),
      sign: h.sign,
      toman: toman ? toman.toFixed(0) : null,
      approx,
      nonCash: nonCashRow,
    };
  });

  const net = income.sub(expense);
  return {
    rows,
    income: income.toFixed(0),
    expense: expense.toFixed(0),
    nonCash: nonCash.toFixed(0),
    debtPaid: debtPaid.toFixed(0),
    net: net.toFixed(0),
    savingsRate: income.gt(0) ? Number(net.div(income).toFixed(4)) : null,
    expenseCount,
    incomeCount,
    approxCount,
    missingCount,
    expenseByGroup: shares(expenseParts),
    // Income has few categories — one level is enough.
    incomeByCategory: shares(incomeParts),
    dailyExpense: daily.map((d) => d.toFixed(0)),
    topExpenses: rows
      .filter((r) => r.type === "expense" && !r.nonCash && r.toman)
      .sort((a, b) => D(b.toman!).cmp(D(a.toman!)))
      .slice(0, TOP_EXPENSES),
  };
}
