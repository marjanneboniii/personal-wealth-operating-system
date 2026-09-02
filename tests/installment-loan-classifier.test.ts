/**
 * «قسط ≠ وام» — pure classifier unit tests.
 *
 * The classifier (isRealLoanDebt) is the mapping layer between the `debts`
 * entity and the Loans presentation. It decides whether a record is a real
 * Loan / Facility (interest-bearing, or already booked against a ledger
 * liability account) versus a mere installment / repayment schedule.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { isRealLoanDebt } from "../src/features/planning/service";

test("installment plan (0% interest, no ledger account) is NOT a loan", () => {
  // «قسط فرش» from the user report: 30,000,000 Toman, 1 unpaid installment.
  assert.equal(
    isRealLoanDebt({ interestRate: "0", accountId: null, totalCount: 1 }),
    false,
    "1-installment 0% planning debt must not be a loan",
  );
  assert.equal(
    isRealLoanDebt({ interestRate: "0", accountId: null, totalCount: 7 }),
    false,
    "multi-installment 0% planning debt must not be a loan",
  );
  assert.equal(
    isRealLoanDebt({ interestRate: 0, accountId: null, totalCount: 0 }),
    false,
    "plain interest-free debt is not a loan either",
  );
});

test("real loan IS a loan: has interest OR a ledger liability account", () => {
  // Seed-like mortgage loan: 18% interest + liability account 2010.
  assert.equal(isRealLoanDebt({ interestRate: "18", accountId: "acc-2010" }), true);
  // Zero-interest but ledger-backed facility (e.g. قرض‌الحسنه booked as a
  // liability) is still a real loan.
  assert.equal(isRealLoanDebt({ interestRate: "0", accountId: "acc-2015" }), true);
  // Interest-bearing but planning-only (user modeled a financing manually).
  assert.equal(isRealLoanDebt({ interestRate: "21", accountId: null }), true);
  // Missing/empty fields are treated conservatively (never a loan).
  assert.equal(isRealLoanDebt({ interestRate: null, accountId: null }), false);
  assert.equal(isRealLoanDebt({ interestRate: "", accountId: "" }), false);
  assert.equal(isRealLoanDebt({}), false);
});
