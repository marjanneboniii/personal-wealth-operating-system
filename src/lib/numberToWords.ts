/**
 * عدد → حروف فارسی (Persian number-to-words)
 * ----------------------------------------------------------------------------
 * Single source of truth for the real-time "amount in words" feature that is
 * shared by every money input across the app (transactions, debts, budgets,
 * accounts, assets, registry, setup wizard, …).
 *
 * Pure, dependency-free and BigInt-based so arbitrarily large amounts convert
 * exactly — no floating point, no rounding drift.
 *
 * Usage:
 *   numberToPersianWords("3000000")  → "سه میلیون"
 *   numberToPersianWords(1250000)    → "یک میلیون و دویست و پنجاه هزار"
 *   amountToWords("300000", "تومان") → "سیصد هزار تومان"
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Convert Persian/Arabic digits (and any latin digits) to latin digits. */
export function toLatinDigits(input: string): string {
  return (input ?? "")
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

const ONES = [
  "", "یک", "دو", "سه", "چهار", "پنج", "شش", "هفت", "هشت", "نه",
  "ده", "یازده", "دوازده", "سیزده", "چهارده", "پانزده", "شانزده",
  "هفده", "هجده", "نوزده",
] as const;

const TENS = [
  "", "", "بیست", "سی", "چهل", "پنجاه", "شصت", "هفتاد", "هشتاد", "نود",
] as const;

const HUNDREDS = [
  "", "صد", "دویست", "سیصد", "چهارصد", "پانصد", "ششصد", "هفتصد", "هشتصد", "نهصد",
] as const;

/** Scale names per 10^(3*i): هزار، میلیون، میلیارد، بیلیون، … */
const SCALES = [
  "",
  "هزار",
  "میلیون",
  "میلیارد",
  "بیلیون",
  "بیلیارد",
  "تریلیون",
  "تریلیارد",
  "کوادریلیون",
  "کوادریلیارد",
  "کوینتیلیون",
  "کوینتیلیارد",
  "سکستیلیون",
  "سکستیلیارد",
  "سپتیلیون",
  "سپتیلیارد",
  "اکتیلیون",
  "اکتیلیارد",
  "نونیلیون",
  "نونیلیارد",
  "دسیلیون",
] as const;

/** Convert a 0–999 integer to Persian words (e.g. 125 → "صد و بیست و پنج"). */
function threeDigitsToWords(n: number): string {
  const parts: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;

  if (hundreds > 0) parts.push(HUNDREDS[hundreds]);

  if (rest > 0) {
    if (rest < 20) {
      parts.push(ONES[rest]);
    } else {
      const tens = Math.floor(rest / 10);
      const ones = rest % 10;
      parts.push(TENS[tens]);
      if (ones > 0) parts.push(ONES[ones]);
    }
  }

  return parts.join(" و ");
}

/** Convert a non-negative BigInt to Persian words grouped by 3 digits. */
function integerToWords(n: bigint): string {
  if (n === 0n) return "صفر";

  // Collect groups from least-significant to most-significant.
  const groups: { value: number; scale: string }[] = [];
  let value = n;
  let index = 0;
  while (value > 0n) {
    const group = Number(value % 1000n);
    value = value / 1000n;
    if (group > 0) groups.push({ value: group, scale: SCALES[index] ?? "" });
    index += 1;
  }

  groups.reverse();
  return groups
    .map((g) => (g.scale ? `${threeDigitsToWords(g.value)} ${g.scale}` : threeDigitsToWords(g.value)))
    .join(" و ");
}

/**
 * Convert an amount (latin or Persian digits, optional thousands separators,
 * optional sign, optional decimals) to Persian words.
 *
 * Returns:
 *   - Persian words for the integer part (e.g. "سه میلیون")
 *   - "صفر" for zero
 *   - null for empty/invalid input
 */
export function numberToPersianWords(value: string | number | bigint | null | undefined): string | null {
  const raw = toLatinDigits(String(value ?? "").trim());
  if (!raw) return null;

  const negative = raw.startsWith("-") || raw.startsWith("−");
  const body = raw.replace(/^[−-]/, "");

  // Remove thousands separators (Persian ٬ , Arabic ٫ , latin , , Arabic comma ،)
  // and take only the integer part (financial amounts are whole numbers).
  const cleaned = body.replace(/[،,٬٫\s]/g, "");
  const integerPart = cleaned.split(".")[0];
  const digits = integerPart.replace(/[^0-9]/g, "");
  if (!digits) return null;

  const big = BigInt(digits);
  if (big === 0n) return negative ? null : "صفر";

  const words = integerToWords(big);
  return negative ? `منفی ${words}` : words;
}

/** Currency keys supported by the shared amount field. */
export type AmountUnitKey = "toman" | "rial" | "usd" | "eur" | "usdt";

export const AMOUNT_UNIT_LABELS: Record<AmountUnitKey, string> = {
  toman: "تومان",
  rial: "ریال",
  usd: "دلار",
  eur: "یورو",
  usdt: "تتر",
};

/** Resolve a currency key (or a free-form label) to the display label. */
export function resolveUnitLabel(unit?: string | null): string {
  if (!unit) return "";
  return (AMOUNT_UNIT_LABELS as Record<string, string>)[unit] ?? unit;
}

/**
 * Full amount-in-words label for the UI hint, e.g. "سه میلیون تومان".
 * Returns null for empty/invalid/zero so the hint stays non-intrusive.
 */
export function amountToWords(value: string | number | bigint | null | undefined, unit?: string | null): string | null {
  const words = numberToPersianWords(value);
  if (!words || words === "صفر") return null;
  const label = resolveUnitLabel(unit);
  return label ? `${words} ${label}` : words;
}
