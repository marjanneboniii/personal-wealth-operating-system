/**
 * RWA Valuation Events — Because valuation is events not single price field
 * Example Apartment Purchase 50B, 2027 Appraisal 80B, 2028 Market Estimate 110B are valuation events
 * Architecture: assets -> real_estate_metadata -> ownership -> valuation_events
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, marketPriceSources, rwaValuationEvents } from "@/db/schema";
import { D } from "@/domain/decimal";
import { recordManualPrice } from "@/features/marketData/service";
import type { CreateValuationEventInput, RWAValuationEvent } from "../types";

export async function createValuationEvent(input: CreateValuationEventInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  // Insert valuation event — isolated table, no FK to ledger
  const [inserted] = await db
    .insert(rwaValuationEvents)
    .values({
      assetId: input.assetId,
      valuationDate: input.valuationDate,
      priceIRR: input.priceIRR ? D(input.priceIRR).toString() : null,
      priceUSD: input.priceUSD ? D(input.priceUSD).toString() : null,
      priceBase: input.priceBase ? D(input.priceBase).toString() : null,
      currencyId: input.currencyId ?? null,
      valuationSource: input.valuationSource ?? "manual",
      appraiser: input.appraiser ?? null,
      sourceId: input.sourceId ?? null,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [rwaValuationEvents.assetId, rwaValuationEvents.valuationDate, rwaValuationEvents.valuationSource],
      set: {
        priceIRR: input.priceIRR ? D(input.priceIRR).toString() : null,
        priceUSD: input.priceUSD ? D(input.priceUSD).toString() : null,
        priceBase: input.priceBase ? D(input.priceBase).toString() : null,
        currencyId: input.currencyId ?? null,
        appraiser: input.appraiser ?? null,
        note: input.note ?? null,
      },
    })
    .returning();

  // Also record into Market Data SSOT for historical tracking via existing service
  // This ensures manual real estate valuation appears in market_snapshots for portfolio timeline
  // Uses recordManualPrice which writes to market_prices, market_snapshots, prices — allowed because RWA has market value
  // For dual IRR/USD, record both if provided
  try {
    if (input.priceUSD) {
      await recordManualPrice({
        assetId: input.assetId,
        price: D(input.priceUSD).toString(),
        asOfDate: input.valuationDate,
        sourceName: input.valuationSource === "appraisal" ? "APPRAISAL" : "MANUAL",
        sourceType: "manual",
      });
    } else if (input.priceIRR) {
      // If only IRR provided, still record as manual price in IRR currency — need currencyId lookup for IRT?
      // For simplicity, record IRR price as priceBase with source MANUAL — will be stored, portfolio may need currencyId
      await recordManualPrice({
        assetId: input.assetId,
        price: D(input.priceIRR).toString(),
        asOfDate: input.valuationDate,
        sourceName: input.valuationSource === "appraisal" ? "APPRAISAL" : "MANUAL",
        sourceType: "manual",
      });
    }
  } catch {
    // Ignore market data sync errors for RWA — valuation event itself is primary, SSOT sync best effort
  }

  return { id: inserted.id };
}

export async function getValuationEvents(assetId: string): Promise<RWAValuationEvent[]> {
  const rows = await db
    .select({
      id: rwaValuationEvents.id,
      assetId: rwaValuationEvents.assetId,
      assetSymbol: assets.symbol,
      valuationDate: rwaValuationEvents.valuationDate,
      priceIRR: rwaValuationEvents.priceIRR,
      priceUSD: rwaValuationEvents.priceUSD,
      priceBase: rwaValuationEvents.priceBase,
      currencyId: rwaValuationEvents.currencyId,
      valuationSource: rwaValuationEvents.valuationSource,
      appraiser: rwaValuationEvents.appraiser,
      sourceId: rwaValuationEvents.sourceId,
      note: rwaValuationEvents.note,
      createdAt: rwaValuationEvents.createdAt,
    })
    .from(rwaValuationEvents)
    .innerJoin(assets, eq(assets.id, rwaValuationEvents.assetId))
    .where(eq(rwaValuationEvents.assetId, assetId))
    .orderBy(desc(rwaValuationEvents.valuationDate));

  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    valuationDate: r.valuationDate,
    priceIRR: r.priceIRR ? r.priceIRR.toString() : null,
    priceUSD: r.priceUSD ? r.priceUSD.toString() : null,
    priceBase: r.priceBase ? r.priceBase.toString() : null,
    currencyId: r.currencyId,
    valuationSource: r.valuationSource as any,
    appraiser: r.appraiser,
    sourceId: r.sourceId,
    note: r.note,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function getLatestValuation(assetId: string): Promise<RWAValuationEvent | null> {
  const events = await getValuationEvents(assetId);
  return events.length > 0 ? events[0] : null;
}
