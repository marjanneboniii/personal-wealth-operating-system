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

/** Routes /coins/markets to the top-250 handler. */
function clientFor(handlers: { top?: () => Response }) {
  const fetchImpl: typeof fetch = async (input) => {
    const handler = handlers.top;
    if (!handler) return jsonResponse([], 503);
    return handler();
  };
  return new CoinGeckoClient({ fetchImpl, apiKey: null });
}

const REQUESTED_CRYPTO = ["USDC", "BNB", "USDG", "USDE", "XAUT", "PAXG", "USDS", "HYPE", "CBBTC", "WBTC"];

beforeEach(async () => {
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
  assert.equal(result.status, "fresh");

  const status = await getMarketCatalogStatus();
  assert.equal(status.bootstrapOnly, false);
  assert.ok(status.lastSyncedAt instanceof Date);

  // Now that the catalog is genuinely fresh, ensure() performs no extra call.
  await ensureCoinGeckoCatalog();
  assert.equal(calls, 1, "a fresh catalog must not re-hit CoinGecko");
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
