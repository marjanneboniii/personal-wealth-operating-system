/**
 * Last-known-price resilience.
 *
 * When the live CoinGecko request succeeds, the quote is persisted as the
 * "last known price". If a later request fails (rate limit, network, outage),
 * the pricing boundary falls back to that persisted quote and reports the
 * freshness as "stale" so the UI can still show a market price instead of an
 * empty "Unavailable" cell. Coins that never had a successful quote remain
 * "unavailable" — the app never fabricates a price.
 */
import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { coingeckoPriceCache } from "../src/db/schema";
import { CoinGeckoClient } from "../src/features/pricing/coingecko";
import { clearCoinGeckoPriceCache, getCurrentUsdPrices } from "../src/features/pricing/service";

const identity = {
  assetId: "asset-btc",
  coingeckoId: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  logoUrl: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function failingClient(status: number) {
  return new CoinGeckoClient({
    apiKey: null,
    fetchImpl: async () => jsonResponse({}, status),
  });
}

function freshClient(price: number, observedAt: number) {
  return new CoinGeckoClient({
    apiKey: null,
    fetchImpl: async () => jsonResponse({ bitcoin: { usd: price, last_updated_at: observedAt } }),
  });
}

beforeEach(async () => {
  clearCoinGeckoPriceCache();
  await createSchemaIfNotExists();
  await db.delete(coingeckoPriceCache);
});

test("successful quote is persisted as the last-known price", async () => {
  const result = await getCurrentUsdPrices([identity], {
    now: 10_000,
    client: freshClient(100_000, 1_786_406_400),
    spotQuotes: null,
  });
  assert.equal(result.get("bitcoin")?.priceUsd, "100000");
  assert.equal(result.get("bitcoin")?.freshness, "fresh");

  const [row] = await db.select().from(coingeckoPriceCache);
  assert.equal(row?.coingeckoId, "bitcoin");
  assert.equal(row?.priceUsd, "100000");
});

test("outage after a successful quote falls back to the last-known price as Stale", async () => {
  await getCurrentUsdPrices([identity], {
    now: 10_000,
    client: freshClient(100_000, 1_786_406_400),
    spotQuotes: null,
  });

  // Simulate a fresh server instance: no in-memory cache, DB is the only source.
  clearCoinGeckoPriceCache();
  const result = await getCurrentUsdPrices([identity], {
    now: 99_999,
    client: failingClient(429),
    spotQuotes: null,
  });

  const point = result.get("bitcoin");
  assert.equal(point?.priceUsd, "100000");
  assert.equal(point?.freshness, "stale");
  assert.equal(point?.failureCode, "rate_limited");
});

test("live spot quote after CoinGecko outage is persisted as last-known", async () => {
  const result = await getCurrentUsdPrices([identity], {
    now: 30_000,
    client: failingClient(429),
    spotQuotes: {
      fetchUsdPrices: async () =>
        new Map([["bitcoin", { priceUsd: "98765", observedAt: "2026-08-20T00:00:00.000Z" }]]),
    },
  });
  assert.equal(result.get("bitcoin")?.priceUsd, "98765");
  assert.equal(result.get("bitcoin")?.freshness, "fresh");
  const [row] = await db.select().from(coingeckoPriceCache);
  assert.equal(row?.coingeckoId, "bitcoin");
  assert.equal(row?.priceUsd, "98765");
});

test("coin with no last-known price stays Unavailable on outage (never a guess)", async () => {
  clearCoinGeckoPriceCache();
  const result = await getCurrentUsdPrices([identity], {
    now: 20_000,
    client: failingClient(503),
    spotQuotes: null,
  });
  const point = result.get("bitcoin");
  assert.equal(point?.priceUsd, null);
  assert.equal(point?.freshness, "unavailable");
  assert.equal(point?.failureCode, "upstream_error");
  assert.equal((await db.select().from(coingeckoPriceCache)).length, 0);
});
