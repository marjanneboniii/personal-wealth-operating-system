/**
 * Creating a debt and its repayment schedule — the shared core.
 *
 * This was extracted from `createDebtAction` so the setup wizard can register
 * a user's existing loans WITHOUT a second copy of the rules. Those rules are
 * not incidental: the contractual Toman amount is authoritative, the USD
 * figures are a creation-time snapshot that must never be treated as a source
 * of truth, and the installment schedule freezes the FX rate it was created
 * at. A parallel implementation in the wizard would have drifted from all
 * three the first time one of them changed.
 *
 * PLANNING LAYER ONLY. A debt registered here posts NO journal entry and gets
 * NO ledger account (`accountId: null`) by design — an obligation the user is
 * merely recording is not money that has moved. The accounting core stays
 * untouched until a real repayment is recorded through `payInstallment`.
 */
import { D } from "@/domain/decimal";
import { db } from "@/db";
import { debts, installments } from "@/db/schema";
import { addMonthsIso } from "@/lib/format";

export type CreateDebtInput = {
  userId: string | null;
  title: string;
  creditor: string;
  /** Contractual principal in Toman — the authoritative figure. */
  principalIrt: string;
  interestRate?: string;
  /** ISO Gregorian date. */
  startDate: string;
  installmentCount?: number;
  /** Toman per installment. Empty means «split the principal evenly». */
  installmentIrt?: string;
  firstDueDate?: string;
};

export type CreateDebtContext = {
  /** Live USD→IRT rate, for the audit snapshot only. Never authoritative. */
  usdIrtRate: string;
  /** Transaction handle, so a caller can register several debts atomically. */
  tx?: typeof db;
};

/**
 * Validate the contractual shape of a debt. Kept separate from the write so a
 * form can check every row BEFORE anything is inserted — registering three
 * loans and failing on the third must not leave the first two behind.
 */
export function validateDebtInput(input: CreateDebtInput): string | null {
  if (input.title.trim().length < 2) return "عنوان بدهی را وارد کنید.";
  if (input.creditor.trim().length < 2) return "نام بستانکار را وارد کنید.";

  const principal = D(input.principalIrt || "0");
  if (!principal.gt(0)) return "اصل بدهی باید بزرگ‌تر از صفر باشد.";

  const rate = D(input.interestRate || "0");
  if (rate.isNegative() || rate.gt(100)) return "نرخ سود باید بین صفر تا ۱۰۰ درصد باشد.";

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate)) return "تاریخ شروع را انتخاب کنید.";

  const count = input.installmentCount ?? 0;
  if (!Number.isInteger(count) || count < 0 || count > 360) {
    return "تعداد اقساط باید بین صفر تا ۳۶۰ باشد.";
  }
  if (count > 0) {
    if (!input.firstDueDate) return "برای بدهی قسطی، تاریخ اولین سررسید را انتخاب کنید.";
    if (input.firstDueDate < input.startDate) {
      return "اولین سررسید نمی‌تواند قبل از تاریخ شروع بدهی باشد.";
    }
    if (input.installmentIrt && !D(input.installmentIrt).gt(0)) {
      return "مبلغ هر قسط باید بزرگ‌تر از صفر باشد.";
    }
  }
  return null;
}

/** The per-installment amount, explicit or derived by splitting the principal. */
export function resolveInstallmentAmount(input: CreateDebtInput): string {
  const count = input.installmentCount ?? 0;
  if (count <= 0) return "0";
  if (input.installmentIrt && D(input.installmentIrt).gt(0)) {
    return D(input.installmentIrt).toString();
  }
  return D(input.principalIrt).div(String(count)).toString();
}

/**
 * Insert one debt and its schedule. Returns the new debt id.
 *
 * Pass `tx` to enrol several debts in ONE transaction — the setup wizard does,
 * so a user registering four loans either gets all four or none, never a
 * half-finished obligation list they have to reconcile by hand.
 */
export async function createDebtRecord(
  input: CreateDebtInput,
  context: CreateDebtContext,
): Promise<string> {
  const invalid = validateDebtInput(input);
  if (invalid) throw new Error(invalid);

  const rate = D(context.usdIrtRate);
  if (!rate.gt(0)) throw new Error("نرخ تبدیل دلار به تومان برای ثبت این بدهی موجود نیست.");

  const principalIrt = D(input.principalIrt);
  const installmentIrt = D(resolveInstallmentAmount(input));
  const count = input.installmentCount ?? 0;

  // Toman is the source of truth; the USD values are an audit snapshot and a
  // legacy dual-write. Neither is ever divided back to reconstruct the Toman.
  const principalToman = principalIrt.toString();
  const principalUsdCreated = principalIrt.div(rate).toString();
  const installmentToman = installmentIrt.toString();
  const installmentUsdCreated = installmentIrt.div(rate).toString();
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
      // Planning-only: no ledger account, no journal entry.
      accountId: null,
      status: "active",
    } as never)
    .returning();

  if (count > 0 && input.firstDueDate) {
    await conn.insert(installments).values(
      Array.from({ length: count }, (_, index) => ({
        debtId: created.id,
        seq: index + 1,
        dueDate: addMonthsIso(input.firstDueDate as string, index),
        amountBase: installmentUsdCreated,
        amountToman: installmentToman,
        amountUsdCreated: installmentUsdCreated,
        originalFxRate,
        originalFxRateCapturedAt,
        status: "pending",
      })) as never,
    );
  }

  return created.id;
}
