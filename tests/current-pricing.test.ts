import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CoinGeckoClient, CoinGeckoRequestError } from "../src/features/pricing/coingecko";
import { clearCoinGeckoPriceCache, getCurrentUsdPrices } from "../src/features/pricing/service";

const identity = {
  assetId: "asset-btc",
  coingeckoId: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  logoUrl: null,
};

afterEach(clearCoinGeckoPriceCache);

function response(body: unknown, status = 200) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("CoinGecko current price is Fresh, then explicitly Stale after a failed refresh", async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls++;
    if (calls === 1) return response({ bitcoin: { usd: 100000, last_updated_at: 1_786_406_400 } });
    return response({}, 503);
  };
  const client = new CoinGeckoClient({ fetchImpl, apiKey: null });

  const fresh = await getCurrentUsdPrices([identity], { client, now: 1_000_000 });
  assert.equal(fresh.get("bitcoin")?.priceUsd, "100000");
  assert.equal(fresh.get("bitcoin")?.freshness, "fresh");

  const cached = await getCurrentUsdPrices([identity], { client, now: 1_030_000 });
  assert.equal(cached.get("bitcoin")?.freshness, "fresh");
  assert.equal(calls, 1, "market-level TTL cache avoids duplicate API calls");

  const stale = await getCurrentUsdPrices([identity], { client, now: 1_061_000 });
  assert.equal(stale.get("bitcoin")?.priceUsd, "100000");
  assert.equal(stale.get("bitcoin")?.freshness, "stale");
  assert.equal(stale.get("bitcoin")?.failureCode, "upstream_error");
});

test("CoinGecko outage without cache is Unavailable, never a manual fallback", async () => {
  const client = new CoinGeckoClient({ fetchImpl: async () => response({}, 429), apiKey: null });
  const result = await getCurrentUsdPrices([identity], { client, now: 2_000_000 });
  assert.equal(result.get("bitcoin")?.priceUsd, null);
  assert.equal(result.get("bitcoin")?.freshness, "unavailable");
  assert.equal(result.get("bitcoin")?.failureCode, "rate_limited");
});

test("timeout/network/invalid response/asset-not-found states are classified", async () => {
  const invalidClient = new CoinGeckoClient({ fetchImpl: async () => response("not-json"), apiKey: null });
  await assert.rejects(
    invalidClient.fetchUsdPrices(["bitcoin"]),
    (error: unknown) => error instanceof CoinGeckoRequestError && error.code === "invalid_response",
  );

  const networkClient = new CoinGeckoClient({ fetchImpl: async () => { throw new Error("offline"); }, apiKey: null });
  await assert.rejects(
    networkClient.fetchUsdPrices(["bitcoin"]),
    (error: unknown) => error instanceof CoinGeckoRequestError && error.code === "network_failure",
  );

  const timeoutClient = new CoinGeckoClient({
    timeoutMs: 2,
    apiKey: null,
    fetchImpl: ((_, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })) as typeof fetch,
  });
  await assert.rejects(
    timeoutClient.fetchUsdPrices(["bitcoin"]),
    (error: unknown) => error instanceof CoinGeckoRequestError && error.code === "timeout",
  );

  const missingClient = new CoinGeckoClient({ fetchImpl: async () => response({}), apiKey: null });
  const missing = await getCurrentUsdPrices([identity], { client: missingClient, now: 3_000_000 });
  assert.equal(missing.get("bitcoin")?.freshness, "unavailable");
  assert.equal(missing.get("bitcoin")?.failureCode, "asset_not_found");
});

test("API key is sent only in a server request header and never returned", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;
  const client = new CoinGeckoClient({
    apiKey: "server-secret",
    baseUrl: "https://example.test/api/v3",
    fetchImpl: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = init?.headers;
      return response({ bitcoin: { usd: 100000 } });
    },
  });
  const result = await client.fetchUsdPrices(["bitcoin"]);
  assert.equal(result.get("bitcoin")?.priceUsd, "100000");
  assert.equal(capturedUrl.includes("server-secret"), false);
  assert.equal((capturedHeaders as Record<string, string>)["x-cg-pro-api-key"], "server-secret");
  assert.equal(JSON.stringify([...result.entries()]).includes("server-secret"), false);
});
