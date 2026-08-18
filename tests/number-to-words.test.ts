/**
 * عدد → حروف فارسی — regression coverage for the shared real-time
 * "amount in words" feature used by every money input in the app.
 *
 * Pins the exact Persian wording (including the "و" conjunction, hundreds,
 * thousands separators, Persian digits and large-number grouping) so the
 * behaviour stays identical across all modules.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { amountToWords, numberToPersianWords, resolveUnitLabel } from "../src/lib/numberToWords";

test("converts the canonical examples from the product spec", () => {
  assert.equal(numberToPersianWords("3000000"), "سه میلیون");
  assert.equal(numberToPersianWords("300000"), "سیصد هزار");
  assert.equal(numberToPersianWords("1250000"), "یک میلیون و دویست و پنجاه هزار");
});

test("appends the currency unit to the words label", () => {
  assert.equal(amountToWords("3000000", "toman"), "سه میلیون تومان");
  assert.equal(amountToWords("300000", "toman"), "سیصد هزار تومان");
  assert.equal(amountToWords("1250000", "toman"), "یک میلیون و دویست و پنجاه هزار تومان");
  assert.equal(amountToWords("500", "usd"), "پانصد دلار");
});

test("handles empty / invalid / zero inputs", () => {
  assert.equal(numberToPersianWords(""), null);
  assert.equal(numberToPersianWords(null), null);
  assert.equal(numberToPersianWords(undefined), null);
  assert.equal(numberToPersianWords("abc"), null);
  assert.equal(numberToPersianWords("   "), null);
  assert.equal(numberToPersianWords("0"), "صفر");
  // The UI hint intentionally hides zero, so the label is null.
  assert.equal(amountToWords("0", "toman"), null);
  assert.equal(amountToWords("0.00", "toman"), null);
});

test("normalizes Persian digits and thousands separators", () => {
  assert.equal(numberToPersianWords("۱۲۵۰۰۰۰"), "یک میلیون و دویست و پنجاه هزار");
  assert.equal(numberToPersianWords("1,250,000"), "یک میلیون و دویست و پنجاه هزار");
  assert.equal(numberToPersianWords("1٬250٬000"), "یک میلیون و دویست و پنجاه هزار");
});

test("numbers 1–99", () => {
  assert.equal(numberToPersianWords("1"), "یک");
  assert.equal(numberToPersianWords("10"), "ده");
  assert.equal(numberToPersianWords("11"), "یازده");
  assert.equal(numberToPersianWords("19"), "نوزده");
  assert.equal(numberToPersianWords("20"), "بیست");
  assert.equal(numberToPersianWords("21"), "بیست و یک");
  assert.equal(numberToPersianWords("35"), "سی و پنج");
  assert.equal(numberToPersianWords("99"), "نود و نه");
});

test("hundreds", () => {
  assert.equal(numberToPersianWords("100"), "صد");
  assert.equal(numberToPersianWords("101"), "صد و یک");
  assert.equal(numberToPersianWords("200"), "دویست");
  assert.equal(numberToPersianWords("300"), "سیصد");
  assert.equal(numberToPersianWords("500"), "پانصد");
  assert.equal(numberToPersianWords("999"), "نهصد و نود و نه");
});

test("group boundaries and the «و» conjunction between groups", () => {
  assert.equal(numberToPersianWords("1000"), "یک هزار");
  assert.equal(numberToPersianWords("1000000"), "یک میلیون");
  assert.equal(numberToPersianWords("1000001"), "یک میلیون و یک");
  assert.equal(numberToPersianWords("1001001"), "یک میلیون و یک هزار و یک");
  assert.equal(numberToPersianWords("1000000000"), "یک میلیارد");
  assert.equal(numberToPersianWords("123456789"), "صد و بیست و سه میلیون و چهارصد و پنجاه و شش هزار و هفتصد و هشتاد و نه");
});

test("large numbers convert exactly (BigInt, no floating point drift)", () => {
  assert.equal(numberToPersianWords("999999999999"), "نهصد و نود و نه میلیارد و نهصد و نود و نه میلیون و نهصد و نود و نه هزار و نهصد و نود و نه");
  assert.equal(numberToPersianWords("1000000000000000"), "یک بیلیارد");
});

test("negative amounts", () => {
  assert.equal(numberToPersianWords("-300000"), "منفی سیصد هزار");
});

test("resolveUnitLabel maps currency keys and passes through free-form labels", () => {
  assert.equal(resolveUnitLabel("toman"), "تومان");
  assert.equal(resolveUnitLabel("rial"), "ریال");
  assert.equal(resolveUnitLabel("usd"), "دلار");
  assert.equal(resolveUnitLabel("eur"), "یورو");
  assert.equal(resolveUnitLabel("usdt"), "تتر");
  assert.equal(resolveUnitLabel("تتر"), "تتر");
  assert.equal(resolveUnitLabel(undefined), "");
});
