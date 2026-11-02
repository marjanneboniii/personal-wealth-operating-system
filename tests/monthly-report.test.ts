import assert from "node:assert/strict";
import { test } from "node:test";
import type { TxRow } from "../src/features/ledger/queries";
import {
  buildMonthlyReport,
  parseReportMonth,
  reportMonthKey,
  reportMonthRange,
  shiftReportMonth,
} from "../src/features/ledger/monthlyReport";
import { jalaliToIso } from "../src/lib/format";

const ABAN = { y: 1405, m: 8 };

/** A Toman entry: money leaves `from` (negative leg) and lands in `to`. */
function tx(over: Partial<TxRow> & { toman: string; day: number; usd?: string }): TxRow {
  const usd = over.usd ?? String(Number(over.toman) / 100000);
  return {
    id: `${over.type}-${over.day}-${over.toman}`,
    entryDate: jalaliToIso(1405, 8, over.day),
    type: "expense",
    description: "شرح",
    status: "posted",
    source: "manual",
    reviewed: false,
    tags: [],
    lines: [
      { account: "هزینه", accountType: "expense", symbol: "IRT", quantity: over.toman, baseValue: usd, decimals: 0, memo: null },
      { account: "بانک ملت", accountType: "asset", symbol: "IRT", quantity: `-${over.toman}`, baseValue: `-${usd}`, decimals: 0, memo: null },
    ],
    ...over,
  } as TxRow;
}

test("month helpers — Jalali keys, shifts across the year, inclusive ranges", () => {
  assert.deepEqual(parseReportMonth("1405-08"), ABAN);
  assert.equal(parseReportMonth("1405-13"), null);
  assert.equal(parseReportMonth("abc"), null);
  assert.equal(reportMonthKey({ y: 1405, m: 1 }), "1405-01");
  assert.deepEqual(shiftReportMonth({ y: 1405, m: 1 }, -1), { y: 1404, m: 12 });
  assert.deepEqual(shiftReportMonth({ y: 1404, m: 12 }, 1), { y: 1405, m: 1 });
  const aban = reportMonthRange(ABAN);
  assert.equal(aban.days, 30);
  assert.equal(aban.from, jalaliToIso(1405, 8, 1));
  assert.equal(aban.to, jalaliToIso(1405, 8, 30));
});

test("monthly report — income, cash expense, debt and non-cash each counted once, in the right place", () => {
  const r = buildMonthlyReport(
    [
      tx({ type: "income", day: 1, toman: "50000000", categoryName: "حقوق ماهانه", categoryParentName: "حقوق و دستمزد" }),
      tx({ day: 2, toman: "16000000", categoryName: "خرید ماهانهٔ خواربار", categoryParentName: "خوراک و خواربار" }),
      tx({ day: 2, toman: "4000000", categoryName: "نان، میوه و سبزی", categoryParentName: "خوراک و خواربار" }),
      tx({ day: 10, toman: "5000000", categoryName: "سوخت خودرو", categoryParentName: "خودرو و حمل‌ونقل" }),
      tx({ day: 15, toman: "3000000", categoryName: "استهلاک خودرو", categoryParentName: "خودرو و حمل‌ونقل", categoryNonCash: true }),
      tx({ type: "debt_repayment", day: 20, toman: "11700000" }),
      tx({ type: "transfer", day: 21, toman: "9000000" }),
    ],
    ABAN,
    "100000",
  );

  assert.equal(r.income, "50000000");
  assert.equal(r.expense, "25000000", "non-cash depreciation and debt are not spending");
  assert.equal(r.nonCash, "3000000");
  assert.equal(r.debtPaid, "11700000");
  assert.equal(r.net, "25000000");
  assert.equal(r.savingsRate, 0.5);
  assert.equal(r.expenseCount, 3);
  assert.equal(r.rows.length, 7, "every entry is listed, transfers included");
  assert.equal(r.approxCount, 0, "Toman legs are frozen figures, never estimates");

  assert.deepEqual(
    r.expenseByGroup.map((g) => [g.name, g.toman, g.share]),
    [
      ["خوراک و خواربار", "20000000", 0.8],
      ["خودرو و حمل‌ونقل", "5000000", 0.2],
    ],
  );
  assert.deepEqual(r.expenseByGroup[0].leaves.map((l) => l.name), ["خرید ماهانهٔ خواربار", "نان، میوه و سبزی"]);
  assert.equal(r.dailyExpense.length, 30);
  assert.equal(r.dailyExpense[1], "20000000", "day ۲ holds both grocery runs");
  assert.equal(r.dailyExpense[14], "0", "depreciation is not a day's spending");
  assert.equal(r.topExpenses[0].toman, "16000000");
});

test("monthly report — an entry without a frozen Toman is estimated at today's rate and marked", () => {
  const usdOnly = tx({ day: 5, toman: "0", usd: "20" });
  usdOnly.lines = usdOnly.lines.map((l) => ({ ...l, symbol: "USD", quantity: l.baseValue }));
  const r = buildMonthlyReport([usdOnly], ABAN, "100000");
  assert.equal(r.expense, "2000000");
  assert.equal(r.approxCount, 1);
  assert.equal(r.rows[0].approx, true);

  const noRate = buildMonthlyReport([usdOnly], ABAN, null);
  assert.equal(noRate.expense, "0");
  assert.equal(noRate.missingCount, 1);
  assert.equal(noRate.savingsRate, null);
});
