import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBankCsv, parseBankDate, parseBankMessage } from "../src/features/bankImport/parser";
import { suggestBankCategory, summarizeBankHabits, type ConfirmedBankRow } from "../src/features/bankImport/insights";

test("Persian and Arabic rial messages separate transaction amounts from balances and card numbers", () => {
  const parsed = parseBankMessage("بانک ملت\nکارت ۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۰\nبرداشت: ٢٬٥٠٠٬٠٠٠ ریال\nمانده: ۹۰٬۰۰۰٬۰۰۰ ریال\n۱۴۰۵/۰۶/۲۶");
  assert.equal(parsed.amountToman, "250000");
  assert.equal(parsed.direction, "withdrawal");
  assert.equal(parsed.date, "2026-09-17");
  assert.equal(parsed.description, "", "raw bank identifiers are not copied to the journal description");
});

test("ambiguous amounts, units and directions stay unresolved; OTPs and debt are flagged", () => {
  assert.equal(parseBankMessage("واریز 250000 مانده 900000").amountToman, "");
  assert.equal(parseBankMessage("برداشت 200 تومان و مبلغ 300 تومان").amountToman, "");
  assert.equal(parseBankMessage("مانده 250000 تومان کارت 6037991234567890").amountToman, "");
  assert.equal(parseBankMessage("برداشت 100 تومان و واریز 100 تومان").direction, "unknown");
  assert.ok(parseBankMessage("رمز یکبار مصرف خرید 200 تومان").warnings.some((w) => /رمز/.test(w)));
  assert.ok(parseBankMessage("پرداخت قسط 200 تومان").warnings.some((w) => /بدهی/.test(w)));
  assert.equal(parseBankMessage("برداشت 15 ریال").amountToman, "1.5", "never round money silently");
});

test("Gregorian and Jalali dates reject impossible calendar dates", () => {
  assert.equal(parseBankDate("2026/02/30"), "");
  assert.equal(parseBankDate("1405/07/31"), "");
  assert.equal(parseBankDate("1405/12/30"), "");
  assert.equal(parseBankDate("1405/06/26"), "2026-09-17");
  assert.equal(parseBankDate("26/06/05"), "", "two-digit years must be reviewed manually");
});

test("CSV handles quoted separators, multiline descriptions and explicit units without evaluating content", () => {
  const drafts = parseBankCsv('\uFEFFتاریخ,مبلغ,نوع,واحد,شرح\r\n1405/06/26,"2,500,000",برداشت,ریال,"خرید, مواد\nغذایی"');
  assert.equal(drafts.length, 1);
  assert.equal(drafts[0].amountToman, "250000");
  assert.equal(drafts[0].description, "خرید, مواد\nغذایی");
  assert.equal(parseBankCsv("date;amount;type;unit;description\n2026-09-17;100;credit;toman;=HYPERLINK(unknown)")[0].description, "=HYPERLINK(unknown)");
  assert.equal(parseBankCsv("تاریخ,مبلغ,نوع\n1405/06/26,250000,برداشت")[0].amountToman, "");
  assert.throws(() => parseBankCsv('تاریخ,مبلغ,نوع\n1405/06/26,"100,برداشت'));
  assert.throws(() => parseBankCsv("تاریخ,مبلغ,نوع\n1405/06/26,100,برداشت,اضافی"));
  assert.throws(() => parseBankCsv("date,amount,type\n" + "2026-09-17,100,debit\n".repeat(101)));
  assert.throws(() => parseBankCsv("x".repeat(100001)));
});

const row = (fields: Partial<ConfirmedBankRow> = {}): ConfirmedBankRow => ({ entryDate: "2026-09-17", type: "expense", status: "posted", reviewed: true, description: "خرید مواد غذایی", categoryId: "food", fxIrtAmount: "100000", ...fields });

test("category suggestions require repeated, unanimous, reviewed history of the same type", () => {
  assert.equal(suggestBankCategory("خرید مواد غذایی", "expense", [row()]), "");
  assert.equal(suggestBankCategory("خرید مواد غذایی", "expense", [row(), row()]), "food");
  assert.equal(suggestBankCategory("خرید مواد غذایی", "expense", [row(), row({ categoryId: "other" })]), "");
  assert.equal(suggestBankCategory("خرید مواد غذایی", "income", [row(), row()]), "");
  assert.equal(suggestBankCategory("خرید مواد غذایی", "expense", [row({ reviewed: false }), row({ status: "void" })]), "");
});

test("habit statistics exclude transfers, repayments, unreviewed and non-cash records and report missing freezes", () => {
  const summary = summarizeBankHabits([
    row({ fxIrtAmount: "100000", entryDate: "2026-09-16" }),
    row({ fxIrtAmount: "200000", entryDate: "2026-09-17" }),
    row({ type: "income", fxIrtAmount: "500000" }),
    row({ type: "transfer", fxIrtAmount: "9999999" }),
    row({ type: "debt_repayment", fxIrtAmount: "9999999" }),
    row({ categoryNonCash: true }), row({ reviewed: false }), row({ status: "void" }),
    row({ fxIrtAmount: null }),
  ]);
  assert.equal(summary.income, "500000");
  assert.equal(summary.spending, "300000");
  assert.equal(summary.net, "200000");
  assert.equal(summary.typicalSpendingDay, "150000");
  assert.equal(summary.smallExpenseCount, 1);
  assert.equal(summary.missing, 1);
});
