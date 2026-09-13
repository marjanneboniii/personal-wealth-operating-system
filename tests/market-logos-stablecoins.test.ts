/**
 * Market logos from CoinGecko, and the stablecoins USDe · USDG · PYUSD.
 *
 * WHAT THIS PINS
 *   • Every symbol in the logo map has a local 96px PNG under /public, so no
 *     row ever points at a missing file or at CoinGecko's CDN.
 *   • Oil (USOON) and natural gas (UNGON) keep their drawn marks: CoinGecko's
 *     artwork for both is the same issuer badge.
 *   • AssetLogo prefers the local logo, but an explicit user logo still wins.
 *   • PYUSD joins the supported list; USDe, USDG, PYUSD have Persian names,
 *     are stablecoins, and count as money (not investment) accounts.
 *   • USDe and PYUSD reach the market list with both prices from the feed.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import { MARKET_LOGO_SYMBOLS, marketLogoFor } from "../src/features/branding/marketLogos";
import { getSupportedCryptoBySymbol } from "../src/features/pricing/supportedAssets";
import { isLiquidAccount } from "../src/features/accounts/classification";

mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const root = new URL("../", import.meta.url);

test("every mapped logo is a real local PNG", () => {
  assert.ok(MARKET_LOGO_SYMBOLS.length >= 90, "the tokenised catalogue is covered");
  for (const symbol of MARKET_LOGO_SYMBOLS) {
    const path = marketLogoFor(symbol);
    assert.equal(path, `/icons/market/${symbol}.png`);
    const file = new URL(`public${path}`, root);
    assert.ok(existsSync(file), `${symbol}: ${path} exists`);
    const bytes = readFileSync(file);
    assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${symbol} is a PNG`);
  }
  assert.equal(marketLogoFor("aaplx"), "/icons/market/AAPLX.png", "lookup is case-insensitive");
  assert.equal(marketLogoFor("NOPE"), null);
});

test("oil and gas keep their drawn marks; the stablecoins have logos", () => {
  assert.equal(marketLogoFor("USOON"), null, "CoinGecko's USCF badge cannot tell oil from gas");
  assert.equal(marketLogoFor("UNGON"), null);
  for (const s of ["USDE", "USDG", "PYUSD", "SPYON", "AAPLX", "SLVON", "XAUT"]) {
    assert.ok(marketLogoFor(s), `${s} has a local logo`);
  }
});

test("AssetLogo prefers the local logo, never over an explicit user choice", () => {
  const src = readFileSync(new URL("src/components/ui/AssetLogo.tsx", root), "utf8");
  assert.match(src, /const marketLogo = input\.userLogoUrl \? null : marketLogoFor\(input\.symbol\)/);
  assert.match(src, /!input\.userLogoUrl && !marketLogo/, "a local logo pre-empts the drawn fallback");
});

test("USDe, USDG and PYUSD: supported, Persian-named, and counted as money", () => {
  const expected: Record<string, [string, string]> = {
    USDE: ["ethena-usde", "اتنا یو‌اس‌دی‌ای"],
    USDG: ["global-dollar", "گلوبال دلار"],
    PYUSD: ["paypal-usd", "پی‌پل یو‌اس‌دی"],
  };
  for (const [symbol, [id, fa]] of Object.entries(expected)) {
    const coin = getSupportedCryptoBySymbol(symbol);
    assert.ok(coin, `${symbol} is supported`);
    assert.equal(coin!.coingeckoId, id);
    assert.equal(coin!.displayName, fa, `${symbol} has its Persian name`);
    assert.doesNotMatch(coin!.displayName, /[A-Za-z]/, `${symbol}: no Latin in the display name`);
    assert.equal(isLiquidAccount({ symbol }), true, `${symbol} is a money account`);
  }
});

test("USDe and PYUSD come through the feed as stablecoins with both prices", async () => {
  const { AbanTetherProvider } = await import("../src/features/pricing/providers/abantether");
  const body = readFileSync(new URL("tests/fixtures/abantether-coins-rwa.json", root), "utf8");
  const provider = new AbanTetherProvider({
    fetchImpl: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
  });
  const entries = await provider.fetchMarketCatalog();
  for (const [symbol, fa] of [["USDE", "اتنا یو‌اس‌دی‌ای"], ["PYUSD", "پی‌پل یو‌اس‌دی"]] as const) {
    const row = entries.find((e: { symbol: string }) => e.symbol === symbol);
    assert.ok(row, `${symbol} is in the market list`);
    assert.equal(row!.kind, "stablecoin");
    assert.equal(row!.displayName, fa);
    assert.ok(row!.priceTmn && row!.priceUsdt, `${symbol} carries both prices`);
  }
  assert.ok(!entries.some((e: { symbol: string }) => e.symbol === "USDT" || e.symbol === "BTC"), "no second copy of a Wallex coin");
});
