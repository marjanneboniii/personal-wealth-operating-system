/**
 * «برگ تقویم» and the date picker mark جمعه and the FIXED official holidays.
 * Lunar holidays are deliberately absent (they move with moon sighting).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { iranHoliday } from "../src/lib/iranHolidays";

test("نوروز and ۲۲ بهمن are official holidays", () => {
  assert.equal(iranHoliday("2026-03-21")?.name, "عید نوروز"); // 1405/01/01
  assert.equal(iranHoliday("2026-04-02")?.name, "روز طبیعت"); // 1405/01/13
});

test("a Friday is a holiday, a working day is not", () => {
  assert.deepEqual(iranHoliday("2026-10-30"), { name: "جمعه", friday: true }); // 8 آبان 1405
  assert.equal(iranHoliday("2026-10-28"), null); // 6 آبان 1405, Wednesday
});
