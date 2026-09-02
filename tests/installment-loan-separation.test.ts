/**
 * «قسط ≠ وام» — Loans UI regression.
 *
 * The old Loans filter was `interestRate > 0 || totalCount > 0`
 * («has a repayment schedule ⇒ is a loan»), so a planning-only debt that is
 * just an installment plan (e.g. «قسط فرش»: 30,000,000 Toman, 1 unpaid
 * installment, 0% interest, no ledger account) was rendered in Loans.
 *
 * After the fix the Loans page shows only real Loans/Facilities; the
 * installment schedule stays in «بدهی‌ها» / «اقساط» and listDebts() still
 * returns every record (display split only — no data is hidden or deleted).
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

/* ── Register every mock BEFORE importing the page (mock.module contract) ── */
mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/link", {
  defaultExport: (props: any) => React.createElement("a", { href: props.href, className: props.className }, props.children),
});
mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => {} } });
mock.module("@/db/seed", { namedExports: { seedIfEmpty: async () => {} } });
mock.module("@/lib/fx", {
  namedExports: {
    getLatestUsdIrtRate: async () => ({ rate: "210000", effectiveDate: "2026-09-02", source: "manual" }),
  },
});

const INSTALLMENT_ONLY_DEBT = {
  id: "debt-installment-only",
  title: "قسط فرش",
  creditor: "فروشگاه سرای فرش",
  principalToman: "30000000",
  outstandingToman: "30000000",
  principalBase: "142.86",
  outstandingBase: "142.86",
  interestRate: "0",
  accountId: null,
  startDate: "2026-08-01",
  status: "active",
  paidCount: 0,
  totalCount: 1,
  nextDue: { dueDate: "2026-10-23", amountToman: "30000000" },
};

const REAL_LOAN_INTEREST = {
  id: "debt-real-loan",
  title: "وام مسکن",
  creditor: "بانک ملت",
  principalToman: "1520000000",
  outstandingToman: "1500000000",
  principalBase: "8000",
  outstandingBase: "7142.86",
  interestRate: "18",
  accountId: "acc-2010",
  startDate: "2026-02-01",
  status: "active",
  paidCount: 2,
  totalCount: 24,
  nextDue: { dueDate: "2026-10-23", amountToman: "74100000" },
};

const REAL_LOAN_ZERO_INTEREST = {
  id: "debt-qard",
  title: "تسهیلات قرض‌الحسنه",
  creditor: "صندوق خانوادگی",
  principalToman: "50000000",
  outstandingToman: "50000000",
  principalBase: "238.10",
  outstandingBase: "238.10",
  interestRate: "0",
  accountId: "acc-2015",
  startDate: "2026-05-01",
  status: "active",
  paidCount: 0,
  totalCount: 0,
  nextDue: null,
};

// The classifier is a SYNC predicate (Array.filter), identical in shape to the
// real isRealLoanDebt exported by the service (covered by the pure unit test
// file). The mock only replaces the DB call (listDebts).
const isRealLoanDebt = (d: any) =>
  Number(d.interestRate ?? 0) > 0 || (d.accountId != null && d.accountId !== "");
mock.module("@/features/planning/service", {
  namedExports: {
    listDebts: async () => [INSTALLMENT_ONLY_DEBT, REAL_LOAN_INTEREST, REAL_LOAN_ZERO_INTEREST],
    isRealLoanDebt,
  },
});

test("Loans UI: «قسط فرش» hidden, real loans visible (installment ≠ loan)", async () => {
  const { default: LoansPage } = await import("../src/app/debts/loans/page");
  const html = renderToStaticMarkup(await (LoansPage as any)());

  // The installment plan must NOT be rendered as a Loan…
  assert.ok(!html.includes("قسط فرش"), "installment-only debt must not appear in Loans UI");
  assert.ok(!html.includes("فروشگاه سرای فرش"), "its creditor must not appear either");
  // …and it must not be counted in the loan KPI strip.
  assert.ok(!html.includes("۳۰٬۰۰۰٬۰۰۰"), "installment amount must not leak into loan metrics");
  // …while real Loans / Facilities stay visible:
  assert.ok(html.includes("وام مسکن"), "interest-bearing loan must be shown in Loans UI");
  assert.ok(html.includes("تسهیلات قرض‌الحسنه"), "ledger-backed facility must be shown in Loans UI");
});
