import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientTxRow } from "../src/components/transactions/TransactionsView";
import { formatMoney, formatMoneyWithSign } from "../src/lib/format";

mock.module("next/navigation", { namedExports: {
  useRouter: () => ({ replace() {}, refresh() {}, push() {} }),
  useSearchParams: () => new URLSearchParams(),
} });

const filters = { q: "", type: "", accountId: "", categoryId: "", tag: "", review: "", range: "m3", sort: "new" };

const payment = (seq: number, irt: string): ClientTxRow => ({
  id: `inst-${seq}`, entryDate: "2026-10-08", type: "debt_repayment", description: `پرداخت قسط ${seq} — وام مسکن`, status: "posted", source: "manual",
  categoryName: null, categoryParentName: null, reviewed: true, tags: [], fx: null, linkedInstallment: { title: "وام مسکن", seq },
  lines: [
    { account: "وام مسکن", accountType: "liability", symbol: "IRT", decimals: 0, quantity: irt, baseValue: "1", memo: null },
    { account: "بانک ملت", accountType: "asset", symbol: "IRT", decimals: 0, quantity: `-${irt}`, baseValue: "-1", memo: null },
  ],
});

test("one day's payments of the same loan fold into one row with their frozen Toman total", async () => {
  const View = (await import("../src/components/transactions/TransactionsView")).default;
  const rows = [payment(3, "74100000"), payment(2, "74100000"), payment(1, "74100000")];
  const before = structuredClone(rows);
  const html = renderToStaticMarkup(createElement(View, { rows, accountGroups: [], rate: "300000", filters }));
  assert.ok(html.includes("mny-run"), "a folded run row");
  assert.ok(html.includes("۳ قسط"), "the run says how many payments it holds");
  assert.ok(html.includes("۱ تا ۳"), "and which installments");
  assert.ok(html.includes(formatMoneyWithSign("−", "222300000", "IRT")), "total of the frozen Toman legs, never a current-rate figure");
  // Folded: the single payments are not listed until the run is opened.
  assert.ok(!html.includes("پرداخت قسط 2 — وام مسکن"));
  assert.deepEqual(rows, before, "presentation never mutates posted rows");
});

test("a lone installment payment stays an ordinary row", async () => {
  const View = (await import("../src/components/transactions/TransactionsView")).default;
  const html = renderToStaticMarkup(createElement(View, { rows: [payment(5, "74100000")], accountGroups: [], rate: "300000", filters }));
  assert.ok(!html.includes("mny-run"));
  assert.ok(html.includes("پرداخت قسط 5 — وام مسکن"));
});

test("StatCard shows the figure, the change pill with its tone, and the ink stage only when asked", async () => {
  const StatCard = (await import("../src/components/money/StatCard")).default;
  const value = formatMoney("340000000", "IRT");
  const ink = renderToStaticMarkup(createElement(StatCard, { label: "درآمد این ماه", value, tone: "ink", delta: { text: "↑ ۱۲٪", tone: "up" } }));
  assert.ok(ink.includes(value));
  assert.ok(ink.includes('data-tone="up"'));
  assert.ok(ink.includes("ink-stage"));
  const plain = renderToStaticMarkup(createElement(StatCard, { label: "سود ماهانه", value }));
  assert.ok(!plain.includes("ink-stage"));
  assert.ok(!plain.includes("mny-delta"), "no pill without a delta");
});

test("MoneyHeader keeps the five money tabs for phones, marking the current page", async () => {
  const MoneyHeader = (await import("../src/components/money/MoneyHeader")).default;
  const html = renderToStaticMarkup(createElement(MoneyHeader, { title: "سپرده‌ها", active: "/deposits" }));
  assert.ok(html.includes("mny-tabs"));
  for (const label of ["تراکنش‌ها", "حساب‌ها", "جریان نقدی", "سپرده‌ها", "تکراری"]) assert.ok(html.includes(label), label);
  assert.match(html, /aria-current="page" href="\/deposits"/);
});

test("the «…» menu keeps the labelled delete action in the server HTML", async () => {
  const Delete = (await import("../src/components/accounts/DeleteAccountButton")).default;
  const html = renderToStaticMarkup(createElement(Delete, { accountId: "a1", accountName: "بانک سامان", variant: "menu" }));
  assert.match(html, /aria-label="حذف حساب بانک سامان"/);
  assert.ok(html.includes("mny-menu-item"));
});
