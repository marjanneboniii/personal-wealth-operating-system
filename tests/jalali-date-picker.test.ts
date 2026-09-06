/**
 * انتخاب‌گر تاریخ شمسی — day / month / year selects, no typing, no Latin date.
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
 * Two things are pinned here:
 *   1. the Jalali calendar arithmetic — month lengths and leap years must agree
 *      with `jalaliToIso`/`toJalali`, otherwise the picker could offer a day
 *      the converter silently rolls into the next month;
 *   2. the rendered widget — three selects, Persian digits and month names,
 *      the ISO still submitted, and nothing Latin on screen.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JalaliDatePicker from "../src/components/ui/JalaliDatePicker";
import DualDateInput from "../src/components/ui/DualDateInput";
import JalaliDateInput from "../src/components/ui/JalaliDateInput";
import {
  JALALI_MONTHS,
  clampJalaliDay,
  formatJalaliIso,
  isJalaliLeapYear,
  jalaliMonthLength,
  jalaliToIso,
  jalaliWeekdayName,
  toFaDigits,
  toJalali,
} from "../src/lib/format";

const src = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

/* ══════════════════ 1. Jalali calendar arithmetic ══════════════════ */

test("month lengths: ۶×۳۱ + ۵×۳۰ + اسفند ۲۹/۳۰, consistent with jalaliToIso", () => {
  for (let jy = 1300; jy <= 1500; jy++) {
    for (let jm = 1; jm <= 12; jm++) {
      const len = jalaliMonthLength(jy, jm);
      assert.ok(len === 29 || len === 30 || len === 31, `${jy}/${jm} has a sane length`);

      // The last day of the month must round-trip…
      const last = toJalali(jalaliToIso(jy, jm, len));
      assert.deepEqual(
        last,
        { y: jy, m: jm, d: len },
        `${jy}/${jm}/${len} round-trips — the offered day really exists`,
      );
      // …and the day after it must NOT (that is what makes `len` the length).
      const overflow = toJalali(jalaliToIso(jy, jm, len + 1));
      assert.notDeepEqual(
        overflow,
        { y: jy, m: jm, d: len + 1 },
        `${jy}/${jm}/${len + 1} must roll over — the month is not longer`,
      );
    }
  }
});

test("leap years: only اسفند is affected, and it agrees with the converter", () => {
  // Known anchors of the Persian calendar.
  assert.equal(isJalaliLeapYear(1399), true, "۱۳۹۹ is leap (اسفند ۳۰ = 2021-03-20)");
  assert.equal(isJalaliLeapYear(1400), false, "۱۴۰۰ is common");
  assert.equal(isJalaliLeapYear(1403), true, "۱۴۰۳ is leap (اسفند ۳۰ = 2025-03-20)");
  assert.equal(isJalaliLeapYear(1404), false, "۱۴۰۴ is common (اسفند ۲۹ = 2026-03-20)");
  // Regression: the naive «(jy % 33 + 3) % 4 === 0» rule says ۱۳۰۸ is leap,
  // but jalaliToIso(1308, 12, 30) rolls into ۱۳۰۹/۰۱/۰۱ — the 33-year cycle
  // carries only 8 leap years, so the last cycle year is NOT one of them.
  assert.equal(isJalaliLeapYear(1308), false, "۱۳۰۸ is common (cycle-boundary year)");
  assert.equal(jalaliToIso(1308, 12, 30), jalaliToIso(1309, 1, 1));

  assert.equal(jalaliMonthLength(1403, 12), 30);
  assert.equal(jalaliMonthLength(1404, 12), 29);
  assert.equal(jalaliToIso(1403, 12, 30), "2025-03-20");
  assert.equal(jalaliToIso(1404, 1, 1), "2025-03-21");
  assert.equal(jalaliToIso(1404, 12, 29), "2026-03-20");

  // Every month except اسفند is leap-independent.
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
  assert.equal(clampJalaliDay(null, null, 15), 15, "no year/month yet → day is kept");
  assert.equal(clampJalaliDay(1404, 7, null), null, "no day chosen → still none");
  // Whatever comes out is always a real date for the converter.
  for (let jm = 1; jm <= 12; jm++) {
    const d = clampJalaliDay(1404, jm, 31) as number;
    assert.deepEqual(toJalali(jalaliToIso(1404, jm, d)), { y: 1404, m: jm, d });
  }
});

test("jalaliWeekdayName is timezone-independent and Persian", () => {
  assert.equal(jalaliWeekdayName("2026-09-05"), "شنبه");
  assert.equal(jalaliWeekdayName("2026-09-06"), "یکشنبه");
  assert.equal(jalaliWeekdayName(""), "");
});

/* ══════════════════ 2. the rendered widget ══════════════════ */

const LATIN_ISO = /\b\d{4}-\d{2}-\d{2}\b/;

/** What the user actually sees — markup and attributes stripped away. */
function visibleText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&");
}

function render(el: React.ReactElement): string {
  return renderToStaticMarkup(el);
}

/** Count the <option>s of the n-th select (0=سال, 1=ماه, 2=روز). */
function optionValues(html: string, selectIndex: number): string[] {
  const selects = html.split("<select").slice(1);
  assert.ok(selects.length > selectIndex, `select #${selectIndex} exists`);
  const body = selects[selectIndex].split("</select>")[0];
  return [...body.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
}

test("the picker renders three selects — سال / ماه / روز — nothing is typed", () => {
  const html = render(
    React.createElement(JalaliDatePicker, { name: "dueDate", value: "2026-09-05", ariaLabel: "سررسید" }),
  );

  assert.equal(html.split("<select").length - 1, 3, "exactly three selects");
  assert.ok(!html.includes('type="date"'), "no native Gregorian picker");
  assert.ok(!/<input(?! type="hidden")/.test(html), "no text input — the date is chosen, never typed");

  // Month select = placeholder + the 12 Persian month names.
  const months = optionValues(html, 1);
  assert.deepEqual(months, ["", ...JALALI_MONTHS.map((_, i) => String(i + 1))]);
  for (const name of JALALI_MONTHS) assert.ok(html.includes(name), `${name} is offered`);

  // Day + year options carry Persian digits.
  const j = toJalali("2026-09-05");
  assert.ok(html.includes(toFaDigits(String(j.y))), "the year is shown in Persian digits");
  const days = optionValues(html, 2).slice(1);
  assert.equal(days.length, jalaliMonthLength(j.y, j.m), `${j.y}/${j.m} offers its real day count`);
  assert.ok(html.includes(toFaDigits("31")), "days are shown in Persian digits");
  assert.ok(
    visibleText(html).includes(toFaDigits(formatJalaliIso("2026-09-05", "en"))),
    "the chosen date is confirmed back to the user in Persian digits",
  );
  assert.ok(visibleText(html).includes(jalaliWeekdayName("2026-09-05")), "the weekday is confirmed too");
});

test("showGregorian echoes the auto-computed equivalent; the debt domain hides it", () => {
  const ISO = "2026-09-05";

  // Default (non-debt modules): the user picks Jalali, the APP shows the ISO it
  // derived — clearly labelled as automatic, never as an input.
  const auto = render(React.createElement(JalaliDatePicker, { value: ISO }));
  assert.ok(auto.includes("میلادی (خودکار)"), "the echo is labelled as automatic");
  assert.ok(LATIN_ISO.test(visibleText(auto)), `the computed equivalent (${ISO}) is displayed`);
  assert.ok(auto.includes(ISO), "…and it is exactly the ISO the form submits");

  // Debt screens (اقساط، تعهدات، سررسیدها): Jalali only, no Latin anywhere.
  const debt = render(React.createElement(JalaliDatePicker, { value: ISO, showGregorian: false }));
  assert.ok(!debt.includes("میلادی"), "no Gregorian label");
  assert.ok(!LATIN_ISO.test(visibleText(debt)), "no Gregorian date is shown to the user");

  // Nothing is echoed while the selection is incomplete.
  const empty = render(React.createElement(JalaliDatePicker, {}));
  assert.ok(!LATIN_ISO.test(visibleText(empty)), "no equivalent before a date is chosen");
});

test("DebtForm keeps its two date fields Jalali-only", () => {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/components/forms/DebtForm.tsx"),
    "utf-8",
  );
  const uses = src.match(/showGregorian=\{false\}/g) ?? [];
  assert.equal(uses.length, 2, "«تاریخ شروع بدهی» and «اولین سررسید» both opt out");
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

test("the picker still submits the Gregorian ISO through the hidden field", () => {
  const html = render(
    React.createElement(JalaliDatePicker, { name: "firstDueDate", value: "2026-09-05", required: true }),
  );

  const hidden = html.match(/<input type="hidden"[^>]*>/g) ?? [];
  assert.equal(hidden.length, 1, "exactly one hidden field is submitted");
  assert.ok(/name="firstDueDate"/.test(hidden[0]), "the field name the actions already read");
  assert.ok(/value="2026-09-05"/.test(hidden[0]), "the Gregorian ISO value");
  assert.equal(html.split("<select").length - 1, 3, "three selects enforce `required` on screen");
  assert.ok(html.includes("required"), "required is enforced (the selects block an empty submit)");
});

test("submitPersian adds the Jalali display copy the real-estate module stores", () => {
  const html = render(
    React.createElement(JalaliDatePicker, {
      name: "valuationDate",
      value: "2026-09-05",
      submitPersian: true,
    }),
  );

  const persian = formatJalaliIso("2026-09-05", "en");
  const hidden = html.match(/<input type="hidden"[^>]*>/g) ?? [];
  assert.equal(hidden.length, 2, "the ISO field + the Persian display copy");
  assert.ok(
    hidden.some((tag) => /name="valuationDatePersian"/.test(tag) && tag.includes(`value="${persian}"`)),
    `${persian} is submitted as the Persian display copy`,
  );
});

test("اسفند offers ۳۰ days in a leap year and ۲۹ in a common one", () => {
  const leap = render(React.createElement(JalaliDatePicker, { value: jalaliToIso(1403, 12, 1) }));
  const common = render(React.createElement(JalaliDatePicker, { value: jalaliToIso(1404, 12, 1) }));

  assert.equal(optionValues(leap, 2).length - 1, 30, "اسفند ۱۴۰۳ → ۳۰ روز");
  assert.equal(optionValues(common, 2).length - 1, 29, "اسفند ۱۴۰۴ → ۲۹ روز");
});

test("an empty picker shows placeholders, submits nothing and offers «امروز»", () => {
  const html = render(React.createElement(JalaliDatePicker, { name: "targetDate" }));

  assert.ok(html.includes(">سال</option>"), "سال placeholder");
  assert.ok(html.includes(">ماه</option>"), "ماه placeholder");
  assert.ok(html.includes(">روز</option>"), "روز placeholder");
  assert.ok(html.includes("روز، ماه و سال را انتخاب کنید"), "the user is told what to do");
  assert.ok(
    html.includes('name="targetDate"') && /name="targetDate"[^>]*value=""|value=""[^>]*name="targetDate"/.test(html),
    "nothing is submitted while incomplete",
  );
  assert.ok(html.includes("امروز"), "the today shortcut is available");
  assert.ok(html.includes('type="button"'), "the shortcut can never submit the form");

  const noToday = render(React.createElement(JalaliDatePicker, { showToday: false }));
  assert.ok(!noToday.includes("امروز"), "showToday={false} hides the shortcut");
});

test("DualDateInput and JalaliDateInput are wrappers around the picker", () => {
  const dual = render(
    React.createElement(DualDateInput, { name: "entryDate", value: "2026-09-05", label: "تاریخ سند", required: true }),
  );
  assert.equal(dual.split("<select").length - 1, 3, "DualDateInput renders the three selects");
  assert.ok(!dual.includes('type="date"'), "DualDateInput has no Gregorian picker");
  assert.ok(dual.includes("تاریخ سند"), "the label is rendered");
  assert.ok(
    dual.includes('name="entryDate"') && dual.includes('value="2026-09-05"'),
    "the ISO field name is preserved",
  );

  const jalali = render(
    React.createElement(JalaliDateInput, { name: "acquisitionDate", value: "2026-09-05", label: "تاریخ تملک", required: true }),
  );
  assert.equal(jalali.split("<select").length - 1, 3, "JalaliDateInput renders the three selects");
  assert.ok(!jalali.includes('type="date"'), "JalaliDateInput has no Gregorian picker");
  assert.ok(!/<input(?! type="hidden")/.test(jalali), "nothing is typed");
  // Its modules (املاک، تورم) are outside the debt domain → the equivalent is echoed.
  assert.ok(jalali.includes("میلادی (خودکار)"), "the computed equivalent is echoed");
  assert.ok(/name="acquisitionDate"[^>]*value="2026-09-05"|value="2026-09-05"[^>]*name="acquisitionDate"/.test(jalali.replace(/<input type="hidden" /g, "|")), "ISO field preserved");
  const persian = formatJalaliIso("2026-09-05", "en");
  assert.ok(
    jalali.includes('name="acquisitionDatePersian"') && jalali.includes(`value="${persian}"`),
    "Persian display copy preserved (the real-estate module stores it)",
  );
});

test("no module of the app keeps a native Gregorian date input", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry.name) && full.includes(`${path.sep}src${path.sep}`)) {
        const code = src(path.relative(process.cwd(), full));
        if (/type="date"|type='date'/.test(code)) offenders.push(path.relative(process.cwd(), full));
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
  ]) {
    assert.ok(src(f).includes("JalaliDatePicker"), `${f} uses the Jalali picker`);
  }
});
