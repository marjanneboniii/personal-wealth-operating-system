/**
 * Installment schedule — layout regression. The page now renders ONE list for
 * the web and the PWA (below). The table-cell CSS contract is kept because the
 * other tables in the app still rely on it.
 *
 * Original report — installment schedule table, mobile layout regression (reported from a real
 * iPhone PWA screenshot: the «باز کردن در فرم» / «پرداخت سریع» action buttons
 * were crushed into vertical letter-by-letter strips in the squeezed column).
 *
 * Root cause: the action cell carries a flex row with TWO buttons. The global
 * text-cell cap (`.table td:not(.td-num) { max-width: clamp(...) }`) is
 * narrower than both labels side-by-side, so with `white-space: normal` the
 * flex row shrinks the buttons and the Persian labels wrap — up to one
 * syllable per line.
 *
 * The fix reuses the repo's own single-token-cell pattern (status badges,
 * row actions, dates): the action cell is marked with the semantic
 * `row-actions` class and the stylesheet rule for single-token cells
 * (`white-space: nowrap; width: 1%`) covers it. `white-space` is inherited
 * into the buttons, so their min-content is the full label width; the table
 * already lives in a `.card.overflow-x-auto` wrapper at `width: max-content`,
 * so the column keeps its readable width and the container scrolls instead.
 *
 * This test locks every link of that chain (markup → CSS → scroll contract)
 * so the layout can never regress again.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

const css = () => fs.readFileSync(path.resolve(process.cwd(), "src/app/globals.css"), "utf-8");
const page = () =>
  fs.readFileSync(path.resolve(process.cwd(), "src/app/installments/page.tsx"), "utf-8");

/** Extract the rule body of the single-token-cell selector list. */
function singleTokenCellRule(cssCode: string): string {
  const m = cssCode.match(/\.table td:has\(> \.badge:only-child\)[^{]*\{([^}]*)\}/);
  assert.ok(m, "single-token-cell rule (td:has(> .badge:only-child) …) exists in globals.css");
  return m[1];
}

test("installments action cell is a single-token cell: nowrap + width:1%", () => {
  const rule = singleTokenCellRule(css());
  assert.ok(rule.includes("white-space: nowrap"), "single-token cells keep white-space: nowrap");
  assert.ok(rule.includes("width: 1%"), "single-token cells shrink to fit (width: 1%)");
});

test("single-token-cell rule covers the .row-actions wrapper (two-button action cell)", () => {
  const m = css().match(/\.table td:has\(> \.badge:only-child\)[^{]*\{([^}]*)\}/);
  assert.ok(m, "single-token-cell selector list exists");
  assert.ok(
    /table td:has\(> \.row-actions:only-child\)/.test(m[0]),
    "the .row-actions:only-child variant is part of the single-token-cell selector list — " +
      "without it the two-button action cell falls back to white-space:normal and the " +
      "labels wrap letter-by-letter in the squeezed column",
  );
});

test("installments render ONE list for the web and the PWA — no table, no second copy", () => {
  const src = page();
  assert.ok(!/<table\b/.test(src), "no schedule table: the same rows serve every screen width");
  assert.ok(!/sm:hidden|hidden sm:block/.test(src), "no layout switched by breakpoint — one markup, one copy of each row");
  assert.match(src, /className="inst-list"/, "the rows live in the installment list");
});

test("a pending row's actions sit on the row's foot, both inside one inst-actions wrapper", () => {
  const src = page();
  const wrapper = src.match(/<div className="inst-actions">([\s\S]*?)<\/div>/);
  assert.ok(wrapper, "the actions wrapper exists");
  assert.ok(/<Link[^>]*className="[^"]*btn[^"]*"/.test(wrapper![1]), "«باز کردن در فرم» is inside the wrapper");
  assert.ok(wrapper![1].includes("SettleObligationSheet"), "the settle control is inside the wrapper");
  assert.ok(/!r\.fx\.isPaid && \(\s*<div className="inst-actions">/.test(src), "only pending rows get actions");
});

test("action labels never wrap letter by letter; on a phone they split the row evenly", () => {
  const cssCode = css();
  assert.match(cssCode, /\.inst-actions \.btn\s*\{[^}]*white-space: nowrap/, "action buttons keep their label on one line");
  const mobile = cssCode.match(/@media \(max-width: 479px\)\s*\{\s*\.inst-actions\s*\{([^}]*)\}/);
  assert.ok(mobile, "a phone-width rule for the actions exists");
  assert.ok(/grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(mobile![1]), "two equal columns on a phone");
  assert.match(cssCode, /\.inst-title\s*\{[^}]*overflow-wrap: break-word/, "titles wrap by word, never anywhere");
});

test("table text cells wrap with break-word, never anywhere (letter-shredding regression)", () => {
  const cssCode = css();
  const m = cssCode.match(/\.table td > \*,\s*\.table th > \*\s*\{([^}]*)\}/);
  assert.ok(m, "the .table td > * / th > * text-cell rule exists");
  assert.ok(
    m[1].includes("overflow-wrap: break-word"),
    "table text cells use overflow-wrap: break-word",
  );
  assert.ok(
    !m[1].includes("anywhere"),
    "overflow-wrap: anywhere shatters Persian words letter-by-letter in narrow columns",
  );
});
