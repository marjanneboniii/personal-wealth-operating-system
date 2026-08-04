/**
 * External Asset Mapping — Verified Mappings Connect to Asset Registry
 * Concepts: external_assets and external_asset_mappings
 * Example: External Asset Symbol ABC Contract 0x123 Chain Ethereum Provider DeBank Status Pending Review
 * After approval: Mapped Asset ASSET-001 Status Verified
 * Only verified mappings connect to Asset Registry
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, externalAssetMappings, externalAssets } from "@/db/schema";
import type { CreateMappingInput, ExternalAssetMapping } from "../types";

export async function createMapping(input: CreateMappingInput): Promise<{ id: string }> {
  // Validate external asset exists
  const [ext] = await db.select().from(externalAssets).where(eq(externalAssets.id, input.externalAssetId)).limit(1);
  if (!ext) throw new Error(`External asset not found: ${input.externalAssetId}`);

  // Validate internal asset exists if provided
  if (input.internalAssetId) {
    const [internal] = await db.select().from(assets).where(eq(assets.id, input.internalAssetId)).limit(1);
    if (!internal) throw new Error(`Internal asset not found: ${input.internalAssetId}`);
  }

  const [inserted] = await db
    .insert(externalAssetMappings)
    .values({
      externalAssetId: input.externalAssetId,
      internalAssetId: input.internalAssetId ?? null,
      mappingStatus: input.mappingStatus ?? "pending",
      mappedAt: input.mappingStatus === "verified" ? new Date() : null,
      confidenceScore: input.confidenceScore ?? null,
      mappingSource: input.mappingSource ?? "manual",
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: externalAssetMappings.externalAssetId,
      set: {
        internalAssetId: input.internalAssetId ?? null,
        mappingStatus: input.mappingStatus ?? "pending",
        mappedAt: input.mappingStatus === "verified" ? new Date() : null,
        confidenceScore: input.confidenceScore ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  // If verified, update external asset status to approved
  if (input.mappingStatus === "verified") {
    await db
      .update(externalAssets)
      .set({ discoveryStatus: "approved", reviewedAt: new Date() })
      .where(eq(externalAssets.id, input.externalAssetId));
  }

  return { id: inserted.id };
}

export async function getMappingByExternalId(externalAssetId: string): Promise<ExternalAssetMapping | null> {
  const rows = await db
    .select({
      id: externalAssetMappings.id,
      externalAssetId: externalAssetMappings.externalAssetId,
      internalAssetId: externalAssetMappings.internalAssetId,
      internalSymbol: assets.symbol,
      mappingStatus: externalAssetMappings.mappingStatus,
      mappedAt: externalAssetMappings.mappedAt,
      mappedBy: externalAssetMappings.mappedBy,
      confidenceScore: externalAssetMappings.confidenceScore,
      mappingSource: externalAssetMappings.mappingSource,
      notes: externalAssetMappings.notes,
      createdAt: externalAssetMappings.createdAt,
    })
    .from(externalAssetMappings)
    .leftJoin(assets, eq(assets.id, externalAssetMappings.internalAssetId))
    .where(eq(externalAssetMappings.externalAssetId, externalAssetId))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    externalAssetId: r.externalAssetId,
    internalAssetId: r.internalAssetId,
    internalSymbol: r.internalSymbol ?? undefined,
    mappingStatus: r.mappingStatus as any,
    mappedAt: r.mappedAt?.toISOString() ?? null,
    mappedBy: r.mappedBy,
    confidenceScore: r.confidenceScore ? r.confidenceScore.toString() : null,
    mappingSource: r.mappingSource,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function listMappings(status?: string): Promise<ExternalAssetMapping[]> {
  const rows = await db
    .select({
      id: externalAssetMappings.id,
      externalAssetId: externalAssetMappings.externalAssetId,
      internalAssetId: externalAssetMappings.internalAssetId,
      internalSymbol: assets.symbol,
      mappingStatus: externalAssetMappings.mappingStatus,
      mappedAt: externalAssetMappings.mappedAt,
      mappedBy: externalAssetMappings.mappedBy,
      confidenceScore: externalAssetMappings.confidenceScore,
      mappingSource: externalAssetMappings.mappingSource,
      notes: externalAssetMappings.notes,
      createdAt: externalAssetMappings.createdAt,
    })
    .from(externalAssetMappings)
    .leftJoin(assets, eq(assets.id, externalAssetMappings.internalAssetId))
    .orderBy(desc(externalAssetMappings.createdAt));

  let filtered = rows;
  if (status) filtered = filtered.filter((r) => r.mappingStatus === status);

  return filtered.map((r) => ({
    id: r.id,
    externalAssetId: r.externalAssetId,
    internalAssetId: r.internalAssetId,
    internalSymbol: r.internalSymbol ?? undefined,
    mappingStatus: r.mappingStatus as any,
    mappedAt: r.mappedAt?.toISOString() ?? null,
    mappedBy: r.mappedBy,
    confidenceScore: r.confidenceScore ? r.confidenceScore.toString() : null,
    mappingSource: r.mappingSource,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}
