/**
 * Asset picker catalog — regression coverage for the "only 4 symbols" bug.
 *
 * The transaction form could only offer BTC / ETH / USDT / SOL because those
 * four rows were the offline bootstrap list, and a failing CoinGecko sync
 * (blocked egress, rate limit, one bad page) left them in place for 24h.
 *
 * These tests pin the fixed behaviour:
 *   1. the offline floor itself contains tokenized RWA identities;
 *   2. a partial upstream failure still registers the page that answered;
 *   3. the RWA category overrides "crypto" for assets present in both;
 *   4. a bootstrap-only catalog keeps retrying instead of caching for a day;
 *   5. search/filter reach tokenized assets by symbol, name and id.
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
  refreshCoinGeckoCatalog,
} from "../src/features/pricing/catalog";

function marketRow(id: string, symbol: string, name: string, rank: number | null) {
  return {
    id,
    symbol,
    name,
    image: `https://coin-images.coingecko.com/coins/images/1/large/${id}.png`,
    market_cap_rank: rank,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Routes /coins/markets by the presence of the RWA `category` parameter. */
function clientFor(handlers: {
  top?: () => Response;
  rwa?: () => Response;
}) {
  const fetchImpl: typeof fetch = async (input) => {
    const url = String(input);
    const isRwa = url.includes("category=real-world-assets-rwa");
    const handler = isRwa ? handlers.rwa : handlers.top;
    if (!handler) return jsonResponse([], 503);
    return handler();
  };
  return new CoinGeckoClient({ fetchImpl, apiKey: null });
}

beforeEach(async () => {
  await createSchemaIfNotExists();
  await db.delete(coingeckoAssetCatalog);
});

test("offline bootstrap is not four crypto symbols — it includes tokenized RWA identities", async () => {
  // Both upstream pages are down: this is exactly the state that produced the bug.
  const result = await refreshCoinGeckoCatalog(clientFor({}));
  assert.equal(result.status, "unavailable");

  const status = await getMarketCatalogStatus();
  assert.equal(status.total, BOOTSTRAP_CATALOG_SIZE);
  assert.ok(status.total > 4, "bootstrap must offer more than BTC/ETH/USDT/SOL");
  assert.ok(status.tokenized >= 10, `bootstrap must carry RWA identities, got ${status.tokenized}`);
  assert.equal(status.bootstrapOnly, true, "an offline floor must not look like a real sync");

  const tokenized = await listCoinGeckoCatalog("", 500, "tokenized");
  const symbols = tokenized.map((row) => row.symbol);
  for (const expected of ["PAXG", "XAUT", "BUIDL", "ONDO", "USDY"]) {
    assert.ok(symbols.includes(expected), `RWA symbol missing from offline catalog: ${expected}`);
  }
});

test("a partial upstream failure still registers the page that answered", async () => {
  const result = await refreshCoinGeckoCatalog(
    clientFor({
      top: () => jsonResponse([], 429), // rate limited
      rwa: () =>
        jsonResponse([
          marketRow("pax-gold", "paxg", "PAX Gold", 43),
          marketRow("ondo-finance", "ondo", "Ondo", 46),
        ]),
    }),
  );

  assert.equal(result.status, "partial");
  assert.deepEqual(result.failed, ["top"]);
  assert.equal(result.synced, 2);

  const status = await getMarketCatalogStatus();
  assert.equal(status.tokenized, 2);
  assert.equal(status.bootstrapOnly, false, "real rows must count as a genuine sync");
});

test("RWA category membership wins over a plain top-market crypto row", async () => {
  await refreshCoinGeckoCatalog(
    clientFor({
      top: () =>
        jsonResponse([
          marketRow("bitcoin", "btc", "Bitcoin", 1),
          marketRow("chainlink", "link", "Chainlink", 19),
        ]),
      rwa: () => jsonResponse([marketRow("chainlink", "link", "Chainlink", 19)]),
    }),
  );

  const [link] = await listCoinGeckoCatalog("chainlink", 5);
  assert.equal(link.kind, "tokenized", "an asset in the RWA category must be classified tokenized");

  const crypto = await listCoinGeckoCatalog("", 50, "crypto");
  assert.deepEqual(crypto.map((row) => row.symbol), ["BTC"]);
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
      return jsonResponse([marketRow("bitcoin", "btc", "Bitcoin", 1)]);
    },
    rwa: () => {
      calls++;
      return jsonResponse([marketRow("tether-gold", "xaut", "Tether Gold", 35)]);
    },
  });
  const result = await refreshCoinGeckoCatalog(recovered);
  assert.equal(calls, 2);
  assert.equal(result.status, "fresh");

  const status = await getMarketCatalogStatus();
  assert.equal(status.bootstrapOnly, false);
  assert.ok(status.lastSyncedAt instanceof Date);

  // Now that the catalog is genuinely fresh, ensure() performs no extra call.
  await ensureCoinGeckoCatalog();
  assert.equal(calls, 2, "a fresh catalog must not re-hit CoinGecko");
});

test("search reaches tokenized assets by symbol, name and CoinGecko id", async () => {
  await refreshCoinGeckoCatalog(
    clientFor({
      top: () => jsonResponse([marketRow("bitcoin", "btc", "Bitcoin", 1)]),
      rwa: () =>
        jsonResponse([
          marketRow(
            "blackrock-usd-institutional-digital-liquidity-fund",
            "buidl",
            "BlackRock USD Institutional Digital Liquidity Fund",
            33,
          ),
          marketRow("pax-gold", "paxg", "PAX Gold", 43),
        ]),
    }),
  );

  assert.equal((await listCoinGeckoCatalog("buidl"))[0]?.symbol, "BUIDL");
  assert.equal((await listCoinGeckoCatalog("BlackRock"))[0]?.symbol, "BUIDL");
  assert.equal((await listCoinGeckoCatalog("pax-gold"))[0]?.symbol, "PAXG");

  // The tokenized filter must exclude plain crypto entirely.
  const tokenizedOnly = await listCoinGeckoCatalog("", 50, "tokenized");
  assert.deepEqual(tokenizedOnly.map((r) => r.symbol).sort(), ["BUIDL", "PAXG"]);
  assert.equal(tokenizedOnly.some((r) => r.symbol === "BTC"), false);
});

test("catalog sync never writes prices — identity columns only", async () => {
  await refreshCoinGeckoCatalog(
    clientFor({
      top: () => jsonResponse([marketRow("bitcoin", "btc", "Bitcoin", 1)]),
      rwa: () => jsonResponse([marketRow("pax-gold", "paxg", "PAX Gold", 43)]),
    }),
  );
  const rows = await listCoinGeckoCatalog("", 50);
  for (const row of rows) {
    assert.equal(Object.hasOwn(row, "priceUsd"), false);
    assert.ok(/^https:\/\//.test(row.logoUrl));
  }
});
