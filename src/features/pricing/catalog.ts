import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
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
  failed: Array<"top" | "rwa">;
};

export type CatalogStatus = {
  total: number;
  crypto: number;
  tokenized: number;
  lastSyncedAt: Date | null;
  /** True while the catalog only holds the offline bootstrap identities. */
  bootstrapOnly: boolean;
};

/**
 * Offline bootstrap only; current prices are NEVER sourced from this list.
 *
 * It exists so the picker is still usable (crypto *and* tokenized RWA) when
 * CoinGecko is unreachable — e.g. blocked egress, no API key + rate limit.
 * Ranks/logos here are identity hints, refreshed on the first successful sync.
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
  { coingeckoId: "dogecoin", symbol: "DOGE", name: "Dogecoin", logoUrl: "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png", marketCapRank: 11, kind: "crypto" },
  { coingeckoId: "cardano", symbol: "ADA", name: "Cardano", logoUrl: "https://coin-images.coingecko.com/coins/images/975/large/cardano.png", marketCapRank: 17, kind: "crypto" },
  { coingeckoId: "monero", symbol: "XMR", name: "Monero", logoUrl: "https://coin-images.coingecko.com/coins/images/69/large/monero_logo.png", marketCapRank: 16, kind: "crypto" },
  { coingeckoId: "dai", symbol: "DAI", name: "Dai", logoUrl: "https://coin-images.coingecko.com/coins/images/9956/large/Badge_Dai.png", marketCapRank: 21, kind: "crypto" },
  { coingeckoId: "avalanche-2", symbol: "AVAX", name: "Avalanche", logoUrl: "https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png", marketCapRank: 25, kind: "crypto" },
  { coingeckoId: "polkadot", symbol: "DOT", name: "Polkadot", logoUrl: "https://coin-images.coingecko.com/coins/images/12171/large/polkadot.png", marketCapRank: 30, kind: "crypto" },
  { coingeckoId: "litecoin", symbol: "LTC", name: "Litecoin", logoUrl: "https://coin-images.coingecko.com/coins/images/2/large/litecoin.png", marketCapRank: 22, kind: "crypto" },

  // ── Tokenized real-world assets (CoinGecko "real-world-assets-rwa") ──────
  { coingeckoId: "figure-heloc", symbol: "FIGR_HELOC", name: "Figure Heloc", logoUrl: "https://coin-images.coingecko.com/coins/images/68480/large/figure.png", marketCapRank: 9, kind: "tokenized" },
  { coingeckoId: "chainlink", symbol: "LINK", name: "Chainlink", logoUrl: "https://coin-images.coingecko.com/coins/images/877/large/Chainlink_Logo_500.png", marketCapRank: 19, kind: "tokenized" },
  { coingeckoId: "stellar", symbol: "XLM", name: "Stellar", logoUrl: "https://coin-images.coingecko.com/coins/images/100/large/fmpFRHHQ_400x400.jpg", marketCapRank: 20, kind: "tokenized" },
  { coingeckoId: "hashnote-usyc", symbol: "USYC", name: "Circle USYC", logoUrl: "https://coin-images.coingecko.com/coins/images/51054/large/Hashnote_SDYC_200x200.png", marketCapRank: 29, kind: "tokenized" },
  { coingeckoId: "blackrock-usd-institutional-digital-liquidity-fund", symbol: "BUIDL", name: "BlackRock USD Institutional Digital Liquidity Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/36291/large/blackrock.png", marketCapRank: 33, kind: "tokenized" },
  { coingeckoId: "tether-gold", symbol: "XAUT", name: "Tether Gold", logoUrl: "https://coin-images.coingecko.com/coins/images/10481/large/logo.png", marketCapRank: 35, kind: "tokenized" },
  { coingeckoId: "ondo-us-dollar-yield", symbol: "USDY", name: "Ondo US Dollar Yield", logoUrl: "https://coin-images.coingecko.com/coins/images/31700/large/usdy_%281%29.png", marketCapRank: 39, kind: "tokenized" },
  { coingeckoId: "pax-gold", symbol: "PAXG", name: "PAX Gold", logoUrl: "https://coin-images.coingecko.com/coins/images/9519/large/asset-paxg.png", marketCapRank: 43, kind: "tokenized" },
  { coingeckoId: "ondo-finance", symbol: "ONDO", name: "Ondo", logoUrl: "https://coin-images.coingecko.com/coins/images/26580/large/ONDO.png", marketCapRank: 46, kind: "tokenized" },
  { coingeckoId: "blockchain-capital", symbol: "BCAP", name: "Blockchain Capital", logoUrl: "https://coin-images.coingecko.com/coins/images/56040/large/bcap_logo_200.png", marketCapRank: 68, kind: "tokenized" },
  { coingeckoId: "superstate-short-duration-us-government-securities-fund-ustb", symbol: "USTB", name: "Invesco Short Duration US Government Securities Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/35012/large/Invesco_icon_lg.png", marketCapRank: 69, kind: "tokenized" },
  { coingeckoId: "eutbl", symbol: "EUTBL", name: "Spiko EU T-Bills Money Market Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/39657/large/EUTBL.png", marketCapRank: 70, kind: "tokenized" },
  { coingeckoId: "janus-henderson-anemoy-treasury-fund", symbol: "JTRSY", name: "Janus Henderson Anemoy Treasury Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/70445/large/JTRSY.png", marketCapRank: 73, kind: "tokenized" },
  { coingeckoId: "quant-network", symbol: "QNT", name: "Quant", logoUrl: "https://coin-images.coingecko.com/coins/images/3370/large/5ZOu7brX_400x400.jpg", marketCapRank: 74, kind: "tokenized" },
  { coingeckoId: "algorand", symbol: "ALGO", name: "Algorand", logoUrl: "https://coin-images.coingecko.com/coins/images/4380/large/download.png", marketCapRank: 79, kind: "tokenized" },
  { coingeckoId: "janus-henderson-anemoy-aaa-clo-fund", symbol: "JAAA", name: "Janus Henderson Anemoy AAA CLO Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/70446/large/jaaa.png", marketCapRank: 84, kind: "tokenized" },
  { coingeckoId: "xdce-crowd-sale", symbol: "XDC", name: "XDC Network", logoUrl: "https://coin-images.coingecko.com/coins/images/2912/large/xdc-icon.png", marketCapRank: 94, kind: "tokenized" },
  { coingeckoId: "injective-protocol", symbol: "INJ", name: "Injective", logoUrl: "https://coin-images.coingecko.com/coins/images/12882/large/Other_200x200.png", marketCapRank: 105, kind: "tokenized" },
  { coingeckoId: "ousg", symbol: "OUSG", name: "Ondo Short-Term U.S. Government Bond Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/29023/large/OUSG.png", marketCapRank: 111, kind: "tokenized" },
  { coingeckoId: "kinesis-gold", symbol: "KAU", name: "Kinesis Gold", logoUrl: "https://coin-images.coingecko.com/coins/images/29788/large/kau-currency-ticker.png", marketCapRank: 120, kind: "tokenized" },
  { coingeckoId: "kinesis-silver", symbol: "KAG", name: "Kinesis Silver", logoUrl: "https://coin-images.coingecko.com/coins/images/29789/large/kag-currency-ticker.png", marketCapRank: 144, kind: "tokenized" },
  { coingeckoId: "vaneck-treasury-fund", symbol: "VBILL", name: "VanEck Treasury Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/56023/large/vbill_200.png", marketCapRank: 165, kind: "tokenized" },
  { coingeckoId: "spiko-us-t-bills-money-market-fund", symbol: "USTBL", name: "Spiko US T-Bills Money Market Fund", logoUrl: "https://coin-images.coingecko.com/coins/images/39666/large/USTB.png", marketCapRank: 180, kind: "tokenized" },
  { coingeckoId: "syrup", symbol: "SYRUP", name: "Maple Finance", logoUrl: "https://coin-images.coingecko.com/coins/images/51232/large/_syrup_token_logo.png", marketCapRank: 175, kind: "tokenized" },
  { coingeckoId: "goldfinch", symbol: "GFI", name: "Goldfinch", logoUrl: "https://coin-images.coingecko.com/coins/images/19081/large/GFI-asset-logo.png", marketCapRank: null, kind: "tokenized" },
  { coingeckoId: "centrifuge", symbol: "CFG", name: "Centrifuge", logoUrl: "https://coin-images.coingecko.com/coins/images/15380/large/centrifuge.png", marketCapRank: null, kind: "tokenized" },
  { coingeckoId: "realio-network", symbol: "RIO", name: "Realio Network", logoUrl: "https://coin-images.coingecko.com/coins/images/17738/large/RIO-Token-Logo.png", marketCapRank: null, kind: "tokenized" },
  { coingeckoId: "polymesh", symbol: "POLYX", name: "Polymesh", logoUrl: "https://coin-images.coingecko.com/coins/images/23496/large/polymesh.png", marketCapRank: null, kind: "tokenized" },
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
          // An RWA-category membership is more specific than top-150 crypto.
          kind: row.kind,
          isActive: true,
          syncedAt,
        },
      });
  }
}

/**
 * Synchronizes top-250 crypto plus CoinGecko's RWA category. Failure is
 * graceful and PARTIAL-TOLERANT: if only one of the two pages answers, the
 * rows that did arrive are still registered, and previously registered
 * identities remain available. Prices are never taken from this path.
 */
export async function refreshCoinGeckoCatalog(
  client = new CoinGeckoClient(),
): Promise<CatalogSyncResult> {
  const [top, rwa] = await Promise.allSettled([
    client.fetchTopAssets(250),
    client.fetchRwaAssets(),
  ]);

  const merged = new Map<string, CoinGeckoCatalogAsset>();
  if (top.status === "fulfilled") for (const row of top.value) merged.set(row.coingeckoId, row);
  // RWA rows are applied last so the tokenized `kind` wins over plain crypto.
  if (rwa.status === "fulfilled") for (const row of rwa.value) merged.set(row.coingeckoId, row);

  const failed: Array<"top" | "rwa"> = [];
  if (top.status === "rejected") failed.push("top");
  if (rwa.status === "rejected") failed.push("rwa");

  if (merged.size > 0) {
    await upsertCatalog([...merged.values()], new Date());
    globalForCatalog.__pwosCatalogNextRetryAt = failed.length ? Date.now() + RETRY_COOLDOWN_MS : undefined;
    return { synced: merged.size, status: failed.length ? "partial" : "fresh", failed };
  }

  // Nothing came back: lay down the offline floor (crypto AND tokenized RWA)
  // with an epoch timestamp so the next request retries the network. Rows that
  // arrived from a previous successful sync are untouched by this upsert.
  globalForCatalog.__pwosCatalogNextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
  const before = await getMarketCatalogStatus();
  if (before.total === 0 || before.bootstrapOnly) {
    await upsertCatalog(BOOTSTRAP_IDENTITIES, BOOTSTRAP_SYNCED_AT);
  }
  return { synced: 0, status: before.total ? "stale" : "unavailable", failed };
}

export async function getMarketCatalogStatus(): Promise<CatalogStatus> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      crypto: sql<number>`count(*) filter (where ${coingeckoAssetCatalog.kind} = 'crypto')::int`,
      tokenized: sql<number>`count(*) filter (where ${coingeckoAssetCatalog.kind} = 'tokenized')::int`,
      lastSyncedAt: sql<Date | null>`max(${coingeckoAssetCatalog.syncedAt})`,
    })
    .from(coingeckoAssetCatalog);

  const lastSyncedAt = row?.lastSyncedAt ? new Date(row.lastSyncedAt) : null;
  return {
    total: row?.total ?? 0,
    crypto: row?.crypto ?? 0,
    tokenized: row?.tokenized ?? 0,
    lastSyncedAt: lastSyncedAt && lastSyncedAt.getTime() > 0 ? lastSyncedAt : null,
    bootstrapOnly: !lastSyncedAt || lastSyncedAt.getTime() === 0,
  };
}

export async function ensureCoinGeckoCatalog(): Promise<void> {
  const status = await getMarketCatalogStatus();
  const isStale =
    status.total === 0 ||
    status.bootstrapOnly ||
    Date.now() - (status.lastSyncedAt?.getTime() ?? 0) > CATALOG_TTL_MS;

  if (!isStale) return;

  const nextRetryAt = globalForCatalog.__pwosCatalogNextRetryAt ?? 0;
  if (status.total > 0 && Date.now() < nextRetryAt) return;

  await refreshCoinGeckoCatalog();
}

export async function listCoinGeckoCatalog(
  query = "",
  limit = 200,
  kind?: "crypto" | "tokenized",
): Promise<Array<typeof coingeckoAssetCatalog.$inferSelect>> {
  const q = query.trim();
  const filters = [eq(coingeckoAssetCatalog.isActive, true)];
  if (q) {
    filters.push(
      or(
        ilike(coingeckoAssetCatalog.symbol, `%${q}%`),
        ilike(coingeckoAssetCatalog.name, `%${q}%`),
        ilike(coingeckoAssetCatalog.coingeckoId, `%${q}%`),
      )!,
    );
  }
  if (kind) filters.push(eq(coingeckoAssetCatalog.kind, kind));

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
