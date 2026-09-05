/**
 * Installment schedule table — mobile layout regression (reported from a real
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

test("installments page marks the action wrapper with the row-actions class", () => {
  const src = page();
  assert.ok(
    src.includes("row-actions"),
    "the action wrapper must carry the semantic `row-actions` class so the " +
      "single-token-cell CSS rule applies to it",
  );
  // The class must be on the span that wraps BOTH action controls.
  const wrapper = src.match(/<span className="([^"]*row-actions[^"]*)">([\s\S]*?)<\/span>/);
  assert.ok(wrapper, "the row-actions wrapper is a <span> with the class in its className");
  assert.ok(
    /flex/.test(wrapper![1]),
    "the row-actions wrapper keeps its flex row layout",
  );
  assert.ok(
    wrapper![2].includes("RowAction"),
    "the quick-pay RowAction lives inside the row-actions wrapper",
  );
  assert.ok(
    /<Link[^>]*className="[^"]*btn[^"]*"/.test(wrapper![2]),
    "the «باز کردن در فرم» link-button lives inside the row-actions wrapper",
  );
});

test("the action <td> holds ONLY the row-actions span when pending (only-child requirement)", () => {
  const src = page();
  const td = src.match(/<td className="text-left">([\s\S]*?)<\/td>/);
  assert.ok(td, "the action <td className=\"text-left\"> exists in the schedule table");
  const inner = td![1];
  assert.ok(
    !/<span(?! className="[^"]*row-actions)/.test(inner),
    "no other <span> child may exist in the action <td> — the CSS rule requires " +
      ".row-actions to be the ONLY child of the cell",
  );
  assert.ok(
    /!\{r\.fx\.isPaid &&/.test(inner) || /isPaid/.test(inner),
    "the wrapper is rendered only for pending rows (paid rows keep an empty action cell)",
  );
});

test("scroll contract: the schedule table can reach max-content inside its card wrapper", () => {
  const cssCode = css();
  // The wrapper must let the table grow past the card (otherwise every column
  // is squeezed to fit the viewport and the text cells start wrapping).
  const m = cssCode.match(/\.card\.overflow-x-auto > \.table\s*\{([^}]*)\}/);
  assert.ok(m, ".card.overflow-x-auto > .table rule exists (the schedule table wrapper)");
  assert.ok(m[1].includes("width: max-content"), "the table may grow to its max-content width");
  assert.ok(
    /max-width:\s*none/.test(m[1]),
    "max-width:none beats `.table { max-width: 100% }` which squeezes columns",
  );

  const src = page();
  assert.ok(
    src.includes('className="card overflow-x-auto"'),
    "the schedule table must live in a `card overflow-x-auto` wrapper for the " +
      "max-content rule to apply",
  );
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
