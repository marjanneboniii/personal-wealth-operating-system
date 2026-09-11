/**
 * The contractual rules for registering a debt, now shared between the debts
 * module and the setup wizard.
 *
 * These are pure-function tests: validation and the installment split. The
 * database write is covered by the existing debt tests, and the point of
 * extracting this core was that those rules stop existing in two places.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveInstallmentAmount,
  validateDebtInput,
  type CreateDebtInput,
} from "../src/features/planning/createDebt";

const base: CreateDebtInput = {
  userId: "u1",
  title: "وام مسکن",
  creditor: "بانک مسکن",
  principalIrt: "1200000000",
  interestRate: "18",
  startDate: "2026-01-15",
  installmentCount: 0,
  installmentIrt: "",
  firstDueDate: "",
};

const withOverrides = (over: Partial<CreateDebtInput>): CreateDebtInput => ({ ...base, ...over });

test("a well-formed debt validates", () => {
  assert.equal(validateDebtInput(base), null);
  assert.equal(
    validateDebtInput(
      withOverrides({ installmentCount: 24, firstDueDate: "2026-02-15", installmentIrt: "50000000" }),
    ),
    null,
  );
});

test("the contractual essentials are required", () => {
  assert.match(validateDebtInput(withOverrides({ title: "و" })) ?? "", /عنوان/);
  assert.match(validateDebtInput(withOverrides({ creditor: "" })) ?? "", /بستانکار/);
  assert.match(validateDebtInput(withOverrides({ principalIrt: "0" })) ?? "", /بزرگ‌تر از صفر/);
  assert.match(validateDebtInput(withOverrides({ startDate: "1405/01/15" })) ?? "", /تاریخ شروع/);
});

test("interest rate is bounded", () => {
  assert.equal(validateDebtInput(withOverrides({ interestRate: "0" })), null);
  assert.equal(validateDebtInput(withOverrides({ interestRate: "100" })), null);
  assert.match(validateDebtInput(withOverrides({ interestRate: "-1" })) ?? "", /نرخ سود/);
  assert.match(validateDebtInput(withOverrides({ interestRate: "101" })) ?? "", /نرخ سود/);
});

test("an instalment plan needs a first due date, and it cannot precede the start", () => {
  assert.match(
    validateDebtInput(withOverrides({ installmentCount: 12 })) ?? "",
    /اولین سررسید/,
  );
  assert.match(
    validateDebtInput(withOverrides({ installmentCount: 12, firstDueDate: "2025-12-01" })) ?? "",
    /قبل از تاریخ شروع/,
  );
  assert.equal(
    validateDebtInput(withOverrides({ installmentCount: 12, firstDueDate: "2026-01-15" })),
    null,
    "the same day as the start is allowed",
  );
});

test("instalment count is bounded at 360", () => {
  assert.equal(
    validateDebtInput(withOverrides({ installmentCount: 360, firstDueDate: "2026-02-15" })),
    null,
  );
  assert.match(
    validateDebtInput(withOverrides({ installmentCount: 361, firstDueDate: "2026-02-15" })) ?? "",
    /تعداد اقساط/,
  );
  assert.match(
    validateDebtInput(withOverrides({ installmentCount: 2.5, firstDueDate: "2026-02-15" })) ?? "",
    /تعداد اقساط/,
  );
});

test("an omitted instalment amount splits the principal exactly", () => {
  // Exact decimal division — a 1.2bn Toman principal over 24 months must not
  // pick up float drift on the way to 50,000,000.
  assert.equal(
    resolveInstallmentAmount(withOverrides({ installmentCount: 24, firstDueDate: "2026-02-15" })),
    "50000000",
  );
  // An explicit amount wins over the split — a real loan's instalment includes
  // interest and is almost never principal ÷ count.
  assert.equal(
    resolveInstallmentAmount(
      withOverrides({ installmentCount: 24, firstDueDate: "2026-02-15", installmentIrt: "61500000" }),
    ),
    "61500000",
  );
});

test("a debt with no instalments has no instalment amount", () => {
  assert.equal(resolveInstallmentAmount(base), "0");
});

test("a zero explicit instalment amount is rejected, not silently split", () => {
  // Otherwise a user who typed 0 would get the even split instead of an error,
  // and a schedule they never agreed to.
  assert.match(
    validateDebtInput(
      withOverrides({ installmentCount: 12, firstDueDate: "2026-02-15", installmentIrt: "0" }),
    ) ?? "",
    /مبلغ هر قسط/,
  );
});
