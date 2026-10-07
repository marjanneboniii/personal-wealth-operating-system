import assert from "node:assert/strict";
import { test } from "node:test";
import { humanizeEntry, moneyFlowLabel } from "../src/lib/tx";
import type { LedgerRow } from "../src/features/ledger/queries";

const row: LedgerRow = {
  id: "expense", entryDate: "2026-10-07", type: "expense", description: "بنزین", status: "posted", source: "manual", categoryName: "سوخت خودرو",
  lines: [
    { account: "هزینه متفرقه", accountType: "expense", symbol: "USD", decimals: 2, quantity: "2", baseValue: "2", memo: null },
    { account: "بانک تجارت", accountType: "asset", symbol: "IRT", decimals: 0, quantity: "-200000", baseValue: "-2", memo: null },
  ],
};

test("expense flow displays the saved category and preserves native amounts and input postings", () => {
  const before = structuredClone(row);
  const human = humanizeEntry(row);
  assert.equal(moneyFlowLabel(human.from, human.to), "از بانک تجارت به سوخت خودرو");
  assert.equal(human.nativeIrt, "200000");
  assert.equal(human.amountExact, "2");
  assert.equal(human.sign, -1);
  assert.deepEqual(row, before);
});

test("uncategorized expenses do not pretend to be misc; a real misc category is still displayed", () => {
  assert.equal(humanizeEntry({ ...row, categoryName: null }).to, "هزینه");
  assert.equal(humanizeEntry({ ...row, categoryName: "متفرقه" }).to, "متفرقه");
});

test("transfers and income keep the real counterpart rather than expense category labels", () => {
  assert.equal(humanizeEntry({ ...row, type: "transfer", categoryName: "اشتباه", lines: [{ ...row.lines[0], account: "بانک شهر", accountType: "asset" }, row.lines[1]] }).to, "بانک شهر");
  assert.equal(humanizeEntry({ ...row, type: "income", categoryName: "حقوق" }).to, "هزینه متفرقه");
});
