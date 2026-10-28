/**
 * Round two of the Kashi ideas: bank detection from a card or IBAN, and the
 * Tehran calendar day behind every «امروز» and every month boundary.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { bankOfCard, bankOfIban } from "../src/features/accounts/bankBins";
import { jalaliMonthStartIso, tehranDateOf, todayIso } from "../src/lib/format";

test("a card's first six digits pick its bank, with Persian digits and spaces too", () => {
  assert.equal(bankOfCard("6037 9912 3456 7890")?.name, "بانک ملی ایران");
  assert.equal(bankOfCard("۶۱۰۴۳۳۱۲۳۴۵۶۷۸۹۰")?.name, "بانک ملت");
  assert.equal(bankOfCard("6219-8612")?.name, "بانک سامان");
  assert.equal(bankOfCard("60379"), null, "five digits are not enough");
  assert.equal(bankOfCard("1111 1111 1111 1111"), null, "an unknown range detects nothing");
});

test("an IBAN's bank code picks its bank, with or without IR", () => {
  assert.equal(bankOfIban("IR06 0170 0000 0010 3238 3700 01")?.name, "بانک ملی ایران");
  assert.equal(bankOfIban("ir120120000000001234567890")?.name, "بانک ملت");
  assert.equal(bankOfIban("06056")?.name, "بانک سامان");
  assert.equal(bankOfIban("IR06"), null);
});

test("«امروز» is the Tehran day: 00:30 on ۱ آبان is not still ۳۰ مهر", () => {
  const halfPastMidnightTehran = new Date("2026-10-22T21:00:00Z"); // 00:30 on 2026-10-23 in Tehran
  assert.equal(todayIso(halfPastMidnightTehran), "2026-10-23");
  assert.equal(jalaliMonthStartIso(todayIso(halfPastMidnightTehran)), "2026-10-23", "already آبان");
  assert.equal(todayIso(new Date("2026-10-22T20:00:00Z")), "2026-10-22", "23:30 the day before");
});

test("a Postgres timestamptz is read as its Tehran calendar day", () => {
  assert.equal(tehranDateOf("2026-10-22 21:30:00.123+00"), "2026-10-23");
  assert.equal(tehranDateOf("2026-10-22T10:00:00Z"), "2026-10-22");
  assert.equal(tehranDateOf(null), null);
  assert.equal(tehranDateOf("not a date"), null);
});
