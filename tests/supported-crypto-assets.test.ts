import assert from "node:assert/strict";
import { test } from "node:test";
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

test("supported crypto registry is the exact 24-asset product allowlist", () => {
  assert.equal(SUPPORTED_CRYPTO_ASSETS.length, 24);
  assert.deepEqual(
    Object.fromEntries(SUPPORTED_CRYPTO_ASSETS.map((asset) => [asset.symbol, asset.coingeckoId])),
    EXPECTED_MAPPING,
  );

  assert.equal(new Set(SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.symbol)).size, 24);
  assert.equal(new Set(SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.coingeckoId)).size, 24);
  assert.ok(SUPPORTED_CRYPTO_ASSETS.every((asset) => asset.displayName && /^https:\/\//.test(asset.logoUrl)));
});

test("symbol and CoinGecko-id lookups resolve the same fixed identity", () => {
  for (const [symbol, coingeckoId] of Object.entries(EXPECTED_MAPPING)) {
    assert.equal(getSupportedCryptoBySymbol(symbol.toLowerCase())?.coingeckoId, coingeckoId);
    assert.equal(getSupportedCryptoByCoinGeckoId(coingeckoId.toUpperCase())?.symbol, symbol);
  }
});

test("DOT, DAI and ADA are not supported for new registration", () => {
  for (const symbol of ["DOT", "DAI", "ADA"]) {
    assert.equal(getSupportedCryptoBySymbol(symbol), undefined);
  }
  for (const coingeckoId of ["polkadot", "dai", "cardano"]) {
    assert.equal(getSupportedCryptoByCoinGeckoId(coingeckoId), undefined);
  }
});
