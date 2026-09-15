/**
 * تقویم شمسی — a field that opens a month calendar, no typing, no Latin date.
 *
 * The policy has two sides and both are pinned here:
 *   • INPUT is Jalali-only everywhere — JalaliDatePicker is the only date-entry
 *     widget, DualDateInput and JalaliDateInput are thin wrappers around it, no
 *     `type="date"` (native Gregorian picker) survives anywhere in src/, and the
 *     setup wizard no longer offers a Gregorian calendar;
 *   • OUTPUT — outside the debt domain the app echoes the Gregorian equivalent it
 *     computed for the chosen day (`showGregorian`, default true). The debt
 *     screens pass `showGregorian={false}` and stay Jalali-only.
 *
 * Pinned here:
 *   1. the Jalali calendar arithmetic — month lengths, leap years and the
 *      Saturday-first month grid must agree with `jalaliToIso`/`toJalali`;
 *   2. the rendered field — the chosen day in Persian, the ISO still submitted,
 *      `required` enforced, nothing typed and nothing Latin on screen.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JalaliDatePicker, { jalaliMonthCells, saturdayColumn } from "../src/components/ui/JalaliDatePicker";
import DualDateInput from "../src/components/ui/DualDateInput";
import JalaliDateInput from "../src/components/ui/JalaliDateInput";
import {
  clampJalaliDay,
  formatDate,
  formatJalaliIso,
  isJalaliLeapYear,
  jalaliMonthLength,
  jalaliToIso,
  jalaliWeekdayName,
  toJalali,
} from "../src/lib/format";

const src = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

/* ══════════════════ 1. Jalali calendar arithmetic ══════════════════ */

test("month lengths: ۶×۳۱ + ۵×۳۰ + اسفند ۲۹/۳۰, consistent with jalaliToIso", () => {
  for (let jy = 1300; jy <= 1500; jy++) {
    for (let jm = 1; jm <= 12; jm++) {
      const len = jalaliMonthLength(jy, jm);
      assert.ok(len === 29 || len === 30 || len === 31, `${jy}/${jm} has a sane length`);
      assert.deepEqual(toJalali(jalaliToIso(jy, jm, len)), { y: jy, m: jm, d: len }, `${jy}/${jm}/${len} exists`);
      assert.notDeepEqual(toJalali(jalaliToIso(jy, jm, len + 1)), { y: jy, m: jm, d: len + 1 }, `${jy}/${jm} is not longer`);
    }
  }
});

test("leap years: only اسفند is affected, and it agrees with the converter", () => {
  assert.equal(isJalaliLeapYear(1399), true, "۱۳۹۹ is leap (اسفند ۳۰ = 2021-03-20)");
  assert.equal(isJalaliLeapYear(1400), false, "۱۴۰۰ is common");
  assert.equal(isJalaliLeapYear(1403), true, "۱۴۰۳ is leap (اسفند ۳۰ = 2025-03-20)");
  assert.equal(isJalaliLeapYear(1404), false, "۱۴۰۴ is common (اسفند ۲۹ = 2026-03-20)");
  // Regression: the naive «(jy % 33 + 3) % 4 === 0» rule says ۱۳۰۸ is leap.
  assert.equal(isJalaliLeapYear(1308), false, "۱۳۰۸ is common (cycle-boundary year)");
  assert.equal(jalaliToIso(1308, 12, 30), jalaliToIso(1309, 1, 1));

  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
  assert.equal(jalaliToIso(1403, 12, 30), "2025-03-20");
  assert.equal(jalaliToIso(1404, 1, 1), "2025-03-21");
  assert.equal(jalaliToIso(1404, 12, 29), "2026-03-20");

  for (let jy = 1380; jy <= 1430; jy++) {
    for (let jm = 1; jm <= 11; jm++) {
      assert.equal(jalaliMonthLength(jy, jm), jm <= 6 ? 31 : 30, `${jy}/${jm} ignores leap`);
    }
  }
});

test("clampJalaliDay keeps a chosen day valid across month/year changes", () => {
  assert.equal(clampJalaliDay(1404, 7, 31), 30, "۳۱ مرداد → ۳۰ شهریور");
  assert.equal(clampJalaliDay(1404, 1, 31), 31, "۳۱ فروردین stays");
  assert.equal(clampJalaliDay(1404, 12, 30), 29, "۳۰ اسفند → ۲۹ in a common year");
  assert.equal(clampJalaliDay(1403, 12, 30), 30, "۳۰ اسفند stays in a leap year");
  assert.equal(clampJalaliDay(null, null, 15), 15);
  assert.equal(clampJalaliDay(1404, 7, null), null);
});

test("jalaliWeekdayName is timezone-independent and Persian", () => {
  assert.equal(jalaliWeekdayName("2026-09-05"), "شنبه");
  assert.equal(jalaliWeekdayName("2026-09-06"), "یکشنبه");
  assert.equal(jalaliWeekdayName(""), "");
});

test("the month grid starts on شنبه and holds every day of the month exactly once", () => {
  assert.equal(saturdayColumn("2026-09-05"), 0, "a Saturday sits in the first column");
  assert.equal(saturdayColumn("2026-09-11"), 6, "a Friday (جمعه) sits in the last column");

  for (const [y, m] of [[1401, 9], [1403, 12], [1404, 12], [1405, 1], [1405, 6]] as const) {
    const cells = jalaliMonthCells(y, m);
    assert.equal(cells.length, 42, "always six weeks — the sheet does not jump in height");
    const days = cells.filter((c): c is number => c !== null);
    assert.deepEqual(days, Array.from({ length: jalaliMonthLength(y, m) }, (_, i) => i + 1), `${y}/${m} days in order`);
    // Every day lands under its real weekday.
    days.forEach((d) => {
      const col = cells.indexOf(d) % 7;
      assert.equal(col, saturdayColumn(jalaliToIso(y, m, d)), `${y}/${m}/${d} is in the right column`);
    });
  }
});

/* ══════════════════ 2. the rendered field ══════════════════ */

const LATIN_ISO = /\b\d{4}-\d{2}-\d{2}\b/;
const visibleText = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&");
const render = (el: React.ReactElement) => renderToStaticMarkup(el);
const hiddenInputs = (html: string) => html.match(/<input type="hidden"[^>]*>/g) ?? [];

test("the field shows the chosen day in Persian and opens a calendar — nothing is typed", () => {
  const html = render(React.createElement(JalaliDatePicker, { name: "dueDate", value: "2026-09-05", ariaLabel: "سررسید" }));

  assert.ok(!html.includes("<select"), "no dropdowns any more");
  assert.ok(!html.includes('type="date"'), "no native Gregorian picker");
  assert.ok(!/<input(?! type="hidden")/.test(html), "no text input — the date is chosen, never typed");
  assert.ok(html.includes('aria-haspopup="dialog"'), "the field opens the calendar dialog");
  assert.ok(html.includes('type="button"'), "opening the calendar never submits the form");
  assert.ok(visibleText(html).includes(formatDate("2026-09-05")), "the chosen day in Persian digits and month name");
  assert.ok(visibleText(html).includes(jalaliWeekdayName("2026-09-05")), "the weekday is confirmed too");
});

test("showGregorian echoes the auto-computed equivalent; the debt domain hides it", () => {
  const ISO = "2026-09-05";
  const auto = render(React.createElement(JalaliDatePicker, { value: ISO }));
  assert.ok(auto.includes("میلادی (خودکار)"), "the echo is labelled as automatic");
  assert.ok(LATIN_ISO.test(visibleText(auto)), `the computed equivalent (${ISO}) is displayed`);

  const debt = render(React.createElement(JalaliDatePicker, { value: ISO, showGregorian: false }));
  assert.ok(!debt.includes("میلادی"), "no Gregorian label");
  assert.ok(!LATIN_ISO.test(visibleText(debt)), "no Gregorian date is shown to the user");

  const empty = render(React.createElement(JalaliDatePicker, {}));
  assert.ok(!LATIN_ISO.test(visibleText(empty)), "no equivalent before a date is chosen");
  assert.ok(empty.includes("انتخاب تاریخ"), "an empty field tells the user what to do");
});

test("every date field in DebtForm is Jalali-only", () => {
  // The schedule editor is shared with the setup wizard; DebtForm renders it.
  const code = src("src/components/forms/DebtForm.tsx") + src("src/components/debts/DebtScheduleFields.tsx");
  const widgets = code.match(/<(DualDateInput|JalaliDatePicker)\b/g) ?? [];
  const optOuts = code.match(/showGregorian=\{false\}/g) ?? [];
  assert.ok(widgets.length >= 3, "«تاریخ شروع»، «اولین سررسید» and the custom-schedule rows");
  assert.equal(optOuts.length, widgets.length, "every date widget on the debt form opts out of the Gregorian echo");
  assert.ok(!/showGregorian=\{true\}/.test(code) && !/type="date"/.test(code));
});

test("the setup wizard offers no Gregorian calendar", () => {
  const page = src("src/app/setup/page.tsx");
  assert.ok(!page.includes('value="gregorian"'), "the Gregorian option is gone");
  assert.ok(!page.includes("setDateCalendar"), "the calendar is no longer a user choice");
  assert.ok(/name="dateCalendar" value=\{dateCalendar\}/.test(page), "the field is still submitted");
  assert.ok(page.includes('const dateCalendar = "jalali"'), "…and it is always Jalali");
  assert.ok(!src("src/i18n/fa.ts").includes("dateCalendarGregorian"), "the label is removed (fa)");
  assert.ok(!src("src/i18n/en.ts").includes("dateCalendarGregorian"), "the label is removed (en)");
});

test("the picker still submits the Gregorian ISO, and `required` blocks an empty submit", () => {
  const html = render(React.createElement(JalaliDatePicker, { name: "firstDueDate", value: "2026-09-05", required: true }));
  const hidden = hiddenInputs(html);
  assert.equal(hidden.length, 1, "exactly one hidden field is submitted");
  assert.ok(/name="firstDueDate"/.test(hidden[0]) && /value="2026-09-05"/.test(hidden[0]));

  // Hidden inputs are never validated, so a nameless stand-in carries `required`.
  const stand = html.match(/<input class="jdp-validity"[^>]*>/g) ?? [];
  assert.equal(stand.length, 1, "a validity stand-in is rendered for a required picker");
  assert.ok(!/name=/.test(stand[0]), "…and it submits nothing of its own");
  assert.ok(!render(React.createElement(JalaliDatePicker, { name: "x" })).includes("jdp-validity"), "optional pickers have none");
});

test("submitPersian adds the Jalali display copy the real-estate module stores", () => {
  const html = render(React.createElement(JalaliDatePicker, { name: "valuationDate", value: "2026-09-05", submitPersian: true }));
  const persian = formatJalaliIso("2026-09-05", "en");
  const hidden = hiddenInputs(html);
  assert.equal(hidden.length, 2, "the ISO field + the Persian display copy");
  assert.ok(hidden.some((tag) => /name="valuationDatePersian"/.test(tag) && tag.includes(`value="${persian}"`)));
});

test("an empty picker submits nothing", () => {
  const html = render(React.createElement(JalaliDatePicker, { name: "targetDate" }));
  assert.ok(/name="targetDate"[^>]*value=""|value=""[^>]*name="targetDate"/.test(html), "nothing is submitted while empty");
});

test("the calendar is portalled above sheets and keeps its keys from the enclosing Sheet", () => {
  const code = src("src/components/ui/JalaliDatePicker.tsx");
  assert.match(code, /createPortal\(calendar, document\.body\)/, "rendered on <body>, outside any transformed sheet");
  assert.match(code, /stopImmediatePropagation/, "Escape/Tab do not reach Sheet's document listener");
  assert.match(code, /«امروز»|امروز/, "the today shortcut is offered inside the calendar");
  const css = src("src/app/globals.css");
  assert.match(css, /\.jdp-overlay\s*\{[^}]*z-index:\s*100/, "above Sheet (z 80)");
});

test("DualDateInput and JalaliDateInput are wrappers around the picker", () => {
  const dual = render(React.createElement(DualDateInput, { name: "entryDate", value: "2026-09-05", label: "تاریخ سند", required: true }));
  assert.ok(dual.includes("jdp-trigger"), "DualDateInput renders the calendar field");
  assert.ok(!dual.includes('type="date"'));
  assert.ok(dual.includes("تاریخ سند"), "the label is rendered");
  assert.ok(dual.includes('name="entryDate"') && dual.includes('value="2026-09-05"'), "the ISO field name is preserved");

  const jalali = render(React.createElement(JalaliDateInput, { name: "acquisitionDate", value: "2026-09-05", label: "تاریخ تملک", required: true }));
  assert.ok(jalali.includes("jdp-trigger"), "JalaliDateInput renders the calendar field");
  assert.ok(jalali.includes("میلادی (خودکار)"), "the computed equivalent is echoed");
  const persian = formatJalaliIso("2026-09-05", "en");
  assert.ok(jalali.includes('name="acquisitionDatePersian"') && jalali.includes(`value="${persian}"`));
});

test("no module of the app keeps a native Gregorian date input", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry.name) && /type="date"|type='date'/.test(fs.readFileSync(full, "utf-8"))) {
        offenders.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(path.resolve(process.cwd(), "src"));
  assert.deepEqual(offenders, [], "every date is picked with JalaliDatePicker");
});

test("the date widgets the app uses all route through JalaliDatePicker", () => {
  assert.ok(src("src/components/ui/DualDateInput.tsx").includes("JalaliDatePicker"));
  assert.ok(src("src/components/ui/JalaliDateInput.tsx").includes("JalaliDatePicker"));
  for (const f of [
    "src/components/forms/MoneyAccountForm.tsx",
    "src/components/registry/realestate/RealEstateCard.tsx",
    "src/components/registry/vehicle/VehicleCard.tsx",
    "src/components/registry/vehicle/VehicleForm.tsx",
    "src/components/setup/SetupRealAssetsStep.tsx",
  ]) {
    assert.ok(src(f).includes("JalaliDatePicker"), `${f} uses the Jalali picker`);
  }
});
