/**
 * Regression — «خلاصه حساب‌ها» reported a total of exactly TWICE the real one.
 *
 * User report: assets $33,403.26, opening equity −$33,403.26, and the summary
 * printed «جمع کل ۶۶٬۸۰۶٫۵۱».
 *
 * Root cause: the simple view rendered `formatMoney(totalDebit + totalCredit)`.
 * A balanced double-entry ledger always satisfies totalDebit === totalCredit,
 * so that expression is unconditionally 2× the real figure — it adds every
 * amount to itself. It is not a total of anything.
 *
 * The opening-equity leg itself is NOT a bug: an asset entering the books
 * without a funding source must be balanced by equity, so a −$33,403.26 credit
 * against +$33,403.26 of assets is the required counter-entry. Removing or
 * flipping it would unbalance the ledger. These tests pin that too, so a
 * future "fix" cannot silently break the accounting identity.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { summariseBalances } from "../src/features/ledger/summary";

/** The exact shape the user reported. */
const REPORTED = [
  { type: "asset", baseValue: "20000.00" },
  { type: "asset", baseValue: "13403.26" },
  { type: "equity", baseValue: "-33403.26" },
];

test("the reported case: total is 33,403.26 per side — never 66,806.51", () => {
  const s = summariseBalances(REPORTED);

  const assets = s.subtotals.find((x) => x.type === "asset")!;
  const equity = s.subtotals.find((x) => x.type === "equity")!;

  assert.equal(assets.total, "33403.26", "assets must total the real figure");
  assert.equal(equity.total, "33403.26", "equity reads as a positive capital figure");

  // The old formula, pinned so it can never come back.
  const doubled = Number(s.totalDebit) + Number(s.totalCredit);
  assert.equal(doubled, 66806.52, "totalDebit+totalCredit is the doubling bug");
  assert.notEqual(assets.total, String(doubled));

  // The only cross-type total that means anything.
  assert.equal(Number(s.signedTotal), 0);
  assert.equal(s.balanced, true);
});

test("equity is never added to assets — the identity holds", () => {
  const s = summariseBalances(REPORTED);
  const assets = Number(s.subtotals.find((x) => x.type === "asset")!.total);
  const equity = Number(s.subtotals.find((x) => x.type === "equity")!.total);
  const liabilities = Number(s.subtotals.find((x) => x.type === "liability")?.total ?? 0);

  // assets = liabilities + equity
  assert.equal(assets, liabilities + equity);
  // and specifically NOT assets + |equity|
  assert.notEqual(assets, 33403.26 + Math.abs(-33403.26));
});

test("each account type carries its own sign convention", () => {
  const s = summariseBalances([
    { type: "asset", baseValue: "1000" },
    { type: "liability", baseValue: "-250" },
    { type: "equity", baseValue: "-600" },
    { type: "income", baseValue: "-400" },
    { type: "expense", baseValue: "250" },
  ]);

  const get = (t: string) => s.subtotals.find((x) => x.type === t)!;
  // Credit-balance types read positive; debit-balance types stay positive.
  assert.equal(get("asset").total, "1000");
  assert.equal(get("liability").total, "250");
  assert.equal(get("equity").total, "600");
  assert.equal(get("income").total, "400");
  assert.equal(get("expense").total, "250");

  // The raw signed values are preserved untouched for the PRO trial balance.
  assert.equal(get("liability").signed, "-250");
  assert.equal(get("equity").signed, "-600");
});

test("an unbalanced ledger is reported, not silently absorbed", () => {
  const s = summariseBalances([
    { type: "asset", baseValue: "1000" },
    { type: "equity", baseValue: "-900" },
  ]);
  assert.equal(s.balanced, false);
  assert.equal(Number(s.signedTotal), 100);
});

test("zero balances are excluded and do not create empty subtotals", () => {
  const s = summariseBalances([
    { type: "asset", baseValue: "500" },
    { type: "expense", baseValue: "0" },
    { type: "equity", baseValue: "-500" },
  ]);
  assert.equal(s.subtotals.length, 2);
  assert.ok(!s.subtotals.some((x) => x.type === "expense"));
});

test("a negative asset (overdrawn) reduces the asset subtotal, never inflates it", () => {
  const s = summariseBalances([
    { type: "asset", baseValue: "1000" },
    { type: "asset", baseValue: "-300" },
    { type: "equity", baseValue: "-700" },
  ]);
  assert.equal(s.subtotals.find((x) => x.type === "asset")!.total, "700");
  assert.equal(s.balanced, true);
});

test("decimal precision is exact — no float drift in the subtotals", () => {
  const s = summariseBalances([
    { type: "asset", baseValue: "0.1" },
    { type: "asset", baseValue: "0.2" },
    { type: "equity", baseValue: "-0.3" },
  ]);
  assert.equal(s.subtotals.find((x) => x.type === "asset")!.total, "0.3");
  assert.equal(s.balanced, true);
});
