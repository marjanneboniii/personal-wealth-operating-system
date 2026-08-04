/**
 * Observation Layer Service — Read-Only Cache + Zerion Full Wallet Sync
 * CRITICAL RULES:
 * - Observes external state via DeBank, Zerion, RPC providers — does NOT own financial truth
 * - Writes ONLY to observation_providers, observation_runs, observed_positions, external_assets (quarantine) AND watch_wallet_* cache tables
 * - MUST NEVER WRITE TO Financial Core: no postEntry, no recordBuy, no recordSell, no FK to accounts, journal_entries, postings, lots
 * - Provider returns observation cache cachedPriceUSD/cachedValueUSD — NOT SSOT price, never calls recordManualPrice
 * - Wallet Identity Layer stores address, chain, ownership, optional linked account (soft link SET NULL, no accounting movement)
 * - Implements syncFullWalletData(address) orchestrating Zerion provider calls, normalizer, bulk upserts into watch_wallet_* cache tables
 */

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  observationProviders,
  observationRuns,
  observedPositions,
  walletIdentities,
} from "@/db/schema";
import { todayIso } from "@/lib/format";
import { observationProviderRegistry } from "./providers";
import { normalizePositions, normalizeZerionPositions, normalizeZerionNft, normalizeZerionPerp, normalizeZerionTransaction } from "./normalizer";
import { createObservationRunSchema } from "./validators";
import type { ObservedPosition, ObservationRun, ObservationProviderName } from "./types";
import { ZerionProvider } from "./providers/zerion";
import { D } from "@/domain/decimal";
import {
  watchWalletNftsCache,
  watchWalletPerpsCache,
  watchWalletPortfolioCache,
  watchWalletPositionsCache,
  watchWalletTransactionsCache,
  watchWallets,
} from "./schema";

export async function ensureObservationProviders() {
  const defaults = [
    { name: "DEBANK", type: "api", config: JSON.stringify({ url: "https://pro-openapi.debank.com" }) },
    { name: "ZERION", type: "api", config: JSON.stringify({ url: "https://api.zerion.io" }) },
    { name: "RPC", type: "rpc", config: JSON.stringify({}) },
  ];
  for (const p of defaults) {
    await db.insert(observationProviders).values(p).onConflictDoNothing({ target: observationProviders.name });
  }
  return db.select().from(observationProviders);
}

export async function createObservationRun(input: {
  walletIdentityId: string;
  providerName?: ObservationProviderName;
}): Promise<{ id: string }> {
  const parsed = createObservationRunSchema.parse(input);

  const [wallet] = await db
    .select()
    .from(walletIdentities)
    .where(eq(walletIdentities.id, parsed.walletIdentityId))
    .limit(1);
  if (!wallet) throw new Error(`Wallet identity not found: ${parsed.walletIdentityId}`);

  const provider = observationProviderRegistry.get(parsed.providerName as any);
  if (!provider) throw new Error(`Provider not registered: ${parsed.providerName}`);

  // Start run
  const [run] = await db
    .insert(observationRuns)
    .values({
      walletIdentityId: parsed.walletIdentityId,
      providerName: parsed.providerName ?? "DEBANK",
      status: "pending",
    })
    .returning();

  try {
    const isAvailable = await provider.isAvailable();
    if (!isAvailable) throw new Error(`Provider ${parsed.providerName} unavailable`);

    const result = await provider.fetchPositions(wallet.address);

    // Normalize positions — maps to canonical assets via external_asset_mappings, quarantine unknown
    const normalized = await normalizePositions(result.positions);

    // Insert observed positions — cache only, no ledger write
    for (const pos of normalized) {
      await db.insert(observedPositions).values({
        observationRunId: run.id,
        walletIdentityId: parsed.walletIdentityId,
        networkId: pos.networkId ?? null,
        assetId: pos.assetId ?? null,
        externalAssetId: pos.externalAssetId ?? null,
        rawSymbol: pos.rawSymbol,
        rawContractAddress: pos.rawContractAddress ?? null,
        positionType: pos.positionType,
        protocol: pos.protocol ?? null,
        contractAddress: pos.contractAddress ?? null,
        quantity: pos.quantity,
        cachedPriceUSD: pos.cachedPriceUSD ?? null,
        cachedValueUSD: pos.cachedValueUSD ?? null,
        metadata: pos.metadata ?? null,
        snapshotDate: todayIso(),
      });
    }

    // Complete run
    await db
      .update(observationRuns)
      .set({
        status: "success",
        finishedAt: new Date(),
        positionsCount: normalized.length,
        rawResponseSummary: result.rawResponseSummary ?? null,
      })
      .where(eq(observationRuns.id, run.id));

    return { id: run.id };
  } catch (e) {
    await db
      .update(observationRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        errorMessage: e instanceof Error ? e.message : String(e),
      })
      .where(eq(observationRuns.id, run.id));
    throw e;
  }
}

export async function getObservedPositions(walletIdentityId?: string): Promise<ObservedPosition[]> {
  const rows = await db
    .select()
    .from(observedPositions)
    .where(walletIdentityId ? eq(observedPositions.walletIdentityId, walletIdentityId) : undefined)
    .orderBy(desc(observedPositions.fetchedAt));

  return rows.map((r) => ({
    id: r.id,
    observationRunId: r.observationRunId,
    walletIdentityId: r.walletIdentityId,
    networkId: r.networkId,
    assetId: r.assetId,
    externalAssetId: r.externalAssetId,
    rawSymbol: r.rawSymbol,
    rawContractAddress: r.rawContractAddress,
    positionType: r.positionType as any,
    protocol: r.protocol,
    contractAddress: r.contractAddress,
    quantity: r.quantity.toString(),
    cachedPriceUSD: r.cachedPriceUSD ? r.cachedPriceUSD.toString() : null,
    cachedValueUSD: r.cachedValueUSD ? r.cachedValueUSD.toString() : null,
    metadata: r.metadata,
    fetchedAt: r.fetchedAt?.toISOString() ?? new Date().toISOString(),
    snapshotDate: r.snapshotDate,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function getObservationRuns(walletIdentityId?: string): Promise<ObservationRun[]> {
  const rows = await db
    .select()
    .from(observationRuns)
    .where(walletIdentityId ? eq(observationRuns.walletIdentityId, walletIdentityId) : undefined)
    .orderBy(desc(observationRuns.createdAt));

  return rows.map((r) => ({
    id: r.id,
    walletIdentityId: r.walletIdentityId,
    providerName: r.providerName as any,
    status: r.status as any,
    startedAt: r.startedAt?.toISOString() ?? new Date().toISOString(),
    finishedAt: r.finishedAt?.toISOString() ?? null,
    positionsCount: r.positionsCount,
    rawResponseSummary: r.rawResponseSummary,
    errorMessage: r.errorMessage,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}

export async function listObservationProviders() {
  await ensureObservationProviders();
  return db.select().from(observationProviders);
}

/**
 * syncFullWalletData(address) — Orchestrates Zerion provider calls, runs normalizer, bulk upserts into watch_wallet_* cache tables
 * Implements spec: getPortfolio, getPositions, getTransactions, getNfts, getPerpPositions
 * No FK to Financial Core, never writes ledger
 */
export async function syncFullWalletData(address: string): Promise<{
  walletAddress: string;
  portfolio: any;
  positionsCount: number;
  transactionsCount: number;
  nftsCount: number;
  perpsCount: number;
}> {
  const normalizedAddress = address.trim().toLowerCase();

  if (!normalizedAddress || normalizedAddress.length < 26) {
    throw new Error("Invalid wallet address");
  }

  // Ensure watch_wallets entry exists
  await db
    .insert(watchWallets)
    .values({
      address: normalizedAddress,
      label: null,
    })
    .onConflictDoNothing({ target: watchWallets.address });

  const provider = new ZerionProvider();

  // Check API key presence — graceful handling
  const hasKey = !!process.env.ZERION_API_KEY;
  if (!hasKey) {
    console.warn("[ObservationService] ZERION_API_KEY missing — sync will create empty cache entries with warning");
  }

  // Orchestrate provider calls in parallel where possible
  const [portfolio, positions, nfts, perps] = await Promise.all([
    provider.getPortfolio(normalizedAddress),
    provider.getPositions(normalizedAddress),
    provider.getNfts(normalizedAddress),
    provider.getPerpPositions(normalizedAddress),
  ]);

  const transactionsResult = await provider.getTransactions(normalizedAddress);
  const transactions = transactionsResult.transactions;

  // Normalizer — convert float to 18-decimal string, check internal assets, quarantine unknown
  const normalizedPositions = await normalizeZerionPositions(positions);

  // Bulk upserts into watch_wallet_* cache tables — isolated, no FK to financial core

  // 1. Portfolio cache
  if (portfolio) {
    await db
      .insert(watchWalletPortfolioCache)
      .values({
        walletAddress: normalizedAddress,
        totalValueUSD: portfolio.totalValueUSD ? D(portfolio.totalValueUSD).toString() : "0",
        netUnrealizedPnlUSD: portfolio.netUnrealizedPnlUSD ? D(portfolio.netUnrealizedPnlUSD).toString() : "0",
        netRealizedPnlUSD: portfolio.netRealizedPnlUSD ? D(portfolio.netRealizedPnlUSD).toString() : "0",
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: watchWalletPortfolioCache.walletAddress,
        set: {
          totalValueUSD: portfolio.totalValueUSD ? D(portfolio.totalValueUSD).toString() : "0",
          netUnrealizedPnlUSD: portfolio.netUnrealizedPnlUSD ? D(portfolio.netUnrealizedPnlUSD).toString() : "0",
          netRealizedPnlUSD: portfolio.netRealizedPnlUSD ? D(portfolio.netRealizedPnlUSD).toString() : "0",
          fetchedAt: new Date(),
        },
      });
  }

  // 2. Positions cache — bulk insert, delete old for same wallet first for freshness
  await db.delete(watchWalletPositionsCache).where(eq(watchWalletPositionsCache.walletAddress, normalizedAddress));

  for (const pos of normalizedPositions) {
    await db.insert(watchWalletPositionsCache).values({
      walletAddress: normalizedAddress,
      protocolId: pos.protocolId,
      marketSymbol: pos.marketSymbol,
      positionType: pos.positionType,
      quantity: pos.quantity,
      priceUSD: pos.priceUSD,
      valueUSD: pos.valueUSD,
      unrealizedPnlUSD: pos.unrealizedPnlUSD,
      rawJson: pos.rawJson,
      fetchedAt: new Date(),
    });
  }

  // 3. Transactions cache — upsert each transaction
  for (const tx of transactions) {
    const normalizedTx = normalizeZerionTransaction(tx);
    await db
      .insert(watchWalletTransactionsCache)
      .values({
        id: normalizedTx.id,
        walletAddress: normalizedAddress,
        txHash: normalizedTx.txHash,
        txType: normalizedTx.txType,
        status: normalizedTx.status,
        feeUSD: normalizedTx.feeUSD,
        summary: normalizedTx.summary,
        detailsJson: normalizedTx.detailsJson,
        minedAt: normalizedTx.minedAt,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: watchWalletTransactionsCache.id,
        set: {
          walletAddress: normalizedAddress,
          txHash: normalizedTx.txHash,
          txType: normalizedTx.txType,
          status: normalizedTx.status,
          feeUSD: normalizedTx.feeUSD,
          summary: normalizedTx.summary,
          detailsJson: normalizedTx.detailsJson,
          minedAt: normalizedTx.minedAt,
          fetchedAt: new Date(),
        },
      });
  }

  // 4. NFTs cache
  await db.delete(watchWalletNftsCache).where(eq(watchWalletNftsCache.walletAddress, normalizedAddress));
  for (const nft of nfts) {
    const normalizedNft = await normalizeZerionNft(nft);
    await db.insert(watchWalletNftsCache).values({
      walletAddress: normalizedAddress,
      collectionName: normalizedNft.collectionName,
      nftId: normalizedNft.nftId,
      floorPriceUSD: normalizedNft.floorPriceUSD,
      estimatedValueUSD: normalizedNft.estimatedValueUSD,
      rawJson: normalizedNft.rawJson,
      fetchedAt: new Date(),
    });
  }

  // 5. Perps cache
  await db.delete(watchWalletPerpsCache).where(eq(watchWalletPerpsCache.walletAddress, normalizedAddress));
  for (const perp of perps) {
    const normalizedPerp = normalizeZerionPerp(perp);
    await db.insert(watchWalletPerpsCache).values({
      walletAddress: normalizedAddress,
      exchangeProtocol: normalizedPerp.exchangeProtocol,
      marketPair: normalizedPerp.marketPair,
      side: normalizedPerp.side,
      leverage: normalizedPerp.leverage,
      marginUSD: normalizedPerp.marginUSD,
      size: normalizedPerp.size,
      entryPriceUSD: normalizedPerp.entryPriceUSD,
      markPriceUSD: normalizedPerp.markPriceUSD,
      unrealizedPnlUSD: normalizedPerp.unrealizedPnlUSD,
      rawJson: normalizedPerp.rawJson,
      fetchedAt: new Date(),
    });
  }

  return {
    walletAddress: normalizedAddress,
    portfolio: portfolio ?? null,
    positionsCount: normalizedPositions.length,
    transactionsCount: transactions.length,
    nftsCount: nfts.length,
    perpsCount: perps.length,
  };
}

export async function getWatchWalletPortfolio(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  const [row] = await db
    .select()
    .from(watchWalletPortfolioCache)
    .where(eq(watchWalletPortfolioCache.walletAddress, normalizedAddress))
    .limit(1);
  return row ?? null;
}

export async function getWatchWalletPositions(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  return db
    .select()
    .from(watchWalletPositionsCache)
    .where(eq(watchWalletPositionsCache.walletAddress, normalizedAddress))
    .orderBy(watchWalletPositionsCache.fetchedAt);
}

export async function getWatchWalletTransactions(address: string, limit = 50) {
  const normalizedAddress = address.trim().toLowerCase();
  return db
    .select()
    .from(watchWalletTransactionsCache)
    .where(eq(watchWalletTransactionsCache.walletAddress, normalizedAddress))
    .orderBy(watchWalletTransactionsCache.minedAt)
    .limit(limit);
}

export async function getWatchWalletNfts(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  return db.select().from(watchWalletNftsCache).where(eq(watchWalletNftsCache.walletAddress, normalizedAddress));
}

export async function getWatchWalletPerps(address: string) {
  const normalizedAddress = address.trim().toLowerCase();
  return db.select().from(watchWalletPerpsCache).where(eq(watchWalletPerpsCache.walletAddress, normalizedAddress));
}
