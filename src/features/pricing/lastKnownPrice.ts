/**
 * Last-known-price persistence boundary.
 *
 * This is the ONLY module in the pricing feature that touches the database.
 * It stores exclusively market-level public price data (a USD quote and its
 * observed-at timestamp) in the dedicated `coingecko_price_cache` table, keyed
 * by CoinGecko id. It never reads or writes users, holdings, transactions or
 * any accounting row — the pricing core (`coingecko.ts`, `service.ts`)
 * deliberately stays database-free.
 *
 * Every operation is wrapped so a database failure (or a missing migration)
 * degrades silently to the no-fallback behaviour instead of breaking a price
 * fetch.
 */
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { coingeckoPriceCache } from "@/db/schema";

export type LastKnownPrice = {
  priceUsd: string;
  observedAt: string;
};

/**
 * Upserts the freshly fetched quotes as the new last-known prices.
 * Best-effort: never fails the live price path because persistence failed.
 */
export async function persistLastKnownPrices(
  fetched: Map<string, LastKnownPrice>,
): Promise<void> {
  if (fetched.size === 0) return;
  const values = [...fetched.entries()].map(([coingeckoId, point]) => ({
    coingeckoId,
    priceUsd: point.priceUsd,
    observedAt: new Date(point.observedAt),
  }));
  try {
    await db
      .insert(coingeckoPriceCache)
      .values(values)
      .onConflictDoUpdate({
        target: coingeckoPriceCache.coingeckoId,
        set: {
          priceUsd: sql`excluded.price_usd`,
          observedAt: sql`excluded.observed_at`,
          updatedAt: sql`now()`,
        },
      });
  } catch {
    // Persistence is best-effort.
  }
}

/**
 * Reads last-known prices for the given ids in ONE batched query. Returns an
 * empty map if the cache table does not exist (migration not yet applied) or
 * the database is temporarily unavailable — callers then report the price as
 * unavailable rather than crashing.
 */
export async function readLastKnownPrices(
  ids: string[],
): Promise<Map<string, LastKnownPrice>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  try {
    const rows = await db
      .select()
      .from(coingeckoPriceCache)
      .where(inArray(coingeckoPriceCache.coingeckoId, unique));
    const map = new Map<string, LastKnownPrice>();
    for (const row of rows) {
      map.set(row.coingeckoId, {
        priceUsd: row.priceUsd,
        observedAt: row.observedAt
          ? new Date(row.observedAt).toISOString()
          : new Date().toISOString(),
      });
    }
    return map;
  } catch {
    return new Map();
  }
}
