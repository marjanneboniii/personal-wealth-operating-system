/**
 * خرید اقساطی (BNPL) — a purchase paid back in a few interest-free monthly
 * installments through a service such as اسنپ‌پی or دیجی‌پی. Only a starting
 * point for the ordinary debt form: every value stays editable, and the
 * schedule goes through the same generators as any other debt.
 */
import { addJalaliMonths } from "@/features/income/recurring";

export const BNPL_PROVIDERS = ["اسنپ‌پی", "دیجی‌پی", "تارا", "ازکی", "لندو"] as const;
export const BNPL_INSTALLMENTS = 4;

/** Four monthly installments, the first one Jalali month after the purchase, no interest. PURE. */
export function bnplPreset(purchaseDate: string) {
  return {
    interestRate: "0",
    schedule: {
      mode: "recurring" as const,
      count: String(BNPL_INSTALLMENTS),
      intervalMonths: "1",
      firstDueDate: addJalaliMonths(purchaseDate, 1),
      customDates: [""],
      installmentIrt: "",
    },
  };
}
