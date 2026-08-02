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
