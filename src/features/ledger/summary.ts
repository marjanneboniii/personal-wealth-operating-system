/**
 * Account-summary aggregation for «سوابق مالی».
 *
 * PURE PRESENTATION. It reads posted balances and groups them; it derives no
 * financial value, writes nothing, and never touches the ledger, FIFO or
 * valuation. It exists as its own module so the totalling rule is testable
 * instead of living inline in JSX — which is how the bug below survived.
 *
 * ── The bug this replaces ──────────────────────────────────────────────
 * The simple view rendered:
 *
 *     formatMoney(totalDebit + totalCredit)
 *
 * In double-entry bookkeeping a balanced ledger always satisfies
 * `totalDebit === totalCredit`, so that expression is ALWAYS exactly twice the
 * real figure. With $33,403.26 of assets balanced by $33,403.26 of opening
 * equity it printed $66,806.51 — the number in the user report.
 *
 * Summing the debit column and the credit column together is not a total of
 * anything: it adds each amount to itself. A list mixing assets, liabilities,
 * equity, income and expense has no single meaningful grand total, so this
 * module returns a subtotal PER ACCOUNT TYPE, each already carried to the sign
 * a reader expects.
 *
 * ── Sign convention ───────────────────────────────────────────────────
 * `baseValue` is stored debit-positive:
 *   asset, expense      → debit balance, positive as stored
 *   liability, equity, income → credit balance, negative as stored
 *
 * Each subtotal is returned as the POSITIVE magnitude a person would say out
 * loud ("۳۳٬۴۰۳ سرمایه"), while `signedTotal` keeps the raw algebraic sum,
 * which must be zero for a balanced ledger.
 */
import { D, Decimal } from "@/domain/decimal";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type SummaryInput = {
  type: string;
  baseValue: string;
};

export type TypeSubtotal = {
  type: AccountType;
  /** The figure as a reader expects it: positive for every type. */
  total: string;
  /** The raw algebraic sum, debit-positive, as stored. */
  signed: string;
  count: number;
};

export type BalanceSummary = {
  subtotals: TypeSubtotal[];
  /** Debit column of the trial balance (PRO view). */
  totalDebit: string;
  /** Credit column of the trial balance, as a positive magnitude. */
  totalCredit: string;
  /**
   * Algebraic sum of every posted balance. Zero on a balanced ledger — this is
   * the only "grand total" that means anything across mixed account types.
   */
  signedTotal: string;
  balanced: boolean;
};

/** Credit-balance types are negated so their subtotal reads positive. */
const CREDIT_TYPES = new Set<AccountType>(["liability", "equity", "income"]);

const ORDER: AccountType[] = ["asset", "liability", "equity", "income", "expense"];

export function summariseBalances(balances: SummaryInput[]): BalanceSummary {
  const byType = new Map<AccountType, { sum: Decimal; count: number }>();
  let debit = Decimal.zero();
  let credit = Decimal.zero();
  let signed = Decimal.zero();

  for (const b of balances) {
    const v = D(b.baseValue);
    if (v.isZero()) continue;

    signed = signed.add(v);
    if (v.gt(0)) debit = debit.add(v);
    else credit = credit.add(v.neg());

    const type = ORDER.includes(b.type as AccountType) ? (b.type as AccountType) : null;
    if (!type) continue;
    const cur = byType.get(type) ?? { sum: Decimal.zero(), count: 0 };
    byType.set(type, { sum: cur.sum.add(v), count: cur.count + 1 });
  }

  const subtotals: TypeSubtotal[] = ORDER.filter((t) => byType.has(t)).map((type) => {
    const { sum, count } = byType.get(type)!;
    return {
      type,
      total: (CREDIT_TYPES.has(type) ? sum.neg() : sum).toString(),
      signed: sum.toString(),
      count,
    };
  });

  return {
    subtotals,
    totalDebit: debit.toString(),
    totalCredit: credit.toString(),
    signedTotal: signed.toString(),
    // Tolerance matches the ledger integrity check in the page query.
    balanced: signed.abs().lt(D("0.000000001")),
  };
}
