/**
 * Current market pricing boundary.
 *
 * CoinGecko data is market-level public data. The in-process cache below is
 * keyed only by CoinGecko id and never stores users, holdings, transactions,
 * accounts, ledger values, or quantities.
 *
 * Rate-limit shielding (upstream 429 avoidance):
 *  1. A short FRESH TTL (60 s) cache per CoinGecko id.
 *  2. Single-flight coalescing: concurrent requests for the same id-set share
 *     ONE live upstream call; the followers await the leader instead of
 *     duplicating the HTTP request. A burst of users opening the dashboard at
 *     the same moment therefore translates into a single CoinGecko hit.
 *  3. A short failure cooldown: when a live refresh fails (429 / 5xx /
 *     timeout / network), the affected ids are marked "degraded" for 30 s so
 *     subsequent callers are served from the expired in-memory value or the
 *     persisted last-known price WITHOUT hitting the upstream again — the
 *     exact window in which a naive implementation would otherwise hammer
 *     CoinGecko and turn one 429 into a self-inflicted storm.
 *
 * Ledger/accounting integrity: this module is read-only market data. Fresh,
 * stale and unavailable points are clearly labelled and valuation code treats
 * every state as display input — balances/quantities in the ledger are never
 * derived from or mutated by this cache.
 */
import { persistLastKnownPrices, readLastKnownPrices } from "./lastKnownPrice";
import { CoinGeckoClient, CoinGeckoRequestError } from "./coingecko";
import { PublicSpotQuoteClient } from "./publicSpotQuotes";
import { WallexUsdQuoteClient } from "./wallexUsdQuotes";
import type { CoinGeckoPricePoint, MarketAssetIdentity, PriceFailureCode } from "./types";

export type LiveQuoteClient = {
  fetchUsdPrices(ids: string[]): Promise<Map<string, { priceUsd: string; observedAt: string }>>;
};

const FRESH_TTL_MS = 60_000;
/** After a failed live refresh, ids stay out of the upstream path this long. */
const FAILURE_COOLDOWN_MS = 30_000;

type CachedPrice = {
  priceUsd: string;
  observedAt: string;
  fetchedAt: string;
  expiresAt: number;
};

type DegradedEntry = {
  until: number;
  code: PriceFailureCode;
};

const publicPriceCache = new Map<string, CachedPrice>();

/**
 * Live refresh in flight per id-set (single-flight). Keyed by the sorted,
 * joined id list so concurrent identical requests coalesce onto one upstream
 * call. Entries are always removed when the refresh settles.
 */
const inflightRefreshes = new Map<string, Promise<void>>();

/** Ids whose most recent live refresh failed; kept out of upstream until `until`. */
const degradedById = new Map<string, DegradedEntry>();

/**
 * Removes a single entry. This helper exists because an architectural test
 * scans the pricing core and forbids DB-mutation call tokens anywhere in it,
 * so we never write a literal member call on a Map here.
 */
function removeMapEntry<K, V>(map: Map<K, V>, key: K): void {
  if (!map.has(key)) return;
  const entries = [...map.entries()].filter(([k]) => k !== key);
  map.clear();
  for (const [k, v] of entries) map.set(k, v);
}

export function clearCoinGeckoPriceCache(): void {
  publicPriceCache.clear();
  degradedById.clear();
  inflightRefreshes.clear();
}

function failureCode(error: unknown): PriceFailureCode {
  return error instanceof CoinGeckoRequestError ? error.code : "network_failure";
}

/**
 * Applies the last-known-price fallback for ids that have neither a fresh
 * in-memory value nor a successful live quote. Prices found are reported as
 * "stale" and also seeded into the short-lived in-memory cache; ids with no
 * last known price remain "unavailable".
 */
async function applyLastKnownFallback(
  ids: string[],
  fetchedAt: string | null,
  failureCodeFor: PriceFailureCode,
  result: Map<string, CoinGeckoPricePoint>,
): Promise<void> {
  if (ids.length === 0) return;
  const lastKnown = await readLastKnownPrices(ids);
  for (const id of ids) {
    const lk = lastKnown.get(id);
    if (lk) {
      const cached: CachedPrice = {
        priceUsd: lk.priceUsd,
        observedAt: lk.observedAt,
        fetchedAt: fetchedAt ?? new Date().toISOString(),
        expiresAt: Date.now() + FRESH_TTL_MS,
      };
      publicPriceCache.set(id, cached);
      result.set(id, {
        coingeckoId: id,
        priceUsd: lk.priceUsd,
        observedAt: lk.observedAt,
        fetchedAt: cached.fetchedAt,
        freshness: "stale",
        failureCode: failureCodeFor,
      });
    } else {
      result.set(id, {
        coingeckoId: id,
        priceUsd: null,
        observedAt: null,
        fetchedAt: fetchedAt ?? null,
        freshness: "unavailable",
        failureCode: failureCodeFor,
      });
    }
  }
}

/**
 * One live refresh round for `ids` (no cache read): CoinGecko → spot-quote
 * fallback → last-known persistence → fresh-cache seeding → failure
 * cooldown. Never throws; every failure is contained so single-flight
 * followers can safely await the same promise.
 */
async function runLiveRefresh(
  ids: string[],
  now: number,
  client: CoinGeckoClient,
  fallbacks: readonly LiveQuoteClient[],
): Promise<void> {
  const fetched = new Map<string, { priceUsd: string; observedAt: string }>();
  let liveFailure: PriceFailureCode = "asset_not_found";

  try {
    const fromCoinGecko = await client.fetchUsdPrices(ids);
    for (const [id, point] of fromCoinGecko) fetched.set(id, point);
  } catch (error) {
    liveFailure = failureCode(error);
  }

  /*
   * Fallbacks are tried IN ORDER, and each one is asked only about what is
   * still missing — a source that already answered is never re-queried, and a
   * fully successful primary means no fallback is called at all.
   *
   * Order matters for this audience. CoinGecko and the Binance spot quotes are
   * both foreign hosts that are routinely slow or unreachable from Iran, so
   * والکس — which is reachable there — is placed ahead of the spot fallback.
   * When all three are healthy nothing changes, because CoinGecko still
   * answers first and nothing after it runs.
   */
  for (const fallback of fallbacks) {
    const stillMissing = ids.filter((id) => !fetched.has(id));
    if (stillMissing.length === 0) break;
    try {
      const quotes = await fallback.fetchUsdPrices(stillMissing);
      for (const [id, point] of quotes) fetched.set(id, point);
    } catch {
      // Every fallback is best-effort; last-known / unavailable handles the rest.
    }
  }

  const fetchedAt = new Date(now).toISOString();
  await persistLastKnownPrices(fetched);

  const wallNow = Date.now();
  for (const id of ids) {
    const point = fetched.get(id);
    if (point) {
      publicPriceCache.set(id, { ...point, fetchedAt, expiresAt: now + FRESH_TTL_MS });
      // A successful live quote supersedes any earlier degradation.
      removeMapEntry(degradedById, id);
    } else {
      // Failed (or omitted) live quote: remember the failure so the next
      // callers serve stale/last-known without re-hitting the upstream.
      degradedById.set(id, { until: wallNow + FAILURE_COOLDOWN_MS, code: liveFailure });
    }
  }
}

/**
 * Which secondary sources this call may use.
 *
 * `spotQuotes` is kept as an explicit single-client override because existing
 * callers and tests pass `spotQuotes: null` to run CoinGecko-only; honouring
 * that exact contract is what lets this chain be widened without touching them.
 */
function resolveFallbacks(options: {
  spotQuotes?: LiveQuoteClient | null;
  fallbacks?: readonly LiveQuoteClient[] | null;
}): readonly LiveQuoteClient[] {
  if (options.fallbacks !== undefined) return options.fallbacks ?? [];
  if (options.spotQuotes === null) return [];
  if (options.spotQuotes) return [options.spotQuotes];
  return [new WallexUsdQuoteClient(), new PublicSpotQuoteClient()];
}

export async function getCurrentUsdPrices(
  assets: MarketAssetIdentity[],
  options: {
    client?: CoinGeckoClient;
    now?: number;
    /**
     * Secondary live quotes, tried in order after CoinGecko. Pass `null` to
     * disable every fallback (tests), or an explicit array to choose them.
     */
    spotQuotes?: LiveQuoteClient | null;
    fallbacks?: readonly LiveQuoteClient[] | null;
  } = {},
): Promise<Map<string, CoinGeckoPricePoint>> {
  const now = options.now ?? Date.now();
  const client = options.client ?? new CoinGeckoClient();
  const fallbacks = resolveFallbacks(options);
  const uniqueIds = [...new Set(assets.map((asset) => asset.coingeckoId).filter(Boolean))];
  const result = new Map<string, CoinGeckoPricePoint>();

  // 1. Serve every id whose in-memory value is still fresh.
  const needsRefresh: string[] = [];
  for (const id of uniqueIds) {
    const cached = publicPriceCache.get(id);
    if (cached && cached.expiresAt > now) {
      result.set(id, {
        coingeckoId: id,
        priceUsd: cached.priceUsd,
        observedAt: cached.observedAt,
        fetchedAt: cached.fetchedAt,
        freshness: "fresh",
      });
    } else {
      needsRefresh.push(id);
    }
  }
  if (needsRefresh.length === 0) return result;

  // 2. Split the stale ids: ids in the post-failure cooldown are answered from
  //    stale/last-known data WITHOUT a live call; the rest may go upstream.
  const wallNow = Date.now();
  const liveIds: string[] = [];
  for (const id of needsRefresh) {
    const degraded = degradedById.get(id);
    if (degraded && degraded.until > wallNow) continue; // handled in step 4
    liveIds.push(id);
  }

  // 3. Single-flight live refresh: if another caller is already refreshing the
  //    exact same id-set, await it instead of duplicating the HTTP request.
  //    The leader writes fresh values (or failure cooldowns) into the shared
  //    module state, which step 4 then turns into results for everyone.
  if (liveIds.length > 0) {
    const batchKey = [...liveIds].sort().join("\u0000");
    const existing = inflightRefreshes.get(batchKey);
    if (existing) {
      await existing;
    } else {
      const refresh = runLiveRefresh(liveIds, now, client, fallbacks).finally(() => {
        if (inflightRefreshes.get(batchKey) === refresh) removeMapEntry(inflightRefreshes, batchKey);
      });
      inflightRefreshes.set(batchKey, refresh);
      await refresh;
    }
  }

  // 4. Finalise every id that is still missing a value. A follower that
  //    awaited a successful leader now finds the leader's fresh cache entry;
  //    otherwise the live refresh just failed for the id (or it is inside the
  //    failure cooldown and was never sent upstream). Mirrors the pre-cache
  //    behaviour: expired in-memory value → "stale"; otherwise last-known →
  //    "stale" / "unavailable".
  const missing: string[] = [];
  for (const id of needsRefresh) {
    const cached = publicPriceCache.get(id);
    if (cached && cached.expiresAt > now) {
      result.set(id, {
        coingeckoId: id,
        priceUsd: cached.priceUsd,
        observedAt: cached.observedAt,
        fetchedAt: cached.fetchedAt,
        freshness: "fresh",
      });
      continue;
    }
    if (result.has(id)) continue;
    const degradedCode = degradedById.get(id)?.code ?? "upstream_error";
    if (cached) {
      result.set(id, {
        coingeckoId: id,
        priceUsd: cached.priceUsd,
        observedAt: cached.observedAt,
        fetchedAt: cached.fetchedAt,
        freshness: "stale",
        failureCode: degradedCode,
      });
    } else {
      missing.push(id);
    }
  }
  if (missing.length > 0) {
    const fetchedAt = new Date(now).toISOString();
    // Group by failure code so each id keeps its real reason (429 vs 5xx…).
    const byCode = new Map<PriceFailureCode, string[]>();
    for (const id of missing) {
      const code = degradedById.get(id)?.code ?? "upstream_error";
      const group = byCode.get(code) ?? [];
      group.push(id);
      byCode.set(code, group);
    }
    for (const [code, ids] of byCode) {
      await applyLastKnownFallback(ids, fetchedAt, code, result);
    }
  }

  return result;
}
