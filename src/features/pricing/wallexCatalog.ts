/**
 * کاتالوگ بازار — Persian-named assets with BOTH market quotes.
 *
 * WHY THIS EXISTS NEXT TO THE CoinGecko CATALOGUE
 * They answer different questions. CoinGecko supplies a global USD identity for
 * 23 curated coins — enough to value a portfolio, not enough to FIND what an
 * Iranian user actually holds. This catalogue holds a few hundred assets —
 * coins, meme coins, tokenised US stocks, indices, bonds, commodities — named
 * in Persian and quoted in BOTH تومان and تتر. Its rows come from two public
 * exchange feeds (see providers/), but no row is ever SHOWN with an exchange
 * name: the user sees the asset, not where its quote came from.
 *
 * TWO PRICES, NEITHER DERIVED FROM THE OTHER
 * `priceTmn` and `priceUsdt` are each read as published. Computing one from
 * the other via a USD/IRT rate would produce a third number matching neither
 * screen the user is comparing against. Either may be null.
 *
 * MARKET DATA ONLY. Every row is public exchange data keyed by symbol: no user,
 * no holding, no transaction, no accounting value. Nothing here is an authority
 * for the ledger, and this catalogue never writes to `assets`, `postings` or
 * `lots`.
 *
 * SPEED, WHICH IS A FEATURE HERE
 * Reads never wait on the network when there is anything persisted to show:
 * a stale catalogue is served at once and refreshed in the background (Next's
 * `after`). Only an EMPTY catalogue blocks, because there is nothing else to
 * serve. A refresh writes in batches, not one round-trip per symbol.
 */
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { after } from "next/server";
import { db } from "@/db";
import { wallexAssetCatalog } from "@/db/schema";
import { bootstrapProviders } from "./providers";
import { WallexProvider, type WallexMarketEntry } from "./providers/wallex";
import type { AbanTetherProvider } from "./providers/abantether";
import { rankMarketRows, type MarketRow } from "./marketSearch";
import { getSupportedCryptoBySymbol } from "./supportedAssets";
import { CoinGeckoClient } from "./coingecko";
import { D } from "@/domain/decimal";
import { getLatestUsdIrtRate } from "@/lib/fx";

/**
 * Stablecoins the app supports that NO exchange feed lists (USDG «گلوبال دلار»,
 * verified absent from both on 2026-09-13). They get a catalogue row so they
 * can be found, picked and valued.
 *
 * THEIR PRICES ARE CONVERTED, AND THAT IS STATED HERE ON PURPOSE
 * Every other row carries two prices read from two real markets. These have no
 * Iranian market at all, so both are derived from CoinGecko's USD price:
 *   • تتری  = coin USD ÷ USDT USD            (both from CoinGecko, one call)
 *   • تومانی = تتری × the USDT Toman price of THIS catalogue
 * Anchoring the Toman figure on the catalogue's own USDT market keeps the row
 * consistent with the tether price a user sees one line above it. Only when
 * no USDT Toman price exists does it fall back to the app's USD→IRT rate.
 */
const REGISTRY_ONLY: ReadonlyArray<{ symbol: string; kind: "stablecoin" | "crypto" }> = [
  { symbol: "USDG", kind: "stablecoin" },
  // Lighter — a perp-DEX token no Iranian exchange feed lists (verified
  // 2026-09-14); CAKE and ASTER trade on Wallex and use that market instead.
  { symbol: "LIT", kind: "crypto" },
];

/** USD prices by CoinGecko id — injectable so tests never reach the network. */
export type RegistryUsdQuotes = (ids: string[]) => Promise<Map<string, { priceUsd: string }>>;

const liveRegistryQuotes: RegistryUsdQuotes = (ids) => new CoinGeckoClient().fetchUsdPrices(ids);
import { WALLEX_KIND_LABELS, WALLEX_RWA_KINDS, wallexKindLabel } from "./wallexKinds";

// The vocabulary lives in a pure module so client components can share it.
export { WALLEX_KIND_LABELS, WALLEX_RWA_KINDS, wallexKindLabel };

/** How long a synced catalogue is considered fresh. */
export const WALLEX_CATALOG_TTL_MS = 10 * 60 * 1000;
/** After a failed refresh, do not hammer the upstream on every request. */
const RETRY_COOLDOWN_MS = 2 * 60 * 1000;
/** Rows per INSERT statement — well under Postgres' parameter limit. */
const UPSERT_CHUNK = 150;

const globalForWallex = globalThis as unknown as {
  __pwosWallexNextRetryAt?: number;
  /** The refresh already running, so concurrent readers share one. */
  __pwosWallexRefresh?: Promise<WallexSyncResult>;
};

export type WallexCatalogRow = typeof wallexAssetCatalog.$inferSelect;

export type WallexCatalogStatus = {
  total: number;
  lastSyncedAt: Date | null;
  /** fresh → synced within the TTL · stale → older · unavailable → empty. */
  freshness: "fresh" | "stale" | "unavailable";
};

export type WallexSyncResult = {
  synced: number;
  status: "fresh" | "stale" | "unavailable";
};

/* ------------------------------------------------------------------ */
/* Sync                                                                */
/* ------------------------------------------------------------------ */

/**
 * Pull the whole catalogue and persist it.
 *
 * Upsert rather than replace: a symbol that temporarily drops out of the feed
 * keeps its identity and its last known prices instead of disappearing from
 * the user's search box mid-session. Rows are marked inactive only when the
 * upstream genuinely returns without them AND the fetch itself succeeded, so
 * one network blip cannot empty the catalogue.
 */
export async function refreshWallexCatalog(
  provider?: WallexProvider,
  /**
   * The second source. `undefined` takes it from the registry — UNLESS a
   * Wallex provider was injected, in which case it is skipped: a test that
   * binds Wallex to a fixture must never reach the network for the other.
   * `null` always skips it.
   */
  abanProvider?: AbanTetherProvider | null,
  /**
   * USD quotes for the registry-only stablecoins. `undefined` uses CoinGecko —
   * unless a Wallex provider was injected (a test), in which case no network
   * call is made and those rows keep whatever price they already had.
   */
  registryQuotes?: RegistryUsdQuotes | null,
): Promise<WallexSyncResult> {
  // The registry is the ONE place a market source is declared, so providers
  // are taken FROM it rather than constructed alongside it. They can still be
  // injected for tests, which is the only reason the parameters survive.
  const registry = provider && abanProvider === undefined ? null : bootstrapProviders();
  const source = provider ?? (registry?.get("wallex") as WallexProvider | undefined);
  const aban =
    abanProvider === null
      ? undefined
      : abanProvider ?? (registry?.get("abantether") as AbanTetherProvider | undefined);
  if (!source && !aban) {
    const status = await getWallexCatalogStatus();
    return { synced: 0, status: status.total > 0 ? "stale" : "unavailable" };
  }

  // Both upstreams in parallel: one payload is ~1 MB and can be slow, and a
  // slow second source must not double the wait for the first.
  const settle = async <T,>(load: (() => Promise<T[]>) | undefined): Promise<T[]> => {
    if (!load) return [];
    try {
      return await load();
    } catch {
      return [];
    }
  };
  const [entries, abanEntries] = await Promise.all([
    settle(source ? () => source.fetchMarketCatalog() : undefined),
    settle(aban ? () => aban.fetchMarketCatalog() : undefined),
  ]);

  if (entries.length === 0 && abanEntries.length === 0) {
    // Nothing came back. Keep whatever is persisted and report honestly.
    globalForWallex.__pwosWallexNextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
    const status = await getWallexCatalogStatus();
    return { synced: 0, status: status.total > 0 ? "stale" : "unavailable" };
  }

  const syncedAt = new Date();

  /**
   * One INSERT … ON CONFLICT per chunk instead of one round-trip per symbol:
   * a full sync is ~280 rows, and doing them one at a time was the slowest
   * part of every refresh.
   */
  const upsertAll = async (rows: WallexMarketEntry[], from: "wallex" | "abantether" | "coingecko") => {
    const unique = [...new Map(rows.map((r) => [r.symbol, r])).values()];
    for (let i = 0; i < unique.length; i += UPSERT_CHUNK) {
      const chunk = unique.slice(i, i + UPSERT_CHUNK);
      await db
        .insert(wallexAssetCatalog)
        .values(
          chunk.map((entry) => ({
            symbol: entry.symbol,
            displayName: entry.displayName,
            latinName: entry.latinName,
            kind: entry.kind,
            logoUrl: entry.logoUrl,
            priceTmn: entry.priceTmn,
            priceUsdt: entry.priceUsdt,
            isActive: true,
            syncedAt,
            source: from,
          })),
        )
        .onConflictDoUpdate({
          target: wallexAssetCatalog.symbol,
          set: {
            displayName: sql`excluded.display_name`,
            latinName: sql`excluded.latin_name`,
            kind: sql`excluded.kind`,
            logoUrl: sql`excluded.logo_url`,
            // A market that stopped quoting keeps its previous price rather
            // than being blanked: a real new price wins, a missing one falls
            // back to what was stored.
            priceTmn: sql`coalesce(excluded.price_tmn, ${wallexAssetCatalog.priceTmn})`,
            priceUsdt: sql`coalesce(excluded.price_usdt, ${wallexAssetCatalog.priceUsdt})`,
            isActive: sql`true`,
            syncedAt: sql`excluded.synced_at`,
            source: sql`excluded.source`,
          },
        });
    }
  };

  // Wallex first, and it WINS a shared symbol: USOON or SLVON quoted by both
  // is stored once, with Wallex's two real market prices.
  await upsertAll(entries, "wallex");

  // Which symbols Wallex owns — from THIS sync when it answered, otherwise
  // from what is persisted, so a sync during a Wallex outage cannot take over
  // a row a user is valuing against it.
  const wallexOwned = new Set(
    entries.length > 0
      ? entries.map((e) => e.symbol)
      : (
          await db
            .select({ symbol: wallexAssetCatalog.symbol })
            .from(wallexAssetCatalog)
            .where(and(eq(wallexAssetCatalog.source, "wallex"), eq(wallexAssetCatalog.isActive, true)))
        ).map((r) => r.symbol),
  );
  const abanTaken = abanEntries.filter((e) => !wallexOwned.has(e.symbol));
  await upsertAll(abanTaken, "abantether");

  // Registry-only stablecoins, only on a full (non-test) sync and only where
  // neither feed supplied the symbol.
  if (aban) {
    const fed = new Set([...wallexOwned, ...abanTaken.map((e) => e.symbol)]);
    const coins = REGISTRY_ONLY.filter((r) => !fed.has(r.symbol))
      .map((r) => {
        const coin = getSupportedCryptoBySymbol(r.symbol);
        return coin ? { ...coin, kind: r.kind } : null;
      })
      .filter((c): c is NonNullable<typeof c> => Boolean(c));

    const quotesFn = registryQuotes === undefined ? (provider ? null : liveRegistryQuotes) : registryQuotes;
    const priced = coins.length > 0 && quotesFn
      ? await convertRegistryPrices(coins.map((c) => c.coingeckoId), quotesFn, entries)
      : new Map<string, { priceUsdt: string; priceTmn: string | null }>();

    const registryRows: WallexMarketEntry[] = coins.map((coin) => ({
      symbol: coin.symbol,
      displayName: coin.displayName,
      latinName: coin.name,
      kind: coin.kind,
      logoUrl: null,
      // A failed quote leaves both null, and the upsert's coalesce keeps the
      // last known prices instead of blanking them.
      priceTmn: priced.get(coin.coingeckoId)?.priceTmn ?? null,
      priceUsdt: priced.get(coin.coingeckoId)?.priceUsdt ?? null,
      fetchedAt: syncedAt.toISOString(),
    }));
    await upsertAll(registryRows, "coingecko");
  }

  // Symbols a feed no longer carries are deactivated, never deleted: a user
  // may already hold one, and its identity must survive a delisting. Each
  // source only ever deactivates ITS OWN rows, and only when it answered.
  const deactivateMissing = async (from: "wallex" | "abantether", seen: string[]) => {
    await db
      .update(wallexAssetCatalog)
      .set({ isActive: false })
      .where(
        and(
          eq(wallexAssetCatalog.isActive, true),
          eq(wallexAssetCatalog.source, from),
          seen.length > 0 ? notInArray(wallexAssetCatalog.symbol, seen) : sql`1=1`,
        ),
      );
  };
  if (entries.length > 0) await deactivateMissing("wallex", entries.map((e) => e.symbol));
  if (abanEntries.length > 0) await deactivateMissing("abantether", abanTaken.map((e) => e.symbol));

  globalForWallex.__pwosWallexNextRetryAt = undefined;
  return { synced: entries.length + abanTaken.length, status: "fresh" };
}

/**
 * CoinGecko USD → تتری and تومانی for the registry-only coins. Never throws:
 * an unreachable CoinGecko yields no prices, and the caller keeps the old ones.
 */
async function convertRegistryPrices(
  ids: string[],
  quotes: RegistryUsdQuotes,
  wallexEntries: WallexMarketEntry[],
): Promise<Map<string, { priceUsdt: string; priceTmn: string | null }>> {
  const out = new Map<string, { priceUsdt: string; priceTmn: string | null }>();
  let usd: Map<string, { priceUsd: string }>;
  try {
    usd = await quotes([...ids, "tether"]);
  } catch {
    return out;
  }

  const usdtUsd = usd.get("tether")?.priceUsd;
  // Toman per USDT: this sync's market first, then what is persisted, then the
  // app's USD→IRT rate as the last resort.
  let usdtToman: string | null = wallexEntries.find((e) => e.symbol === "USDT")?.priceTmn ?? null;
  if (!usdtToman) {
    const [row] = await db
      .select({ priceTmn: wallexAssetCatalog.priceTmn })
      .from(wallexAssetCatalog)
      .where(eq(wallexAssetCatalog.symbol, "USDT"))
      .limit(1);
    usdtToman = row?.priceTmn ?? null;
  }
  let usdToman: string | null = null;
  if (!usdtToman) {
    try {
      const fx = await getLatestUsdIrtRate();
      usdToman = fx.rate && D(fx.rate).gt(0) ? fx.rate : null;
    } catch {
      usdToman = null;
    }
  }

  for (const id of ids) {
    const coinUsd = usd.get(id)?.priceUsd;
    if (!coinUsd || !D(coinUsd).gt(0)) continue;
    const priceUsdt =
      usdtUsd && D(usdtUsd).gt(0) ? D(coinUsd).div(usdtUsd) : D(coinUsd);
    const priceTmn = usdtToman
      ? priceUsdt.mul(usdtToman).toFixed(0)
      : usdToman
        ? D(coinUsd).mul(usdToman).toFixed(0)
        : null;
    out.set(id, { priceUsdt: priceUsdt.toFixed(6).replace(/\.?0+$/, ""), priceTmn });
  }
  return out;
}

export async function getWallexCatalogStatus(): Promise<WallexCatalogStatus> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      lastSyncedAt: sql<Date | null>`max(${wallexAssetCatalog.syncedAt})`,
    })
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.isActive, true));

  const total = row?.total ?? 0;
  const lastSyncedAt = row?.lastSyncedAt ? new Date(row.lastSyncedAt) : null;
  if (total === 0) return { total: 0, lastSyncedAt: null, freshness: "unavailable" };

  const age = Date.now() - (lastSyncedAt?.getTime() ?? 0);
  return {
    total,
    lastSyncedAt,
    freshness: age <= WALLEX_CATALOG_TTL_MS ? "fresh" : "stale",
  };
}

/** Run one refresh at a time; concurrent callers share it. */
function refreshOnce(): Promise<WallexSyncResult> {
  if (!globalForWallex.__pwosWallexRefresh) {
    globalForWallex.__pwosWallexRefresh = refreshWallexCatalog().finally(() => {
      globalForWallex.__pwosWallexRefresh = undefined;
    });
  }
  return globalForWallex.__pwosWallexRefresh;
}

/**
 * Guarantee a usable catalogue WITHOUT making the reader wait on the network.
 *
 *   • fresh              → returned as-is.
 *   • stale, has rows    → returned at once; a refresh is scheduled to run
 *                          after the response (or detached, outside a request).
 *   • empty              → the one case that waits, because there is nothing
 *                          else to show.
 */
export async function ensureWallexCatalog(): Promise<WallexCatalogStatus> {
  const status = await getWallexCatalogStatus();
  if (status.freshness === "fresh") return status;

  if (status.total === 0) {
    await refreshOnce();
    return getWallexCatalogStatus();
  }

  const nextRetryAt = globalForWallex.__pwosWallexNextRetryAt ?? 0;
  if (Date.now() >= nextRetryAt && !globalForWallex.__pwosWallexRefresh) {
    const task = () => refreshOnce().then(() => undefined, () => undefined);
    try {
      after(task);
    } catch {
      // Outside a request scope (a script, a test) `after` throws — detach.
      void task();
    }
  }
  return status;
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export type WallexCatalogResult = MarketRow & {
  syncedAt: string | null;
  /** Internal provenance — never rendered. See the product rule above. */
  source: string;
};

function decorate(row: WallexCatalogRow): WallexCatalogResult {
  return {
    symbol: row.symbol,
    displayName: row.displayName,
    latinName: row.latinName,
    kind: row.kind,
    kindLabel: wallexKindLabel(row.kind),
    logoUrl: row.logoUrl,
    priceTmn: row.priceTmn,
    priceUsdt: row.priceUsdt,
    syncedAt: row.syncedAt ? new Date(row.syncedAt).toISOString() : null,
    source: row.source,
  };
}

/**
 * Every active row, as the client-facing shape — no provenance. This is what
 * a picker or «نمای بازار» loads ONCE and then searches in memory.
 */
export async function listMarketRows(): Promise<MarketRow[]> {
  const rows = await db
    .select()
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.isActive, true))
    .orderBy(asc(wallexAssetCatalog.displayName));
  return rows.map((row) => ({
    symbol: row.symbol,
    displayName: row.displayName,
    latinName: row.latinName,
    kind: row.kind,
    kindLabel: wallexKindLabel(row.kind),
    logoUrl: row.logoUrl,
    priceTmn: row.priceTmn,
    priceUsdt: row.priceUsdt,
  }));
}

/**
 * Ranked search over the persisted catalogue — the same ranking the client
 * runs (`rankMarketRows`), so server and browser agree about «matches».
 */
export async function searchWallexCatalog(
  query = "",
  options: { kind?: string | readonly string[]; limit?: number } = {},
): Promise<WallexCatalogResult[]> {
  const rows = await db
    .select()
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.isActive, true))
    .orderBy(asc(wallexAssetCatalog.displayName));
  const kinds =
    options.kind === undefined ? undefined : typeof options.kind === "string" ? [options.kind] : options.kind;
  return rankMarketRows(rows.map(decorate), query, { kinds, limit: options.limit ?? 50 });
}

/** One asset by symbol — the identity a registration writes into `assets`. */
export async function getWallexAsset(symbol: string): Promise<WallexCatalogResult | null> {
  const [row] = await db
    .select()
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.symbol, symbol.trim().toUpperCase()))
    .limit(1);
  return row ? decorate(row) : null;
}
