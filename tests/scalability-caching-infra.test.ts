/**
 * Infrastructure upgrades for scale-out (thousands of users):
 *  1. DATABASE_POOL_MAX parsing & clamping (db/config).
 *  2. Modular rate-limit storage: in-memory default + graceful Redis fallback.
 *  3. Tenant-state cache invalidation (single→multi transitions are immediate).
 *  4. CoinGecko single-flight + post-failure cooldown (upstream 429 shielding).
 */
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  DEFAULT_DATABASE_POOL_MAX,
  PRODUCTION_DATABASE_POOL_MAX,
  MAX_DATABASE_POOL_MAX,
  MIN_DATABASE_POOL_MAX,
  resolvePoolMax,
} from "../src/db/config";
import {
  checkRateLimit,
  getRateLimitBackend,
  resetRateLimit,
} from "../src/lib/rateLimit";
import {
  authUsersExistCached,
  invalidateTenantStateCache,
  isMultiTenantCached,
  readTenantState,
} from "../src/lib/tenantState";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { users, coingeckoPriceCache } from "../src/db/schema";
import { CoinGeckoClient } from "../src/features/pricing/coingecko";
import { clearCoinGeckoPriceCache, getCurrentUsdPrices } from "../src/features/pricing/service";

/* ------------------------------------------------------------------ *
 * 1. Pool sizing
 * ------------------------------------------------------------------ */

test("pool max: env override with safe env-aware defaults and clamping", () => {
  // Defaults by environment.
  assert.equal(resolvePoolMax({}), DEFAULT_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ NODE_ENV: "production" }), PRODUCTION_DATABASE_POOL_MAX);
  // `next build` is not a production runtime → keeps the dev default.
  assert.equal(
    resolvePoolMax({ NODE_ENV: "production", NEXT_PHASE: "phase-production-build" }),
    DEFAULT_DATABASE_POOL_MAX,
  );

  // Explicit override.
  assert.equal(resolvePoolMax({ NODE_ENV: "production", DATABASE_POOL_MAX: "25" }), 25);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "3" }), 3);

  // Invalid / unsafe values fall back to the default or get clamped.
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "" }), DEFAULT_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "abc" }), DEFAULT_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "0" }), DEFAULT_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "-5" }), DEFAULT_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "NaN" }), DEFAULT_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "1" }), MIN_DATABASE_POOL_MAX);
  assert.equal(resolvePoolMax({ DATABASE_POOL_MAX: "999999" }), MAX_DATABASE_POOL_MAX);
});

/* ------------------------------------------------------------------ *
 * 2. Rate limiting — in-memory default
 * ------------------------------------------------------------------ */

test("rate limit: in-memory default enforces max attempts and resets", async () => {
  delete process.env.REDIS_URL;
  assert.equal(getRateLimitBackend(), "memory");

  const key = `memory-test-${Date.now()}`;
  let last: { ok: boolean; remaining: number } | null = null;
  for (let i = 0; i < 5; i++) {
    last = await checkRateLimit(key, 5, 60);
    assert.equal(last.ok, true);
  }
  assert.equal(last?.remaining, 0);
  const denied = await checkRateLimit(key, 5, 60);
  assert.equal(denied.ok, false);
  assert.equal(denied.remaining, 0);

  await resetRateLimit(key);
  const afterReset = await checkRateLimit(key, 5, 60);
  assert.equal(afterReset.ok, true);
  assert.equal(afterReset.remaining, 4);
});

test("rate limit: distinct keys are isolated", async () => {
  delete process.env.REDIS_URL;
  const stamp = Date.now();
  const a = await checkRateLimit(`iso-a-${stamp}`, 1, 60);
  const b = await checkRateLimit(`iso-b-${stamp}`, 1, 60);
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  const a2 = await checkRateLimit(`iso-a-${stamp}-2`, 1, 60); // another fresh key -> ok
  assert.equal(a2.ok, true);
});

test("rate limit: Redis unreachable degrades gracefully (no throw, no hang)", async () => {
  const previous = process.env.REDIS_URL;
  process.env.REDIS_URL = "redis://127.0.0.1:1"; // nothing listens on port 1
  try {
    const first = await checkRateLimit(`fallback-${Date.now()}`, 5, 60);
    assert.equal(first.ok, true);
    // The background connect fails fast and the module stays on memory.
    const second = await checkRateLimit(`fallback-${Date.now()}`, 5, 60);
    assert.equal(second.ok, true);
  } finally {
    if (previous === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = previous;
  }
});

/* ------------------------------------------------------------------ *
 * 3. Tenant-state cache — invalidation on user-table writes
 * ------------------------------------------------------------------ */

beforeEach(async () => {
  await createSchemaIfNotExists();
  await db.delete(users);
  await db.delete(coingeckoPriceCache);
  invalidateTenantStateCache();
  clearCoinGeckoPriceCache();
});

afterEach(() => {
  invalidateTenantStateCache();
  clearCoinGeckoPriceCache();
  delete process.env.REDIS_URL;
});

test("tenant-state cache: single→multi→auth transitions are visible after invalidation", async () => {
  invalidateTenantStateCache();
  const empty = await readTenantState();
  assert.equal(empty.userCount, 0);
  assert.equal(empty.authUsersExist, false);
  assert.equal(await isMultiTenantCached(), false);
  assert.equal(await authUsersExistCached(), false);

  // Legacy owner row (no username): still single-user, auth still disabled.
  const [legacy] = await db.insert(users).values({ name: "مالک خانواده", role: "owner" } as any).returning();
  invalidateTenantStateCache();
  const single = await readTenantState();
  assert.equal(single.userCount, 1);
  assert.equal(single.singleUserId, legacy.id);
  assert.equal(single.authUsersExist, false);

  // Second (username-bearing) user flips both flags — must be visible at once.
  await db.insert(users).values({ name: "Ali", username: "ali", role: "user" } as any);
  invalidateTenantStateCache();
  assert.equal(await isMultiTenantCached(), true);
  assert.equal(await authUsersExistCached(), true);

  // Deleting back to a single user is also reflected after invalidation.
  await db.delete(users);
  invalidateTenantStateCache();
  assert.equal(await isMultiTenantCached(), false);
});

/* ------------------------------------------------------------------ *
 * 4. CoinGecko — single-flight & 429 cooldown
 * ------------------------------------------------------------------ */

const identity = {
  assetId: "asset-btc",
  coingeckoId: "bitcoin",
  symbol: "BTC",
  name: "Bitcoin",
  logoUrl: null,
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("CoinGecko: concurrent identical requests share ONE upstream call (single-flight)", async () => {
  let calls = 0;
  const client = new CoinGeckoClient({
    apiKey: null,
    fetchImpl: async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 30));
      return jsonResponse({ bitcoin: { usd: 100000, last_updated_at: 1_786_406_400 } });
    },
  });

  const [first, second] = await Promise.all([
    getCurrentUsdPrices([identity], { client, now: 500_000, spotQuotes: null }),
    getCurrentUsdPrices([identity], { client, now: 500_000, spotQuotes: null }),
  ]);
  assert.equal(calls, 1, "concurrent same-id-set requests must coalesce into one upstream call");
  assert.equal(first.get("bitcoin")?.priceUsd, "100000");
  assert.equal(second.get("bitcoin")?.priceUsd, "100000");
  assert.equal(first.get("bitcoin")?.freshness, "fresh");
  assert.equal(second.get("bitcoin")?.freshness, "fresh");
});

test("CoinGecko: after a 429 the id stays out of upstream for the cooldown window", async () => {
  let calls = 0;
  const client = new CoinGeckoClient({
    apiKey: null,
    fetchImpl: async () => {
      calls++;
      return jsonResponse({}, 429);
    },
  });

  const first = await getCurrentUsdPrices([identity], { client, now: 1_000_000, spotQuotes: null });
  assert.equal(first.get("bitcoin")?.freshness, "unavailable");
  assert.equal(first.get("bitcoin")?.failureCode, "rate_limited");
  assert.equal(calls, 1);

  // Immediately following call: served from degradation, upstream untouched.
  const second = await getCurrentUsdPrices([identity], { client, now: 1_001_000, spotQuotes: null });
  assert.equal(second.get("bitcoin")?.freshness, "unavailable");
  assert.equal(second.get("bitcoin")?.failureCode, "rate_limited");
  assert.equal(calls, 1, "degraded id must not hit upstream again inside the cooldown");

  // Clearing the cache (as between requests / after a restart) lifts the cooldown.
  clearCoinGeckoPriceCache();
  const third = await getCurrentUsdPrices([identity], { client, now: 1_002_000, spotQuotes: null });
  assert.equal(calls, 2, "after clear a live refresh is attempted again");
  assert.equal(third.get("bitcoin")?.failureCode, "rate_limited");
});
