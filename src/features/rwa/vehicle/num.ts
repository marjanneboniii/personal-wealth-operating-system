/**
 * Vehicle module — numeric normalisation at the DB boundary.
 *
 * PostgreSQL `numeric(38, 18)` columns come back as
 * `"8500000000.000000000000000000"`. Those raw strings must never reach the
 * DTOs: they break value comparisons and leak 18 zeros into the UI.
 * Every read goes through these helpers so the whole module speaks one
 * canonical numeric dialect:
 *
 *   Toman  → integer string      (تومان کسری ندارد)
 *   USD    → 2 decimals
 *   FX rate→ shortest exact form
 */
import { D } from "@/domain/decimal";

type Numeric = string | number | bigint | null | undefined;

function has(value: Numeric): value is string | number | bigint {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

/** مبلغ تومانی — عدد صحیح */
export function tomanStr(value: Numeric): string | null {
  return has(value) ? D(value.toString()).toFixed(0) : null;
}

/** مبلغ دلاری — دو رقم اعشار */
export function usdStr(value: Numeric): string | null {
  return has(value) ? D(value.toString()).toFixed(2) : null;
}

/** نرخ دلار — کوتاه‌ترین نمایش دقیق (بدون صفرهای انتهایی) */
export function rateStr(value: Numeric): string | null {
  return has(value) ? D(value.toString()).toString() : null;
}
