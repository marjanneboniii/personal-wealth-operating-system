/**
 * Reports page — «کل هزینه ثبت‌شده» must not be an installment graveyard.
 *
 * Audit F-1 (docs/AUDIT-INSTALLMENT-PAYMENT-CLASSIFICATION-2026-09-07.md):
 * the KPI strip used to sum `getAccountBalances()` rows by account TYPE, so the
 * contra leg of every repayment of a planning-only debt — booked on an
 * EXPENSE-typed bucket (5960 «پرداخت اقساط», 5900 before it) — inflated
 * «کل هزینه ثبت‌شده» and pushed «نرخ پس‌انداز» down, while every other report
 * in the same app (cash flow, per-account flow, category flow) excludes
 * `debt_repayment`. Two definitions of "expense" in one product.
 *
 * Scenario: 12 months, ONE real expense of 100 USD and 1,000 USD of income at
 * a 200,000 IRT/USD rate → «۲۰٬۰۰۰٬۰۰۰ تومان» of expense and a 90.0% savings
 * rate. 13 installments of 909,090 Toman were also paid (11,818,170 Toman),
 * and the balance of the expense account says 159.09085 USD — the buggy
 * balance-derived sum, which must no longer reach the KPI.
 *
 * The excluded amount is DISCLOSED in the debt section, in FROZEN contractual
 * Toman; when only part of it is backed by a frozen installment row the note
 * falls back to the ledger's own USD base value instead of mixing two bases.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const RATE = "200000";
/** The ONE real expense of the window, in USD base value. */
const EXPENSE_USD = "100";
const INCOME_USD = "1000";
/** 13 paid installments of 909,090 Toman, as the ledger booked them (÷ rate). */
const REPAYMENTS_USD = "59.09085";
const REPAYMENTS_TOMAN = "11818170";

/** Mutated per test — the page is rendered twice against these fixtures. */
let TOTALS: any = {
  expense: EXPENSE_USD,
  income: INCOME_USD,
  repayments: REPAYMENTS_USD,
  repaymentEntries: 13,
  repaymentsToman: REPAYMENTS_TOMAN,
  repaymentsTomanEntries: 13,
};

mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => {} } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });
mock.module("@/features/ledger/queries", {
  namedExports: {
    // The OLD source of the KPI: the expense account's balance ALSO carries the
    // repayment legs, which is exactly the leak. Kept here so a regression to
    // a balance sum is caught by a real number, not a crash.
    getAccountBalances: async () => [
      {
        accountId: "acc-expense",
        code: "5960",
        name: "پرداخت اقساط",
        type: "expense",
        baseValue: "159.09085",
      },
      { accountId: "acc-income", code: "4010", name: "حقوق و درآمد", type: "income", baseValue: "-1000" },
    ],
    // Snapshot coverage is deliberately PARTIAL (outflowEntriesSnap: 0): that
    // is the state in which the KPI headline itself is computed from
    // totalExpense, so this file cannot pass on a flow-derived number alone.
    getCashflow: async () => [
      {
        month: "2026-08-01",
        inflow: INCOME_USD,
        outflow: EXPENSE_USD,
        inflowToman: "200000000",
        outflowToman: "20000000",
        inflowEntries: 1,
        inflowEntriesSnap: 1,
        outflowEntries: 1,
        outflowEntriesSnap: 0,
      },
    ],
    getExpenseIncomeTotals: async () => TOTALS,
    getRealizedPnl: async () => ({ total: "0", bySymbol: [] }),
  },
});
mock.module("@/features/planning/service", {
  namedExports: {
    listDebts: async () => [],
    projectCashflow: async () => ({ points: [] }),
  },
});
mock.module("@/features/portfolio/service", {
  namedExports: {
    getCurrentNetWorth: async () => ({
      netWorth: "1000",
      netWorthToman: "200000000",
      totalAssets: "1000",
      totalAssetsToman: "200000000",
      totalLiabilities: "0",
      totalLiabilitiesToman: "0",
      liquid: "1000",
      liquidToman: "200000000",
      valuation: { totalUnrealizedPnl: "0", totalUnrealizedPnlToman: "0" },
    }),
  },
});
mock.module("@/lib/fx", {
  namedExports: {
    getLatestUsdIrtRate: async () => ({ rate: RATE, effectiveDate: "2026-08-01", source: "manual" }),
  },
});
mock.module("@/components/RowAction", { defaultExport: () => null });
mock.module("@/components/reports/PdfButton", { defaultExport: () => null });
mock.module("@/components/charts/Charts", { namedExports: { BarsChart: () => null } });

const NBSP = "\u00A0";
/**
 * Money strings carry invisible bidi controls (RLI/LRI…PDI) that keep the
 * «number → unit» order and the «−» in front of the digits. They are not part
 * of what the user sees, so strip them before matching rendered markup.
 */
const stripBidi = (s: string) => s.replace(/[\u2066\u2067\u2068\u2069]/g, "");


function section(html: string, heading: string) {
  const start = html.indexOf(heading);
  assert.notEqual(start, -1, `the ${heading} part of the report must render`);
  const end = html.indexOf("</section>", start);
  assert.notEqual(end, -1, `the ${heading} section must close`);
  return html.slice(start, end);
}

test("installment payments leave «کل هزینه ثبت‌شده» and the savings rate alone", async () => {
  TOTALS = {
    expense: EXPENSE_USD,
    income: INCOME_USD,
    repayments: REPAYMENTS_USD,
    repaymentEntries: 13,
    repaymentsToman: REPAYMENTS_TOMAN,
    repaymentsTomanEntries: 13,
  };
  const { default: ReportsPage } = await import("../src/app/reports/page");
  const html = stripBidi(renderToStaticMarkup(await (ReportsPage as any)()));
  const kpi = section(html, "کل هزینه ثبت‌شده");

  // The real expense only: 100 USD at 200,000 = ۲۰٬۰۰۰٬۰۰۰ تومان, with the
  // ledger amount of the SAME total as its hint.
  assert.ok(
    kpi.includes(`۲۰٬۰۰۰٬۰۰۰${NBSP}تومان`),
    "«کل هزینه ثبت‌شده» must be the ENTRY-derived expense total (20,000,000 Toman)",
  );
  assert.ok(kpi.includes(`۱۰۰${NBSP}دلار`), "the hint must be the entry total in the base currency");
  assert.ok(!kpi.includes("۱۵۹.۰۹"), "…never the expense ACCOUNT BALANCE (159.09 USD)");
  // NOT the expense-account BALANCE (159.09085 USD → 31,818,170 Toman), which
  // is what a repayment of a planning-only debt used to turn into fake spend.
  assert.ok(!html.includes("۳۱٬۸۱۸٬۱۷۰"), "a repayment must never inflate the expense KPI");
  // The savings rate follows: (1000 − 100) / 1000 = 90.0%, not 84.1%.
  assert.ok(kpi.includes("۹۰.۰٪"), "savings rate must ignore the repayment");
  assert.ok(!html.includes("۸۴.۱٪"), "the repayment must not drag the savings rate down");
  // «میانگین هزینه ماهانه» is derived from the SAME total, so it is clean too.
  assert.ok(!section(html, "میانگین هزینه ماهانه").includes("۳۱٬۸۱۸٬۱۷۰"), "monthly average stays clean");
});

test("what was excluded is disclosed under «بدهی و بازپرداخت», in frozen Toman", async () => {
  const { default: ReportsPage } = await import("../src/app/reports/page");
  const html = stripBidi(renderToStaticMarkup(await (ReportsPage as any)()));
  const debts_ = section(html, "بدهی و بازپرداخت");

  // The contractual amount the user actually paid — 13 × 909,090 — never a
  // ÷rate reconstruction that would move when the dollar moves.
  assert.ok(
    debts_.includes(`۱۱٬۸۱۸٬۱۷۰${NBSP}تومان`),
    "the excluded repayments must be disclosed in frozen Toman",
  );
  assert.ok(debts_.includes("پرداخت اقساط"), "the note must name the bucket that archived them");
  assert.ok(debts_.includes("مصرف نیست"), "and say why they are not an expense");
});

test("partial frozen coverage falls back to the ledger amount, unconverted", async () => {
  // Two excluded entries, only ONE backed by a paid-installment row (e.g. a
  // hand-written repayment). A partial Toman sum must never be presented as the
  // whole story — so the note shows the ledger's own base currency instead.
  TOTALS = {
    expense: EXPENSE_USD,
    income: INCOME_USD,
    repayments: REPAYMENTS_USD,
    repaymentEntries: 2,
    repaymentsToman: "909090",
    repaymentsTomanEntries: 1,
  };
  const { default: ReportsPage } = await import("../src/app/reports/page");
  const html = stripBidi(renderToStaticMarkup(await (ReportsPage as any)()));
  const debts_ = section(html, "بدهی و بازپرداخت");

  assert.ok(
    debts_.includes(`۵۹.۰۹${NBSP}دلار`),
    "the disclosure falls back to the USD base value of the excluded legs",
  );
  assert.ok(!debts_.includes("۹۰۹٬۰۹۰"), "a PARTIAL frozen Toman must not be shown as the total");
  assert.ok(!html.includes("۳۱٬۸۱۸٬۱۷۰"), "and the expense KPI stays clean either way");
});
