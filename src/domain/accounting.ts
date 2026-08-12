import { D, Decimal } from "./decimal";

export type AccountType = "asset" | "liability" | "equity" | "income" | "expense";

export type EntryType =
  | "transfer"
  | "buy"
  | "sell"
  | "income"
  | "expense"
  | "fx"
  | "debt"
  | "debt_repayment"
  | "installment"
  | "adjustment"
  | "opening";

/**
 * Transaction-type separation (never conflated):
 *  - expense        → a real consumption cost (classified by category).
 *  - debt_repayment → principal repayment of a debt; it decreases a
 *                     liability (or is tracked separately) and is NOT an
 *                     expense in reports.
 *  - transfer       → movement between the user's own accounts; neither
 *                     income nor expense.
 */
export const ENTRY_TYPE_LABELS: Record<EntryType, string> = {
  transfer: "انتقال",
  buy: "خرید دارایی",
  sell: "فروش دارایی",
  income: "درآمد",
  expense: "هزینه",
  fx: "تبدیل ارز",
  debt: "ایجاد بدهی",
  debt_repayment: "بازپرداخت بدهی",
  installment: "پرداخت قسط",
  adjustment: "اصلاحی",
  opening: "افتتاحیه",
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "دارایی",
  liability: "بدهی",
  equity: "سرمایه",
  income: "درآمد",
  expense: "هزینه",
};

export type DraftPosting = {
  accountId: string;
  assetId: string;
  quantity: string;
  baseValue: string;
  memo?: string | null;
};

export class UnbalancedEntryError extends Error {
  constructor(delta: string) {
    super(`سند تراز نیست. اختلاف در ارز پایه: ${delta}`);
    this.name = "UnbalancedEntryError";
  }
}

/** Tolerance: 1e-9 of the base currency — covers rounding of imported rates. */
const TOLERANCE = D("0.000000001");

/**
 * Core invariant of the whole system:
 * a journal entry may only be posted when the signed sum of base values is zero
 * and it contains at least two postings.
 */
export function assertBalanced(postings: DraftPosting[]): void {
  if (postings.length < 2) {
    throw new UnbalancedEntryError("سند باید حداقل دو ردیف داشته باشد");
  }
  const delta = Decimal.sum(postings.map((p) => p.baseValue));
  if (delta.abs().gt(TOLERANCE)) {
    throw new UnbalancedEntryError(delta.toFixed(6));
  }
  for (const p of postings) {
    if (D(p.quantity).isZero()) {
      throw new UnbalancedEntryError("مقدار ردیف نمی‌تواند صفر باشد");
    }
  }
}

/** Natural sign of an account type used when presenting balances. */
export function naturalSign(type: AccountType): 1 | -1 {
  return type === "liability" || type === "income" || type === "equity" ? -1 : 1;
}

/** Value of an account balance as shown to the user (always positive-oriented). */
export function presentBalance(type: AccountType, raw: string): Decimal {
  return D(raw).mul(naturalSign(type));
}
