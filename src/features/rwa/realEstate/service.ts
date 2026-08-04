/**
 * RWA Real Estate Service — Identity Only
 * Identity: asset_id, type, location — NOT valuation history, NOT ownership details
 * Ownership: separate rwa_ownership_records
 * Valuation: separate rwa_valuation_events
 * Must remain isolated from ledger — No FK to journal_entries, postings, lots — only assets, users
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, realEstateProperties } from "@/db/schema";
import type { CreateRealEstateInput, RealEstateProperty } from "../types";

export async function createRealEstateProperty(input: CreateRealEstateInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  const [inserted] = await db
    .insert(realEstateProperties)
    .values({
      assetId: input.assetId,
      userId: input.userId ?? null,
      propertyType: input.propertyType ?? "apartment",
      city: input.city ?? "Ahvaz",
      area: input.area ?? null,
      address: input.address ?? null,
      sizeSqm: input.sizeSqm ?? null,
      floor: input.floor ?? null,
      yearBuilt: input.yearBuilt ?? null,
      deedNumber: input.deedNumber ?? null,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: realEstateProperties.assetId,
      set: {
        userId: input.userId ?? null,
        propertyType: input.propertyType ?? "apartment",
        city: input.city ?? "Ahvaz",
        area: input.area ?? null,
        address: input.address ?? null,
        sizeSqm: input.sizeSqm ?? null,
        floor: input.floor ?? null,
        yearBuilt: input.yearBuilt ?? null,
        deedNumber: input.deedNumber ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { id: inserted.id };
}

export async function getRealEstateProperty(assetId: string): Promise<RealEstateProperty | null> {
  const rows = await db
    .select({
      id: realEstateProperties.id,
      assetId: realEstateProperties.assetId,
      assetSymbol: assets.symbol,
      userId: realEstateProperties.userId,
      propertyType: realEstateProperties.propertyType,
      city: realEstateProperties.city,
      area: realEstateProperties.area,
      address: realEstateProperties.address,
      sizeSqm: realEstateProperties.sizeSqm,
      floor: realEstateProperties.floor,
      yearBuilt: realEstateProperties.yearBuilt,
      deedNumber: realEstateProperties.deedNumber,
      notes: realEstateProperties.notes,
      createdAt: realEstateProperties.createdAt,
      updatedAt: realEstateProperties.updatedAt,
    })
    .from(realEstateProperties)
    .innerJoin(assets, eq(assets.id, realEstateProperties.assetId))
    .where(eq(realEstateProperties.assetId, assetId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    propertyType: r.propertyType as any,
    city: r.city,
    area: r.area,
    address: r.address,
    sizeSqm: r.sizeSqm ? r.sizeSqm.toString() : null,
    floor: r.floor,
    yearBuilt: r.yearBuilt,
    deedNumber: r.deedNumber,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

export async function listRealEstateProperties(userId?: string): Promise<RealEstateProperty[]> {
  const rows = await db
    .select({
      id: realEstateProperties.id,
      assetId: realEstateProperties.assetId,
      assetSymbol: assets.symbol,
      userId: realEstateProperties.userId,
      propertyType: realEstateProperties.propertyType,
      city: realEstateProperties.city,
      area: realEstateProperties.area,
      address: realEstateProperties.address,
      sizeSqm: realEstateProperties.sizeSqm,
      floor: realEstateProperties.floor,
      yearBuilt: realEstateProperties.yearBuilt,
      deedNumber: realEstateProperties.deedNumber,
      notes: realEstateProperties.notes,
      createdAt: realEstateProperties.createdAt,
      updatedAt: realEstateProperties.updatedAt,
    })
    .from(realEstateProperties)
    .innerJoin(assets, eq(assets.id, realEstateProperties.assetId))
    .orderBy(desc(realEstateProperties.createdAt));

  let filtered = rows;
  if (userId) filtered = filtered.filter((r) => r.userId === userId);

  return filtered.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    propertyType: r.propertyType as any,
    city: r.city,
    area: r.area,
    address: r.address,
    sizeSqm: r.sizeSqm ? r.sizeSqm.toString() : null,
    floor: r.floor,
    yearBuilt: r.yearBuilt,
    deedNumber: r.deedNumber,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}
