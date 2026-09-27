/**
 * «سوابق گذشته» — the page renders, in both states that matter.
 *
 *   • with records: the timeline, the kind colours, the «شروع ثبت‌ها» line,
 *     and none of the retired «پیش از توازن» wording;
 *   • on a database without migration 0053: a clear «update the database»
 *     card instead of the generic error page.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/headers", {
  namedExports: {
    cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
    headers: async () => new Headers(),
  },
});
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", {
  namedExports: { redirect: () => {}, useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/transactions/history" },
});
mock.module("next/link", {
  defaultExport: (props: any) => React.createElement("a", { href: props.href, className: props.className }, props.children),
});
mock.module("@/lib/authGuard", { namedExports: { ensureAuth: async () => ({ id: "u1" }) } });

const state: { missing: boolean } = { missing: false };
const rows = [
  { id: "r1", occurredOn: "2025-12-20", kind: "buy", title: "خرید پراید", amount: "250000000", unit: "IRT", counterparty: "نمایشگاه", accountLabel: "بانک ملت", note: null },
  { id: "r2", occurredOn: "2025-12-02", kind: "income", title: "حقوق آذر", amount: "40000000", unit: "IRT", counterparty: null, accountLabel: null, note: "با اضافه‌کار" },
  { id: "r3", occurredOn: "2024-03-01", kind: "sell", title: "فروش دلار", amount: "500", unit: "USD", counterparty: null, accountLabel: null, note: null },
];
mock.module("@/features/history/service", {
  namedExports: {
    listHistoryRecords: async () => {
      if (state.missing) throw Object.assign(new Error('relation "history_records" does not exist'), { code: "42P01" });
      return rows;
    },
    getTavazonStart: async () => "2026-03-01",
    isHistoryTableMissing: (e: any) => e?.code === "42P01",
    summarizeHistory: () => ({ count: 3, inToman: "40000000", outToman: "250000000", first: "2024-03-01", last: "2025-12-20" }),
  },
});

async function render() {
  const { default: Page } = await import("../src/app/transactions/history/page");
  const html = renderToStaticMarkup(await (Page as any)());
  const visible = html.replace(/<[^>]*>/g, " ").replace(/[‎‏⁦-⁩ ]/g, " ").replace(/\s+/g, " ");
  return { html, visible };
}

test("the timeline renders with the new wording", async () => {
  state.missing = false;
  const { html, visible } = await render();
  assert.ok(visible.includes("سوابق گذشته"), "the section is named «سوابق گذشته»");
  assert.ok(visible.includes("شروع ثبت‌ها"), "the boundary line renders");
  assert.ok(visible.includes("خرید پراید") && visible.includes("حقوق آذر") && visible.includes("فروش دلار"));
  assert.ok(html.includes('data-kind="buy"') && html.includes('data-kind="income"'), "rows carry their kind colour");
  assert.ok(visible.includes("۵۰۰ دلار"), "a USD record keeps its own unit");
  assert.ok(!/پیش از توازن|قبل از توازن|آغاز توازن/.test(visible), "the retired wording is gone");
});

test("a database without the table shows a clear notice, not the error page", async () => {
  state.missing = true;
  const { visible } = await render();
  assert.ok(visible.includes("هنوز فعال نشده"), visible.slice(0, 400));
  assert.ok(visible.includes("db:migrate"));
});
