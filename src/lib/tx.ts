import { ENTRY_TYPE_LABELS, type EntryType } from "@/domain/accounting";
import { D, Decimal } from "@/domain/decimal";
import type { LedgerRow } from "@/features/ledger/queries";
import { currencyLabel, formatQty } from "@/lib/format";

/**
 * Human rendering of a ledger entry.
 * The Human Finance Layer shows ONE number with a direction;
 * the Accounting Truth Layer (ledger page) shows the full postings.
 */

export type HumanTx = {
  /** display amount in base currency, always positive */
  amount: string;
  /**
   * FULL-PRECISION base-currency amount (no 2-dp rounding). Any dynamic Toman
   * equivalent MUST be derived from this — never from `amount`, whose 2-dp
   * display rounding is exactly what produced the ۹۰۸٬۲۰۰-vs-۹۰۹٬۰۹۰ class of
   * discrepancy (Global System Directive §4 — Rounding Service Fix).
   */
  amountExact: string;
  /** native toman on IRT/IRR legs when present — never recomputed via today's FX */
  nativeIrt: string | null;
  /** sign for colour: +1 income-ish, -1 expense-ish, 0 neutral movement */
  sign: -1 | 0 | 1;
  from: string | null;
  to: string | null;
  typeLabel: string;
  /** quantity on the primary leg, e.g. "0.5 BTC" */
  qtyLabel: string | null;
};

const POSITIVE_TYPES = new Set(["income", "sell"]);
const NEGATIVE_TYPES = new Set(["expense", "buy", "installment", "debt", "debt_repayment"]);

export function humanizeEntry(e: LedgerRow): HumanTx {
  const positives = e.lines.filter((l) => D(l.baseValue).gt(0));
  const negatives = e.lines.filter((l) => D(l.baseValue).lt(0));
  const amountDec = positives.reduce((s, l) => s.add(l.baseValue), Decimal.zero());
  const amount = amountDec.gt(0) ? amountDec : D(e.lines[0]?.baseValue ?? 0).abs();
  const amountExact = amount.toString();
  const irtLeg = e.lines.find((l) => l.symbol === "IRT" || l.symbol === "IRR");
  const nativeIrt = irtLeg
    ? (irtLeg.symbol === "IRR" ? D(irtLeg.quantity).abs().div(10) : D(irtLeg.quantity).abs()).toFixed(0)
    : null;

  let sign: -1 | 0 | 1 = 0;
  if (POSITIVE_TYPES.has(e.type)) sign = 1;
  else if (NEGATIVE_TYPES.has(e.type)) sign = -1;

  // From = where value left (negative legs), To = where it arrived (positive legs)
  const from = negatives[0]?.account ?? null;
  const to = positives[0]?.account ?? null;

  const qtyLeg = positives[0] ?? e.lines[0];
  // Display only: the asset label is shown to the user in Persian
  // (USD→دلار, USDT→تتر, IRT→تومان); unknown tickers (ETH, BTC, …) pass through.
  const qtyLabel = qtyLeg && qtyLeg.symbol && qtyLeg.symbol !== "USD" && qtyLeg.symbol !== "IRT" ? `${formatQty(qtyLeg.quantity, qtyLeg.decimals ?? 8)} ${currencyLabel(qtyLeg.symbol)}` : null;

  return {
    amount: amount.toFixed(2),
    amountExact,
    nativeIrt,
    sign,
    from,
    to,
    typeLabel: ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type,
    qtyLabel,
  };
}

/** Human money-flow sentence — never uses debit/credit jargon. */
export function moneyFlowLabel(from: string | null, to: string | null): string | null {
  if (from && to) return `از ${from} به ${to}`;
  if (from) return `از ${from}`;
  if (to) return `به ${to}`;
  return null;
}

/** Badge tone per entry type — semantic, quiet. */
export function typeBadgeTone(type: string): "pos" | "neg" | "brand" | "neutral" | "warn" | "info" {
  if (type === "income") return "pos";
  if (type === "expense") return "neg";
  if (type === "transfer" || type === "fx" || type === "debt_repayment") return "info";
  if (type === "adjustment") return "warn";
  if (type === "buy" || type === "sell") return "brand";
  return "neutral";
}
