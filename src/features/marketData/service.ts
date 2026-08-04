import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  currencies,
  marketPriceSources,
  marketPrices,
  marketSnapshots,
  prices,
} from "@/db/schema";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";

export type RecordPriceInput = {
  assetId: string;
  price: string;
  currencyId?: string;
  asOfDate?: string; // YYYY-MM-DD
  timestamp?: string; // ISO String
  sourceName?: string; // DEFAULT "MANUAL"
  sourceType?: "manual" | "api" | "import";
  description?: string;
};

/**
 * Ensure default price sources exist in database
 */
export async function ensurePriceSources() {
  const defaults = [
    { name: "MANUAL", type: "manual", description: "ورود دستی کاربر" },
    { name: "IMPORT", type: "import", description: "درون‌ریزی از فایل" },
    { name: "COINGECKO", type: "api", description: "سرویس کوین‌گکو" },
    { name: "TSETMC", type: "api", description: "سرویس بورس تهران" },
  ];

  for (const src of defaults) {
    await db
      .insert(marketPriceSources)
      .values(src)
      .onConflictDoNothing({ target: marketPriceSources.name });
  }

  const all = await db.select().from(marketPriceSources);
  return new Map(all.map((s) => [s.name, s]));
}

/**
 * Service: Record a manual or imported market price quote & snapshot.
 *
 * CRITICAL FINANCIAL INVARIANT:
 * This service operates ONLY on market data tables (market_prices, market_snapshots, prices).
 * It NEVER touches journal_entries, postings, lots, or ledger tables.
 */
export async function recordManualPrice(input: RecordPriceInput): Promise<{ id: string }> {
  // 1. Validate Price
  const priceDec = D(input.price);
  if (priceDec.lte(0)) {
    throw new Error("قیمت دارایی باید بزرگ‌تر از صفر باشد.");
  }

  // 2. Validate Asset Exists
  const [assetRow] = await db
    .select()
    .from(assets)
    .where(and(eq(assets.id, input.assetId), sql`${assets.deletedAt} is null`))
    .limit(1);

  if (!assetRow) throw new Error("دارایی مورد نظر یافت نشد.");

  // 3. Resolve Quote Currency
  let quoteCurrencyId = input.currencyId;
  if (!quoteCurrencyId) {
    quoteCurrencyId = assetRow.currencyId ?? undefined;
  }
  if (!quoteCurrencyId) {
    const usd = await db.select().from(currencies).where(eq(currencies.code, "USD")).limit(1);
    quoteCurrencyId = usd[0]?.id;
  }

  const asOf = input.asOfDate || todayIso();
  const sourceName = input.sourceName ?? "MANUAL";
  const sourceType = input.sourceType ?? "manual";

  return db.transaction(async (tx) => {
    // Resolve source ID
    let [sourceRow] = await tx
      .select()
      .from(marketPriceSources)
      .where(eq(marketPriceSources.name, sourceName))
      .limit(1);

    if (!sourceRow) {
      [sourceRow] = await tx
        .insert(marketPriceSources)
        .values({
          name: sourceName,
          type: sourceType,
          description: input.description ?? `سورس ${sourceName}`,
        })
        .returning();
    }

    // Insert into market_prices
    const [priceRecord] = await tx
      .insert(marketPrices)
      .values({
        assetId: input.assetId,
        price: priceDec.toString(),
        currencyId: quoteCurrencyId ?? null,
        sourceId: sourceRow.id,
        priceTimestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
      })
      .returning();

    // Upsert historical snapshot for this date & source
    await tx
      .insert(marketSnapshots)
      .values({
        assetId: input.assetId,
        snapshotDate: asOf,
        price: priceDec.toString(),
        currencyId: quoteCurrencyId ?? null,
        sourceId: sourceRow.id,
      })
      .onConflictDoUpdate({
        target: [marketSnapshots.assetId, marketSnapshots.snapshotDate, marketSnapshots.sourceId],
        set: { price: priceDec.toString(), currencyId: quoteCurrencyId ?? null },
      });

    // Sync to backward-compatible prices table for reporting
    await tx
      .insert(prices)
      .values({
        assetId: input.assetId,
        asOf,
        priceBase: priceDec.toString(),
        source: sourceName.toLowerCase(),
      })
      .onConflictDoUpdate({
        target: [prices.assetId, prices.asOf],
        set: { priceBase: priceDec.toString(), source: sourceName.toLowerCase() },
      });

    return { id: priceRecord.id };
  });
}

/**
 * Query current market quotes for assets
 */
export async function getMarketPrices(assetId?: string) {
  return db
    .select({
      id: marketPrices.id,
      assetId: marketPrices.assetId,
      symbol: assets.symbol,
      assetName: assets.name,
      price: marketPrices.price,
      currencyCode: currencies.code,
      currencySymbol: currencies.symbol,
      priceTimestamp: marketPrices.priceTimestamp,
      sourceName: marketPriceSources.name,
    })
    .from(marketPrices)
    .innerJoin(assets, eq(assets.id, marketPrices.assetId))
    .leftJoin(currencies, eq(currencies.id, marketPrices.currencyId))
    .leftJoin(marketPriceSources, eq(marketPriceSources.id, marketPrices.sourceId))
    .where(assetId ? eq(marketPrices.assetId, assetId) : undefined)
    .orderBy(desc(marketPrices.priceTimestamp), desc(marketPrices.createdAt));
}

/**
 * Query historical market snapshots for an asset
 */
export async function getMarketSnapshots(assetId?: string) {
  return db
    .select({
      id: marketSnapshots.id,
      assetId: marketSnapshots.assetId,
      symbol: assets.symbol,
      assetName: assets.name,
      snapshotDate: marketSnapshots.snapshotDate,
      price: marketSnapshots.price,
      currencyCode: currencies.code,
      currencySymbol: currencies.symbol,
      sourceName: marketPriceSources.name,
    })
    .from(marketSnapshots)
    .innerJoin(assets, eq(assets.id, marketSnapshots.assetId))
    .leftJoin(currencies, eq(currencies.id, marketSnapshots.currencyId))
    .leftJoin(marketPriceSources, eq(marketPriceSources.id, marketSnapshots.sourceId))
    .where(assetId ? eq(marketSnapshots.assetId, assetId) : undefined)
    .orderBy(desc(marketSnapshots.snapshotDate));
}

export async function listPriceSources() {
  await ensurePriceSources();
  return db.select().from(marketPriceSources);
}

/* ------------------------------------------------------------------ */
/* CoinGecko Sync — Updates SSOT price tables market_prices, market_snapshots, prices */
/* ------------------------------------------------------------------ */
// Implements: syncAllCoinGeckoPrices() queries registered coingecko_asset_mappings, fetches current market prices via provider, updates SSOT
// Implements: syncHistoricalPricePoint(assetId, date) fetches price for specific historical date and inserts into market_snapshots
// CRITICAL: Only this service writes to market_prices, market_snapshots, prices — providers only return data

import { coingeckoAssetMappings } from "@/db/schema";

function convertToISOFromCoinGeckoDate(ddmmyyyy: string): string {
  // CoinGecko uses DD-MM-YYYY, convert to YYYY-MM-DD for asOf
  const parts = ddmmyyyy.split("-");
  if (parts.length !== 3) return todayIso();
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

export async function syncAllCoinGeckoPrices(): Promise<{ synced: number; failed: number; details: Array<{ assetId: string; coingeckoId: string; price: string | null; status: string }> }> {
  // Dynamically import provider to avoid circular dependency
  const { CoinGeckoProvider } = await import("./providers/coingecko");

  const provider = new CoinGeckoProvider();

  // Check API key presence — graceful handling
  if (!process.env.COINGECKO_API_KEY) {
    console.log("[MarketDataService] COINGECKO_API_KEY not set — using public API with rate limits");
  }

  // Get all registered mappings
  const mappings = await db.select().from(coingeckoAssetMappings);

  if (mappings.length === 0) {
    console.warn("[MarketDataService] No coingecko_asset_mappings found — nothing to sync. Use mapAssetToCoinGeckoAction to register mappings.");
    return { synced: 0, failed: 0, details: [] };
  }

  const coinIds = mappings.map((m) => m.coingeckoId);
  const vsCurrencies = ["usd"];

  let priceData: Awaited<ReturnType<typeof provider.getSimplePrice>> | null = null;

  try {
    priceData = await provider.getSimplePrice(coinIds, vsCurrencies);
  } catch (e) {
    console.error("[MarketDataService] Failed to fetch simple prices from CoinGecko", e);
    return {
      synced: 0,
      failed: mappings.length,
      details: mappings.map((m) => ({
        assetId: m.internalAssetId,
        coingeckoId: m.coingeckoId,
        price: null,
        status: "fetch_failed",
      })),
    };
  }

  if (!priceData) {
    return {
      synced: 0,
      failed: mappings.length,
      details: mappings.map((m) => ({
        assetId: m.internalAssetId,
        coingeckoId: m.coingeckoId,
        price: null,
        status: "no_data",
      })),
    };
  }

  let synced = 0;
  let failed = 0;
  const details: Array<{ assetId: string; coingeckoId: string; price: string | null; status: string }> = [];

  for (const mapping of mappings) {
    const priceEntry = (priceData as any)[mapping.coingeckoId];
    const priceUSD = priceEntry?.usd ?? null;

    if (!priceUSD) {
      failed++;
      details.push({
        assetId: mapping.internalAssetId,
        coingeckoId: mapping.coingeckoId,
        price: null,
        status: "price_not_found",
      });
      continue;
    }

    try {
      // Validate asset exists
      const [assetRow] = await db.select().from(assets).where(eq(assets.id, mapping.internalAssetId)).limit(1);
      if (!assetRow) {
        failed++;
        details.push({
          assetId: mapping.internalAssetId,
          coingeckoId: mapping.coingeckoId,
          price: null,
          status: "asset_not_found",
        });
        continue;
      }

      // Update SSOT price tables via recordManualPrice with source COINGECKO
      await recordManualPrice({
        assetId: mapping.internalAssetId,
        price: String(priceUSD),
        asOfDate: todayIso(),
        sourceName: "COINGECKO",
        sourceType: "api",
      });

      // Update last_synced_at in mapping
      await db
        .update(coingeckoAssetMappings)
        .set({ lastSyncedAt: new Date() })
        .where(eq(coingeckoAssetMappings.coingeckoId, mapping.coingeckoId));

      synced++;
      details.push({
        assetId: mapping.internalAssetId,
        coingeckoId: mapping.coingeckoId,
        price: String(priceUSD),
        status: "synced",
      });
    } catch (e) {
      console.error(`[MarketDataService] Failed to sync price for ${mapping.coingeckoId}`, e);
      failed++;
      details.push({
        assetId: mapping.internalAssetId,
        coingeckoId: mapping.coingeckoId,
        price: null,
        status: `error: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  return { synced, failed, details };
}

export async function syncHistoricalPricePoint(assetId: string, date: string): Promise<{ id: string; price: string } | null> {
  // date param expected as YYYY-MM-DD (ISO) for our API, but CoinGecko needs DD-MM-YYYY
  // Validate asset exists
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${assetId}`);

  // Find coingecko mapping for this asset
  const [mapping] = await db
    .select()
    .from(coingeckoAssetMappings)
    .where(eq(coingeckoAssetMappings.internalAssetId, assetId))
    .limit(1);

  if (!mapping) {
    throw new Error(`No CoinGecko mapping found for asset ${assetId}. Use mapAssetToCoinGeckoAction to register.`);
  }

  // Convert date YYYY-MM-DD to DD-MM-YYYY for CoinGecko
  const parts = date.split("-");
  if (parts.length !== 3) throw new Error(`Invalid date format, expected YYYY-MM-DD, got ${date}`);
  const [yyyy, mm, dd] = parts;
  const coingeckoDate = `${dd.padStart(2, "0")}-${mm.padStart(2, "0")}-${yyyy}`;

  const { CoinGeckoProvider } = await import("./providers/coingecko");
  const provider = new CoinGeckoProvider();

  const result = await provider.getHistoricalPrice(mapping.coingeckoId, coingeckoDate);

  if (!result || result.price === null) {
    console.warn(`[MarketDataService] No historical price found for ${mapping.coingeckoId} on ${coingeckoDate}`);
    return null;
  }

  // Insert into market_snapshots via recordManualPrice with specific asOfDate
  const record = await recordManualPrice({
    assetId,
    price: String(result.price),
    asOfDate: date, // YYYY-MM-DD for our SSOT
    sourceName: "COINGECKO",
    sourceType: "api",
  });

  return { id: record.id, price: String(result.price) };
}

export async function mapAssetToCoinGecko(internalAssetId: string, coingeckoId: string): Promise<{ id: string }> {
  // Validate asset exists
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, internalAssetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${internalAssetId}`);

  // Validate coingeckoId exists via search (optional, best effort)
  try {
    const { CoinGeckoProvider } = await import("./providers/coingecko");
    const provider = new CoinGeckoProvider();
    const marketData = await provider.getCoinMarketData(coingeckoId);
    if (!marketData) {
      console.warn(`[MarketDataService] CoinGecko ID ${coingeckoId} not found via API, but mapping will still be created`);
    }
  } catch {
    // ignore validation errors, allow mapping
  }

  // Check symbol from asset for convenience
  const symbol = assetRow.symbol;

  const [existing] = await db
    .select()
    .from(coingeckoAssetMappings)
    .where(eq(coingeckoAssetMappings.coingeckoId, coingeckoId))
    .limit(1);

  if (existing) {
    // Update existing mapping
    const [updated] = await db
      .update(coingeckoAssetMappings)
      .set({
        internalAssetId,
        symbol,
        lastSyncedAt: new Date(),
      })
      .where(eq(coingeckoAssetMappings.coingeckoId, coingeckoId))
      .returning();
    return { id: updated.id };
  } else {
    const [inserted] = await db
      .insert(coingeckoAssetMappings)
      .values({
        internalAssetId,
        coingeckoId,
        symbol,
        lastSyncedAt: new Date(),
      })
      .returning();
    return { id: inserted.id };
  }
}

export async function getCoingeckoMappings() {
  return db.select().from(coingeckoAssetMappings);
}

export async function searchCoingeckoCoins(query: string) {
  const { CoinGeckoProvider } = await import("./providers/coingecko");
  const provider = new CoinGeckoProvider();
  return provider.searchCoin(query);
}
