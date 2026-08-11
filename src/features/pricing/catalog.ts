import { asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { coingeckoAssetCatalog } from "@/db/schema";
import { CoinGeckoClient } from "./coingecko";
import type { CoinGeckoCatalogAsset } from "./types";

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** Offline bootstrap only; current prices are never sourced from this list. */
const CANONICAL_IDENTITIES: CoinGeckoCatalogAsset[] = [
  { coingeckoId: "bitcoin", symbol: "BTC", name: "Bitcoin", logoUrl: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png", marketCapRank: 1, kind: "crypto" },
  { coingeckoId: "ethereum", symbol: "ETH", name: "Ethereum", logoUrl: "https://assets.coingecko.com/coins/images/279/large/ethereum.png", marketCapRank: 2, kind: "crypto" },
  { coingeckoId: "tether", symbol: "USDT", name: "Tether", logoUrl: "https://assets.coingecko.com/coins/images/325/large/Tether.png", marketCapRank: 3, kind: "crypto" },
  { coingeckoId: "solana", symbol: "SOL", name: "Solana", logoUrl: "https://assets.coingecko.com/coins/images/4128/large/solana.png", marketCapRank: 4, kind: "crypto" },
];

async function upsertCatalog(rows: CoinGeckoCatalogAsset[]): Promise<void> {
  const syncedAt = new Date();
  for (const row of rows) {
    await db
      .insert(coingeckoAssetCatalog)
      .values({ ...row, syncedAt, isActive: true })
      .onConflictDoUpdate({
        target: coingeckoAssetCatalog.coingeckoId,
        set: {
          symbol: row.symbol,
          name: row.name,
          logoUrl: row.logoUrl,
          marketCapRank: row.marketCapRank,
          // An RWA-category membership is more specific than top-150 crypto.
          kind: row.kind,
          isActive: true,
          syncedAt,
        },
      });
  }
}

/**
 * Synchronizes top-150 crypto plus CoinGecko's RWA category. Failure is
 * graceful: previously registered identities remain available and are never
 * mistaken for current price data.
 */
export async function refreshCoinGeckoCatalog(
  client = new CoinGeckoClient(),
): Promise<{ synced: number; status: "fresh" | "stale" | "unavailable" }> {
  try {
    const [top, rwa] = await Promise.all([client.fetchTopAssets(150), client.fetchRwaAssets()]);
    const merged = new Map<string, CoinGeckoCatalogAsset>();
    for (const row of top) merged.set(row.coingeckoId, row);
    for (const row of rwa) merged.set(row.coingeckoId, row);
    await upsertCatalog([...merged.values()]);
    return { synced: merged.size, status: "fresh" };
  } catch {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(coingeckoAssetCatalog);
    if (!count) await upsertCatalog(CANONICAL_IDENTITIES);
    return { synced: 0, status: count ? "stale" : "unavailable" };
  }
}

export async function ensureCoinGeckoCatalog(): Promise<void> {
  const [latest] = await db
    .select({ syncedAt: coingeckoAssetCatalog.syncedAt, count: sql<number>`count(*)::int` })
    .from(coingeckoAssetCatalog)
    .groupBy(coingeckoAssetCatalog.syncedAt)
    .orderBy(desc(coingeckoAssetCatalog.syncedAt))
    .limit(1);

  if (!latest || Date.now() - latest.syncedAt.getTime() > CATALOG_TTL_MS) {
    await refreshCoinGeckoCatalog();
  }
}

export async function listCoinGeckoCatalog(
  query = "",
  limit = 200,
): Promise<Array<typeof coingeckoAssetCatalog.$inferSelect>> {
  const q = query.trim();
  return db
    .select()
    .from(coingeckoAssetCatalog)
    .where(
      q
        ? or(
            ilike(coingeckoAssetCatalog.symbol, `%${q}%`),
            ilike(coingeckoAssetCatalog.name, `%${q}%`),
          )
        : eq(coingeckoAssetCatalog.isActive, true),
    )
    .orderBy(asc(coingeckoAssetCatalog.marketCapRank), asc(coingeckoAssetCatalog.symbol))
    .limit(Math.min(Math.max(limit, 1), 500));
}
