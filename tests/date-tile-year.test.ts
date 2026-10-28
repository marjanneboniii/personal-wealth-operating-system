/**
 * «برگ تقویم» — the small leaf drops the year only when it is this year; a
 * due date next year must say so («مرداد ۱۴۰۶»), or «۱۲ مرداد» is ambiguous.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import DateTile from "../src/components/ui/DateTile";
import { jalaliToIso, toFaDigits, toJalali, todayIso } from "../src/lib/format";

test("a small leaf shows the year only outside the current year", () => {
  const y = toJalali(todayIso()).y;
  const thisYear = renderToStaticMarkup(React.createElement(DateTile, { iso: jalaliToIso(y, 5, 12), size: "sm" }));
  const nextYear = renderToStaticMarkup(React.createElement(DateTile, { iso: jalaliToIso(y + 1, 5, 12), size: "sm" }));
  assert.ok(!thisYear.includes(toFaDigits(String(y))), "this year: no year on the small leaf");
  assert.ok(nextYear.includes(toFaDigits(String(y + 1))), "next year: the year is shown");
});
