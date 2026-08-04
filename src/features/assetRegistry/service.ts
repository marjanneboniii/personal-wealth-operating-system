/**
 * Asset Registry Service — Identity-Focused
 * Owns: assets, assetClasses hierarchy, asset_networks, asset_token_metadata
 * Must NOT store: wallet observations, balances, ownership history, valuation history
 * Correct: Asset Gold Metadata Purity Location in side tables, not in assets
 * Incorrect: Asset Ahvaz Kianpars because location is metadata not identity
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assetClasses,
  assetNetworks,
  assetTokenMetadata,
  assets,
  currencies,
  networks,
} from "@/db/schema";
import type { AssetClassNode, AssetNetwork, CreateAssetClassInput, CreateAssetNetworkInput, TokenMetadata } from "./types";

export async function createAssetClass(input: CreateAssetClassInput): Promise<{ id: string }> {
  if (input.parentId) {
    const [parent] = await db.select().from(assetClasses).where(eq(assetClasses.id, input.parentId)).limit(1);
    if (!parent) throw new Error(`Parent asset class not found: ${input.parentId}`);
  }

  const [inserted] = await db
    .insert(assetClasses)
    .values({
      code: input.code,
      name: input.name,
      color: input.color ?? "#64748b",
      sortOrder: input.sortOrder ?? 0,
      parentId: input.parentId ?? null,
      level: input.level ?? (input.parentId ? 1 : 0),
      attributesSchema: input.attributesSchema ?? null,
    })
    .returning();

  return { id: inserted.id };
}

export async function getAssetClassTree(): Promise<AssetClassNode[]> {
  const rows = await db.select().from(assetClasses).orderBy(assetClasses.sortOrder);

  const map = new Map<string, AssetClassNode>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      color: r.color,
      sortOrder: r.sortOrder,
      parentId: r.parentId ?? null,
      level: r.level ?? 0,
      attributesSchema: r.attributesSchema ?? null,
      children: [],
    });
  }

  const roots: AssetClassNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function listAssetClasses(): Promise<AssetClassNode[]> {
  const rows = await db.select().from(assetClasses).orderBy(assetClasses.sortOrder);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    color: r.color,
    sortOrder: r.sortOrder,
    parentId: r.parentId ?? null,
    level: r.level ?? 0,
    attributesSchema: r.attributesSchema ?? null,
  }));
}

export async function createAssetNetwork(input: CreateAssetNetworkInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  const [net] = await db.select().from(networks).where(eq(networks.id, input.networkId)).limit(1);
  if (!net) throw new Error(`Network not found: ${input.networkId}`);

  // Many-to-many validation: contract + chainId required for multi-chain support
  // USDT example: Ethereum, Arbitrum, Base must have distinct contractAddress
  const [inserted] = await db
    .insert(assetNetworks)
    .values({
      assetId: input.assetId,
      networkId: input.networkId,
      contractAddress: input.contractAddress ? input.contractAddress.toLowerCase() : null,
      chainId: input.chainId ?? null,
      decimals: input.decimals ?? null,
      tokenStandard: input.tokenStandard ?? null,
      isPrimary: input.isPrimary ?? false,
      isActive: input.isActive ?? true,
      explorerUrl: input.explorerUrl ?? null,
      logoUri: input.logoUri ?? null,
    })
    .onConflictDoUpdate({
      target: [assetNetworks.assetId, assetNetworks.networkId, assetNetworks.contractAddress],
      set: {
        chainId: input.chainId ?? null,
        decimals: input.decimals ?? null,
        tokenStandard: input.tokenStandard ?? null,
        isPrimary: input.isPrimary ?? false,
        isActive: input.isActive ?? true,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { id: inserted.id };
}

export async function getAssetNetworks(assetId?: string): Promise<AssetNetwork[]> {
  const rows = await db
    .select({
      id: assetNetworks.id,
      assetId: assetNetworks.assetId,
      assetSymbol: assets.symbol,
      networkId: assetNetworks.networkId,
      networkCode: networks.code,
      networkName: networks.name,
      contractAddress: assetNetworks.contractAddress,
      chainId: assetNetworks.chainId,
      decimals: assetNetworks.decimals,
      tokenStandard: assetNetworks.tokenStandard,
      isPrimary: assetNetworks.isPrimary,
      isActive: assetNetworks.isActive,
      explorerUrl: assetNetworks.explorerUrl,
      logoUri: assetNetworks.logoUri,
      createdAt: assetNetworks.createdAt,
    })
    .from(assetNetworks)
    .innerJoin(assets, eq(assets.id, assetNetworks.assetId))
    .innerJoin(networks, eq(networks.id, assetNetworks.networkId))
    .where(assetId ? eq(assetNetworks.assetId, assetId) : undefined)
    .orderBy(assetNetworks.isPrimary);

  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    networkId: r.networkId,
    networkCode: r.networkCode,
    networkName: r.networkName,
    contractAddress: r.contractAddress,
    chainId: r.chainId,
    decimals: r.decimals,
    tokenStandard: r.tokenStandard,
    isPrimary: r.isPrimary,
    isActive: r.isActive,
    explorerUrl: r.explorerUrl,
    logoUri: r.logoUri,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function upsertTokenMetadata(
  assetId: string,
  data: { underlyingAssetId?: string | null; logoUri?: string; coingeckoId?: string; websiteUrl?: string; description?: string },
): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${assetId}`);

  if (data.underlyingAssetId) {
    const [underlying] = await db.select().from(assets).where(eq(assets.id, data.underlyingAssetId)).limit(1);
    if (!underlying) throw new Error(`Underlying asset not found: ${data.underlyingAssetId}`);
  }

  const [inserted] = await db
    .insert(assetTokenMetadata)
    .values({
      assetId,
      underlyingAssetId: data.underlyingAssetId ?? null,
      logoUri: data.logoUri ?? null,
      coingeckoId: data.coingeckoId ?? null,
      websiteUrl: data.websiteUrl ?? null,
      description: data.description ?? null,
    })
    .onConflictDoUpdate({
      target: assetTokenMetadata.assetId,
      set: {
        underlyingAssetId: data.underlyingAssetId ?? null,
        logoUri: data.logoUri ?? null,
        coingeckoId: data.coingeckoId ?? null,
        websiteUrl: data.websiteUrl ?? null,
        description: data.description ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return { id: inserted.id };
}

export async function getTokenMetadata(assetId?: string): Promise<TokenMetadata[]> {
  const rows = await db
    .select({
      id: assetTokenMetadata.id,
      assetId: assetTokenMetadata.assetId,
      assetSymbol: assets.symbol,
      underlyingAssetId: assetTokenMetadata.underlyingAssetId,
      underlyingSymbol: sql<string>`underlying.symbol`.as("underlyingSymbol"),
      logoUri: assetTokenMetadata.logoUri,
      coingeckoId: assetTokenMetadata.coingeckoId,
      coinMarketCapId: assetTokenMetadata.coinMarketCapId,
      websiteUrl: assetTokenMetadata.websiteUrl,
      description: assetTokenMetadata.description,
      createdAt: assetTokenMetadata.createdAt,
    })
    .from(assetTokenMetadata)
    .innerJoin(assets, eq(assets.id, assetTokenMetadata.assetId))
    .leftJoin(sql`assets as underlying`.as("underlying"), sql`underlying.id = ${assetTokenMetadata.underlyingAssetId}`)
    .where(assetId ? eq(assetTokenMetadata.assetId, assetId) : undefined);

  // Drizzle doesn't easily handle alias join for underlying, fallback to simple query without underlying symbol
  if (rows.length === 0 && assetId) {
    const simple = await db
      .select()
      .from(assetTokenMetadata)
      .where(eq(assetTokenMetadata.assetId, assetId));
    return simple.map((r) => ({
      id: r.id,
      assetId: r.assetId,
      underlyingAssetId: r.underlyingAssetId,
      logoUri: r.logoUri,
      coingeckoId: r.coingeckoId,
      coinMarketCapId: r.coinMarketCapId,
      websiteUrl: r.websiteUrl,
      description: r.description,
      createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    }));
  }

  return rows.map((r: any) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    underlyingAssetId: r.underlyingAssetId ?? null,
    underlyingSymbol: r.underlyingSymbol ?? null,
    logoUri: r.logoUri ?? null,
    coingeckoId: r.coingeckoId ?? null,
    coinMarketCapId: r.coinMarketCapId ?? null,
    websiteUrl: r.websiteUrl ?? null,
    description: r.description ?? null,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}
