/**
 * Coloured fills that carry text — ثبت تراکنش، دسته جدید، بودجه — must clear
 * WCAG AA (4.5:1) while the vivid hues themselves stay as they are.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { contrast, solidFor, INK_ON_LIGHT } from "../src/lib/toneColors";
import { EXPENSE_GROUP_LOOK, FALLBACK_LOOK, INCOME_GROUP_LOOK } from "../src/components/forms/txKit";
import { BUDGET_TEMPLATES } from "../src/features/planning/budgetTemplates";

const CSS = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
const AA = 4.5;

test("every category and budget hue gets a fill and text pair that clears AA", () => {
  const hues = [
    ...Object.values(EXPENSE_GROUP_LOOK).map((l) => l.color),
    ...Object.values(INCOME_GROUP_LOOK).map((l) => l.color),
    FALLBACK_LOOK.color,
    ...BUDGET_TEMPLATES.map((t) => t.tone),
    "#475569",
  ];
  for (const hue of hues) {
    const { solid, on } = solidFor(hue);
    assert.ok(contrast(solid, on) >= AA, `${hue}: ${on} on ${solid} is ${contrast(solid, on).toFixed(2)}`);
  }
});

test("bright hues keep their fill and take navy text; red and pink are deepened", () => {
  assert.deepEqual(solidFor("#f76b15"), { solid: "#f76b15", on: INK_ON_LIGHT });
  assert.deepEqual(solidFor("#12a594"), { solid: "#12a594", on: INK_ON_LIGHT });
  assert.deepEqual(solidFor("#3e63dd"), { solid: "#3e63dd", on: "#ffffff" });
  assert.equal(solidFor("#e5484d").on, "#ffffff");
  assert.notEqual(solidFor("#e5484d").solid, "#e5484d");
});

test("the transaction types' solid/on tokens in CSS clear AA", () => {
  const rules = [...CSS.matchAll(/--tx: var\(--kind-[a-z]+\); --tx-solid: (#[0-9a-f]{6}); --tx-on: (#[0-9a-f]{3,6});/g)].map(
    (m) => [m[0], "", m[1], m[2]] as const,
  );
  assert.equal(rules.length, 6, "one token set per transaction type");
  for (const [, , solid, on] of rules) {
    const full = on === "#fff" ? "#ffffff" : on;
    assert.ok(contrast(solid, full) >= AA, `${on} on ${solid} is ${contrast(solid, full).toFixed(2)}`);
  }
});

test("text on a type fill never hard-codes white", () => {
  const section = CSS.slice(CSS.indexOf("ثبت تراکنش (/new)"), CSS.indexOf(".ncat-actions"));
  assert.doesNotMatch(section, /background: var\(--tx\); color: #fff/);
  assert.doesNotMatch(section, /\.dark \.txr-cta[\s\S]{0,40}color: #0d1726/);
});

test("the history «+» button follows the app's own dark class, not the OS setting", () => {
  assert.doesNotMatch(CSS, /prefers-color-scheme: dark\) \{ :root:not\(\[data-theme="light"\]\) \.hist-fab/);
  assert.match(CSS, /\.dark \.hist-fab \{ color: #0d1726; \}/);
});

test("one colour per domain of money, the same in «ثبت تراکنش» and «سوابق گذشته»", () => {
  const kind = (name: string) => CSS.match(new RegExp(`:root \\{[^}]*--kind-${name}: (#[0-9a-f]{6})`))?.[1];
  assert.equal(kind("invest"), "#8e4ec6");
  assert.equal(kind("debt"), "#d6409f");
  // The form: buy and sell are both investment; orange is left to warnings.
  assert.match(CSS, /\.txr\[data-kind="buy"\][^{]*\{ --tx: var\(--kind-invest\)/);
  assert.match(CSS, /\.txr\[data-kind="sell"\][^{]*\{ --tx: var\(--kind-invest\)/);
  assert.doesNotMatch(CSS, /#f76b15; --tx-solid/);
  // History reads the same tokens, scoped to its own elements.
  assert.match(CSS, /\[data-kind="buy"\], \[data-kind="sell"\]\) \{ --tone: var\(--kind-invest\); \}/);
  assert.match(CSS, /\[data-kind="borrow"\], \[data-kind="repay"\]\) \{ --tone: var\(--kind-debt\); \}/);
  assert.doesNotMatch(CSS, /^\[data-kind/m, "no bare [data-kind] rule leaks to other pages");
});

test("history icons match the transaction form", () => {
  const history = readFileSync(new URL("../src/components/transactions/HistoryView.tsx", import.meta.url), "utf8");
  const kit = readFileSync(new URL("../src/components/forms/txKit.tsx", import.meta.url), "utf8");
  const iconOf = (src: string, re: RegExp) => src.match(re)?.[1];
  for (const [h, t] of [["expense", "expense"], ["income", "income"], ["transfer", "transfer"], ["buy", "buy"], ["sell", "sell"], ["repay", "debt_repayment"]]) {
    assert.equal(
      iconOf(history, new RegExp(`  ${h}: \\{ label: "[^"]+", icon: "([a-z-]+)"`)),
      iconOf(kit, new RegExp(`key: "${t}", label: "[^"]+", hint: "[^"]+", icon: "([a-z-]+)"`)),
      h,
    );
  }
});
