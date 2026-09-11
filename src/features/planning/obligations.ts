/**
 * تعهدات مالی — the shared model behind «بدهی‌های من» and «مطالبات من».
 *
 * WHY ONE MODEL WITH AN EXPLICIT DIRECTION, NOT TWO TABLES
 * A debt and a receivable are the same contract read from two ends: a
 * counterparty, a principal, a status, and (optionally) a repayment schedule.
 * Splitting them into two tables would have duplicated the schedule, the FX
 * freeze, the tenant scoping and the payment path — four things this project
 * already got right ONCE, in the debt domain. So the row stays one row and the
 * DIRECTION is a first-class field.
 *
 * WHY DIRECTION IS NEVER "JUST A LABEL"
 * The direction decides the ACCOUNTING SIGN of a settlement, not merely the
 * word on a button:
 *
 *   payable    (بدهی من)   settle → cash ↓ , obligation ↓   «پرداخت»
 *   receivable (طلب من)    settle → cash ↑ , receivable ↓   «دریافت»
 *
 * `settlementSign()` below is the single place that mapping lives, so a UI can
 * never produce a receipt that drains the wallet by flipping a caption.
 *
 * PURE MODULE — no database, no clock, no FX lookup, no side effects. Every
 * function here is total and deterministic so the money invariants in §18 of
 * the brief can be tested without a server.
 */
import { D, Decimal } from "@/domain/decimal";

/* ------------------------------------------------------------------ */
/* Direction                                                           */
/* ------------------------------------------------------------------ */

/** بدهی من — a liability the user owes to someone else. */
export const PAYABLE = "payable";
/** طلب من — a receivable someone else owes to the user. */
export const RECEIVABLE = "receivable";

export type ObligationDirection = typeof PAYABLE | typeof RECEIVABLE;

/**
 * Normalise whatever a row or a form carries into a direction.
 * Anything unrecognised — including the NULL that every pre-migration debt row
 * carries — reads as `payable`, which is what those rows have always been.
 */
export function resolveDirection(value: string | null | undefined): ObligationDirection {
  return value === RECEIVABLE ? RECEIVABLE : PAYABLE;
}

export function isReceivable(value: string | null | undefined): boolean {
  return resolveDirection(value) === RECEIVABLE;
}

/**
 * The sign a settlement applies to the user's CASH.
 *   payable    → -1 (money leaves)
 *   receivable → +1 (money arrives)
 *
 * The ledger posting path multiplies its cash leg by this, so the two
 * directions can never collapse into one another.
 */
export function settlementSign(direction: string | null | undefined): -1 | 1 {
  return isReceivable(direction) ? 1 : -1;
}

/** The user-facing verb for settling this obligation. */
export function settlementVerb(direction: string | null | undefined): string {
  return isReceivable(direction) ? "دریافت" : "پرداخت";
}

/** Persian noun for the obligation itself, for headings and empty states. */
export function directionLabel(direction: string | null | undefined): string {
  return isReceivable(direction) ? "طلب" : "بدهی";
}

/** The counterparty's role, which differs per direction. */
export function counterpartyLabel(direction: string | null | undefined): string {
  return isReceivable(direction) ? "بدهکار" : "بستانکار";
}

/* ------------------------------------------------------------------ */
/* Repayment schedule                                                  */
/* ------------------------------------------------------------------ */

/**
 * How the due dates of a schedule are produced.
 *
 *   once    — a single settlement on one date (a debt «بدون قسط» with a due date)
 *   every-N — a fixed cadence in MONTHS (1, 2, 3, 4, 5, 6 …)
 *   custom  — every installment carries its OWN date, with no interval implied
 *
 * `custom` is not a special case of `every-N` with a variable step: it has no
 * step at all. The brief's example (۱۴۰۵/۰۷/۲۰ → ۱۴۰۵/۱۰/۲۰ → ۱۴۰۵/۱۲/۲۰ →
 * ۱۴۰۶/۰۴/۲۰) has gaps of 3, 2 and 4 months. Generating those from a cadence is
 * impossible, so the dates are stored as given and never re-derived.
 */
export type ScheduleKind = "once" | "recurring" | "custom";

export const MAX_INSTALLMENTS = 360;
/** The cadences the UI offers, in months. */
export const RECURRING_INTERVALS = [1, 2, 3, 4, 5, 6] as const;
export type RecurringInterval = (typeof RECURRING_INTERVALS)[number];

export type ScheduleInput =
  | { kind: "once"; dueDate: string }
  | { kind: "recurring"; count: number; intervalMonths: number; firstDueDate: string }
  /** Dates exactly as the user entered them — order is normalised, values are not. */
  | { kind: "custom"; dueDates: string[] };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  // Reject a syntactically valid but non-existent date (2025-02-31): the
  // calendar round-trip is the only reliable check.
  const [y, m, d] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * Add whole months to an ISO date, clamping to the end of the target month.
 *
 * Deliberately a LOCAL copy of the rule rather than an import of
 * `addMonthsIso`: this module must stay pure and dependency-free so the
 * schedule invariants can be tested in isolation, and the clamping behaviour
 * (31 Jan + 1 month → 28/29 Feb) is part of the contract being tested. The two
 * agree by construction — `generateDueDates` is verified against
 * `addMonthsIso` in the regression suite.
 */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  return `${target.getUTCFullYear()}-${mm}-${String(day).padStart(2, "0")}`;
}

/**
 * The due dates of a schedule.
 *
 * A `custom` schedule is returned SORTED but otherwise untouched — no interval
 * is inferred, no date is regenerated. A `recurring` schedule steps by
 * `intervalMonths`, so «هر ۳ ماه» is one step of 3, never three steps of 1.
 */
export function generateDueDates(schedule: ScheduleInput): string[] {
  if (schedule.kind === "once") return [schedule.dueDate];
  if (schedule.kind === "custom") return [...schedule.dueDates].sort((a, b) => a.localeCompare(b));
  return Array.from({ length: schedule.count }, (_, index) =>
    addMonthsClamped(schedule.firstDueDate, index * schedule.intervalMonths),
  );
}

/**
 * Validate a schedule before anything is written.
 *
 * Returns a Persian message (the project's convention for user-facing
 * validation) or null. Separated from the write so a form can reject a bad
 * schedule with NOTHING inserted — the same reason `validateDebtInput` exists.
 */
export function validateSchedule(schedule: ScheduleInput, startDate: string): string | null {
  if (schedule.kind === "once") {
    if (!isIsoDate(schedule.dueDate)) return "تاریخ سررسید را انتخاب کنید.";
    if (schedule.dueDate < startDate) return "سررسید نمی‌تواند قبل از تاریخ شروع باشد.";
    return null;
  }

  if (schedule.kind === "custom") {
    const dates = schedule.dueDates;
    if (dates.length === 0) return "برای زمان‌بندی سفارشی، تاریخ هر قسط را وارد کنید.";
    if (dates.length > MAX_INSTALLMENTS) return `تعداد اقساط نمی‌تواند بیشتر از ${MAX_INSTALLMENTS} باشد.`;
    for (const iso of dates) {
      if (!isIsoDate(iso)) return "تاریخ سررسید هر قسط را کامل انتخاب کنید.";
      if (iso < startDate) return "سررسید هیچ قسطی نمی‌تواند قبل از تاریخ شروع باشد.";
    }
    // Two installments on the same day are almost always a mis-click, and they
    // make «قسط بعدی» ambiguous forever after.
    if (new Set(dates).size !== dates.length) return "دو قسط نمی‌توانند سررسید یکسان داشته باشند.";
    return null;
  }

  if (!Number.isInteger(schedule.count) || schedule.count < 1 || schedule.count > MAX_INSTALLMENTS) {
    return `تعداد اقساط باید بین ۱ تا ${MAX_INSTALLMENTS} باشد.`;
  }
  if (!RECURRING_INTERVALS.includes(schedule.intervalMonths as RecurringInterval)) {
    return "فاصله اقساط را انتخاب کنید.";
  }
  if (!isIsoDate(schedule.firstDueDate)) return "تاریخ اولین سررسید را انتخاب کنید.";
  if (schedule.firstDueDate < startDate) return "اولین سررسید نمی‌تواند قبل از تاریخ شروع باشد.";
  return null;
}

/* ------------------------------------------------------------------ */
/* Splitting the principal                                             */
/* ------------------------------------------------------------------ */

/**
 * Split a Toman principal into `count` installments with EXACT decimal
 * arithmetic and a fully accounted remainder.
 *
 * The invariant this exists to guarantee (brief §18):
 *
 *     Σ(installments) === principal      — to the Toman, always
 *
 * Naive `principal / count` rounded per row loses or invents money: 1,000,000
 * over 3 gives 333,333 × 3 = 999,999, one Toman short. Here every row gets the
 * floor and the remainder is distributed one unit at a time over the EARLIEST
 * installments, so the sum reconciles and the last installment is never the
 * odd one out (paying the stub first is what a lender actually does).
 */
export function splitPrincipal(principalToman: string | number, count: number): string[] {
  if (!Number.isInteger(count) || count < 1) throw new Error("تعداد اقساط باید حداقل یک باشد.");
  const principal = D(principalToman);
  if (!principal.gt(0)) throw new Error("اصل مبلغ باید بزرگ‌تر از صفر باشد.");

  // Toman is a whole-unit currency in this app (every amount is stored and
  // displayed with toFixed(0)), so the split is integral by construction.
  const total = BigInt(principal.toFixed(0));
  const n = BigInt(count);
  const base = total / n;
  const remainder = total % n;
  return Array.from({ length: count }, (_, index) =>
    (base + (BigInt(index) < remainder ? 1n : 0n)).toString(),
  );
}

/**
 * Per-installment amounts for a schedule.
 *
 * An explicit per-installment figure is honoured as entered (a real contract
 * often carries interest, so Σ ≠ principal is legitimate and must not be
 * "corrected"); an empty one splits the principal exactly.
 */
export function resolveScheduleAmounts(input: {
  principalToman: string;
  count: number;
  installmentToman?: string | null;
}): string[] {
  const { principalToman, count } = input;
  if (count < 1) return [];
  const explicit = input.installmentToman;
  if (explicit && D(explicit).gt(0)) {
    const each = D(explicit).toFixed(0);
    return Array.from({ length: count }, () => each);
  }
  return splitPrincipal(principalToman, count);
}

/* ------------------------------------------------------------------ */
/* Installment state                                                   */
/* ------------------------------------------------------------------ */

/**
 * Installment lifecycle. `partial` is new; `pending` and `paid` are the two
 * the database has always carried and keep their exact meaning, so no existing
 * row changes state as a result of this model.
 */
export const INSTALLMENT_PENDING = "pending";
export const INSTALLMENT_PARTIAL = "partial";
export const INSTALLMENT_PAID = "paid";

export type InstallmentStatus =
  | typeof INSTALLMENT_PENDING
  | typeof INSTALLMENT_PARTIAL
  | typeof INSTALLMENT_PAID;

/** Anything still owed on this row — `partial` is NOT settled. */
export function isInstallmentOutstanding(status: string | null | undefined): boolean {
  return status !== INSTALLMENT_PAID;
}

export type PartialPaymentRow = {
  status: string;
  /** Contractual Toman of the installment. */
  amountToman?: string | null;
  /** Toman settled SO FAR — accumulates across partial payments. */
  paidToman?: string | null;
};

/** Toman already settled against this installment (0 when nothing is paid). */
export function paidSoFarToman(row: PartialPaymentRow): Decimal {
  const paid = row.paidToman != null && row.paidToman !== "" ? D(row.paidToman) : Decimal.zero();
  return paid.isNegative() ? Decimal.zero() : paid;
}

/**
 * Toman still owed on one installment.
 * A fully paid row is zero by definition even if the figures disagree — the
 * status is what the rest of the system settles on.
 */
export function remainingToman(row: PartialPaymentRow): Decimal {
  if (row.status === INSTALLMENT_PAID) return Decimal.zero();
  const contractual = row.amountToman != null && row.amountToman !== "" ? D(row.amountToman) : null;
  if (!contractual) return Decimal.zero();
  const left = contractual.sub(paidSoFarToman(row));
  return left.isNegative() ? Decimal.zero() : left;
}

/**
 * The state one installment lands in after settling `payToman` against it.
 *
 * Over-payment is REFUSED rather than silently absorbed: an amount larger than
 * the remaining balance is either a typo or a payment that belongs to a
 * different installment, and quietly booking it would make Σ(paid) exceed the
 * contract with no trace of where the excess went.
 */
export function applyPartialPayment(
  row: PartialPaymentRow,
  payToman: string | number,
): { status: InstallmentStatus; paidToman: string; remainingToman: string } {
  if (row.status === INSTALLMENT_PAID) throw new Error("این قسط قبلاً به‌طور کامل تسویه شده است.");

  const pay = D(payToman);
  if (!pay.gt(0)) throw new Error("مبلغ پرداخت باید بزرگ‌تر از صفر باشد.");

  const left = remainingToman(row);
  if (!left.gt(0)) throw new Error("مانده‌ای برای این قسط باقی نمانده است.");
  if (pay.gt(left)) throw new Error("مبلغ پرداخت از مانده این قسط بیشتر است.");

  const total = paidSoFarToman(row).add(pay);
  const stillOwed = left.sub(pay);
  return {
    status: stillOwed.isZero() ? INSTALLMENT_PAID : INSTALLMENT_PARTIAL,
    paidToman: total.toFixed(0),
    remainingToman: stillOwed.toFixed(0),
  };
}

/* ------------------------------------------------------------------ */
/* Derived obligation state                                            */
/* ------------------------------------------------------------------ */

/**
 * The six states the brief asks for (§17), DERIVED — never stored, so the
 * contradiction it warns about («بدهی تسویه‌شده با اقساط پرداخت‌نشده») is
 * unrepresentable rather than merely discouraged.
 */
export type ObligationState =
  | "active"
  | "due-soon"
  | "overdue"
  | "partially-paid"
  | "settled"
  | "cancelled";

export const OBLIGATION_STATE_LABELS: Record<ObligationState, string> = {
  active: "فعال",
  "due-soon": "سررسید نزدیک",
  overdue: "سررسید گذشته",
  "partially-paid": "بخشی پرداخت شده",
  settled: "پرداخت شده",
  cancelled: "لغو شده",
};

/** Days inside which an upcoming due date counts as «سررسید نزدیک». */
export const DUE_SOON_DAYS = 14;

export function deriveObligationState(input: {
  status: string | null | undefined;
  deletedAt?: Date | string | null;
  /** Every installment of this obligation, in any order. */
  installments: PartialPaymentRow[];
  /** Earliest unsettled due date (ISO), when the obligation has a schedule. */
  nextDueDate?: string | null;
  /** Toman still owed overall — used when there is no schedule at all. */
  outstandingToman?: string | null;
  todayIso: string;
}): ObligationState {
  if (input.deletedAt != null || input.status === "cancelled") return "cancelled";

  const outstanding = input.installments.some((i) => isInstallmentOutstanding(i.status));
  const noScheduleBalance =
    input.installments.length === 0 &&
    input.outstandingToman != null &&
    D(input.outstandingToman).gt(0);

  // `settled` is only reachable when NOTHING is outstanding. A stored status of
  // "settled" is not trusted on its own — that is exactly the inconsistency the
  // brief asks to be defended against.
  if (!outstanding && !noScheduleBalance) return "settled";

  if (input.nextDueDate && input.nextDueDate < input.todayIso) return "overdue";

  // A part-paid row outranks the calendar: the user's question about it is
  // «چقدرش مانده؟», not «کِی سررسید است؟».
  if (input.installments.some((i) => i.status === INSTALLMENT_PARTIAL)) return "partially-paid";

  if (input.nextDueDate) {
    const days = Math.ceil(
      (Date.parse(`${input.nextDueDate}T00:00:00Z`) - Date.parse(`${input.todayIso}T00:00:00Z`)) /
        86_400_000,
    );
    if (days <= DUE_SOON_DAYS) return "due-soon";
  }

  return "active";
}
