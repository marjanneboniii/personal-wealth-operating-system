import { ENTRY_TYPE_LABELS, type EntryType } from "@/domain/accounting";
import type { LedgerRow } from "@/features/ledger/queries";

/**
 * Human rendering of a ledger entry.
 * The Human Finance Layer shows ONE number with a direction;
 * the Accounting Truth Layer (ledger page) shows the full postings.
 */

export type HumanTx = {
  /** display amount in base currency, always positive */
  amount: string;
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
  const positives = e.lines.filter((l) => Number(l.baseValue) > 0);
  const negatives = e.lines.filter((l) => Number(l.baseValue) < 0);
  const amount = positives.reduce((s, l) => s + Number(l.baseValue), 0) || Math.abs(Number(e.lines[0]?.baseValue ?? 0));

  let sign: -1 | 0 | 1 = 0;
  if (POSITIVE_TYPES.has(e.type)) sign = 1;
  else if (NEGATIVE_TYPES.has(e.type)) sign = -1;

  // From = where value left (negative legs), To = where it arrived (positive legs)
  const from = negatives[0]?.account ?? null;
  const to = positives[0]?.account ?? null;

  const qtyLeg = positives[0] ?? e.lines[0];
  const qtyLabel = qtyLeg && qtyLeg.symbol && qtyLeg.symbol !== "USD" && qtyLeg.symbol !== "IRT" ? `${Number(qtyLeg.quantity).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${qtyLeg.symbol}` : null;

  return {
    amount: amount.toFixed(2),
    sign,
    from,
    to,
    typeLabel: ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type,
    qtyLabel,
  };
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
