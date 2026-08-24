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
  // Frozen Toman, never recomputed via today's FX. Priority (first wins):
  //   1. a native IRT/IRR leg (if the entry carried one) — the real Toman unit,
  //   2. the frozen historical purchase Toman of a real-estate opening entry
  //      (real_estate_properties.purchase_price_toman) — a prior-period
  //      acquisition is booked in USD, so its contractual Toman purchase price
  //      is the SINGLE authoritative figure. It wins over any generic snapshot
  //      so a stale/incorrect entry_fx_snapshots row can never override it,
  //   3. the entry's frozen FX snapshot (entry_fx_snapshots.irt_amount).
  const frozenToman = e.realEstatePurchaseToman ?? e.fxIrtAmount;
  const nativeIrt = irtLeg
    ? (irtLeg.symbol === "IRR" ? D(irtLeg.quantity).abs().div(10) : D(irtLeg.quantity).abs()).toFixed(0)
    : frozenToman != null && D(frozenToman).gt(0)
      ? D(frozenToman).toFixed(0)
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
  const pFrom = from != null ? plainAccountName(from) : null;
  const pTo = to != null ? plainAccountName(to) : null;
  if (pFrom && pTo) return `از ${pFrom} به ${pTo}`;
  if (pFrom) return `از ${pFrom}`;
  if (pTo) return `به ${pTo}`;
  return null;
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 * UX TRANSLATION PIPE (Global Directive §4 — Accounting Abstraction Layer)
 *
 * Technical general-ledger account names (equity / opening-capital / reserve
 * accounts such as «سرمایه افتتاحیه تملک‌های تاریخی») are sanitized into
 * smooth, human category titles for the GENERAL UI layer (overview recent
 * activity, transactions). The accounting-truth layer — the /ledger page in
 * Pro Mode — keeps the exact names and codes; this pipe never touches data,
 * only presentation. Rules are ordered: first match wins, everything else
 * passes through untouched.
 * ────────────────────────────────────────────────────────────────────────── */
const PLAIN_ACCOUNT_RULES: { pattern: RegExp; label: string }[] = [
  // 3010 «سرمایه افتتاحیه» + 3015 «سرمایه افتتاحیه تملک‌های تاریخی (املاک)»
  { pattern: /^سرمایه\s+افتتاحیه/, label: "موجودی آغازین" },
  // 3000 «سرمایه» (bare equity root)
  { pattern: /^سرمایه$/, label: "موجودی آغازین" },
  // 3200 «ذخیره استهلاک و تعمیرات آتی» — non-cash reserve
  { pattern: /^ذخیره\s+استهلاک/, label: "ذخیره هزینه‌های آتی (غیرنقدی)" },
  // 4100 «سود سرمایه‌ای تحقق‌یافته»
  { pattern: /^سود\s+سرمایه‌ای\s+تحقق‌یافته/, label: "سود فروش دارایی" },
];

/**
 * Translate ONE technical ledger account name into its smooth human title.
 * Unknown names (real banks, wallets, user-created accounts) pass through
 * unchanged — the pipe only abstracts bookkeeping vocabulary, never the
 * user's own data.
 */
export function plainAccountName(name: string): string {
  for (const rule of PLAIN_ACCOUNT_RULES) {
    if (rule.pattern.test(name)) return rule.label;
  }
  return name;
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
