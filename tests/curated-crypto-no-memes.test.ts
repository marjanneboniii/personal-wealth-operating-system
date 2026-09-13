/**
 * رمزارز — a curated list, and no meme coins anywhere.
 *
 * WHAT THIS PINS
 *   • Meme coins never become market rows, whatever the feed lists.
 *   • A plain coin is a market row only when it is on the curated list
 *     (major · DeFi · classic · privacy).
 *   • Stablecoins, tokenised gold and tokenised stocks are NOT curated away.
 *   • The setup wizard's coin picker offers no meme coin.
 *   • The four groups carry the coins the product chose, with no overlap.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { WallexProvider, isListed } from "../src/features/pricing/providers/wallex";
import { CRYPTO_GROUPS, isCuratedCrypto, isMemeSymbol } from "../src/features/pricing/wallexKinds";

/** A minimal market in the live `/v1/markets` shape: TMN + USDT, priced. */
function market(base: string, fa: string, en: string, tmn: string, usdt: string) {
  const common = { baseAsset: base, faBaseAsset: fa, enBaseAsset: en };
  return {
    [`${base}TMN`]: { ...common, symbol: `${base}TMN`, quoteAsset: "TMN", stats: { lastPrice: tmn } },
    [`${base}USDT`]: { ...common, symbol: `${base}USDT`, quoteAsset: "USDT", stats: { lastPrice: usdt } },
  };
}

const FEED = {
  result: {
    symbols: {
      ...market("BTC", "بیت کوین", "Bitcoin", "17000000000", "76000"),
      ...market("UNI", "یونی سوآپ", "Uniswap", "1500000", "7"),
      ...market("XMR", "مونرو", "Monero", "70000000", "310"),
      ...market("XTZ", "تزوس", "Tezos", "150000", "0.7"),
      ...market("DOGE", "دوج کوین", "Dogecoin", "40000", "0.18"),
      ...market("PEPE", "پپه", "Pepe", "0.002", "0.00001"),
      ...market("AGLD", "ادونچر گلد", "Adventure Gold", "150000", "0.6"),
      ...market("AIXBT", "ای‌آی‌ایکس‌بی‌تی", "Aixbt", "20000", "0.09"),
      ...market("USDT", "تتر", "Tether", "230000", "1"),
      ...market("PAXG", "پکس گلد", "Paxos Gold", "900000000", "4000"),
      ...market("AAPLX", "اپل استاک", "Apple tokenized stock", "75000000", "330"),
    },
  },
};

test("the synced market list has no meme coin and no uncurated coin", async () => {
  const provider = new WallexProvider({
    fetchImpl: (async () => new Response(JSON.stringify(FEED), { status: 200 })) as unknown as typeof fetch,
  });
  const symbols = (await provider.fetchMarketCatalog()).map((e: { symbol: string }) => e.symbol).sort();
  assert.deepEqual(symbols, ["AAPLX", "BTC", "PAXG", "UNI", "USDT", "XMR", "XTZ"]);

  const searchable = (await provider.fetchCatalog()).map((e: { symbol: string }) => e.symbol).sort();
  assert.deepEqual(searchable, symbols, "the search catalogue applies the same rule");
});

test("isListed: memes never; plain coins only when curated; other kinds always", () => {
  assert.equal(isListed("DOGE", "meme"), false);
  assert.equal(isListed("BTC", "crypto"), true);
  assert.equal(isListed("AIXBT", "crypto"), false);
  assert.equal(isListed("USDC", "stablecoin"), true, "stablecoins are not curated away");
  assert.equal(isListed("XAUT", "gold"), true);
  assert.equal(isListed("SPYON", "index"), true);
});

test("the four groups hold the chosen coins, each exactly once", () => {
  const all = Object.values(CRYPTO_GROUPS).flat();
  assert.equal(new Set(all).size, all.length, "no coin sits in two groups");
  for (const s of ["BTC", "ETH", "SOL", "LINK"]) assert.ok((CRYPTO_GROUPS.major as readonly string[]).includes(s), `${s} is major`);
  for (const s of ["UNI", "AAVE", "CRV", "MORPHO"]) assert.ok((CRYPTO_GROUPS.defi as readonly string[]).includes(s), `${s} is DeFi`);
  for (const s of ["XMR", "ZEC", "DASH", "ZEN"]) assert.ok((CRYPTO_GROUPS.privacy as readonly string[]).includes(s), `${s} is privacy`);
  for (const s of all) assert.equal(isMemeSymbol(s), false, `${s} is not a meme coin`);
  assert.equal(isCuratedCrypto("btc"), true, "case-insensitive");
});

test("the setup wizard offers no meme coin", () => {
  const page = readFileSync(new URL("../src/app/setup/page.tsx", import.meta.url), "utf8");
  assert.match(page, /SUPPORTED_CRYPTO_ASSETS\.filter\(\(c\) => !isMemeSymbol\(c\.symbol\)\)/);
});
