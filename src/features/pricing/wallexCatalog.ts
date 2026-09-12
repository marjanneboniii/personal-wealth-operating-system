/**
 * کاتالوگ والکس — Persian-named assets with BOTH market quotes.
 *
 * WHY THIS EXISTS NEXT TO THE CoinGecko CATALOGUE
 * They answer different questions. CoinGecko supplies a global USD identity for
 * 23 curated coins — enough to value a portfolio, not enough to FIND what an
 * Iranian user actually holds. Wallex publishes a few hundred assets, named in
 * Persian by the source itself (`faBaseAsset`), quoted in BOTH تومان and تتر,
 * with icons on an Iranian host that resolves where CoinGecko's CDN often does
 * not. It also carries the tokenised metals (XAUT «تترگلد», PAXG «پکس گلد»)
 * that the 23-coin list could not express at all.
 *
 * TWO PRICES, NEITHER DERIVED FROM THE OTHER
 * `priceTmn` comes from the TMN market and `priceUsdt` from the USDT market.
 * A Toman market carries its own premium, so computing one from the other via
 * a USD/IRT rate would produce a third number matching neither screen the user
 * is comparing against. Either may be null — a thin asset trades in one market
 * only — and the UI says so rather than inventing the missing side.
 *
 * MARKET DATA ONLY. Every row is public exchange data keyed by symbol: no user,
 * no holding, no transaction, no accounting value. Nothing here is an authority
 * for the ledger — a purchase still records its own price and cost basis, and
 * this catalogue never writes to `assets`, `postings` or `lots`.
 *
 * RESILIENCE. The upstream is one call for the whole catalogue. When it fails,
 * the persisted rows are served as-is and reported STALE rather than empty: a
 * search box that goes blank during an outage reads as «the feature is gone».
 */
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { wallexAssetCatalog } from "@/db/schema";
import { bootstrapProviders } from "./providers";
import { WallexProvider, type WallexMarketEntry } from "./providers/wallex";
import { foldPersian } from "@/features/funds/search";

/** How long a synced catalogue is considered fresh. */
export const WALLEX_CATALOG_TTL_MS = 10 * 60 * 1000;
/** After a failed refresh, do not hammer the upstream on every request. */
const RETRY_COOLDOWN_MS = 2 * 60 * 1000;

const globalForWallex = globalThis as unknown as {
  __pwosWallexNextRetryAt?: number;
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
): Promise<WallexSyncResult> {
  // The registry is the ONE place a market source is declared (adding نوبیتکس
  // or fipiran later is a `register(...)` line there, not a change here), so
  // the provider is taken FROM it rather than constructed alongside it. Before
  // this, `bootstrapProviders()` was never called from anywhere and the whole
  // provider layer — registry, cache, fallback — was unreachable code.
  //
  // A provider can still be injected for tests, which is the only reason the
  // parameter survives.
  const source = provider ?? (bootstrapProviders().get("wallex") as WallexProvider | undefined);
  if (!source) {
    const status = await getWallexCatalogStatus();
    return { synced: 0, status: status.total > 0 ? "stale" : "unavailable" };
  }

  let entries: WallexMarketEntry[] = [];
  try {
    entries = await source.fetchMarketCatalog();
  } catch {
    entries = [];
  }

  if (entries.length === 0) {
    // Nothing came back. Keep whatever is persisted and report honestly.
    globalForWallex.__pwosWallexNextRetryAt = Date.now() + RETRY_COOLDOWN_MS;
    const status = await getWallexCatalogStatus();
    return { synced: 0, status: status.total > 0 ? "stale" : "unavailable" };
  }

  const syncedAt = new Date();
  for (const entry of entries) {
    await db
      .insert(wallexAssetCatalog)
      .values({
        symbol: entry.symbol,
        displayName: entry.displayName,
        latinName: entry.latinName,
        kind: entry.kind,
        logoUrl: entry.logoUrl,
        priceTmn: entry.priceTmn,
        priceUsdt: entry.priceUsdt,
        isActive: true,
        syncedAt,
      })
      .onConflictDoUpdate({
        target: wallexAssetCatalog.symbol,
        set: {
          displayName: entry.displayName,
          latinName: entry.latinName,
          kind: entry.kind,
          logoUrl: entry.logoUrl,
          // A market that stopped quoting keeps its previous price rather than
          // being blanked — `coalesce` on the INCOMING value, so a real new
          // price always wins and only a missing one falls back.
          priceTmn: entry.priceTmn ?? sql`${wallexAssetCatalog.priceTmn}`,
          priceUsdt: entry.priceUsdt ?? sql`${wallexAssetCatalog.priceUsdt}`,
          isActive: true,
          syncedAt,
        },
      });
  }

  // Symbols the feed no longer carries are deactivated, never deleted: a user
  // may already hold one, and its identity must survive a delisting.
  const seen = entries.map((e) => e.symbol);
  await db
    .update(wallexAssetCatalog)
    .set({ isActive: false })
    .where(and(eq(wallexAssetCatalog.isActive, true), notInArray(wallexAssetCatalog.symbol, seen)));

  globalForWallex.__pwosWallexNextRetryAt = undefined;
  return { synced: entries.length, status: "fresh" };
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

/**
 * Guarantee a usable catalogue, refreshing only when it is actually stale and
 * the cooldown has passed. Safe to call on every request that needs the list.
 */
export async function ensureWallexCatalog(): Promise<WallexCatalogStatus> {
  const status = await getWallexCatalogStatus();
  if (status.freshness === "fresh") return status;

  const nextRetryAt = globalForWallex.__pwosWallexNextRetryAt ?? 0;
  // An empty catalogue always tries — there is nothing to serve otherwise.
  if (status.total > 0 && Date.now() < nextRetryAt) return status;

  await refreshWallexCatalog();
  return getWallexCatalogStatus();
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export type WallexCatalogResult = {
  symbol: string;
  displayName: string;
  latinName: string;
  kind: string;
  /** Persian label for the kind, for the picker's chip. */
  kindLabel: string;
  logoUrl: string | null;
  /** Toman per unit — from the TMN market, never converted. */
  priceTmn: string | null;
  /** Tether per unit — from the USDT market, never converted. */
  priceUsdt: string | null;
  syncedAt: string | null;
};

export const WALLEX_KIND_LABELS: Record<string, string> = {
  crypto: "رمزارز",
  stablecoin: "استیبل‌کوین",
  gold: "فلز توکنیزه",
};

export function wallexKindLabel(kind: string): string {
  return WALLEX_KIND_LABELS[kind] ?? "رمزارز";
}

/**
 * Ranked search over the persisted catalogue.
 *
 * Reuses `foldPersian` from the fund search rather than carrying a second
 * notion of «matches»: the user types ي and ك from an Arabic keyboard here too,
 * and two screens that disagree about what matches is exactly the bug that
 * folding was introduced to remove. Ranking mirrors `searchFunds` — an exact
 * symbol beats a prefix, which beats a hit anywhere in either name.
 */
export async function searchWallexCatalog(
  query = "",
  options: { kind?: string; limit?: number } = {},
): Promise<WallexCatalogResult[]> {
  const limit = options.limit ?? 50;
  const rows = await db
    .select()
    .from(wallexAssetCatalog)
    .where(
      and(
        eq(wallexAssetCatalog.isActive, true),
        options.kind ? eq(wallexAssetCatalog.kind, options.kind) : sql`1=1`,
      ),
    )
    .orderBy(asc(wallexAssetCatalog.displayName));

  const q = foldPersian(query);
  const decorate = (row: WallexCatalogRow): WallexCatalogResult => ({
    symbol: row.symbol,
    displayName: row.displayName,
    latinName: row.latinName,
    kind: row.kind,
    kindLabel: wallexKindLabel(row.kind),
    logoUrl: row.logoUrl,
    priceTmn: row.priceTmn,
    priceUsdt: row.priceUsdt,
    syncedAt: row.syncedAt ? new Date(row.syncedAt).toISOString() : null,
  });

  if (!q) return rows.slice(0, limit).map(decorate);

  const scored: { row: WallexCatalogRow; score: number }[] = [];
  for (const row of rows) {
    const symbol = foldPersian(row.symbol);
    const display = foldPersian(row.displayName);
    const latin = foldPersian(row.latinName);
    let score: number;
    if (symbol === q) score = 0;
    else if (symbol.startsWith(q)) score = 1;
    else if (display.startsWith(q)) score = 2;
    else if (symbol.includes(q)) score = 3;
    else if (display.includes(q)) score = 4;
    else if (latin.includes(q)) score = 5;
    else continue;
    scored.push({ row, score });
  }

  return scored
    .sort((a, b) => a.score - b.score || a.row.displayName.localeCompare(b.row.displayName, "fa"))
    .slice(0, limit)
    .map((s) => decorate(s.row));
}

/** One asset by symbol — the identity a registration writes into `assets`. */
export async function getWallexAsset(symbol: string): Promise<WallexCatalogResult | null> {
  const [row] = await db
    .select()
    .from(wallexAssetCatalog)
    .where(eq(wallexAssetCatalog.symbol, symbol.trim().toUpperCase()))
    .limit(1);
  if (!row) return null;
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
  };
}
