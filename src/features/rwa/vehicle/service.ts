/**
 * RWA Vehicle Service — Identity Only, Isolated from Ledger
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, vehicleAssets } from "@/db/schema";
import type { CreateVehicleInput, VehicleAsset } from "../types";

export async function createVehicleAsset(input: CreateVehicleInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  const [inserted] = await db
    .insert(vehicleAssets)
    .values({
      assetId: input.assetId,
      userId: input.userId ?? null,
      brand: input.brand,
      model: input.model,
      year: input.year,
      licensePlate: input.licensePlate ?? null,
      chassisNumber: input.chassisNumber ?? null,
      mileage: input.mileage ?? null,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: vehicleAssets.assetId,
      set: {
        userId: input.userId ?? null,
        brand: input.brand,
        model: input.model,
        year: input.year,
        licensePlate: input.licensePlate ?? null,
        chassisNumber: input.chassisNumber ?? null,
        mileage: input.mileage ?? null,
        notes: input.notes ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { id: inserted.id };
}

export async function getVehicleAsset(assetId: string): Promise<VehicleAsset | null> {
  const rows = await db
    .select({
      id: vehicleAssets.id,
      assetId: vehicleAssets.assetId,
      assetSymbol: assets.symbol,
      userId: vehicleAssets.userId,
      brand: vehicleAssets.brand,
      model: vehicleAssets.model,
      year: vehicleAssets.year,
      licensePlate: vehicleAssets.licensePlate,
      chassisNumber: vehicleAssets.chassisNumber,
      mileage: vehicleAssets.mileage,
      notes: vehicleAssets.notes,
      createdAt: vehicleAssets.createdAt,
      updatedAt: vehicleAssets.updatedAt,
    })
    .from(vehicleAssets)
    .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
    .where(eq(vehicleAssets.assetId, assetId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    brand: r.brand,
    model: r.model,
    year: r.year,
    licensePlate: r.licensePlate,
    chassisNumber: r.chassisNumber,
    mileage: r.mileage,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

export async function listVehicleAssets(userId?: string): Promise<VehicleAsset[]> {
  const rows = await db
    .select({
      id: vehicleAssets.id,
      assetId: vehicleAssets.assetId,
      assetSymbol: assets.symbol,
      userId: vehicleAssets.userId,
      brand: vehicleAssets.brand,
      model: vehicleAssets.model,
      year: vehicleAssets.year,
      licensePlate: vehicleAssets.licensePlate,
      chassisNumber: vehicleAssets.chassisNumber,
      mileage: vehicleAssets.mileage,
      notes: vehicleAssets.notes,
      createdAt: vehicleAssets.createdAt,
      updatedAt: vehicleAssets.updatedAt,
    })
    .from(vehicleAssets)
    .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
    .orderBy(desc(vehicleAssets.createdAt));

  let filtered = rows;
  if (userId) filtered = filtered.filter((r) => r.userId === userId);

  return filtered.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    brand: r.brand,
    model: r.model,
    year: r.year,
    licensePlate: r.licensePlate,
    chassisNumber: r.chassisNumber,
    mileage: r.mileage,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}
