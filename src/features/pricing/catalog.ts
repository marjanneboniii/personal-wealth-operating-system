import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { coingeckoAssetCatalog } from "@/db/schema";
import { CoinGeckoClient } from "./coingecko";
import { getCurrentUsdPrices } from "./service";
import {
  getSupportedCryptoByCoinGeckoId,
  isSupportedCoinGeckoId,
  SUPPORTED_COINGECKO_IDS,
  SUPPORTED_CRYPTO_ASSETS,
} from "./supportedAssets";
import type { CoinGeckoCatalogAsset, PriceFailureCode, PriceFreshness } from "./types";

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
const BOOTSTRAP_IDENTITIES: CoinGeckoCatalogAsset[] = SUPPORTED_CRYPTO_ASSETS.map((asset) => ({
  coingeckoId: asset.coingeckoId,
  symbol: asset.symbol,
  name: asset.name,
  logoUrl: asset.logoUrl,
  marketCapRank: asset.marketCapRank,
  kind: "crypto",
}));

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
 * that were previously refreshed from CoinGecko. Conflicts only reactivate the
 * supported identity: a real upstream timestamp/logo always wins over bootstrap
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
      .onConflictDoUpdate({
        target: coingeckoAssetCatalog.coingeckoId,
        set: { isActive: true },
      });
  }
}

/**
 * Synchronizes the supported identities found in CoinGecko's top-250 response.
 * Failure is graceful: rows that did arrive are still registered, and the
 * offline allowlist remains available. Prices are never taken from this path.
 * Legacy non-crypto rows are dropped; unsupported crypto rows may remain for
 * history but are filtered from every picker/status query.
 */
export async function refreshCoinGeckoCatalog(
  client = new CoinGeckoClient(),
): Promise<CatalogSyncResult> {
  let top: CoinGeckoCatalogAsset[] = [];
  try {
    top = (await client.fetchTopAssets(250)).filter((asset) =>
      isSupportedCoinGeckoId(asset.coingeckoId),
    );
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
    const complete = merged.size === SUPPORTED_CRYPTO_ASSETS.length;
    // Some supported identities can temporarily fall outside /coins/markets'
    // first page. Keep their offline identities, but do not retry on every
    // request while the catalog is only partially refreshed.
    globalForCatalog.__pwosCatalogNextRetryAt = complete
      ? undefined
      : Date.now() + RETRY_COOLDOWN_MS;
    return { synced: merged.size, status: complete ? "fresh" : "partial", failed };
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
    .from(coingeckoAssetCatalog)
    .where(and(
      eq(coingeckoAssetCatalog.isActive, true),
      eq(coingeckoAssetCatalog.kind, "crypto"),
      inArray(coingeckoAssetCatalog.coingeckoId, SUPPORTED_COINGECKO_IDS),
    ));

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
  // The allowlist is enforced at read time too, so old DOT/DAI/ADA or other
  // legacy rows can never reappear even if they still exist for history.
  const filters = [
    eq(coingeckoAssetCatalog.isActive, true),
    eq(coingeckoAssetCatalog.kind, "crypto"),
    inArray(coingeckoAssetCatalog.coingeckoId, SUPPORTED_COINGECKO_IDS),
  ];
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

export type PricedCoinGeckoCatalogEntry = typeof coingeckoAssetCatalog.$inferSelect & {
  displayName: string;
  priceUsd: string | null;
  priceFreshness: PriceFreshness;
  priceFailureCode?: PriceFailureCode;
  priceObservedAt: string | null;
};

/**
 * Returns picker identities with one batched, failure-safe current-price read.
 * A CoinGecko outage is represented in each row; it never rejects the picker.
 */
export async function listPricedCoinGeckoCatalog(
  query = "",
  limit = 200,
  options: { client?: CoinGeckoClient; now?: number } = {},
): Promise<PricedCoinGeckoCatalogEntry[]> {
  const rows = await listCoinGeckoCatalog(query, limit);
  const quotes = await getCurrentUsdPrices(rows.map((row) => ({
    assetId: row.coingeckoId,
    coingeckoId: row.coingeckoId,
    symbol: row.symbol,
    name: row.name,
    logoUrl: row.logoUrl,
  })), options);

  return rows.map((row) => {
    const supported = getSupportedCryptoByCoinGeckoId(row.coingeckoId);
    const quote = quotes.get(row.coingeckoId);
    return {
      ...row,
      displayName: supported?.displayName ?? row.name,
      priceUsd: quote?.priceUsd ?? null,
      priceFreshness: quote?.freshness ?? "unavailable",
      priceFailureCode: quote?.failureCode,
      priceObservedAt: quote?.observedAt ?? null,
    };
  });
}

/** Newest-first sync timestamps, used by diagnostics screens. */
export async function latestCatalogSyncAt(): Promise<Date | null> {
  const [row] = await db
    .select({ syncedAt: coingeckoAssetCatalog.syncedAt })
    .from(coingeckoAssetCatalog)
    .where(and(
      eq(coingeckoAssetCatalog.isActive, true),
      inArray(coingeckoAssetCatalog.coingeckoId, SUPPORTED_COINGECKO_IDS),
    ))
    .orderBy(desc(coingeckoAssetCatalog.syncedAt))
    .limit(1);
  return row?.syncedAt ?? null;
}
