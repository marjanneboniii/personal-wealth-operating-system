/**
 * Numeric input — one rule for every number a user TYPES, anywhere in the app.
 *
 * WHAT A USER CAN TYPE
 *   • Persian digits (۱۲۳), Arabic-Indic digits (١٢٣) or Latin digits (123) —
 *     mixed freely; all three mean the same number.
 *   • Thousands separators in any spelling (٬ ، , space) — ignored.
 *   • A decimal point as «.», the Persian «٫», or «/» (what many Persian
 *     keyboards produce) — only in fields that accept decimals.
 *
 * WHAT THE FIELD SHOWS
 *   Persian digits grouped by thousands with «٬», e.g. ۱٬۰۰۰٬۰۰۰ — the same
 *   rendering `formatMoney` uses for display, so a number looks identical while
 *   it is being typed and after it is saved. The decimal point stays ASCII «.»,
 *   because «٫» reads as a slash in most Persian UI fonts (see groupThousands).
 *
 * WHAT THE FORM RECEIVES
 *   The canonical value: Latin digits, no separators, at most one «.». Server
 *   actions, Decimal and every existing `onChange` handler read that — the
 *   display format never leaks into accounting.
 *
 * PURE: no DOM, no React — importable from client and server, and testable.
 */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Persian and Arabic-Indic digits → Latin. Everything else is untouched. */
export function toLatinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(FA_DIGITS.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR_DIGITS.indexOf(d)));
}

export type NumericOptions = {
  /** Accept a fractional part. Integer fields drop any decimal mark. */
  decimal?: boolean;
  /** Cap on fractional digits, when the unit has a known precision. */
  maxDecimals?: number;
};

/**
 * Whatever was typed or pasted → the canonical value («1000000», «0.25»).
 * Returns "" for input with no digits.
 */
export function normalizeNumericInput(input: unknown, options: NumericOptions = {}): string {
  if (input === null || input === undefined) return "";
  let s = toLatinDigits(String(input));

  if (options.decimal) {
    // Every spelling of a decimal mark becomes «.»; separators disappear.
    s = s.replace(/[٫/]/g, ".").replace(/[^0-9.]/g, "");
    const dot = s.indexOf(".");
    if (dot >= 0) {
      let frac = s.slice(dot + 1).replace(/\./g, "");
      if (options.maxDecimals !== undefined) frac = frac.slice(0, options.maxDecimals);
      s = `${s.slice(0, dot)}.${frac}`;
      if (s.startsWith(".")) s = `0${s}`;
    }
  } else {
    s = s.replace(/[^0-9]/g, "");
  }

  // No leading zeros on the integer part — «007» is 7 — but «0» and «0.5» stay.
  return s.replace(/^0+(?=\d)/, "");
}

/**
 * Canonical value → what the field shows: grouped, Persian digits by default.
 * A trailing «.» is kept, so a user typing «12.» does not see it vanish.
 */
export function formatNumericInput(raw: string, digits: "fa" | "en" = "fa", grouping = true): string {
  if (!raw) return "";
  const [int, frac] = raw.split(".");
  // A year, a floor or an instalment count is not an amount: «۱۴۰۰», never «۱٬۴۰۰».
  const grouped = grouping
    ? (int || "0").replace(/\B(?=(\d{3})+(?!\d))/g, digits === "fa" ? "٬" : ",")
    : int || "0";
  const out = raw.includes(".") ? `${grouped}.${frac ?? ""}` : grouped;
  return digits === "fa" ? out.replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]) : out;
}

/** A character that carries value — a digit in any script, or the decimal mark. */
function isSignificant(ch: string): boolean {
  return /[0-9۰-۹٠-٩.٫/]/.test(ch);
}

/** How many value-carrying characters sit before `caret` in `text`. */
export function significantBefore(text: string, caret: number): number {
  let count = 0;
  for (let i = 0; i < Math.min(caret, text.length); i++) if (isSignificant(text[i])) count++;
  return count;
}

/**
 * Where the caret belongs in the re-formatted text so it stays after the same
 * digit the user just typed — without this, inserting a separator throws the
 * caret to the end of the field on every keystroke.
 */
export function caretAfterSignificant(formatted: string, count: number): number {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (isSignificant(formatted[i])) {
      seen++;
      if (seen === count) return i + 1;
    }
  }
  return formatted.length;
}
