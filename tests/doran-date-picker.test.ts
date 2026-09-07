/**
 * تقویم فارسی دوران — the app's date entry is the Doran Jalali calendar.
 *
 * The policy has two sides and both are pinned here:
 *   • INPUT — dates are picked from the Doran Jalali calendar
 *     (`AppDoranDatePicker`, src/components/ui/DoranDatePicker.tsx, wrapping
 *     `@doranjs/react`). The old select-based `JalaliDatePicker` is removed and
 *     nothing in src/ references it; the setup wizard offers no Gregorian
 *     calendar at all;
 *   • OUTPUT — the contract with the server is unchanged: forms still submit
 *     the Gregorian ISO under `name` (a hidden field inside the widgets), the
 *     real-estate module still receives its `${name}Persian` display copy, and
 *     outside the debt domain the widgets echo the auto-computed Gregorian
 *     equivalent while the debt screens pass `showGregorian={false}`.
 *
 * Two things are pinned here:
 *   1. the Jalali calendar arithmetic — the conversions the widgets rely on
 *      (`jalaliToIso`/`toJalali`, month lengths, leap years);
 *   2. the wiring — every date widget and every form routes through the Doran
 *      calendar, and `JalaliDatePicker` is gone for good.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  clampJalaliDay,
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

/* ══════════════════ 2. the Doran wiring ══════════════════ */

test("JalaliDatePicker is gone — every date is picked from the Doran calendar", () => {
  assert.ok(
    !fs.existsSync(path.resolve(process.cwd(), "src/components/ui/JalaliDatePicker.tsx")),
    "the old select-based picker component is removed",
  );

  // Nothing in src/ may reference it.
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry.name)) {
        const code = src(path.relative(process.cwd(), full));
        if (code.includes("JalaliDatePicker")) offenders.push(path.relative(process.cwd(), full));
      }
    }
  };
  walk(path.resolve(process.cwd(), "src"));
  assert.deepEqual(offenders, [], "no module references the removed JalaliDatePicker");

  // …and the replacement really is the Doran calendar.
  const wrapper = src("src/components/ui/DoranDatePicker.tsx");
  assert.ok(wrapper.includes('@doranjs/react'), "AppDoranDatePicker wraps the Doran calendar");
  assert.ok(wrapper.includes("jalali") || wrapper.includes("DoranDate"), "it converts to/from the Jalali date");
});

test("DualDateInput routes through the Doran calendar and keeps the server contract", () => {
  const dual = src("src/components/ui/DualDateInput.tsx").replace(/\s+/g, " ");
  assert.ok(dual.includes('from "./DoranDatePicker"'), "the picker is the Doran calendar");
  assert.ok(
    /<input type="hidden" name=\{name\} value=\{iso\}/.test(dual),
    "the Gregorian ISO still reaches the server under `name`",
  );
  // Debt screens (اقساط، تعهدات، سررسیدها) can hide the Gregorian echo.
  assert.ok(dual.includes("showGregorian"), "the debt-only opt-out survives");
  assert.ok(!dual.includes("JalaliDatePicker"), "the old widget is gone");
});

test("JalaliDateInput routes through the Doran calendar and still submits the Persian copy", () => {
  const jalali = src("src/components/ui/JalaliDateInput.tsx");
  assert.ok(jalali.includes('from "./DoranDatePicker"'), "the picker is the Doran calendar");
  assert.ok(
    jalali.includes("${name}Persian"),
    "the Jalali display copy the real-estate module stores is still submitted",
  );
  assert.ok(jalali.includes("showGregorian"), "the Gregorian echo stays opt-out-able");
  assert.ok(!jalali.includes("JalaliDatePicker"), "the old widget is gone");
});

test("the registry/account forms pick dates from the Doran calendar", () => {
  for (const f of [
    "src/components/forms/MoneyAccountForm.tsx",
    "src/components/registry/realestate/RealEstateCard.tsx",
    "src/components/registry/vehicle/VehicleCard.tsx",
    "src/components/registry/vehicle/VehicleForm.tsx",
  ]) {
    const code = src(f);
    assert.ok(code.includes("@/components/ui/DoranDatePicker"), `${f} uses the Doran calendar`);
    assert.ok(!code.includes("JalaliDatePicker"), `${f} no longer uses the old widget`);
  }
});

test("the app layout loads the Doran calendar styles", () => {
  const layout = src("src/app/layout.tsx");
  assert.ok(layout.includes("@doranjs/react/styles.css"), "the picker styles are loaded");
});

test("DebtForm keeps its two date fields Jalali-only", () => {
  const debtForm = src("src/components/forms/DebtForm.tsx");
  const uses = debtForm.match(/showGregorian=\{false\}/g) ?? [];
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
