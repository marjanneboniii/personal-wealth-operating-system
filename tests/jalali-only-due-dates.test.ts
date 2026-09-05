/**
 * تاریخ سررسید فقط شمسی — no Latin/Gregorian date in the debt UI.
 *
 * Product decision: every due date («سررسید») shown to the user is Jalali only.
 * The Gregorian/ISO value stays the storage + transport format (hidden fields,
 * server actions, DB columns) but must never be rendered next to the Jalali
 * date in the debt domain:
 *
 *   • /installments          — «زمان‌بندی اقساط»
 *   • /debts/obligations     — «زمان‌بندی تعهدات»
 *   • /debts                 — debt cards + «قسط بعدی» metric
 *   • /debts/loans           — loan cards + next instalment
 *   • /reports               — «قسط بعدی» line of the debt report
 *   • DebtForm               — instalment-plan preview
 *   • DualDateInput          — the date widget itself is Jalali-only
 *
 * These tests render the REAL page components (the repo's established pattern,
 * see tests/obligations-90day-scope.test.ts) so a reintroduced `formatDualDate`
 * or a stray `{dueDate}` interpolation fails the suite.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { formatJalaliIso, toFaDigits } from "../src/lib/format";

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", {
  namedExports: { redirect: () => {}, useRouter: () => ({ refresh: () => {}, push: () => {} }) },
});
mock.module("next/link", {
  defaultExport: (props: any) =>
    React.createElement("a", { href: props.href, className: props.className }, props.children),
});
mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => ({ id: "u1" }) } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });
mock.module("@/lib/fx", {
  namedExports: {
    getLatestUsdIrtRate: async () => ({ rate: "190000", effectiveDate: "2026-09-02", source: "manual" }),
  },
});

/** A Gregorian ISO date (the shape that must NOT be shown to the user). */
const LATIN_ISO = /\b\d{4}-\d{2}-\d{2}\b/;

/**
 * What the user actually SEES: markup (and therefore every attribute —
 * `href`, hidden-input `value`, …) is stripped away. The Gregorian ISO value
 * legitimately stays in those attributes because it is the storage/transport
 * format; it must never appear as rendered text.
 */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&quot;/g, "'")
    .replace(/\u2068|\u2069/g, " ");
}

function assertNoLatinDate(html: string, where: string) {
  const text = visibleText(html);
  const leak = text.match(LATIN_ISO)?.[0];
  assert.ok(!leak, `${where}: Gregorian date "${leak}" is rendered to the user`);
}

const iso = (dayOffset: number) =>
  new Date(Date.now() + dayOffset * 86_400_000).toISOString().slice(0, 10);

/* ─────────────────────────── fixtures ─────────────────────────── */

const DUE_A = iso(5);
const DUE_B = iso(-3); // overdue
const PAID_AT = iso(-40);
const START = iso(-120);

const scheduleRows = [
  {
    id: "inst-1",
    seq: 1,
    title: "وام مسکن",
    creditor: "بانک ملت",
    dueDate: DUE_A,
    fx: {
      isPaid: false,
      paidAt: null,
      amountToman: "25000000",
      displayToman: "25000000",
      displayUsd: "131.58",
    },
  },
  {
    id: "inst-2",
    seq: 2,
    title: "وام خودرو",
    creditor: "بانک ملی",
    dueDate: DUE_B,
    fx: {
      isPaid: true,
      paidAt: PAID_AT,
      amountToman: "18000000",
      displayToman: "18000000",
      displayUsd: "94.74",
    },
  },
];

const debtFixture = {
  id: "debt-1",
  title: "وام مسکن",
  creditor: "بانک ملت",
  startDate: START,
  interestRate: "18",
  status: "active",
  totalCount: 12,
  paidCount: 3,
  outstandingBase: "180000000",
  outstandingToman: "180000000",
  paidToman: "60000000",
  nextDue: {
    id: "inst-1",
    seq: 4,
    dueDate: DUE_A,
    amountBase: "25000000",
    amountToman: "25000000",
  },
  installments: [
    { id: "inst-2", seq: 3, dueDate: DUE_B, status: "pending", amountToman: "18000000" },
  ],
};

const obligationFixture = [
  {
    id: "obl-1",
    title: "اجاره خانه",
    amountBase: "30000000",
    amountToman: "30000000",
    dueDate: DUE_A,
    recurrence: "monthly",
    status: "pending",
    note: null,
  },
];

mock.module("@/features/planning/service", {
  namedExports: {
    listInstallmentSchedule: async () => ({
      rows: scheduleRows,
      rate: "190000",
      pendingUsdInsight: null,
    }),
    listDebts: async () => [debtFixture],
    isRealLoanDebt: (d: any) => Number(d.interestRate ?? 0) > 0 || Boolean(d.accountId),
    listObligations: async () => obligationFixture,
    listEvents: async () => [],
    upcomingInstallments: async () => [
      {
        id: "inst-1",
        seq: 4,
        debtTitle: "وام مسکن",
        creditor: "بانک ملت",
        dueDate: DUE_A,
        amountBase: "25000000",
        amountToman: "25000000",
        status: "pending",
      },
    ],
  },
});

/** Minimal chainable db stub — the pages only read a cash account id. */
const dbStub: any = {
  select: () => dbStub,
  from: () => dbStub,
  leftJoin: () => dbStub,
  where: () => dbStub,
  orderBy: () => dbStub,
  limit: async () => [{ id: "acc-cash" }],
};
mock.module("@/db", { namedExports: { db: dbStub } });
mock.module("@/components/RowAction", {
  defaultExport: () => React.createElement("button", { type: "button" }, "پرداخت سریع"),
});

async function renderPage(path: string): Promise<string> {
  const mod: any = await import(path);
  return renderToStaticMarkup(await mod.default());
}

/* ─────────────────────────── assertions ─────────────────────────── */

test("زمان‌بندی اقساط (/installments) renders the due date in Jalali only", async () => {
  const html = await renderPage("../src/app/installments/page");

  assert.ok(html.includes("زمان‌بندی اقساط"), "the schedule section is rendered");
  assert.ok(
    html.includes(toFaDigits(formatJalaliIso(DUE_A, "en"))),
    "the Jalali due date is present",
  );
  assertNoLatinDate(html, "/installments «زمان‌بندی اقساط»");
  assert.ok(
    visibleText(html).includes(toFaDigits(formatJalaliIso(PAID_AT, "en"))),
    "the paid-at line shows the Jalali payment date",
  );
});

test("زمان‌بندی تعهدات (/debts/obligations) renders the due date in Jalali only", async () => {
  const html = await renderPage("../src/app/debts/obligations/page");

  assert.ok(html.includes("زمان‌بندی تعهدات"), "the obligations schedule is rendered");
  assert.ok(html.includes("اجاره خانه"), "the obligation row is rendered");
  assert.ok(
    html.includes(toFaDigits(formatJalaliIso(DUE_A, "en"))),
    "the Jalali due date is present",
  );
  assertNoLatinDate(html, "/debts/obligations «زمان‌بندی تعهدات»");
});

test("بدهی‌ها (/debts) — card start date and «قسط بعدی» hint carry no Latin date", async () => {
  const html = await renderPage("../src/app/debts/page");

  assert.ok(html.includes("وام مسکن"), "the debt card is rendered");
  assert.ok(html.includes("شروع"), "the start-date label is rendered");
  assert.ok(
    visibleText(html).includes(toFaDigits(formatJalaliIso(START, "en"))),
    "the Jalali start date is present",
  );
  assertNoLatinDate(html, "/debts");
});

test("وام‌ها (/debts/loans) — next instalment due date carries no Latin date", async () => {
  const html = await renderPage("../src/app/debts/loans/page");

  assert.ok(html.includes("قسط بعدی"), "the next-instalment line is rendered");
  assertNoLatinDate(html, "/debts/loans");
});

test("گزارش بدهی (/reports) — «قسط بعدی» is formatted Jalali-only", async () => {
  // The reports page pulls a wide service graph (net worth, cashflow, PnL,
  // projection); like tests/installments-schedule-mobile-layout.test.ts this
  // one asserts on the page source instead of a full render.
  const src = fs.readFileSync(path.resolve(process.cwd(), "src/app/reports/page.tsx"), "utf-8");

  assert.ok(!src.includes("formatDualDate"), "the dual (Jalali + Gregorian) formatter is not used");
  assert.ok(
    /قسط بعدی \{formatJalaliIso\(d\.nextDue\.dueDate\)\}/.test(src),
    "the next-instalment due date is rendered with formatJalaliIso",
  );
});

test("DualDateInput is Jalali-only: no Latin picker, no Gregorian text, ISO still submitted", async () => {
  const { default: DualDateInput } = await import("../src/components/ui/DualDateInput");

  const html = renderToStaticMarkup(
    React.createElement(DualDateInput, { name: "firstDueDate", value: DUE_A, label: "اولین سررسید", required: true }),
  );

  assert.ok(!html.includes('type="date"'), "the native Gregorian date picker is gone");
  assert.ok(!html.includes("میلادی"), "no «میلادی» label is rendered");
  assertNoLatinDate(html, "DualDateInput");
  // The server still receives the ISO value through the hidden field.
  assert.ok(
    html.includes(`type="hidden" name="firstDueDate" value="${DUE_A}"`) ||
      new RegExp(`name="firstDueDate"[^>]*value="${DUE_A}"`).test(html),
    "the hidden field still submits the Gregorian ISO date to the server",
  );
  // And the Jalali equivalent is what the user sees / confirms.
  assert.ok(html.includes("۱۴۰") || html.includes(formatJalaliIso(DUE_A, "en")), "the Jalali date is shown");
});
