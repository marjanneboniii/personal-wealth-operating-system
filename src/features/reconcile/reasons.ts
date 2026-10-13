/**
 * Why a balance is being corrected — chosen by the user when a difference is
 * closed, and written into the entry's description so the history still says
 * what happened months later («تتر به YT رفت», not «تطبیق با بانک»).
 *
 * PURE: shared by the reconcile row (client) and the service (server).
 */
export const RECONCILE_REASONS = [
  { key: "elsewhere", label: "پول جای دیگری رفت", hint: "سرمایه‌گذاری، استیکینگ یا سپرده‌ای که توازن ندارد" },
  { key: "lost", label: "از دست رفت", hint: "هک، کلاهبرداری یا ورشکستگی صرافی" },
  { key: "missing", label: "تراکنشی جا افتاده", hint: "خرید، واریز یا کارمزدی که ثبت نشده بود" },
  { key: "unknown", label: "نمی‌دانم", hint: "فقط موجودی را با واقعیت یکی کن" },
] as const;

export type ReconcileReason = (typeof RECONCILE_REASONS)[number]["key"];

export const NOTE_MAX = 80;

export function isReconcileReason(value: unknown): value is ReconcileReason {
  return RECONCILE_REASONS.some((r) => r.key === value);
}

/** The adjustment entry's description, in the user's words. */
export function reconcileDescription(accountName: string, reason?: ReconcileReason | null, note?: string | null): string {
  const found = RECONCILE_REASONS.find((r) => r.key === reason);
  if (!found) return `تطبیق موجودی «${accountName}» با بانک`;
  const text = (note ?? "").replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
  return `اصلاح موجودی «${accountName}» — ${found.label}${text ? `: ${text}` : ""}`;
}
