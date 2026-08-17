import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { coingeckoAssetCatalog } from "@/db/schema";
import { CoinGeckoClient } from "./coingecko";
import type { CoinGeckoCatalogAsset } from "./types";

const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
/** A failed sync must not silently lock the catalog for a whole day. */
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
/**
 * Bootstrap rows are stamped with the Unix epoch so that `ensureCoinGeckoCatalog`
 * always treats them as "not really synced yet" and keeps retrying the network.
 */
const BOOTSTRAP_SYNCED_AT = new Date(0);

export type CatalogSyncStatus = "fresh" | "partial" | "stale" | "unavailable";

export type CatalogSyncResult = {
  synced: number;
  status: CatalogSyncStatus;
  /** Which upstream pages failed, so the UI can explain a partial catalog. */
  failed: Array<"top">;
};

export type CatalogStatus = {
  total: number;
  crypto: number;
  lastSyncedAt: Date | null;
  /** Number of identities still sourced only from the offline floor. */
  bootstrapEntries: number;
  /** True when the usable catalog is effectively the supported offline floor. */
  usingOfflineFloor: boolean;
  /** True while every catalog row is an epoch-stamped bootstrap identity. */
  bootstrapOnly: boolean;
};

/**
 * Offline bootstrap only; current prices are NEVER sourced from this list.
 *
 * It exists so the picker is still usable (crypto) when CoinGecko is
 * unreachable — e.g. blocked egress, no API key + rate limit. Ranks/logos
 * here are identity hints, refreshed on the first successful sync.
 */
const BOOTSTRAP_IDENTITIES: CoinGeckoCatalogAsset[] = [
  // ── Major crypto ────────────────────────────────────────────────────────
  { coingeckoId: "bitcoin", symbol: "BTC", name: "Bitcoin", logoUrl: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png", marketCapRank: 1, kind: "crypto" },
  { coingeckoId: "ethereum", symbol: "ETH", name: "Ethereum", logoUrl: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png", marketCapRank: 2, kind: "crypto" },
  { coingeckoId: "tether", symbol: "USDT", name: "Tether", logoUrl: "https://coin-images.coingecko.com/coins/images/325/large/Tether.png", marketCapRank: 3, kind: "crypto" },
  { coingeckoId: "binancecoin", symbol: "BNB", name: "BNB", logoUrl: "https://coin-images.coingecko.com/coins/images/825/large/bnb-icon2_2x.png", marketCapRank: 4, kind: "crypto" },
  { coingeckoId: "usd-coin", symbol: "USDC", name: "USDC", logoUrl: "https://coin-images.coingecko.com/coins/images/6319/large/USDC.png", marketCapRank: 5, kind: "crypto" },
  { coingeckoId: "ripple", symbol: "XRP", name: "XRP", logoUrl: "https://coin-images.coingecko.com/coins/images/44/large/xrp-symbol-white-128.png", marketCapRank: 6, kind: "crypto" },
  { coingeckoId: "solana", symbol: "SOL", name: "Solana", logoUrl: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png", marketCapRank: 7, kind: "crypto" },
  { coingeckoId: "tron", symbol: "TRX", name: "TRON", logoUrl: "https://coin-images.coingecko.com/coins/images/1094/large/tron-logo.png", marketCapRank: 8, kind: "crypto" },
  { coingeckoId: "hyperliquid", symbol: "HYPE", name: "Hyperliquid", logoUrl: "https://coin-images.coingecko.com/coins/images/50882/large/hyperliquid.jpg", marketCapRank: 10, kind: "crypto" },
  { coingeckoId: "dogecoin", symbol: "DOGE", name: "Dogecoin", logoUrl: "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png", marketCapRank: 11, kind: "crypto" },
  { coingeckoId: "usds", symbol: "USDS", name: "USDS", logoUrl: "https://coin-images.coingecko.com/coins/images/39926/large/usds.webp", marketCapRank: 12, kind: "crypto" },
  { coingeckoId: "monero", symbol: "XMR", name: "Monero", logoUrl: "https://coin-images.coingecko.com/coins/images/69/large/monero_logo.png", marketCapRank: 16, kind: "crypto" },
  { coingeckoId: "cardano", symbol: "ADA", name: "Cardano", logoUrl: "https://coin-images.coingecko.com/coins/images/975/large/cardano.png", marketCapRank: 17, kind: "crypto" },
  { coingeckoId: "litecoin", symbol: "LTC", name: "Litecoin", logoUrl: "https://coin-images.coingecko.com/coins/images/2/large/litecoin.png", marketCapRank: 22, kind: "crypto" },
  { coingeckoId: "ethena-usde", symbol: "USDE", name: "Ethena USDe", logoUrl: "https://coin-images.coingecko.com/coins/images/33613/large/usde.png", marketCapRank: 24, kind: "crypto" },
  { coingeckoId: "avalanche-2", symbol: "AVAX", name: "Avalanche", logoUrl: "https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png", marketCapRank: 25, kind: "crypto" },
  { coingeckoId: "global-dollar", symbol: "USDG", name: "Global Dollar", logoUrl: "https://coin-images.coingecko.com/coins/images/51281/large/GDN_USDG_Token_200x200.png", marketCapRank: 28, kind: "crypto" },
  { coingeckoId: "polkadot", symbol: "DOT", name: "Polkadot", logoUrl: "https://coin-images.coingecko.com/coins/images/12171/large/polkadot.png", marketCapRank: 30, kind: "crypto" },
  { coingeckoId: "tether-gold", symbol: "XAUT", name: "Tether Gold", logoUrl: "https://coin-images.coingecko.com/coins/images/10481/large/logo.png", marketCapRank: 35, kind: "crypto" },
  { coingeckoId: "pax-gold", symbol: "PAXG", name: "PAX Gold", logoUrl: "https://coin-images.coingecko.com/coins/images/9519/large/asset-paxg.png", marketCapRank: 42, kind: "crypto" },
  { coingeckoId: "dai", symbol: "DAI", name: "Dai", logoUrl: "https://coin-images.coingecko.com/coins/images/9956/large/Badge_Dai.png", marketCapRank: 21, kind: "crypto" },
  // ── Wrapped / stable variants — reachable offline too ───────────────────
  { coingeckoId: "coinbase-wrapped-btc", symbol: "CBBTC", name: "Coinbase Wrapped BTC", logoUrl: "https://coin-images.coingecko.com/coins/images/40143/large/cbbtc.webp", marketCapRank: null, kind: "crypto" },
  { coingeckoId: "wrapped-bitcoin", symbol: "WBTC", name: "Wrapped Bitcoin", logoUrl: "https://coin-images.coingecko.com/coins/images/7598/large/WBTCLOGO.png", marketCapRank: null, kind: "crypto" },
];

/** Exposed for diagnostics/tests — the offline identity floor of the picker. */
export const BOOTSTRAP_CATALOG_SIZE = BOOTSTRAP_IDENTITIES.length;

/** In-memory guard so a failing upstream is retried soon, but not per request. */
const globalForCatalog = globalThis as typeof globalThis & {
  __pwosCatalogNextRetryAt?: number;
};

async function upsertCatalog(rows: CoinGeckoCatalogAsset[], syncedAt: Date): Promise<void> {
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
          kind: row.kind,
          isActive: true,
          syncedAt,
        },
      });
  }
}

/**
 * Makes every supported offline identity available without downgrading rows
 * that were previously refreshed from CoinGecko. This is intentionally
 * insert-only: a real upstream timestamp/logo always wins over bootstrap
 * metadata.
 *
 * Older installations may already contain the original four-row seed
 * (BTC/ETH/USDT/SOL) with a recent timestamp. Looking only at freshness would
 * incorrectly consider that catalog complete for 24 hours. Laying down the
 * missing floor before the freshness check repairs those installations on the
 * next visit, even when CoinGecko itself is unreachable.
 */
async function ensureOfflineCatalogFloor(): Promise<void> {
  for (const row of BOOTSTRAP_IDENTITIES) {
    await db
      .insert(coingeckoAssetCatalog)
      .values({ ...row, syncedAt: BOOTSTRAP_SYNCED_AT, isActive: true })
      .onConflictDoNothing({ target: coingeckoAssetCatalog.coingeckoId });
  }
}

/**
 * Synchronizes top-250 crypto from CoinGecko. Failure is graceful: rows that
 * did arrive are still registered, and previously registered identities
 * remain available. Prices are never taken from this path. Any legacy rows
 * that are not crypto (old RWA/tokenized identities) are dropped, so they can
 * never surface in the picker again.
 */
export async function refreshCoinGeckoCatalog(
  client = new CoinGeckoClient(),
): Promise<CatalogSyncResult> {
  let top: CoinGeckoCatalogAsset[] = [];
  try {
    top = await client.fetchTopAssets(250);
  } catch {
    top = [];
  }

  const merged = new Map<string, CoinGeckoCatalogAsset>();
  for (const row of top) merged.set(row.coingeckoId, row);

  const failed: Array<"top"> = merged.size === 0 ? ["top"] : [];

  // Remove any legacy non-crypto rows (old RWA/tokenized identities).
  await db.delete(coingeckoAssetCatalog).where(ne(coingeckoAssetCatalog.kind, "crypto"));

  if (merged.size > 0) {
    await upsertCatalog([...merged.values()], new Date());
    globalForCatalog.__pwosCatalogNextRetryAt = failed.length ? Date.now() + RETRY_COOLDOWN_MS : undefined;
    return { synced: merged.size, status: failed.length ? "partial" : "fresh", failed };
  }

  // Nothing came back: lay down every missing offline identity. This also
  // repairs the legacy four-row catalog instead of preserving the exact bug
  // that made USDC/PAXG/XAUT/CBBTC/WBTC unreachable while offline.
  globalForCatalog.__pwosCatalogNextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
  const before = await getMarketCatalogStatus();
  await ensureOfflineCatalogFloor();
  return { synced: 0, status: before.total ? "stale" : "unavailable", failed };
}

export async function getMarketCatalogStatus(): Promise<CatalogStatus> {
  const [row] = await db
    .select({
      total: sql<number>`count(*) filter (where ${coingeckoAssetCatalog.kind} = 'crypto')::int`,
      crypto: sql<number>`count(*) filter (where ${coingeckoAssetCatalog.kind} = 'crypto')::int`,
      bootstrapEntries: sql<number>`count(*) filter (where ${coingeckoAssetCatalog.syncedAt} = ${BOOTSTRAP_SYNCED_AT})::int`,
      lastSyncedAt: sql<Date | null>`max(${coingeckoAssetCatalog.syncedAt})`,
    })
    .from(coingeckoAssetCatalog);

  const lastSyncedAt = row?.lastSyncedAt ? new Date(row.lastSyncedAt) : null;
  return {
    total: row?.total ?? 0,
    crypto: row?.crypto ?? 0,
    bootstrapEntries: row?.bootstrapEntries ?? 0,
    usingOfflineFloor:
      (row?.bootstrapEntries ?? 0) > 0 && (row?.total ?? 0) <= BOOTSTRAP_CATALOG_SIZE,
    lastSyncedAt: lastSyncedAt && lastSyncedAt.getTime() > 0 ? lastSyncedAt : null,
    bootstrapOnly: !lastSyncedAt || lastSyncedAt.getTime() === 0,
  };
}

export async function ensureCoinGeckoCatalog(): Promise<void> {
  // Completeness and freshness are separate concerns. Always guarantee the
  // supported offline floor first; then decide whether an upstream refresh is
  // due. This is what upgrades databases that still hold only the old 4 rows.
  await ensureOfflineCatalogFloor();
  const status = await getMarketCatalogStatus();
  const isStale =
    status.total === 0 ||
    status.bootstrapOnly ||
    status.usingOfflineFloor ||
    Date.now() - (status.lastSyncedAt?.getTime() ?? 0) > CATALOG_TTL_MS;

  if (!isStale) return;

  const nextRetryAt = globalForCatalog.__pwosCatalogNextRetryAt ?? 0;
  if (status.total > 0 && Date.now() < nextRetryAt) return;

  await refreshCoinGeckoCatalog();
}

export async function listCoinGeckoCatalog(
  query = "",
  limit = 200,
): Promise<Array<typeof coingeckoAssetCatalog.$inferSelect>> {
  const q = query.trim();
  // Only crypto identities are ever offered; legacy non-crypto rows can't
  // surface in the picker even if they linger in an old database.
  const filters = [eq(coingeckoAssetCatalog.isActive, true), eq(coingeckoAssetCatalog.kind, "crypto")];
  if (q) {
    filters.push(
      or(
        ilike(coingeckoAssetCatalog.symbol, `%${q}%`),
        ilike(coingeckoAssetCatalog.name, `%${q}%`),
        ilike(coingeckoAssetCatalog.coingeckoId, `%${q}%`),
      )!,
    );
  }

  return db
    .select()
    .from(coingeckoAssetCatalog)
    .where(and(...filters))
    .orderBy(asc(coingeckoAssetCatalog.marketCapRank), asc(coingeckoAssetCatalog.symbol))
    .limit(Math.min(Math.max(limit, 1), 500));
}

/** Newest-first sync timestamps, used by diagnostics screens. */
export async function latestCatalogSyncAt(): Promise<Date | null> {
  const [row] = await db
    .select({ syncedAt: coingeckoAssetCatalog.syncedAt })
    .from(coingeckoAssetCatalog)
    .orderBy(desc(coingeckoAssetCatalog.syncedAt))
    .limit(1);
  return row?.syncedAt ?? null;
}
