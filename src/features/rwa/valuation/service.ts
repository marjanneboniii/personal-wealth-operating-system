/**
 * Tenant-scoped manual valuation events for generic real assets.
 *
 * This service is independent from CoinGecko and the retired Market Data
 * subsystem. It writes only real-asset valuation events after verifying an
 * active ownership record for the same tenant.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, rwaOwnershipRecords, rwaValuationEvents } from "@/db/schema";
import { D } from "@/domain/decimal";
import type { CreateValuationEventInput, RWAValuationEvent } from "../types";

async function assertRealAssetOwnership(assetId: string, userId: string | null): Promise<void> {
  const [owned] = await db
    .select({ id: rwaOwnershipRecords.id })
    .from(rwaOwnershipRecords)
    .where(and(
      eq(rwaOwnershipRecords.assetId, assetId),
      eq(rwaOwnershipRecords.isActive, true),
      userId ? eq(rwaOwnershipRecords.userId, userId) : sql`${rwaOwnershipRecords.userId} is null`,
    ))
    .limit(1);
  if (!owned) throw new Error("دارایی واقعی یافت نشد یا متعلق به شما نیست.");
}

export async function createValuationEvent(input: CreateValuationEventInput): Promise<{ id: string }> {
  const userId = input.userId ?? null;
  const [asset] = await db.select({ id: assets.id }).from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!asset) throw new Error(`Asset not found: ${input.assetId}`);
  await assertRealAssetOwnership(input.assetId, userId);

  const amounts = [input.priceIRR, input.priceUSD, input.priceBase].filter(Boolean);
  if (!amounts.length || amounts.every((amount) => D(amount!).lte(0))) {
    throw new Error("ارزش فعلی دارایی باید بزرگ‌تر از صفر باشد.");
  }

  const [inserted] = await db
    .insert(rwaValuationEvents)
    .values({
      assetId: input.assetId,
      userId,
      valuationDate: input.valuationDate,
      priceIRR: input.priceIRR ? D(input.priceIRR).toString() : null,
      priceUSD: input.priceUSD ? D(input.priceUSD).toString() : null,
      priceBase: input.priceBase ? D(input.priceBase).toString() : null,
      currencyId: input.currencyId ?? null,
      valuationSource: input.valuationSource ?? "manual",
      appraiser: input.appraiser ?? null,
      note: input.note ?? null,
    })
    .onConflictDoUpdate({
      target: [
        rwaValuationEvents.userId,
        rwaValuationEvents.assetId,
        rwaValuationEvents.valuationDate,
        rwaValuationEvents.valuationSource,
      ],
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

  return { id: inserted.id };
}

export async function getValuationEvents(
  assetId: string,
  userId?: string | null,
): Promise<RWAValuationEvent[]> {
  const rows = await db
    .select({
      id: rwaValuationEvents.id,
      assetId: rwaValuationEvents.assetId,
      assetSymbol: assets.symbol,
      userId: rwaValuationEvents.userId,
      valuationDate: rwaValuationEvents.valuationDate,
      priceIRR: rwaValuationEvents.priceIRR,
      priceUSD: rwaValuationEvents.priceUSD,
      priceBase: rwaValuationEvents.priceBase,
      currencyId: rwaValuationEvents.currencyId,
      valuationSource: rwaValuationEvents.valuationSource,
      appraiser: rwaValuationEvents.appraiser,
      note: rwaValuationEvents.note,
      createdAt: rwaValuationEvents.createdAt,
    })
    .from(rwaValuationEvents)
    .innerJoin(assets, eq(assets.id, rwaValuationEvents.assetId))
    .where(and(
      eq(rwaValuationEvents.assetId, assetId),
      userId ? eq(rwaValuationEvents.userId, userId) : sql`${rwaValuationEvents.userId} is null`,
    ))
    .orderBy(desc(rwaValuationEvents.valuationDate));

  return rows.map((row) => ({
    id: row.id,
    assetId: row.assetId,
    assetSymbol: row.assetSymbol,
    userId: row.userId,
    valuationDate: row.valuationDate,
    priceIRR: row.priceIRR?.toString() ?? null,
    priceUSD: row.priceUSD?.toString() ?? null,
    priceBase: row.priceBase?.toString() ?? null,
    currencyId: row.currencyId,
    valuationSource: row.valuationSource as RWAValuationEvent["valuationSource"],
    appraiser: row.appraiser,
    note: row.note,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function getLatestValuation(
  assetId: string,
  userId?: string | null,
): Promise<RWAValuationEvent | null> {
  return (await getValuationEvents(assetId, userId))[0] ?? null;
}
