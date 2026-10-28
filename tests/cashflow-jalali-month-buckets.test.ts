/**
 * «جریان نقدی» / «گزارش‌های مالی» — month rows are JALALI months.
 *
 * getCashflow used Postgres' date_trunc('month'), a GREGORIAN bucket, and then
 * labelled it by the Jalali month of its 1st day. On ۶ آبان ۱۴۰۵ (2026-10-28)
 * the October bucket (۹ مهر … ۹ آبان) read «مهر», and no آبان row existed, so
 * an expense recorded in آبان never showed as آبان's spending.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { jalaliMonthStartIso, recentJalaliMonths, toJalali } from "../src/lib/format";

test("an آبان date starts its month on ۱ آبان, not on the Gregorian 1st", () => {
  assert.equal(jalaliMonthStartIso("2026-10-28"), "2026-10-23"); // 1405/08/06 → 1405/08/01
  assert.equal(jalaliMonthStartIso("2026-10-23"), "2026-10-23");
  assert.equal(jalaliMonthStartIso("2026-10-22"), "2026-09-23"); // ۳۰ مهر stays مهر
});

test("recent months end with the current Jalali month, oldest first, as [start, end)", () => {
  const months = recentJalaliMonths(3, "2026-10-28");
  assert.deepEqual(months, [
    { start: "2026-08-23", end: "2026-09-23" }, // شهریور
    { start: "2026-09-23", end: "2026-10-23" }, // مهر
    { start: "2026-10-23", end: "2026-11-22" }, // آبان
  ]);
  assert.equal(toJalali(months.at(-1)!.start).m, 8);
});

test("the window crosses نوروز without a gap", () => {
  assert.deepEqual(recentJalaliMonths(2, "2026-03-15"), [
    { start: "2026-01-21", end: "2026-02-20" }, // بهمن ۱۴۰۴
    { start: "2026-02-20", end: "2026-03-21" }, // اسفند ۱۴۰۴ ends at ۱ فروردین ۱۴۰۵
  ]);
  assert.deepEqual(recentJalaliMonths(2, "2026-03-25"), [
    { start: "2026-02-20", end: "2026-03-21" },
    { start: "2026-03-21", end: "2026-04-21" }, // فروردین ۱۴۰۵
  ]);
});

test("twelve months are twelve contiguous Jalali months", () => {
  const months = recentJalaliMonths(12, "2026-10-28");
  assert.equal(months.length, 12);
  for (let i = 1; i < months.length; i++) assert.equal(months[i].start, months[i - 1].end);
  assert.equal(toJalali(months[0].start).m, 9); // آذر ۱۴۰۴
});
