/**
 * Asset picker catalog — regression coverage for the "only 4 symbols" bug.
 *
 * The transaction form could only offer BTC / ETH / USDT / SOL because those
 * four rows were the offline bootstrap list, and a failing CoinGecko sync
 * (blocked egress, rate limit) left them in place for 24h.
 *
 * These tests pin the fixed behaviour:
 *   1. the offline floor covers the full requested crypto list (incl. USDC,
 *      BNB, USDG, USDE, XAUT, PAXG, USDS, HYPE, CBBTC, WBTC);
 *   2. a failed sync lays down the offline floor and keeps retrying;
 *   3. legacy non-crypto rows (old RWA/tokenized identities) are dropped and
 *      can never surface in the picker;
 *   4. a bootstrap-only catalog keeps retrying instead of caching for a day;
 *   5. search reaches assets by symbol, name and CoinGecko id.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { coingeckoAssetCatalog } from "../src/db/schema";
import { CoinGeckoClient } from "../src/features/pricing/coingecko";
import {
  BOOTSTRAP_CATALOG_SIZE,
  ensureCoinGeckoCatalog,
  getMarketCatalogStatus,
  listCoinGeckoCatalog,
  listPricedCoinGeckoCatalog,
  refreshCoinGeckoCatalog,
} from "../src/features/pricing/catalog";
import { clearCoinGeckoPriceCache } from "../src/features/pricing/service";
import { SUPPORTED_CRYPTO_ASSETS } from "../src/features/pricing/supportedAssets";

function marketRow(id: string, symbol: string, name: string, rank: number | null) {
  return {
    id,
    symbol,
    name,
    image: `https://coin-images.coingecko.com/coins/images/1/large/${id}.png`,
    market_cap_rank: rank,
  };
}

function storedCatalogRow(id: string, symbol: string, name: string, rank: number, syncedAt: Date) {
  return {
    coingeckoId: id,
    symbol,
    name,
    logoUrl: `https://coin-images.coingecko.com/coins/images/1/large/${id}.png`,
    marketCapRank: rank,
    kind: "crypto",
    isActive: true,
    syncedAt,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes /coins/markets to the top-250 handler. */
function clientFor(handlers: { top?: () => Response }) {
  const fetchImpl: typeof fetch = async (input) => {
    const handler = handlers.top;
    if (!handler) return jsonResponse([], 503);
    return handler();
  };
  return new CoinGeckoClient({ fetchImpl, apiKey: null });
}

const REQUESTED_CRYPTO = SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.symbol);

beforeEach(async () => {
  clearCoinGeckoPriceCache();
  await createSchemaIfNotExists();
  await db.delete(coingeckoAssetCatalog);
});

test("offline bootstrap covers the full requested crypto list", async () => {
  // Upstream is down: this is exactly the state that produced the bug.
  const result = await refreshCoinGeckoCatalog(clientFor({}));
  assert.equal(result.status, "unavailable");

  const status = await getMarketCatalogStatus();
  assert.equal(status.total, BOOTSTRAP_CATALOG_SIZE);
  assert.ok(status.total > 4, "bootstrap must offer more than BTC/ETH/USDT/SOL");
  assert.equal(status.bootstrapOnly, true, "an offline floor must not look like a real sync");

  const rows = await listCoinGeckoCatalog("", 500);
  const symbols = rows.map((row) => row.symbol);
  for (const expected of REQUESTED_CRYPTO) {
    assert.ok(symbols.includes(expected), `requested crypto missing from offline catalog: ${expected}`);
    assert.equal(rows.find((r) => r.symbol === expected)?.kind, "crypto");
  }
});

test("unsupported DOT, DAI and ADA stay hidden even if old rows or upstream results contain them", async () => {
  await db.insert(coingeckoAssetCatalog).values([
    storedCatalogRow("polkadot", "DOT", "Polkadot", 30, new Date()),
    storedCatalogRow("dai", "DAI", "Dai", 21, new Date()),
    storedCatalogRow("cardano", "ADA", "Cardano", 17, new Date()),
  ]);

  assert.deepEqual(await listCoinGeckoCatalog("", 500), []);
  assert.equal((await getMarketCatalogStatus()).total, 0);

  await refreshCoinGeckoCatalog(
    clientFor({
      top: () => jsonResponse([
        marketRow("bitcoin", "btc", "Bitcoin", 1),
        marketRow("polkadot", "dot", "Polkadot", 30),
        marketRow("dai", "dai", "Dai", 21),
        marketRow("cardano", "ada", "Cardano", 17),
      ]),
    }),
  );

  const visible = await listCoinGeckoCatalog("", 500);
  assert.deepEqual(visible.map((row) => row.symbol), ["BTC"]);
  assert.equal((await getMarketCatalogStatus()).total, 1);
});

test("a failed sync upgrades the legacy four-row catalog to the complete offline floor", async () => {
  const recent = new Date();
  await db.insert(coingeckoAssetCatalog).values([
    storedCatalogRow("bitcoin", "BTC", "Bitcoin", 1, recent),
    storedCatalogRow("ethereum", "ETH", "Ethereum", 2, recent),
    storedCatalogRow("tether", "USDT", "Tether", 3, recent),
    storedCatalogRow("solana", "SOL", "Solana", 7, recent),
  ]);

  const result = await refreshCoinGeckoCatalog(clientFor({}));
  assert.equal(result.status, "stale");
  const symbols = (await listCoinGeckoCatalog("", 500)).map((row) => row.symbol);
  assert.equal(symbols.length, BOOTSTRAP_CATALOG_SIZE);
  for (const expected of REQUESTED_CRYPTO) {
    assert.ok(symbols.includes(expected), `legacy catalog was not repaired for ${expected}`);
  }
});

test("a bootstrap-only catalog keeps retrying instead of being cached for 24h", async () => {
  await refreshCoinGeckoCatalog(clientFor({})); // offline floor, epoch-stamped
  const bootstrapped = await getMarketCatalogStatus();
  assert.equal(bootstrapped.bootstrapOnly, true);
  assert.equal(bootstrapped.lastSyncedAt, null, "the floor must not advertise a sync time");

  // Upstream recovers. ensureCoinGeckoCatalog must go back out to the network
  // rather than treating the epoch-stamped rows as a fresh 24h-cached sync.
  let calls = 0;
  const recovered = clientFor({
    top: () => {
      calls++;
      return jsonResponse([
        marketRow("bitcoin", "btc", "Bitcoin", 1),
        marketRow("tether-gold", "xaut", "Tether Gold", 35),
      ]);
    },
  });
  const result = await refreshCoinGeckoCatalog(recovered);
  assert.equal(calls, 1);
  assert.equal(result.status, "partial");

  const status = await getMarketCatalogStatus();
  assert.equal(status.bootstrapOnly, false);
  assert.ok(status.lastSyncedAt instanceof Date);

  // A partially refreshed catalog observes the retry cooldown instead of
  // re-hitting CoinGecko on every request.
  await ensureCoinGeckoCatalog();
  assert.equal(calls, 1, "a partial catalog must observe the retry cooldown");
});

test("legacy non-crypto rows are dropped and never surface in the picker", async () => {
  // Simulate an old database that still holds RWA/tokenized identities.
  await db.insert(coingeckoAssetCatalog).values({
    coingeckoId: "blackrock-usd-institutional-digital-liquidity-fund",
    symbol: "BUIDL",
    name: "BlackRock USD Institutional Digital Liquidity Fund",
    logoUrl: "https://coin-images.coingecko.com/coins/images/36291/large/blackrock.png",
    marketCapRank: 33,
    kind: "tokenized",
    isActive: true,
  });

  await refreshCoinGeckoCatalog(
    clientFor({
      top: () => jsonResponse([marketRow("bitcoin", "btc", "Bitcoin", 1)]),
    }),
  );

  const rows = await listCoinGeckoCatalog("", 500);
  assert.equal(rows.some((r) => r.symbol === "BUIDL"), false, "legacy tokenized row must not surface");
  assert.ok(rows.every((r) => r.kind === "crypto"), "every catalog row must be crypto");

  const status = await getMarketCatalogStatus();
  assert.equal(status.total, 1);
  assert.equal(status.crypto, 1);
});

test("search reaches assets by symbol, name and CoinGecko id", async () => {
  await refreshCoinGeckoCatalog(
    clientFor({
      top: () =>
        jsonResponse([
          marketRow("bitcoin", "btc", "Bitcoin", 1),
          marketRow("hyperliquid", "hype", "Hyperliquid", 10),
          marketRow("pax-gold", "paxg", "PAX Gold", 42),
        ]),
    }),
  );

  assert.equal((await listCoinGeckoCatalog("hype"))[0]?.symbol, "HYPE");
  assert.equal((await listCoinGeckoCatalog("Hyperliquid"))[0]?.symbol, "HYPE");
  assert.equal((await listCoinGeckoCatalog("pax-gold"))[0]?.symbol, "PAXG");
  assert.equal((await listCoinGeckoCatalog("BTC"))[0]?.symbol, "BTC");
});

test("priced picker rows expose current USD price and graceful unavailable state", async () => {
  await refreshCoinGeckoCatalog(
    clientFor({
      top: () => jsonResponse([
        marketRow("bitcoin", "btc", "Bitcoin", 1),
        marketRow("hyperliquid", "hype", "Hyperliquid", 10),
      ]),
    }),
  );

  const priced = await listPricedCoinGeckoCatalog("", 50, {
    now: 10_000,
    client: new CoinGeckoClient({
      apiKey: null,
      fetchImpl: async () => jsonResponse({
        bitcoin: { usd: 64000, last_updated_at: 1_786_406_400 },
        hyperliquid: { usd: 58, last_updated_at: 1_786_406_400 },
      }),
    }),
  });
  assert.equal(priced.find((row) => row.symbol === "BTC")?.priceUsd, "64000");
  assert.equal(priced.find((row) => row.symbol === "BTC")?.priceFreshness, "fresh");
  assert.equal(priced.find((row) => row.symbol === "BTC")?.displayName, "بیت‌کوین");

  clearCoinGeckoPriceCache();
  const unavailable = await listPricedCoinGeckoCatalog("HYPE", 50, {
    now: 20_000,
    client: new CoinGeckoClient({ apiKey: null, fetchImpl: async () => jsonResponse({}, 429) }),
  });
  assert.equal(unavailable[0]?.priceUsd, null);
  assert.equal(unavailable[0]?.priceFreshness, "unavailable");
  assert.equal(unavailable[0]?.priceFailureCode, "rate_limited");
});

test("catalog sync never writes prices — identity columns only", async () => {
  await refreshCoinGeckoCatalog(
    clientFor({
      top: () =>
        jsonResponse([
          marketRow("bitcoin", "btc", "Bitcoin", 1),
          marketRow("pax-gold", "paxg", "PAX Gold", 42),
        ]),
    }),
  );
  const rows = await listCoinGeckoCatalog("", 50);
  for (const row of rows) {
    assert.equal(Object.hasOwn(row, "priceUsd"), false);
    assert.ok(/^https:\/\//.test(row.logoUrl));
  }
});
