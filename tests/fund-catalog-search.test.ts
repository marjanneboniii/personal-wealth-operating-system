/**
 * The fund catalogue and its Persian search.
 *
 * Search ranking is the part that decides whether the picker feels broken.
 * «زر» and «زرفام» are both real gold funds three letters apart, and a user
 * who registers the wrong one only finds out after attaching transactions to
 * it — so an exact symbol has to win, every time.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FUND_CATALOG,
  FUND_BY_SYMBOL,
  FUND_KIND_LABELS,
} from "../src/features/funds/catalogData";
import { foldPersian, searchFunds } from "../src/features/funds/search";

test("every fund the brief names by name is in the catalogue", () => {
  // کهربا، زر، گوهر، گنج، عیار، مثقال، نفیس — quoted verbatim from the brief.
  for (const symbol of ["کهربا", "زر", "گوهر", "گنج", "عیار", "مثقال", "نفیس"]) {
    const fund = FUND_BY_SYMBOL.get(symbol);
    assert.ok(fund, `«${symbol}» is missing from the catalogue`);
    assert.equal(fund.kind, "gold", `«${symbol}» should be a gold fund`);
  }
});

test("the three sub-kinds the brief separates are all present and Persian", () => {
  const kinds = new Set(FUND_CATALOG.map((f) => f.kind));
  assert.deepEqual([...kinds].sort(), ["etf", "fixed_income", "gold"]);
  for (const [, label] of Object.entries(FUND_KIND_LABELS)) {
    assert.ok(/[؀-ۿ]/.test(label), `kind label «${label}» is not Persian`);
  }
  for (const fund of FUND_CATALOG) {
    assert.ok(/[؀-ۿ]/.test(fund.symbol), `symbol «${fund.symbol}» is not Persian`);
    assert.ok(/[؀-ۿ]/.test(fund.name), `name «${fund.name}» is not Persian`);
  }
});

test("symbols are unique — two funds must never collide on one identity", () => {
  const symbols = FUND_CATALOG.map((f) => f.symbol);
  assert.equal(new Set(symbols).size, symbols.length, "duplicate symbol in the catalogue");
});

test("an exact symbol outranks a longer one that merely starts with it", () => {
  const hits = searchFunds("زر");
  assert.equal(hits[0].symbol, "زر", `expected «زر» first, got «${hits[0].symbol}»`);
  // …but the near-miss is still offered, because the user may have meant it.
  assert.ok(hits.some((h) => h.symbol === "زرفام"));
});

test("search forgives an Arabic keyboard and a stray ZWNJ", () => {
  // ک and ی typed as ك and ي is the single most common Persian input issue.
  assert.equal(searchFunds("كهربا")[0].symbol, "کهربا");
  assert.equal(searchFunds("کهربا")[0].symbol, "کهربا");
  // A pasted ZWNJ or an extra space must not hide the result.
  assert.equal(searchFunds("زر‌افشان").length > 0, true);
  assert.equal(searchFunds("  عیار  ")[0].symbol, "عیار");
});

test("a name match is found even when the symbol does not contain the query", () => {
  const hits = searchFunds("مفید");
  assert.ok(hits.length > 0, "«مفید» appears in fund names but matched nothing");
  assert.ok(hits.every((h) => h.name.includes("مفید")));
});

test("the kind filter narrows the picker to one sub-kind", () => {
  const gold = searchFunds("", { kind: "gold", limit: 50 });
  assert.ok(gold.length > 0);
  assert.equal(gold.every((f) => f.kind === "gold"), true);

  const fixed = searchFunds("", { kind: "fixed_income", limit: 50 });
  assert.equal(fixed.every((f) => f.kind === "fixed_income"), true);
  assert.equal(
    gold.some((g) => fixed.some((f) => f.symbol === g.symbol)),
    false,
    "the sub-kinds must not overlap",
  );
});

test("an empty query shows all three families, not twelve gold funds", () => {
  // The catalogue is ordered gold-first, so a plain slice made the «همه» tab
  // look like the product only supported طلا. Caught by rendering the screen.
  const hits = searchFunds("", { limit: 9 });
  assert.ok(hits.length > 0, "a blank box should show options, not a void");
  assert.ok(hits.length <= 9, "default listing is capped");
  assert.deepEqual(
    [...new Set(hits.map((h) => h.kind))].sort(),
    ["etf", "fixed_income", "gold"],
    "every sub-kind must be visible before the user types",
  );
});

test("a kind filter with an empty query stays inside that kind", () => {
  const gold = searchFunds("", { kind: "gold", limit: 6 });
  assert.equal(gold.every((f) => f.kind === "gold"), true);
  assert.equal(gold.length, 6);
});

test("a query that matches nothing returns nothing — never a wrong fund", () => {
  assert.deepEqual(searchFunds("قطعاً چنین صندوقی وجود ندارد"), []);
});

test("folding is for matching only — display text is never altered", () => {
  assert.equal(foldPersian("كهربا"), foldPersian("کهربا"));
  assert.equal(foldPersian("زر افشان"), foldPersian("زرافشان"));
  // The catalogue entry that comes back is the untouched original.
  assert.equal(searchFunds("كهربا")[0].name, FUND_BY_SYMBOL.get("کهربا")!.name);
});

test("every result carries its Persian kind label for the UI", () => {
  for (const hit of searchFunds("", { limit: 50 })) {
    assert.equal(hit.kindLabel, FUND_KIND_LABELS[hit.kind]);
  }
});
