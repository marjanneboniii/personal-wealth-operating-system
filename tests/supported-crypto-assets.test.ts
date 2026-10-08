import assert from "node:assert/strict";
import { test } from "node:test";
import { CRYPTO_GROUPS } from "../src/features/pricing/wallexKinds";
import { existsSync, readFileSync } from "node:fs";
import { marketLogoFor } from "../src/features/branding/marketLogos";
import {
  getSupportedCryptoByCoinGeckoId,
  getSupportedCryptoBySymbol,
  SUPPORTED_CRYPTO_ASSETS,
} from "../src/features/pricing/supportedAssets";

const EXPECTED_MAPPING: Record<string, string> = {
  USDT: "tether",
  BNB: "binancecoin",
  SOL: "solana",
  USDC: "usd-coin",
  XRP: "ripple",
  TRX: "tron",
  HYPE: "hyperliquid",
  DOGE: "dogecoin",
  USDS: "usds",
  XMR: "monero",
  LTC: "litecoin",
  USDE: "ethena-usde",
  AVAX: "avalanche-2",
  USDG: "global-dollar",
  PYUSD: "paypal-usd",
  ASTER: "aster-2",
  LIT: "lighter",
  CAKE: "pancakeswap-token",
  XAUT: "tether-gold",
  PAXG: "pax-gold",
  CBBTC: "coinbase-wrapped-btc",
  WBTC: "wrapped-bitcoin",
  ETH: "ethereum",
  BTC: "bitcoin",
};

test("supported crypto registry preserves existing identities and covers every market group", () => {
  for (const [symbol, id] of Object.entries(EXPECTED_MAPPING)) assert.equal(getSupportedCryptoBySymbol(symbol)?.coingeckoId, id);
  for (const symbol of Object.values(CRYPTO_GROUPS).flat()) assert.ok(getSupportedCryptoBySymbol(symbol), `${symbol} in market must be selectable in setup`);
  assert.ok(SUPPORTED_CRYPTO_ASSETS.length > 24);

  assert.equal(new Set(SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.symbol)).size, SUPPORTED_CRYPTO_ASSETS.length);
  assert.equal(new Set(SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.coingeckoId)).size, SUPPORTED_CRYPTO_ASSETS.length);
  assert.ok(SUPPORTED_CRYPTO_ASSETS.every((asset) => asset.displayName && /^https:\/\//.test(asset.logoUrl)));
});

test("symbol and CoinGecko-id lookups resolve the same fixed identity", () => {
  for (const [symbol, coingeckoId] of Object.entries(EXPECTED_MAPPING)) {
    assert.equal(getSupportedCryptoBySymbol(symbol.toLowerCase())?.coingeckoId, coingeckoId);
    assert.equal(getSupportedCryptoByCoinGeckoId(coingeckoId.toUpperCase())?.symbol, symbol);
  }
});

test("previously missing market coins have canonical identities, not same-symbol bridged tokens", () => {
  for (const [symbol, id] of Object.entries({ DOT: "polkadot", DAI: "dai", ADA: "cardano", DYDX: "dydx-chain", JUP: "jupiter-exchange-solana", MORPHO: "morpho" })) {
    assert.equal(getSupportedCryptoBySymbol(symbol)?.coingeckoId, id);
  }
});

test("CIRBTC is distinct from Coinbase wrapped BTC and has its official local artwork", () => {
  const circle = getSupportedCryptoBySymbol("cirbtc")!;
  assert.equal(circle.coingeckoId, "circle-wrapped-btc");
  assert.equal(circle.displayName, "بیت‌کوین رپ‌شدهٔ سیرکل");
  assert.notEqual(circle.coingeckoId, getSupportedCryptoBySymbol("CBBTC")?.coingeckoId);
  const path = marketLogoFor("cirbtc")!;
  const file = new URL(`../public${path}`, import.meta.url);
  assert.ok(existsSync(file));
  assert.equal(readFileSync(file).subarray(0, 3).toString("hex"), "ffd8ff");
});
