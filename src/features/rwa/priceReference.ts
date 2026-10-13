/**
 * Recorded market prices used as the reference band of `priceValidation`.
 * Server only. A missing reference simply falls back to the internal bands.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { marketPriceSnapshots, vehicleValuationSnapshots } from "@/db/schema";

const toNum = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Latest model-level (catalog) market value of every model, in USD. */
export async function listVehicleReferenceUsd(): Promise<Record<string, number>> {
  const rows = await db
    .select({ catalogId: vehicleValuationSnapshots.vehicleCatalogId, usd: vehicleValuationSnapshots.currentValueUsd })
    .from(vehicleValuationSnapshots)
    .where(isNull(vehicleValuationSnapshots.userVehicleId))
    .orderBy(desc(vehicleValuationSnapshots.snapshotDate));
  const out: Record<string, number> = {};
  for (const row of rows) {
    const usd = toNum(row.usd);
    if (row.catalogId && usd && !(row.catalogId in out)) out[row.catalogId] = usd;
  }
  return out;
}

export async function vehicleReferenceUsd(catalogId: string): Promise<number | null> {
  const [row] = await db
    .select({ usd: vehicleValuationSnapshots.currentValueUsd })
    .from(vehicleValuationSnapshots)
    .where(and(eq(vehicleValuationSnapshots.vehicleCatalogId, catalogId), isNull(vehicleValuationSnapshots.userVehicleId)))
    .orderBy(desc(vehicleValuationSnapshots.snapshotDate))
    .limit(1);
  return toNum(row?.usd);
}

/** Latest per-m² market price (USD) the user recorded, keyed «neighborhoodId:propertyTypeId». */
export async function listPropertyReferencePpsqmUsd(userId?: string | null): Promise<Record<string, number>> {
  const rows = await db
    .select({
      neighborhoodId: marketPriceSnapshots.neighborhoodId,
      propertyTypeId: marketPriceSnapshots.propertyTypeId,
      ppsqm: marketPriceSnapshots.pricePerSqmToman,
      rate: marketPriceSnapshots.usdRate,
    })
    .from(marketPriceSnapshots)
    .where(userId ? eq(marketPriceSnapshots.userId, userId) : isNull(marketPriceSnapshots.userId))
    .orderBy(desc(marketPriceSnapshots.observedOn));
  const out: Record<string, number> = {};
  for (const row of rows) {
    const key = `${row.neighborhoodId}:${row.propertyTypeId}`;
    const ppsqm = toNum(row.ppsqm), rate = toNum(row.rate);
    if (ppsqm && rate && !(key in out)) out[key] = ppsqm / rate;
  }
  return out;
}

export async function propertyReferencePpsqmUsd(userId: string | null | undefined, neighborhoodId: string, propertyTypeId: string): Promise<number | null> {
  return (await listPropertyReferencePpsqmUsd(userId))[`${neighborhoodId}:${propertyTypeId}`] ?? null;
}
