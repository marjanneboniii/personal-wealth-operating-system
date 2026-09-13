/**
 * Typing numbers — Persian and Latin digits mean the same value, everywhere.
 *
 * WHAT THIS PINS
 *   • ۱۰۰۰۰۰۰, 1000000 and a mix of both are the SAME canonical value.
 *   • The field shows ۱٬۰۰۰٬۰۰۰ — grouped, Persian digits — whatever was typed.
 *   • Separators in any spelling are ignored; decimal marks («.», «٫», «/»)
 *     are read only by decimal fields.
 *   • The caret stays after the digit just typed when separators appear.
 *   • The shared AmountInput posts the canonical value, never the display text.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  caretAfterSignificant,
  formatNumericInput,
  normalizeNumericInput,
  significantBefore,
  toLatinDigits,
} from "../src/lib/numericInput";

test("Persian, Arabic-Indic and Latin digits are the same number", () => {
  assert.equal(toLatinDigits("۱۲۳٤٥٦789"), "123456789");
  assert.equal(normalizeNumericInput("۱۰۰۰۰۰۰"), "1000000");
  assert.equal(normalizeNumericInput("1000000"), "1000000");
  assert.equal(normalizeNumericInput("۱۰00۰۰0"), "1000000", "mixed scripts in one field");
  assert.equal(normalizeNumericInput("١٠٠٠"), "1000", "Arabic-Indic digits from an Arabic keyboard");
});

test("thousands separators in any spelling are ignored", () => {
  for (const typed of ["۱٬۰۰۰٬۰۰۰", "۱،۰۰۰،۰۰۰", "1,000,000", "1 000 000", "۱٬000،۰۰۰"]) {
    assert.equal(normalizeNumericInput(typed), "1000000", typed);
  }
});

test("integer fields drop decimal marks; decimal fields read every spelling of one", () => {
  assert.equal(normalizeNumericInput("12.5"), "125", "an integer field never grows a fraction");
  assert.equal(normalizeNumericInput("۰٫۲۵", { decimal: true }), "0.25", "Persian decimal mark");
  assert.equal(normalizeNumericInput("0/25", { decimal: true }), "0.25", "slash from a Persian keyboard");
  assert.equal(normalizeNumericInput(".5", { decimal: true }), "0.5");
  assert.equal(normalizeNumericInput("1.2.3", { decimal: true }), "1.23", "only the first mark counts");
  assert.equal(normalizeNumericInput("0.123456789", { decimal: true, maxDecimals: 8 }), "0.12345678");
  assert.equal(normalizeNumericInput("007"), "7");
  assert.equal(normalizeNumericInput("0"), "0");
  assert.equal(normalizeNumericInput("abc"), "");
  assert.equal(normalizeNumericInput(null), "");
});

test("the field shows grouped Persian digits, keeping a half-typed decimal", () => {
  assert.equal(formatNumericInput("1000000"), "۱٬۰۰۰٬۰۰۰");
  assert.equal(formatNumericInput("1234.5"), "۱٬۲۳۴.۵", "decimal mark stays ASCII");
  assert.equal(formatNumericInput("12."), "۱۲.", "a trailing mark does not vanish while typing");
  assert.equal(formatNumericInput("999"), "۹۹۹");
  assert.equal(formatNumericInput(""), "");
  assert.equal(formatNumericInput("1000000", "en"), "1,000,000");
});

test("the caret stays after the digit just typed when a separator appears", () => {
  // User has «۱۰۰» and types a fourth digit at the end: text «۱۰۰۰», caret 4.
  const count = significantBefore("۱۰۰۰", 4);
  const shown = formatNumericInput(normalizeNumericInput("۱۰۰۰"));
  assert.equal(shown, "۱٬۰۰۰");
  assert.equal(caretAfterSignificant(shown, count), shown.length, "caret at the end, past the separator");

  // Typing «5» right after the first digit of «۱٬۰۰۰»: text «۱5٬۰۰۰», caret 2.
  const mid = significantBefore("۱5٬۰۰۰", 2);
  const midShown = formatNumericInput(normalizeNumericInput("۱5٬۰۰۰"));
  assert.equal(midShown, "۱۵٬۰۰۰");
  assert.equal(caretAfterSignificant(midShown, mid), 2, "right after the digit just typed");
});

test("AmountInput posts the canonical value and hands it to onChange handlers", () => {
  const src = readFileSync(new URL("../src/components/ui/AmountInput.tsx", import.meta.url), "utf8");
  assert.match(src, /normalizeNumericInput/);
  assert.match(src, /formatNumericInput/);
  assert.match(src, /type="hidden" name=\{name\} value=\{canonical\}/, "the named hidden input carries the canonical value");
  assert.doesNotMatch(src, /<input\s+\{\.\.\.rest\}[^>]*\bname=\{name\}/, "the visible, grouped input is never the named one");
  assert.match(src, /value: next/, "onChange receives the canonical value");
});
