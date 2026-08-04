/**
 * External Asset Discovery — Quarantine for Unknown Tokens
 * Never: Unknown Token -> INSERT INTO assets (spam/scam/dust)
 * Correct: Unknown Token -> Discovery -> Review Queue -> Mapping -> Asset Registry
 * Only verified mappings connect to Asset Registry
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { externalAssets, networks } from "@/db/schema";
import type { CreateExternalAssetInput, ExternalAsset } from "../types";

export async function discoverExternalAsset(input: CreateExternalAssetInput): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(externalAssets)
    .values({
      providerName: input.providerName,
      rawSymbol: input.rawSymbol ?? null,
      rawName: input.rawName ?? null,
      contractAddress: input.contractAddress ? input.contractAddress.toLowerCase() : null,
      chainId: input.chainId ?? null,
      networkId: input.networkId ?? null,
      decimals: input.decimals ?? null,
      tokenStandard: input.tokenStandard ?? null,
      logoUri: input.logoUri ?? null,
      explorerUrl: input.explorerUrl ?? null,
      sourceMetadata: input.sourceMetadata ?? null,
      discoveryStatus: "pending_review",
      notes: input.notes ?? null,
    })
    .returning();

  return { id: inserted.id };
}

export async function getExternalAsset(id: string): Promise<ExternalAsset | null> {
  const rows = await db
    .select({
      id: externalAssets.id,
      providerName: externalAssets.providerName,
      rawSymbol: externalAssets.rawSymbol,
      rawName: externalAssets.rawName,
      contractAddress: externalAssets.contractAddress,
      chainId: externalAssets.chainId,
      networkId: externalAssets.networkId,
      networkCode: networks.code,
      decimals: externalAssets.decimals,
      tokenStandard: externalAssets.tokenStandard,
      logoUri: externalAssets.logoUri,
      explorerUrl: externalAssets.explorerUrl,
      sourceMetadata: externalAssets.sourceMetadata,
      discoveryStatus: externalAssets.discoveryStatus,
      discoveredAt: externalAssets.discoveredAt,
      reviewedAt: externalAssets.reviewedAt,
      reviewedBy: externalAssets.reviewedBy,
      notes: externalAssets.notes,
      createdAt: externalAssets.createdAt,
    })
    .from(externalAssets)
    .leftJoin(networks, eq(networks.id, externalAssets.networkId))
    .where(eq(externalAssets.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    providerName: r.providerName,
    rawSymbol: r.rawSymbol,
    rawName: r.rawName,
    contractAddress: r.contractAddress,
    chainId: r.chainId,
    networkId: r.networkId,
    networkCode: r.networkCode ?? undefined,
    decimals: r.decimals,
    tokenStandard: r.tokenStandard,
    logoUri: r.logoUri,
    explorerUrl: r.explorerUrl,
    sourceMetadata: r.sourceMetadata,
    discoveryStatus: r.discoveryStatus as any,
    discoveredAt: r.discoveredAt?.toISOString() ?? new Date().toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: r.reviewedBy,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

export async function listExternalAssets(status?: string): Promise<ExternalAsset[]> {
  const rows = await db
    .select({
      id: externalAssets.id,
      providerName: externalAssets.providerName,
      rawSymbol: externalAssets.rawSymbol,
      rawName: externalAssets.rawName,
      contractAddress: externalAssets.contractAddress,
      chainId: externalAssets.chainId,
      networkId: externalAssets.networkId,
      networkCode: networks.code,
      decimals: externalAssets.decimals,
      tokenStandard: externalAssets.tokenStandard,
      logoUri: externalAssets.logoUri,
      explorerUrl: externalAssets.explorerUrl,
      sourceMetadata: externalAssets.sourceMetadata,
      discoveryStatus: externalAssets.discoveryStatus,
      discoveredAt: externalAssets.discoveredAt,
      reviewedAt: externalAssets.reviewedAt,
      reviewedBy: externalAssets.reviewedBy,
      notes: externalAssets.notes,
      createdAt: externalAssets.createdAt,
    })
    .from(externalAssets)
    .leftJoin(networks, eq(networks.id, externalAssets.networkId))
    .orderBy(desc(externalAssets.discoveredAt));

  let filtered = rows;
  if (status) filtered = filtered.filter((r) => r.discoveryStatus === status);

  return filtered.map((r) => ({
    id: r.id,
    providerName: r.providerName,
    rawSymbol: r.rawSymbol,
    rawName: r.rawName,
    contractAddress: r.contractAddress,
    chainId: r.chainId,
    networkId: r.networkId,
    networkCode: r.networkCode ?? undefined,
    decimals: r.decimals,
    tokenStandard: r.tokenStandard,
    logoUri: r.logoUri,
    explorerUrl: r.explorerUrl,
    sourceMetadata: r.sourceMetadata,
    discoveryStatus: r.discoveryStatus as any,
    discoveredAt: r.discoveredAt?.toISOString() ?? new Date().toISOString(),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: r.reviewedBy,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function updateDiscoveryStatus(
  id: string,
  status: "pending_review" | "approved" | "rejected" | "ignored",
  reviewedBy?: string,
): Promise<void> {
  await db
    .update(externalAssets)
    .set({
      discoveryStatus: status,
      reviewedAt: new Date(),
      reviewedBy: reviewedBy ?? null,
      updatedAt: new Date(),
    })
    .where(eq(externalAssets.id, id));
}
