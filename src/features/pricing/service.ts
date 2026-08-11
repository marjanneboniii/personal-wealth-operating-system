/**
 * Current market pricing boundary.
 *
 * CoinGecko data is market-level public data. The in-process cache below is
 * keyed only by CoinGecko id and never stores users, holdings, transactions,
 * accounts, ledger values, or quantities.
 */
import { CoinGeckoClient, CoinGeckoRequestError } from "./coingecko";
import type { CoinGeckoPricePoint, MarketAssetIdentity, PriceFailureCode } from "./types";

const FRESH_TTL_MS = 60_000;

type CachedPrice = {
  priceUsd: string;
  observedAt: string;
  fetchedAt: string;
  expiresAt: number;
};

const publicPriceCache = new Map<string, CachedPrice>();

export function clearCoinGeckoPriceCache(): void {
  publicPriceCache.clear();
}

function failureCode(error: unknown): PriceFailureCode {
  return error instanceof CoinGeckoRequestError ? error.code : "network_failure";
}

export async function getCurrentUsdPrices(
  assets: MarketAssetIdentity[],
  options: { client?: CoinGeckoClient; now?: number } = {},
): Promise<Map<string, CoinGeckoPricePoint>> {
  const now = options.now ?? Date.now();
  const client = options.client ?? new CoinGeckoClient();
  const uniqueIds = [...new Set(assets.map((asset) => asset.coingeckoId).filter(Boolean))];
  const result = new Map<string, CoinGeckoPricePoint>();
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

  try {
    const fetched = await client.fetchUsdPrices(needsRefresh);
    const fetchedAt = new Date(now).toISOString();
    for (const id of needsRefresh) {
      const point = fetched.get(id);
      if (point) {
        const cached: CachedPrice = {
          ...point,
          fetchedAt,
          expiresAt: now + FRESH_TTL_MS,
        };
        publicPriceCache.set(id, cached);
        result.set(id, {
          coingeckoId: id,
          priceUsd: point.priceUsd,
          observedAt: point.observedAt,
          fetchedAt,
          freshness: "fresh",
        });
        continue;
      }

      const stale = publicPriceCache.get(id);
      result.set(id, stale
        ? {
            coingeckoId: id,
            priceUsd: stale.priceUsd,
            observedAt: stale.observedAt,
            fetchedAt: stale.fetchedAt,
            freshness: "stale",
            failureCode: "asset_not_found",
          }
        : {
            coingeckoId: id,
            priceUsd: null,
            observedAt: null,
            fetchedAt,
            freshness: "unavailable",
            failureCode: "asset_not_found",
          });
    }
  } catch (error) {
    const code = failureCode(error);
    for (const id of needsRefresh) {
      const stale = publicPriceCache.get(id);
      result.set(id, stale
        ? {
            coingeckoId: id,
            priceUsd: stale.priceUsd,
            observedAt: stale.observedAt,
            fetchedAt: stale.fetchedAt,
            freshness: "stale",
            failureCode: code,
          }
        : {
            coingeckoId: id,
            priceUsd: null,
            observedAt: null,
            fetchedAt: null,
            freshness: "unavailable",
            failureCode: code,
          });
    }
  }

  return result;
}
