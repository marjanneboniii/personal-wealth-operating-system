/**
 * نسبت اقساط به درآمد — the share of a month's income already promised to installments.
 *
 *  • only PAYABLE, still-owed installments due in the next 90 days count; a
 *    receivable, a paid row and an overdue row do not
 *  • a partial payment counts only what is still owed
 *  • income is the frozen Toman average over the months that had income;
 *    without full snapshot coverage it falls back to USD × rate and says so
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { computeDebtService } from "../src/features/planning/debtService";

const TODAY = "2026-09-23";
const inst = (dueDate: string, amountToman: string, status = "pending", paidToman: string | null = null) => ({
  dueDate,
  status,
  amountToman,
  amountBase: "0",
  paidToman,
});
const month = (inflowToman: string, entries = 1, snap = entries) => ({
  inflow: String(Number(inflowToman) / 100000),
  inflowToman,
  inflowEntries: entries,
  inflowEntriesSnap: snap,
});

test("installments due in the next 90 days, against frozen monthly income", () => {
  const r = computeDebtService({
    today: TODAY,
    rate: "100000",
    debts: [
      {
        direction: "payable",
        installments: [
          inst("2026-09-01", "10000000"), // overdue — flagged elsewhere, not here
          inst("2026-10-01", "10000000"),
          inst("2026-11-01", "10000000", "paid", "10000000"), // already paid
          inst("2026-12-01", "10000000", "partial", "4000000"), // 6M still owed
          inst("2027-01-01", "10000000"), // beyond 90 days
        ],
      },
      { direction: null, installments: [inst("2026-10-15", "5000000")] }, // legacy NULL = payable
      { direction: "receivable", installments: [inst("2026-10-10", "50000000")] }, // money coming in
    ],
    // Two months with income, one without: the average is over the two.
    cashflow: [month("60000000"), { inflow: "0", inflowToman: "0", inflowEntries: 0, inflowEntriesSnap: 0 }, month("40000000")],
  });
  // (10M + 6M + 5M) / 3 = 7M a month; income (60M + 40M) / 2 = 50M a month.
  assert.equal(r.monthlyInstallmentsToman, "7000000");
  assert.equal(r.monthlyIncomeToman, "50000000");
  assert.equal(r.ratioPct, "14.0");
  assert.equal(r.installmentsInWindow, 3);
  assert.equal(r.incomeMonths, 2);
  assert.equal(r.incomeFrozen, true);
});

test("uncovered income falls back to the current rate, and says so", () => {
  const r = computeDebtService({
    today: TODAY,
    rate: "100000",
    debts: [{ direction: "payable", installments: [inst("2026-10-01", "30000000")] }],
    cashflow: [month("20000000", 2, 1)], // inflow 200 USD, one entry without snapshot
  });
  assert.equal(r.incomeFrozen, false);
  assert.equal(r.monthlyIncomeToman, "20000000", "200 USD × 100,000");
  assert.equal(r.ratioPct, "50.0");
});

test("no income: no ratio, never a division by zero", () => {
  const r = computeDebtService({
    today: TODAY,
    rate: "100000",
    debts: [{ direction: "payable", installments: [inst("2026-10-01", "30000000")] }],
    cashflow: [],
  });
  assert.equal(r.ratioPct, null);
  assert.equal(r.monthlyIncomeToman, null);
  assert.equal(r.monthlyInstallmentsToman, "10000000");
});

test("no installments: a ratio of zero", () => {
  const r = computeDebtService({ today: TODAY, rate: "100000", debts: [], cashflow: [month("50000000")] });
  assert.equal(r.ratioPct, "0.0");
  assert.equal(r.installmentsInWindow, 0);
});
