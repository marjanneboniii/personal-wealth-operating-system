/**
 * «۹۰ روز آینده» — time-scoped obligation window.
 *
 * The obligations module (/debts/obligations) shows a 90-day indicator. Per the
 * domain it is a *time-window count*: only records whose due_date falls inside
 * [today, today + 90 days] and that are still live commitments.
 *
 * It must NOT be conflated with:
 *   • Total Debt  (مانده کل بدهی — every outstanding debt, no date filter)
 *   • Remaining Installments (مانده اقساط — every unpaid installment)
 *
 * These tests render the REAL page component so the actual filter (including
 * its inclusive/exclusive boundaries) is what gets exercised.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { faCount, todayIso } from "../src/lib/format";

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/link", {
  defaultExport: (props: any) =>
    React.createElement("a", { href: props.href, className: props.className }, props.children),
});
mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => {} } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });
mock.module("@/lib/fx", {
  namedExports: {
    getLatestUsdIrtRate: async () => ({ rate: "190000", effectiveDate: "2026-09-02", source: "manual" }),
  },
});

/** Obligation rows the page will render, injected per test. */
let obligationsFixture: any[] = [];
mock.module("@/features/planning/service", {
  namedExports: {
    listObligations: async () => obligationsFixture,
    listEvents: async () => [],
    upcomingInstallments: async () => [],
  },
});

const iso = (dayOffset: number) =>
  new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);

const obligation = (id: string, dayOffset: number, amountToman: string) => ({
  id,
  title: `تعهد ${id}`,
  amountBase: amountToman,
  amountToman,
  dueDate: iso(dayOffset),
  recurrence: "none",
  status: "pending",
  note: null,
});

/** Pull the rendered value of a Metric out of the page HTML by its label. */
function metricValue(html: string, label: string): string | null {
  const anchor = html.indexOf(`>${label}</div>`);
  if (anchor < 0) return null;
  const m = html.slice(anchor).match(/metric-value[^>]*>([^<]*)</);
  return m ? m[1] : null;
}

async function render() {
  const { default: ObligationsPage } = await import("../src/app/debts/obligations/page");
  return renderToStaticMarkup(await (ObligationsPage as any)());
}

/* ------------------------------------------------------------------ */

test("Test 8 — only records due inside [today, today+90d] are in «۹۰ روز آینده»", async () => {
  obligationsFixture = [
    obligation("inside-89", 89, "10000000"), // inside the window
    obligation("outside-91", 91, "20000000"), // outside the window
    obligation("outside-300", 300, "30000000"), // far outside
  ];

  const html = await render();

  assert.equal(metricValue(html, "۹۰ روز آینده"), faCount(1), "exactly one record is inside 90 days");
  assert.equal(metricValue(html, "۳۰ روز آینده"), faCount(0), "none inside 30 days");
  // The window is a SUBSET: the far-out records still belong to the
  // all-upcoming total, they are simply not in the 90-day slice.
  assert.equal(metricValue(html, "سررسید گذشته"), faCount(0));
  assert.ok(html.includes("تعهد outside-300"), "out-of-window records are still listed");
});

test("Test 9 — day boundaries are inclusive on both ends (today and today+90)", async () => {
  obligationsFixture = [
    obligation("today", 0, "1000000"), // lower bound — inclusive
    obligation("plus-90", 90, "2000000"), // upper bound — inclusive
    obligation("plus-91", 91, "3000000"), // just outside
    obligation("yesterday", -1, "4000000"), // past due
  ];

  const html = await render();

  assert.equal(
    metricValue(html, "۹۰ روز آینده"),
    faCount(2),
    "today and today+90 are both inside; today+91 is not",
  );
  assert.equal(metricValue(html, "سررسید گذشته"), faCount(1), "the past-due row is reported separately");
});

test("Test 9b — the window is a day count, not a calendar-month bucket", async () => {
  const today = todayIso();
  // Last day of the current month vs. the 1st of the next: whichever is
  // closer in DAYS decides membership — month rollover must not.
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const lastDayThisMonth = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const firstDayNextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const daysFromToday = (d: string) =>
    Math.round((Date.parse(d + "T00:00:00Z") - Date.parse(today + "T00:00:00Z")) / 86_400_000);

  obligationsFixture = [
    obligation("last-of-month", daysFromToday(lastDayThisMonth), "1000000"),
    obligation("first-of-next", daysFromToday(firstDayNextMonth), "2000000"),
  ];

  const html = await render();
  const expected =
    (daysFromToday(lastDayThisMonth) <= 90 ? 1 : 0) + (daysFromToday(firstDayNextMonth) <= 90 ? 1 : 0);

  assert.equal(
    metricValue(html, "۹۰ روز آینده"),
    faCount(expected),
    "month rollover must not change the day-based window",
  );
});

test("Test 8b — the 90-day indicator is a COUNT, never a Total Debt figure", async () => {
  obligationsFixture = [
    obligation("a", 10, "10000000"),
    obligation("b", 20, "20000000"),
    obligation("c", 200, "30000000"),
  ];

  const html = await render();
  const value = metricValue(html, "۹۰ روز آینده");

  // It is a record count…
  assert.equal(value, faCount(2));
  // …so it can never be mistaken for the Toman totals on the page.
  assert.notEqual(value, "۶۰٬۰۰۰٬۰۰۰");
  assert.ok(!String(value).includes("٬"), "a count has no thousands separator");
});

test("Test 7b — a non-pending obligation is not a live commitment in the window", async () => {
  obligationsFixture = [
    obligation("pending", 10, "10000000"),
    { ...obligation("cancelled", 12, "99000000"), status: "cancelled" },
  ];

  const html = await render();
  assert.equal(metricValue(html, "۹۰ روز آینده"), faCount(1), "cancelled commitments drop out");
  assert.ok(!html.includes("تعهد cancelled"), "and are not rendered in the schedule");
});
