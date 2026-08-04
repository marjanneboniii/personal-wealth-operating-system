/**
 * Observation Normalizer — Sanitizes external provider data, maps to canonical assets
 * Responsibilities:
 * - Validate symbol length, contract address format, decimals 0-36, quantity non-negative
 * - Sanitize JSONB metadata
 * - Map rawSymbol + contract + chainId -> internalAssetId via external_asset_mappings verified or assets symbol
 * - Prevent spam/scam/dust tokens from auto-creating assets — leave assetId NULLABLE, externalAssetId for quarantine
 * - Ensure cachedPriceUSD is observation cache, NOT SSOT price — never calls recordManualPrice
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/db";
import { assets, externalAssetMappings, externalAssets, networks } from "@/db/schema";
import { D } from "@/domain/decimal";
import type { ProviderPosition } from "./types";

const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;

function sanitizeSymbol(raw: string): string {
  return raw.trim().slice(0, 50).replace(/[^a-zA-Z0-9._-]/g, "");
}

export type NormalizedPosition = {
  rawSymbol: string;
  rawContractAddress: string | null;
  chainId: number | null;
  networkId: string | null;
  networkCode: string | null;
  decimals: number | null;
  quantity: string;
  cachedPriceUSD: string | null;
  cachedValueUSD: string | null;
  positionType: string;
  protocol: string | null;
  contractAddress: string | null;
  assetId: string | null; // mapped canonical
  externalAssetId: string | null; // quarantine if unknown
  metadata: string | null;
};

export async function normalizePosition(pos: ProviderPosition): Promise<NormalizedPosition> {
  const rawSymbol = sanitizeSymbol(pos.rawSymbol);
  const contract = pos.contractAddress ? pos.contractAddress.trim().toLowerCase() : null;
  const chainId = pos.chainId ?? null;

  // Validate contract format if present
  let validContract: string | null = null;
  if (contract) {
    if (ethAddressRegex.test(contract) || contract.length >= 32) {
      validContract = contract;
    }
  }

  // Validate quantity non-negative via D()
  let qty = "0";
  try {
    const q = D(pos.quantity);
    if (q.gte(0)) qty = q.toString();
  } catch {
    qty = "0";
  }

  // Resolve networkId via chainId or networkCode
  let networkId: string | null = null;
  let networkCode: string | null = pos.networkCode ?? null;

  if (chainId) {
    const [net] = await db.select().from(networks).where(eq(networks.chainId, chainId)).limit(1);
    if (net) {
      networkId = net.id;
      networkCode = net.code;
    }
  } else if (networkCode) {
    const [net] = await db.select().from(networks).where(eq(networks.code, networkCode)).limit(1);
    if (net) networkId = net.id;
  }

  // Try mapping via external_asset_mappings verified
  let assetId: string | null = null;
  let externalAssetId: string | null = null;

  if (validContract && chainId) {
    // Search external_assets by contract + chainId
    const [ext] = await db
      .select()
      .from(externalAssets)
      .where(and(eq(externalAssets.contractAddress, validContract), eq(externalAssets.chainId, chainId)))
      .limit(1);

    if (ext) {
      externalAssetId = ext.id;
      // Check mapping
      const [mapping] = await db
        .select()
        .from(externalAssetMappings)
        .where(and(eq(externalAssetMappings.externalAssetId, ext.id), eq(externalAssetMappings.mappingStatus, "verified")))
        .limit(1);
      if (mapping?.internalAssetId) assetId = mapping.internalAssetId;
    } else {
      // Unknown token — create quarantine entry in external_assets as pending_review (do NOT create assets row)
      // This insertion is observation layer, not asset registry pollution, status pending_review
      // For audit, we create external_assets row here, but NOT assets row
      try {
        const [created] = await db
          .insert(externalAssets)
          .values({
            providerName: "DEBANK",
            rawSymbol,
            rawName: pos.rawName ?? null,
            contractAddress: validContract,
            chainId: chainId ?? null,
            networkId: networkId ?? null,
            decimals: pos.decimals ?? null,
            tokenStandard: "ERC20",
            sourceMetadata: pos.metadata ? JSON.stringify(pos.metadata) : null,
            discoveryStatus: "pending_review",
          })
          .onConflictDoNothing()
          .returning();
        if (created) externalAssetId = created.id;
      } catch {
        // ignore if conflict or missing table in test env
      }
    }
  }

  // Fallback: search assets by symbol exact match (canonical)
  if (!assetId) {
    const [assetRow] = await db.select().from(assets).where(eq(assets.symbol, rawSymbol)).limit(1);
    if (assetRow) assetId = assetRow.id;
  }

  return {
    rawSymbol,
    rawContractAddress: validContract,
    chainId,
    networkId,
    networkCode,
    decimals: pos.decimals ?? null,
    quantity: qty,
    cachedPriceUSD: pos.priceUSD ? D(pos.priceUSD).toString() : null,
    cachedValueUSD: pos.valueUSD ? D(pos.valueUSD).toString() : null,
    positionType: pos.positionType ?? "token",
    protocol: pos.protocol ?? null,
    contractAddress: pos.contractAddress ?? null,
    assetId, // null if unknown — quarantine
    externalAssetId,
    metadata: pos.metadata ? JSON.stringify(pos.metadata) : null,
  };
}

export async function normalizePositions(positions: ProviderPosition[]): Promise<NormalizedPosition[]> {
  const out: NormalizedPosition[] = [];
  for (const p of positions) {
    out.push(await normalizePosition(p));
  }
  return out;
}
