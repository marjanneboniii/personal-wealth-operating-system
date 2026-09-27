/**
 * بودجه‌ها — the board renders: the hero, an event card in its template's
 * colour with its lines, and a monthly category row.
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
  namedExports: { redirect: () => {}, useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/budgets" },
});
mock.module("next/link", {
  defaultExport: (props: any) => React.createElement("a", { href: props.href, className: props.className }, props.children),
});

const base = { accountId: null, accountName: null, accountCode: null, amountUsd: "0", spentUsd: "0", remainingUsd: "0" };
const budgets = [
  {
    ...base,
    id: "b1",
    name: "عروسی ما",
    tag: "عروسی",
    template: "wedding",
    periodStart: "2026-09-01",
    periodEnd: "2026-12-30",
    amountBase: "500000000",
    amountToman: "500000000",
    spentToman: "215000000",
    remainingToman: "285000000",
    spentBase: "215000000",
    remainingBase: "285000000",
    usage: 43,
    over: false,
    items: [
      { id: "i1", title: "حلقه", tag: "عروسی_حلقه", amountToman: "150000000", spentToman: "120000000", usage: 80, over: false },
      { id: "i2", title: "تالار", tag: "عروسی_تالار", amountToman: "0", spentToman: "0", usage: 0, over: false },
      { id: "i3", title: "لباس", tag: "عروسی_لباس", amountToman: "80000000", spentToman: "90000000", usage: 112.5, over: true },
    ],
  },
  {
    ...base,
    id: "b2",
    name: "خوراک",
    tag: null,
    template: null,
    periodStart: "2026-09-23",
    periodEnd: "2026-10-22",
    amountBase: "10000000",
    amountToman: "10000000",
    spentToman: "12000000",
    remainingToman: "-2000000",
    spentBase: "12000000",
    remainingBase: "-2000000",
    usage: 120,
    over: true,
    items: [],
  },
];

test("the budgets board renders both kinds", async () => {
  const { default: BudgetsView } = await import("../src/components/planning/BudgetsView");
  const html = renderToStaticMarkup(React.createElement(BudgetsView, { budgets: budgets as any, today: "2026-09-28" }));
  const visible = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  assert.ok(visible.includes("رویدادها و پروژه‌ها") && visible.includes("بودجه‌های ماهانه"));
  assert.ok(html.includes("--tone:#d9577a"), "the wedding card carries its colour");
  assert.ok(visible.includes("حلقه") && visible.includes("تالار"), "the lines render");
  assert.ok(html.includes("tags=%D8%B9%D8%B1%D9%88%D8%B3%DB%8C_%D8%AD%D9%84%D9%82%D9%87"), "a line links to «ثبت هزینه» with its tag");
  assert.ok(html.includes("irtAmount=30000000"), "the ring line prefills what is left under its ceiling (150M − 120M)");
  assert.ok(html.includes("irtAmount=285000000"), "the budget's own button prefills what is left of the whole budget");
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeURIComponent(m[1].replace(/&amp;/g, "&")));
  const linkFor = (tag: string) => hrefs.find((h) => h.startsWith("/new?") && h.includes(`tags=${tag}&`))!;
  assert.ok(linkFor("عروسی_تالار") && !linkFor("عروسی_تالار").includes("irtAmount"), "a line without a ceiling prefills no amount");
  assert.ok(visible.includes("خارج از سقف"), "the over-spent category says so");
  assert.ok(visible.includes("بیشتر از برآورد"), "a line that cost more than planned shows the gap");
  assert.ok(linkFor("عروسی_لباس") && !linkFor("عروسی_لباس").includes("irtAmount"), "an over-spent line prefills no amount");
  assert.ok(visible.includes("۹۳ روز مانده"), "the countdown to the event");
});
