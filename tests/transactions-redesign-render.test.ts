import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ClientTxRow } from "../src/components/transactions/TransactionsView";
import { formatMoneyWithSign } from "../src/lib/format";

mock.module("next/navigation", { namedExports: {
  useRouter: () => ({ replace() {}, refresh() {}, push() {} }),
  useSearchParams: () => new URLSearchParams(),
} });

const filters = { q: "", type: "", accountId: "", categoryId: "", tag: "", review: "", range: "m3", sort: "new" };
const row: ClientTxRow = {
  id: "expense", entryDate: "2026-10-07", type: "expense", description: "خرید سوخت خودرو برای سفر", status: "posted", source: "manual",
  categoryName: "سوخت خودرو", categoryParentName: "حمل‌ونقل", reviewed: false, tags: ["سفر"], fx: null, linkedInstallment: null,
  lines: [
    { account: "هزینه متفرقه", accountType: "expense", symbol: "USD", decimals: 2, quantity: "2", baseValue: "2", memo: null },
    { account: "بانک تجارت", accountType: "asset", symbol: "IRT", decimals: 0, quantity: "-200000", baseValue: "-2", memo: null },
  ],
};

test("transaction presentation keeps native money, category and bank flow without mutating posted rows", async () => {
  const before = structuredClone(row);
  const View = (await import("../src/components/transactions/TransactionsView")).default;
  const html = renderToStaticMarkup(createElement(View, { rows: [row], accountGroups: [], rate: "300000", filters, truncated: true }));
  for (const text of [row.description, "سوخت خودرو", "از بانک تجارت به سوخت خودرو", "#سفر", "فقط موارد اخیر"]) assert.ok(html.includes(text), text);
  assert.ok(html.includes(formatMoneyWithSign("−", "200000", "IRT")), "native Toman does not change with current FX");
  assert.ok(html.includes("۱ مورد در فهرست فعلی"), "counts are explicitly scoped to loaded rows");
  assert.deepEqual(row, before);
});

test("empty filtered transaction list keeps clear-filter recovery", async () => {
  const View = (await import("../src/components/transactions/TransactionsView")).default;
  const html = renderToStaticMarkup(createElement(View, { rows: [], accountGroups: [], rate: "300000", filters: { ...filters, q: "ناموجود" } }));
  assert.ok(html.includes("تراکنشی با این فیلترها پیدا نشد"));
  assert.ok(html.includes("حذف فیلترها"));
});

test("transaction semantics distinguish expense, income, repayment and FX without changing amounts", async () => {
  const View = (await import("../src/components/transactions/TransactionsView")).default;
  for (const type of ["expense", "income", "debt_repayment", "fx"]) {
    const entry = { ...row, id: type, type };
    const before = structuredClone(entry);
    const html = renderToStaticMarkup(createElement(View, { rows: [entry], accountGroups: [], rate: "300000", filters }));
    assert.ok(html.includes(`data-type="${type}"`));
    assert.deepEqual(entry, before);
  }
});
