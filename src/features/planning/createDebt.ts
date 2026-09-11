/**
 * Creating a financial obligation and its repayment schedule — the shared core.
 *
 * This was extracted from `createDebtAction` so the setup wizard can register
 * a user's existing loans WITHOUT a second copy of the rules. Those rules are
 * not incidental: the contractual Toman amount is authoritative, the USD
 * figures are a creation-time snapshot that must never be treated as a source
 * of truth, and the installment schedule freezes the FX rate it was created
 * at. A parallel implementation in the wizard would have drifted from all
 * three the first time one of them changed. `createDebtAction` now delegates
 * here too, so there is exactly ONE place an obligation is written.
 *
 * DIRECTION. The same core writes «بدهی من» (payable) and «طلب من»
 * (receivable): one contract shape, two ends. Nothing about the schedule, the
 * Toman truth or the FX freeze differs between them — only the SIGN of the
 * cash leg at settlement does, and that lives in `obligations.settlementSign`,
 * not here.
 *
 * PLANNING LAYER ONLY. An obligation registered here posts NO journal entry
 * and gets NO ledger account (`accountId: null`) by design — money the user
 * merely expects to pay or receive has not moved. The accounting core stays
 * untouched until a real settlement is recorded through `payInstallment` or
 * the transaction form.
 */
import { D } from "@/domain/decimal";
import { db } from "@/db";
import { debts, installments } from "@/db/schema";
import {
  MAX_INSTALLMENTS,
  PAYABLE,
  RECURRING_INTERVALS,
  generateDueDates,
  resolveDirection,
  resolveScheduleAmounts,
  validateSchedule,
  type ObligationDirection,
  type RecurringInterval,
  type ScheduleInput,
} from "@/features/planning/obligations";

export type CreateDebtInput = {
  userId: string | null;
  title: string;
  /** The other party. Creditor for a payable, debtor for a receivable. */
  creditor: string;
  /** Contractual principal in Toman — the authoritative figure. */
  principalIrt: string;
  interestRate?: string;
  /** ISO Gregorian date. */
  startDate: string;
  /** «بدهی من» (default) or «طلب من». */
  direction?: string | null;

  /* ── Schedule. Two shapes, never mixed. ──────────────────────────────
   *
   * RECURRING: installmentCount + firstDueDate (+ intervalMonths, default 1).
   * The generator steps by the interval, so «هر ۳ ماه» is one step of 3.
   *
   * CUSTOM: customDueDates — every installment's own date, with NO interval
   * implied. The brief's example has gaps of 3, 2 and 4 months; that cannot be
   * produced by any cadence, so the dates are stored exactly as given.
   */
  installmentCount?: number;
  /** Cadence in months for a recurring schedule. Defaults to 1 (monthly). */
  intervalMonths?: number;
  firstDueDate?: string;
  /** Independent ISO due dates. When present, the schedule is `custom`. */
  customDueDates?: string[];

  /** Toman per installment. Empty means «split the principal exactly». */
  installmentIrt?: string;
};

export type CreateDebtContext = {
  /** Live USD→IRT rate, for the audit snapshot only. Never authoritative. */
  usdIrtRate: string;
  /** Transaction handle, so a caller can register several debts atomically. */
  tx?: typeof db;
};

/**
 * Build the `ScheduleInput` this obligation describes, or null when it carries
 * no schedule at all (a lump-sum debt the user will settle in one go).
 *
 * Custom wins over recurring when both are somehow present: an explicit list
 * of dates is a stronger statement of intent than a count and a cadence.
 */
export function resolveScheduleInput(input: CreateDebtInput): ScheduleInput | null {
  const custom = input.customDueDates?.filter((d) => d && d.trim().length > 0) ?? [];
  if (custom.length > 0) return { kind: "custom", dueDates: custom };

  const count = input.installmentCount ?? 0;
  if (count <= 0) return null;
  return {
    kind: "recurring",
    count,
    intervalMonths: input.intervalMonths ?? 1,
    firstDueDate: input.firstDueDate ?? "",
  };
}

/**
 * Validate the contractual shape of an obligation. Kept separate from the
 * write so a form can check every row BEFORE anything is inserted —
 * registering three loans and failing on the third must not leave the first
 * two behind.
 */
export function validateDebtInput(input: CreateDebtInput): string | null {
  const direction = resolveDirection(input.direction);
  const noun = direction === PAYABLE ? "بدهی" : "طلب";

  if (input.title.trim().length < 2) return `عنوان ${noun} را وارد کنید.`;
  if (input.creditor.trim().length < 2) {
    return direction === PAYABLE ? "نام بستانکار را وارد کنید." : "نام بدهکار را وارد کنید.";
  }

  const principal = D(input.principalIrt || "0");
  if (!principal.gt(0)) return `اصل ${noun} باید بزرگ‌تر از صفر باشد.`;

  const rate = D(input.interestRate || "0");
  if (rate.isNegative() || rate.gt(100)) return "نرخ سود باید بین صفر تا ۱۰۰ درصد باشد.";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return "تاریخ شروع را انتخاب کنید.";

  if (input.intervalMonths != null && !RECURRING_INTERVALS.includes(input.intervalMonths as RecurringInterval)) {
    return "فاصله اقساط را انتخاب کنید.";
  }

  const count = input.installmentCount ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > MAX_INSTALLMENTS) {
    return `تعداد اقساط باید بین صفر تا ${MAX_INSTALLMENTS} باشد.`;
  }

  const schedule = resolveScheduleInput(input);
  if (schedule) {
    const invalid = validateSchedule(schedule, input.startDate);
    if (invalid) return invalid;
    // A zero or negative per-installment amount is refused outright rather
    // than clamped: it is never what the user meant, and it would make the
    // schedule total disagree with the contract silently.
    if (input.installmentIrt && !D(input.installmentIrt).gt(0)) {
      return "مبلغ هر قسط باید بزرگ‌تر از صفر باشد.";
    }
  }
  return null;
}

/**
 * The per-installment amount, explicit or derived by splitting the principal.
 *
 * Retained for the callers (and tests) that ask for «the» installment figure.
 * The exact per-row amounts — which differ by at most one Toman when the
 * principal does not divide evenly — come from `resolveScheduleAmounts`.
 */
export function resolveInstallmentAmount(input: CreateDebtInput): string {
  const schedule = resolveScheduleInput(input);
  if (!schedule) return "0";
  if (input.installmentIrt && D(input.installmentIrt).gt(0)) {
    return D(input.installmentIrt).toString();
  }
  const count = generateDueDates(schedule).length;
  if (count <= 0) return "0";
  return D(input.principalIrt).div(String(count)).toString();
}

/**
 * Insert one obligation and its schedule. Returns the new row's id.
 *
 * Pass `tx` to enrol several obligations in ONE transaction — the setup wizard
 * does, so a user registering four loans either gets all four or none, never a
 * half-finished list they have to reconcile by hand.
 */
export async function createDebtRecord(
  input: CreateDebtInput,
  context: CreateDebtContext,
): Promise<string> {
  const invalid = validateDebtInput(input);
  if (invalid) throw new Error(invalid);

  const rate = D(context.usdIrtRate);
  if (!rate.gt(0)) throw new Error("نرخ تبدیل دلار به تومان برای ثبت این مورد موجود نیست.");

  const direction: ObligationDirection = resolveDirection(input.direction);
  const principalIrt = D(input.principalIrt);
  const schedule = resolveScheduleInput(input);
  const dueDates = schedule ? generateDueDates(schedule) : [];

  // Exact split: Σ(installments) === principal, to the Toman, with the
  // remainder distributed over the earliest rows instead of being rounded
  // away. An explicit per-installment figure is honoured as entered — an
  // interest-bearing schedule legitimately totals MORE than its principal.
  const amounts = resolveScheduleAmounts({
    principalToman: principalIrt.toFixed(0),
    count: dueDates.length,
    installmentToman: input.installmentIrt,
  });

  // Toman is the source of truth; the USD values are an audit snapshot and a
  // legacy dual-write. Neither is ever divided back to reconstruct the Toman.
  const principalToman = principalIrt.toString();
  const principalUsdCreated = principalIrt.div(rate).toString();
  // Frozen at creation: a later rate change never rewrites the schedule, it
  // only moves the DERIVED equivalent shown for a pending installment.
  const originalFxRate = rate.toString();
  const originalFxRateCapturedAt = new Date();

  const conn = context.tx ?? db;
  const [created] = await conn
    .insert(debts)
    .values({
      userId: input.userId,
      creditor: input.creditor.trim(),
      title: input.title.trim(),
      principalBase: principalUsdCreated,
      principalToman,
      principalUsdCreated,
      interestRate: D(input.interestRate || "0").toString(),
      startDate: input.startDate,
      direction,
      scheduleKind: schedule?.kind ?? null,
      scheduleIntervalMonths: schedule?.kind === "recurring" ? schedule.intervalMonths : null,
      // Planning-only: no ledger account, no journal entry.
      accountId: null,
      status: "active",
    } as never)
    .returning();

  if (dueDates.length > 0) {
    await conn.insert(installments).values(
      dueDates.map((dueDate, index) => {
        const amountToman = amounts[index];
        const amountUsdCreated = D(amountToman).div(rate).toString();
        return {
          // Every installment is a CHILD of this obligation — there is no path
          // that writes one without a parent (brief §18).
          debtId: created.id,
          seq: index + 1,
          dueDate,
          amountBase: amountUsdCreated,
          amountToman,
          amountUsdCreated,
          originalFxRate,
          originalFxRateCapturedAt,
          status: "pending",
        };
      }) as never,
    );
  }

  return created.id;
}
