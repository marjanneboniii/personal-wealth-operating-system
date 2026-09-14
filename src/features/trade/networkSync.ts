/**
 * Keeps `crypto_networks` current: every coin the market lists (and every
 * supported coin) gets its network families from CoinGecko platform data.
 * Nobody adds coins by hand — a new listing is picked up by the next sync.
 *
 * Failure-safe: CoinGecko being unreachable keeps the last synced rows, and a
 * fresh install falls back to the offline seed until a sync succeeds.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cryptoNetworks, wallexAssetCatalog } from "@/db/schema";
import { CoinGeckoClient } from "@/features/pricing/coingecko";
import { SUPPORTED_CRYPTO_ASSETS } from "@/features/pricing/supportedAssets";
import { BOOTSTRAP_NETWORKS, networksFromPlatforms } from "./networks";

const TTL_MS = 24 * 60 * 60 * 1000;
const RETRY_COOLDOWN_MS = 30 * 60 * 1000;
const SEED_SYNCED_AT = new Date(0);
/** Market-catalogue kinds that are coins (shares, indices and commodities have no chain). */
const COIN_KINDS = ["crypto", "stablecoin", "gold"];

const globalForNetworks = globalThis as typeof globalThis & { __pwosNetworksNextRetryAt?: number };

export type NetworkSyncResult = { synced: number; status: "fresh" | "unavailable" };

export async function refreshCryptoNetworks(client = new CoinGeckoClient({ timeoutMs: 30_000 })): Promise<NetworkSyncResult> {
  const listed = await db
    .select({ symbol: wallexAssetCatalog.symbol })
    .from(wallexAssetCatalog)
    .where(inArray(wallexAssetCatalog.kind, COIN_KINDS));
  const symbols = new Set([
    ...listed.map((row) => row.symbol.trim().toUpperCase()),
    ...SUPPORTED_CRYPTO_ASSETS.map((asset) => asset.symbol.toUpperCase()),
  ]);

  let coins: Awaited<ReturnType<CoinGeckoClient["fetchCoinPlatforms"]>>;
  try {
    coins = await client.fetchCoinPlatforms();
  } catch {
    globalForNetworks.__pwosNetworksNextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
    return { synced: 0, status: "unavailable" };
  }

  // Which CoinGecko id a ticker means: the supported identity, else the
  // highest-ranked coin with that ticker, else the only coin with it.
  const idBySymbol = new Map<string, string>();
  for (const asset of SUPPORTED_CRYPTO_ASSETS) idBySymbol.set(asset.symbol.toUpperCase(), asset.coingeckoId);
  try {
    for (const top of await client.fetchTopAssets(250)) {
      if (!idBySymbol.has(top.symbol)) idBySymbol.set(top.symbol, top.coingeckoId);
    }
  } catch {
    /* ranking is a tie-breaker only */
  }
  const byId = new Map(coins.map((coin) => [coin.id, coin]));
  const bySymbol = new Map<string, typeof coins>();
  for (const coin of coins) bySymbol.set(coin.symbol, [...(bySymbol.get(coin.symbol) ?? []), coin]);

  const now = new Date();
  let synced = 0;
  for (const symbol of symbols) {
    const candidates = bySymbol.get(symbol) ?? [];
    const id = idBySymbol.get(symbol) ?? (candidates.length === 1 ? candidates[0].id : null);
    const coin = id ? byId.get(id) : undefined;
    if (!id || !coin) continue; // ambiguous or unknown ticker: left as it was
    const networks = networksFromPlatforms(id, coin.platforms).join(",");
    await db
      .insert(cryptoNetworks)
      .values({ symbol, coingeckoId: id, networks, syncedAt: now })
      .onConflictDoUpdate({ target: cryptoNetworks.symbol, set: { coingeckoId: id, networks, syncedAt: now } });
    synced++;
  }
  globalForNetworks.__pwosNetworksNextRetryAt = undefined;
  return { synced, status: "fresh" };
}

/** Offline seed for rows that have never been synced. Never overwrites synced data. */
async function ensureNetworkSeed(): Promise<void> {
  for (const [symbol, families] of Object.entries(BOOTSTRAP_NETWORKS)) {
    await db
      .insert(cryptoNetworks)
      .values({ symbol, coingeckoId: null, networks: [...families].sort().join(","), syncedAt: SEED_SYNCED_AT })
      .onConflictDoNothing();
  }
}

/** Seed once, then refresh at most daily (and not while a failure cool-down runs). */
export async function ensureCryptoNetworks(): Promise<void> {
  try {
    await ensureNetworkSeed();
    const [row] = await db
      .select({ latest: sql<Date | null>`max(${cryptoNetworks.syncedAt})` })
      .from(cryptoNetworks);
    const latest = row?.latest ? new Date(row.latest).getTime() : 0;
    if (latest > 0 && Date.now() - latest < TTL_MS) return;
    if (Date.now() < (globalForNetworks.__pwosNetworksNextRetryAt ?? 0)) return;
    await refreshCryptoNetworks();
  } catch {
    // Network data is advisory for the pickers; never block a page on it.
  }
}

/** symbol → network families, for the given symbols (or all). */
export async function getCryptoNetworks(symbols?: string[]): Promise<Record<string, string[]>> {
  const wanted = symbols?.map((s) => s.trim().toUpperCase()).filter(Boolean);
  if (wanted && wanted.length === 0) return {};
  const rows = await db
    .select({ symbol: cryptoNetworks.symbol, networks: cryptoNetworks.networks })
    .from(cryptoNetworks)
    .where(wanted ? inArray(cryptoNetworks.symbol, wanted) : undefined);
  return Object.fromEntries(rows.map((row) => [row.symbol, row.networks.split(",").filter(Boolean)]));
}

/**
 * One coin's network families. Pass the write transaction when called inside
 * one (a single-connection driver deadlocks on `db`). A coin never synced falls
 * back to the offline seed; `null` means its network is not known at all.
 */
export async function getCryptoNetworksOf(symbol: string | null | undefined, client: any = db): Promise<string[] | null> {
  if (!symbol) return null;
  const key = symbol.trim().toUpperCase();
  const [row] = await client
    .select({ networks: cryptoNetworks.networks })
    .from(cryptoNetworks)
    .where(eq(cryptoNetworks.symbol, key))
    .limit(1);
  if (row) return row.networks.split(",").filter(Boolean);
  return BOOTSTRAP_NETWORKS[key] ? [...BOOTSTRAP_NETWORKS[key]] : null;
}
