/**
 * Valuation Engine — Separate Domain
 * Implements: Asset -> Valuation Source -> Valuation Event -> Valuation Engine
 * Do not mix price with valuation
 * Different policies: Crypto Market Price, Gold Spot Price, Real Estate Appraisal, Private Equity Manual Valuation
 * Reads Market Data SSOT + RWA valuation events + manual sources, produces valuation, never writes ledger
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, currencies, valuationEvents, valuationSources } from "@/db/schema";
import { D } from "@/domain/decimal";
import { getMarketPrices, getMarketSnapshots } from "@/features/marketData/service";
import type { CreateValuationEventInput, CreateValuationSourceInput, ValuationEvent, ValuationResult, ValuationSource } from "./types";
import { todayIso } from "@/lib/format";

export async function upsertValuationSource(input: CreateValuationSourceInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  const [inserted] = await db
    .insert(valuationSources)
    .values({
      assetId: input.assetId,
      sourceType: input.sourceType ?? "market_price",
      primaryProviderName: input.primaryProviderName ?? "MANUAL",
      backupProviderName: input.backupProviderName ?? null,
      isActive: input.isActive ?? true,
      config: input.config ?? null,
    })
    .onConflictDoUpdate({
      target: valuationSources.assetId,
      set: {
        sourceType: input.sourceType ?? "market_price",
        primaryProviderName: input.primaryProviderName ?? "MANUAL",
        backupProviderName: input.backupProviderName ?? null,
        isActive: input.isActive ?? true,
        config: input.config ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { id: inserted.id };
}

export async function getValuationSource(assetId: string): Promise<ValuationSource | null> {
  const rows = await db
    .select({
      id: valuationSources.id,
      assetId: valuationSources.assetId,
      assetSymbol: assets.symbol,
      sourceType: valuationSources.sourceType,
      primaryProviderName: valuationSources.primaryProviderName,
      backupProviderName: valuationSources.backupProviderName,
      isActive: valuationSources.isActive,
      config: valuationSources.config,
      createdAt: valuationSources.createdAt,
    })
    .from(valuationSources)
    .innerJoin(assets, eq(assets.id, valuationSources.assetId))
    .where(eq(valuationSources.assetId, assetId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    sourceType: r.sourceType as any,
    primaryProviderName: r.primaryProviderName as any,
    backupProviderName: r.backupProviderName,
    isActive: r.isActive,
    config: r.config,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function createValuationEvent(input: CreateValuationEventInput): Promise<{ id: string }> {
  const priceDec = D(input.price);
  if (priceDec.lte(0)) throw new Error("Valuation price must be greater than zero");

  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  const [inserted] = await db
    .insert(valuationEvents)
    .values({
      assetId: input.assetId,
      valuationDate: input.valuationDate,
      price: priceDec.toString(),
      currencyId: input.currencyId ?? null,
      sourceType: input.sourceType ?? "market_price",
      providerName: input.providerName ?? "MANUAL",
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? null,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [valuationEvents.assetId, valuationEvents.valuationDate, valuationEvents.providerName],
      set: {
        price: priceDec.toString(),
        currencyId: input.currencyId ?? null,
        sourceType: input.sourceType ?? "market_price",
        metadata: input.metadata ?? null,
        note: input.note ?? null,
      },
    })
    .returning();

  return { id: inserted.id };
}

export async function getValuationEvents(assetId: string): Promise<ValuationEvent[]> {
  const rows = await db
    .select({
      id: valuationEvents.id,
      assetId: valuationEvents.assetId,
      assetSymbol: assets.symbol,
      valuationDate: valuationEvents.valuationDate,
      price: valuationEvents.price,
      currencyId: valuationEvents.currencyId,
      currencyCode: currencies.code,
      sourceType: valuationEvents.sourceType,
      providerName: valuationEvents.providerName,
      sourceId: valuationEvents.sourceId,
      metadata: valuationEvents.metadata,
      note: valuationEvents.note,
      createdAt: valuationEvents.createdAt,
    })
    .from(valuationEvents)
    .innerJoin(assets, eq(assets.id, valuationEvents.assetId))
    .leftJoin(currencies, eq(currencies.id, valuationEvents.currencyId))
    .where(eq(valuationEvents.assetId, assetId))
    .orderBy(desc(valuationEvents.valuationDate));

  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    valuationDate: r.valuationDate,
    price: r.price.toString(),
    currencyId: r.currencyId,
    currencyCode: r.currencyCode ?? "USD",
    sourceType: r.sourceType as any,
    providerName: r.providerName as any,
    sourceId: r.sourceId,
    metadata: r.metadata,
    note: r.note,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

/**
 * Valuation Engine — selects latest valuation per policy
 * For Crypto: Market Price from market_prices SSOT
 * For Gold: Spot Price from market_snapshots
 * For Real Estate: Appraisal from valuation_events where sourceType appraisal
 * For Private Equity: Manual Valuation
 */
export async function getCurrentValuation(assetId: string): Promise<ValuationResult | null> {
  const source = await getValuationSource(assetId);
  const sourceType = source?.sourceType ?? "market_price";
  const providerName = (source?.primaryProviderName as any) ?? "MANUAL";

  // Try valuation_events first — most recent
  const events = await getValuationEvents(assetId);
  if (events.length > 0) {
    const latest = events[0];
    return {
      assetId,
      assetSymbol: latest.assetSymbol ?? "",
      valuationDate: latest.valuationDate,
      price: latest.price,
      currencyCode: latest.currencyCode ?? "USD",
      sourceType: latest.sourceType,
      providerName: latest.providerName,
      valuationEventId: latest.id,
      isFallback: false,
    };
  }

  // Fallback to Market Data SSOT for market_price policy
  if (sourceType === "market_price" || sourceType === "spot_price") {
    try {
      const quotes = await getMarketPrices(assetId);
      if (quotes.length > 0) {
        return {
          assetId,
          assetSymbol: quotes[0].symbol,
          valuationDate: todayIso(),
          price: quotes[0].price.toString(),
          currencyCode: quotes[0].currencyCode ?? "USD",
          sourceType,
          providerName: (quotes[0].sourceName as any) ?? providerName,
          valuationEventId: null,
          isFallback: true,
          fallbackReason: "No valuation_events, using market_prices SSOT",
        };
      }

      const snaps = await getMarketSnapshots(assetId);
      if (snaps.length > 0) {
        return {
          assetId,
          assetSymbol: snaps[0].symbol,
          valuationDate: snaps[0].snapshotDate,
          price: snaps[0].price.toString(),
          currencyCode: snaps[0].currencyCode ?? "USD",
          sourceType,
          providerName: (snaps[0].sourceName as any) ?? providerName,
          valuationEventId: null,
          isFallback: true,
          fallbackReason: "No valuation_events, using market_snapshots SSOT",
        };
      }
    } catch {
      // ignore
    }
  }

  return null;
}
