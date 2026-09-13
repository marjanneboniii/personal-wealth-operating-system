/**
 * نمای بازار — sections by kind, instant search, and no exchange names.
 *
 * WHAT THIS PINS
 *   • Meme coins have their own section; BTC stays «رمزارز».
 *   • Search is a pure in-memory ranking the browser runs — exact symbol, then
 *     prefix, then name — with Persian folding (Arabic ي/ك still match).
 *   • A client-facing market row carries no provenance field at all.
 *   • No screen that lists market symbols names an exchange.
 *   • The catalogue read never waits on the network once rows exist.
 *   • A refresh writes in batches rather than one statement per symbol.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFileSync } from "node:fs";
import { wallexAssetCatalog } from "../src/db/schema";
import { rankMarketRows, type MarketRow } from "../src/features/pricing/marketSearch";
import { kindOf } from "../src/features/pricing/providers/wallex";
import { MARKET_KIND_ORDER, WALLEX_KIND_LABELS } from "../src/features/pricing/wallexKinds";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const row = (symbol: string, displayName: string, kind: string, latinName = symbol): MarketRow => ({
  symbol,
  displayName,
  latinName,
  kind,
  kindLabel: WALLEX_KIND_LABELS[kind],
  logoUrl: null,
  priceTmn: "1",
  priceUsdt: "1",
});

test("meme coins get their own section, apart from crypto", () => {
  for (const s of ["DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "1BBABYDOGE", "PENGU"]) {
    assert.equal(kindOf(s, "whatever"), "meme", s);
  }
  assert.equal(kindOf("BTC", "Bitcoin"), "crypto");
  assert.equal(kindOf("ETH", "Ethereum"), "crypto");
  assert.equal(WALLEX_KIND_LABELS.meme, "میم‌کوین");
  assert.deepEqual(
    [...MARKET_KIND_ORDER],
    ["crypto", "meme", "stablecoin", "tokenized_stock", "index", "commodity", "bond", "gold"],
    "every section the user asked for, in a stable order",
  );
});

test("in-memory ranking: exact symbol, then prefix, then name — with Persian folding", () => {
  const rows = [
    row("DOGE", "دوج کوین", "meme", "Dogecoin"),
    row("DOGS", "داگز", "meme"),
    row("BTC", "بیت کوین", "crypto", "Bitcoin"),
    row("SPYON", "توکن صندوق اس‌اندپی ۵۰۰", "index", "SPDR S&P 500 Tokenized ETF (Ondo)"),
    row("PAXG", "پکس گلد", "gold", "Paxos Gold"),
  ];
  assert.deepEqual(
    rankMarketRows(rows, "DOG").slice(0, 2).map((r) => r.symbol).sort(),
    ["DOGE", "DOGS"],
    "both symbol prefixes lead",
  );
  assert.equal(rankMarketRows(rows, "doge")[0].symbol, "DOGE", "exact symbol wins, case-insensitive");
  assert.equal(rankMarketRows(rows, "dogs")[0].symbol, "DOGS");
  assert.equal(rankMarketRows(rows, "دوج")[0].symbol, "DOGE", "the Persian name finds it too");
  assert.equal(rankMarketRows(rows, "بیت")[0].symbol, "BTC");
  assert.equal(rankMarketRows(rows, "پكس")[0].symbol, "PAXG", "Arabic ك folds to ک");
  assert.equal(rankMarketRows(rows, "S&P")[0].symbol, "SPYON", "Latin name is searched too");
  assert.deepEqual(
    rankMarketRows(rows, "", { kinds: ["meme"] }).map((r) => r.symbol).sort(),
    ["DOGE", "DOGS"],
    "a section filter returns only that kind",
  );
});

test("ranking 2,000 rows per keystroke stays well under a frame", () => {
  const rows = Array.from({ length: 2000 }, (_, i) => row(`SYM${i}`, `نماد شماره ${i}`, "crypto", `Symbol ${i}`));
  const queries = ["س", "SYM1", "نماد", "Symbol 19", "zzz"];
  // The FASTEST of several rounds, not one wall-clock sample: a busy CI box
  // (or a build running alongside) can stall any single run, and that stall
  // says nothing about the ranking. The minimum is what the code costs.
  let best = Infinity;
  for (let round = 0; round < 7; round++) {
    const started = performance.now();
    for (const q of queries) rankMarketRows(rows, q);
    best = Math.min(best, (performance.now() - started) / queries.length);
  }
  assert.ok(best < 16, `ranking took ${best.toFixed(1)}ms per keystroke at best`);
});

test("no market screen names an exchange, and client rows carry no provenance", () => {
  const screens = [
    "src/components/assets/WallexAssetPicker.tsx",
    "src/components/assets/MarketView.tsx",
    "src/app/market/page.tsx",
    "src/components/forms/TransactionForm.tsx",
    "src/components/setup/SetupInstrumentsStep.tsx",
    "src/components/funds/AssetRegistrarTabs.tsx",
  ];
  for (const file of screens) {
    // Only rendered text matters — strip comments before looking.
    const code = read(file)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // Exchange NAMES only: «تبدیل» on its own is the ordinary word for a
    // conversion (the transfer form uses it), and «آبان» alone is a month.
    // Persian exchange names and exchange hosts — not code identifiers such as
    // the `WallexAssetPicker` component name, which the user never sees.
    assert.doesNotMatch(
      code,
      /والکس|آبان[\s‌]?تتر|رمزینکس|صرافی تبدیل|wallex\.ir|abantether\.com|tabdeal\.org|ramzinex\.com|saraf\.app|sourceLabel/i,
      file,
    );
  }

  const search = read("src/features/pricing/marketSearch.ts");
  const shape = search.match(/export type MarketRow = \{([\s\S]*?)\};/);
  assert.ok(shape, "MarketRow is declared");
  assert.doesNotMatch(shape![1], /source/, "the client-facing row has no source field");
});

test("the catalogue read never blocks on the network once rows exist; refresh writes in batches", () => {
  const src = read("src/features/pricing/wallexCatalog.ts");
  const ensure = src.match(/export async function ensureWallexCatalog[\s\S]*?\n}\n/);
  assert.ok(ensure, "ensureWallexCatalog exists");
  assert.match(ensure![0], /after\(task\)/, "a stale catalogue is refreshed after the response");
  assert.match(ensure![0], /status\.total === 0\)[\s\S]*?await refreshOnce\(\)/, "only an empty catalogue waits");

  assert.match(src, /UPSERT_CHUNK/, "a refresh upserts in chunks");
  assert.doesNotMatch(src, /for \(const entry of entries\) await/, "no per-symbol round-trips");

  // The purchase page no longer waits on a price catalogue before rendering.
  const page = read("src/app/new/page.tsx");
  assert.doesNotMatch(page, /ensureCoinGeckoCatalog|listPricedCoinGeckoCatalog/);
});

test("the market view is reachable from navigation", () => {
  const nav = read("src/lib/nav.ts");
  assert.match(nav, /href: "\/market"[\s\S]*?label: "نمای بازار"/);
  void wallexAssetCatalog;
});
