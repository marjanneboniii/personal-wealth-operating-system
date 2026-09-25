/**
 * نمای بازار: صندوق و سهام بورسی · یک کادر سفید برای همهٔ لوگوها · ASTER/LIT/CAKE
 *
 * WHAT THIS PINS
 *   • Every Tehran-exchange fund and stock is a market row, with no price and
 *     the drawn mark of what it is — and only the market page lists them.
 *   • A row with no price is marked by a small icon with an accessible label,
 *     never by a sentence.
 *   • Every logo — drawn mark or real artwork — sits on ONE white plate whose
 *     radius is a quarter of its size; a caller's `radius` no longer rounds a
 *     coin into a circle.
 *   • ASTER, LIT and CAKE: supported, Persian-named, curated, with local logos.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tseMarketRows } from "../src/features/pricing/tseMarketRows";
import { FUND_CATALOG } from "../src/features/funds/catalogData";
import { STOCK_CATALOG } from "../src/features/funds/stockCatalogData";
import { MARKET_KIND_ORDER, WALLEX_KIND_LABELS, isCuratedCrypto } from "../src/features/pricing/wallexKinds";
import { getSupportedCryptoBySymbol } from "../src/features/pricing/supportedAssets";
import { marketLogoFor } from "../src/features/branding/marketLogos";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("every Tehran fund and stock is a priceless market row with its drawn mark", () => {
  const rows = tseMarketRows();
  const certificates = rows.filter((r) => r.kind === "ir_certificate");
  assert.equal(rows.length, FUND_CATALOG.length + certificates.length + STOCK_CATALOG.length);
  assert.deepEqual(
    certificates.map((c) => [c.displayName, c.logoUrl]),
    [["گواهی سپردهٔ شمش نقره", "mark:silver"], ["گواهی نفت دیجیتال", "mark:oil"]],
    "commodity certificates sit beside the funds, drawn by what they hold",
  );
  assert.equal(WALLEX_KIND_LABELS.ir_certificate, "گواهی کالایی");

  const funds = rows.filter((r) => r.kind === "ir_fund");
  const stocks = rows.filter((r) => r.kind === "ir_stock");
  assert.equal(funds.length, FUND_CATALOG.length);
  assert.equal(stocks.length, STOCK_CATALOG.length);

  for (const r of rows) {
    assert.equal(r.priceTmn, null, `${r.symbol}: no invented Toman price`);
    assert.equal(r.priceUsdt, null, `${r.symbol}: no invented Tether price`);
    assert.match(r.logoUrl ?? "", /^mark:/, `${r.symbol} uses a drawn mark`);
  }
  const eyar = funds.find((f) => f.symbol === "عیار");
  assert.equal(eyar?.logoUrl, "mark:fund-gold", "a gold fund gets the gold mark");
  assert.equal(stocks.find((s) => s.symbol === "فولاد")?.logoUrl, "mark:stock");

  assert.equal(WALLEX_KIND_LABELS.ir_fund, "صندوق بورسی");
  assert.equal(WALLEX_KIND_LABELS.ir_stock, "سهام بورسی");
  assert.ok(MARKET_KIND_ORDER.includes("ir_fund") && MARKET_KIND_ORDER.includes("ir_stock"));
});

test("only the market page lists them — never the transaction picker", () => {
  assert.match(read("src/app/market/page.tsx"), /\.\.\.tseMarketRows\(\)/);
  assert.doesNotMatch(read("src/components/assets/WallexAssetPicker.tsx"), /tseMarketRows/);
  assert.doesNotMatch(read("src/features/pricing/wallexCatalog.ts"), /tseMarketRows/, "not persisted");
});

test("a missing price is a small labelled icon, not a sentence", () => {
  for (const file of ["src/components/assets/MarketView.tsx", "src/components/assets/WallexAssetPicker.tsx"]) {
    const src = read(file);
    assert.match(src, /NoLivePrice/, `${file} uses the shared no-price marker`);
    assert.doesNotMatch(src, /قیمت زنده در دسترس نیست/, `${file}: no long sentence`);
  }
  const marker = read("src/components/assets/NoLivePrice.tsx");
  assert.match(marker, /aria-label=/, "the icon is labelled for screen readers");
  assert.match(marker, /title=/, "and explained on hover");
});

test("one white plate for every logo; a caller's radius cannot make a circle", () => {
  const src = read("src/components/ui/AssetLogo.tsx");
  assert.match(src, /export function plateRadius\(size: number\): number \{\s*return Math\.round\(\(size \* 12\) \/ 48\);/);
  assert.match(src, /const borderRadius = plateRadius\(size\);/);
  assert.match(src, /radius: _radius/, "the radius prop is accepted but not applied");
  assert.match(src, /background: "var\(--paper-000\)"/, "the plate is the white paper token");
  // Every branch — Toman, drawn marks, real artwork — renders through the plate.
  assert.equal((src.match(/return plate\(/g) ?? []).length, 4);
});

test("ASTER, LIT and CAKE are supported, curated, Persian-named, with logos", () => {
  const expected: Record<string, [string, string]> = {
    ASTER: ["aster-2", "آستر"],
    LIT: ["lighter", "لایتر"],
    CAKE: ["pancakeswap-token", "پنکیک‌سواپ"],
  };
  for (const [symbol, [id, fa]] of Object.entries(expected)) {
    const coin = getSupportedCryptoBySymbol(symbol);
    assert.equal(coin?.coingeckoId, id, `${symbol} maps to CoinGecko ${id}`);
    assert.equal(coin?.displayName, fa);
    assert.equal(isCuratedCrypto(symbol), true, `${symbol} is on the curated list`);
    assert.equal(marketLogoFor(symbol), `/icons/market/${symbol}.png`);
  }
});
