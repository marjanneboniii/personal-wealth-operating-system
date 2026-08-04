/**
 * Observation Layer Service — Read-Only Cache
 * CRITICAL RULES:
 * - Observes external state via DeBank, Zerion, RPC providers — does NOT own financial truth
 * - Writes ONLY to observation_providers, observation_runs, observed_positions, external_assets (quarantine)
 * - MUST NEVER WRITE TO Financial Core: no postEntry, no recordBuy, no recordSell, no FK to accounts, journal_entries, postings, lots
 * - Provider returns observation cache cachedPriceUSD/cachedValueUSD — NOT SSOT price, never calls recordManualPrice
 * - Wallet Identity Layer stores address, chain, ownership, optional linked account (soft link SET NULL, no accounting movement)
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
import { normalizePositions } from "./normalizer";
import { createObservationRunSchema } from "./validators";
import type { ObservedPosition, ObservationRun, ObservationProviderName } from "./types";

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
