/**
 * نمای بازار: طلا، سکه، نقره، ارز و انرژی
 *
 * WHAT THIS PINS
 *   • Gold, coins, silver, cash currencies and oil are market rows with NO
 *     price — never a stale scraped number — each with a Persian name and a
 *     drawn mark of the app's own system (no flags, no photographs).
 *   • Every currency has a drawn sign or code; every mark key resolves.
 *   • Only the market page lists them — never the transaction picker.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { REFERENCE_GROUPS, referenceMarketRows } from "../src/features/pricing/referenceMarketRows";
import { MARKET_KIND_ORDER, WALLEX_KIND_LABELS } from "../src/features/pricing/wallexKinds";
import { FIAT_GLYPHS, FIAT_MARKS } from "../src/components/ui/AssetTypeMarks";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every reference row is priceless, Persian-named and drawn", () => {
  const rows = referenceMarketRows();
  assert.equal(rows.length, Object.values(REFERENCE_GROUPS).reduce((n, g) => n + g.length, 0));
  for (const r of rows) {
    assert.equal(r.priceTmn, null, `${r.symbol}: no invented Toman price`);
    assert.equal(r.priceUsdt, null, `${r.symbol}: no invented Tether price`);
    assert.match(r.displayName, /[؀-ۿ]/, `${r.symbol} has a Persian name`);
    assert.match(r.logoUrl ?? "", /^mark:/, `${r.symbol} uses a drawn mark`);
    assert.ok(MARKET_KIND_ORDER.includes(r.kind as never), `${r.kind} has a section`);
    assert.equal(r.kindLabel, WALLEX_KIND_LABELS[r.kind]);
  }
  const keys = rows.map((r) => `${r.kind}:${r.symbol}`);
  assert.equal(new Set(keys).size, keys.length, "no duplicate rows");

  const bySymbol = new Map(rows.map((r) => [r.symbol, r]));
  assert.equal(bySymbol.get("EMAMI")?.logoUrl, "mark:coin");
  assert.equal(bySymbol.get("NIM-BAHAR")?.logoUrl, "mark:coin-half");
  assert.equal(bySymbol.get("ROB-EMAMI")?.logoUrl, "mark:coin-quarter");
  assert.equal(bySymbol.get("EUR")?.displayName, "یورو");
  assert.equal(bySymbol.get("BRENT")?.kindLabel, "انرژی");
});

test("every currency row has a drawn sign or code", () => {
  for (const r of referenceMarketRows().filter((row) => row.kind === "fiat")) {
    assert.equal(r.logoUrl, `mark:fiat-${r.symbol}`);
    assert.ok(FIAT_GLYPHS[r.symbol], `${r.symbol} has a glyph`);
    assert.equal(typeof FIAT_MARKS[r.symbol], "function");
  }
  // A shared sign would make two currencies indistinguishable.
  const glyphs = Object.values(FIAT_GLYPHS);
  assert.equal(new Set(glyphs).size, glyphs.length, "every glyph names exactly one currency");
});

test("every mark key a reference row uses is drawn by AssetLogo", () => {
  const logo = read("src/components/ui/AssetLogo.tsx");
  const keys = new Set(referenceMarketRows().map((r) => r.logoUrl!.slice(5)).filter((k) => !k.startsWith("fiat-")));
  for (const key of keys) {
    assert.match(logo, new RegExp(`(^|\\s|")${key}"?:`, "m"), `KIND_MARKS has «${key}»`);
  }
  assert.match(logo, /markKey\.startsWith\("fiat-"\)/, "fiat marks resolve by ISO code");
});

test("only the market page lists them — never the picker, never persisted", () => {
  assert.match(read("src/app/market/page.tsx"), /\.\.\.referenceMarketRows\(\)/);
  assert.doesNotMatch(read("src/components/assets/WallexAssetPicker.tsx"), /referenceMarketRows/);
  assert.doesNotMatch(read("src/features/pricing/wallexCatalog.ts"), /referenceMarketRows/);
});
