/**
 * Reconciliation Engine — Reporting Only
 * CRITICAL RULE: Reconciliation only reports differences, never creates accounting transactions
 * Example Ledger ETH 10 vs Blockchain Observation ETH 12 -> Difference +2 ETH Status Needs Review (never auto-buy)
 * Reads Financial Ownership (ledger holdings) + Observation Layer (observed_positions)
 * Writes ONLY reconciliation_runs, reconciliation_items — isolated, no FK to journal_entries, postings, lots
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  observedPositions,
  reconciliationItems,
  reconciliationRuns,
  walletIdentities,
} from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { getAccountBalances, getHoldings } from "@/features/ledger/queries";
import type { CreateReconciliationRunInput, ReconciliationItem, ReconciliationRun } from "./types";

export async function createReconciliationRun(input: CreateReconciliationRunInput): Promise<{ id: string }> {
  const [run] = await db
    .insert(reconciliationRuns)
    .values({
      userId: input.userId ?? null,
      runType: input.runType ?? "wallet_reconciliation",
      status: "pending",
      periodStart: input.periodStart ?? null,
      periodEnd: input.periodEnd ?? null,
    })
    .returning();

  return { id: run.id };
}

export async function getReconciliationRun(id: string): Promise<ReconciliationRun | null> {
  const [row] = await db.select().from(reconciliationRuns).where(eq(reconciliationRuns.id, id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.userId,
    runType: row.runType as any,
    status: row.status as any,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    summary: row.summary,
    createdAt: row.createdAt?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Ownership Resolution Core — Compares ledger holdings vs observed positions by wallet address + asset
 * Prevents double count: Ledger 3 ETH + Watch 3 ETH = 6 ETH if naive sum
 * Instead produces reconciled view with categories already_accounted, not_yet_accounted, external_research
 * No FK to accounts/journal/postings/lots, only soft matching on address string + asset symbol
 */
export async function reconcileWallet(
  reconciliationRunId: string,
  walletIdentityId: string,
): Promise<ReconciliationItem[]> {
  const [wallet] = await db.select().from(walletIdentities).where(eq(walletIdentities.id, walletIdentityId)).limit(1);
  if (!wallet) throw new Error(`Wallet identity not found: ${walletIdentityId}`);

  // Read ledger holdings for this wallet's linked account if exists, or all holdings for self custody
  const holdings = await getHoldings();
  const balances = await getAccountBalances();

  // Read observed positions for this wallet
  const observed = await db
    .select({
      id: observedPositions.id,
      walletIdentityId: observedPositions.walletIdentityId,
      assetId: observedPositions.assetId,
      rawSymbol: observedPositions.rawSymbol,
      quantity: observedPositions.quantity,
      cachedValueUSD: observedPositions.cachedValueUSD,
    })
    .from(observedPositions)
    .where(eq(observedPositions.walletIdentityId, walletIdentityId))
    .orderBy(desc(observedPositions.fetchedAt));

  const items: ReconciliationItem[] = [];

  // Build map of ledger holdings by asset symbol lowercased
  const holdingsBySymbol = new Map<string, { assetId: string; quantity: string; value: string }>();
  for (const h of holdings) {
    const qty = D(h.quantity);
    if (qty.isZero()) continue;
    // For simplicity, use symbol lowercased as key
    holdingsBySymbol.set(h.symbol.toLowerCase(), {
      assetId: h.assetId,
      quantity: h.quantity,
      value: h.costBase, // use costBase as placeholder, actual value would be qty*price
    });
  }

  // Compare observed vs ledger
  for (const obs of observed) {
    const symbolKey = (obs.rawSymbol ?? "").toLowerCase();
    const ledger = holdingsBySymbol.get(symbolKey);

    const observedQty = D(obs.quantity);
    const ledgerQty = ledger ? D(ledger.quantity) : Decimal.zero();
    const diffQty = observedQty.sub(ledgerQty);

    let status: ReconciliationItem["status"] = "needs_review";
    let resolutionCategory: ReconciliationItem["resolutionCategory"] = null;
    let ledgerQtyStr: string | null = ledger ? ledger.quantity : null;
    let ledgerValueStr: string | null = ledger ? ledger.value : null;

    if (ledger) {
      if (diffQty.isZero()) {
        status = "matched";
        resolutionCategory = "already_accounted";
      } else {
        status = "difference";
        // If observed close to ledger, already accounted duplicate
        if (observedQty.lte(ledgerQty.mul("1.1")) && observedQty.gte(ledgerQty.mul("0.9"))) {
          resolutionCategory = "already_accounted";
        } else {
          resolutionCategory = "duplicate";
        }
      }
    } else {
      status = "external_only";
      // Check wallet type to distinguish not_yet_accounted vs external_research
      if (wallet.walletType === "personal") {
        resolutionCategory = "not_yet_accounted";
      } else if (wallet.walletType === "external_research" || wallet.ownershipCategory === "research") {
        resolutionCategory = "external_research";
      } else {
        resolutionCategory = "new_acquisition_candidate";
      }
      ledgerQtyStr = null;
      ledgerValueStr = null;
    }

    const [inserted] = await db
      .insert(reconciliationItems)
      .values({
        reconciliationRunId,
        walletIdentityId,
        assetId: obs.assetId ?? ledger?.assetId ?? null,
        ledgerQuantity: ledgerQtyStr,
        ledgerValue: ledgerValueStr,
        observedQuantity: obs.quantity.toString(),
        observedValue: obs.cachedValueUSD ? obs.cachedValueUSD.toString() : null,
        differenceQuantity: diffQty.toString(),
        differenceValue: null,
        status,
        resolutionStatus: "pending",
        resolutionCategory,
        notes: `Wallet ${wallet.address} asset ${obs.rawSymbol} ledger ${ledgerQtyStr ?? 0} vs observed ${obs.quantity}`,
      })
      .returning();

    items.push({
      id: inserted.id,
      reconciliationRunId,
      walletIdentityId,
      assetId: inserted.assetId,
      externalAssetId: null,
      ledgerQuantity: inserted.ledgerQuantity ? inserted.ledgerQuantity.toString() : null,
      ledgerValue: inserted.ledgerValue ? inserted.ledgerValue.toString() : null,
      observedQuantity: inserted.observedQuantity ? inserted.observedQuantity.toString() : null,
      observedValue: inserted.observedValue ? inserted.observedValue.toString() : null,
      differenceQuantity: inserted.differenceQuantity ? inserted.differenceQuantity.toString() : null,
      differenceValue: inserted.differenceValue ? inserted.differenceValue.toString() : null,
      status: inserted.status as any,
      resolutionStatus: inserted.resolutionStatus as any,
      resolutionCategory: inserted.resolutionCategory as any,
      notes: inserted.notes,
      createdAt: inserted.createdAt?.toISOString() ?? new Date().toISOString(),
    });
  }

  // Also check ledger_only items (ledger has asset but observed does not)
  for (const [symbolKey, ledger] of holdingsBySymbol.entries()) {
    const hasObserved = observed.some((o) => (o.rawSymbol ?? "").toLowerCase() === symbolKey);
    if (!hasObserved) {
      const [inserted] = await db
        .insert(reconciliationItems)
        .values({
          reconciliationRunId,
          walletIdentityId,
          assetId: ledger.assetId,
          ledgerQuantity: ledger.quantity,
          ledgerValue: ledger.value,
          observedQuantity: null,
          observedValue: null,
          differenceQuantity: D(ledger.quantity).neg().toString(),
          status: "ledger_only",
          resolutionStatus: "pending",
          resolutionCategory: "already_accounted",
          notes: `Ledger has ${symbolKey} ${ledger.quantity} but no observed position`,
        })
        .returning();

      items.push({
        id: inserted.id,
        reconciliationRunId,
        walletIdentityId,
        assetId: inserted.assetId,
        externalAssetId: null,
        ledgerQuantity: inserted.ledgerQuantity ? inserted.ledgerQuantity.toString() : null,
        ledgerValue: inserted.ledgerValue ? inserted.ledgerValue.toString() : null,
        observedQuantity: null,
        observedValue: null,
        differenceQuantity: inserted.differenceQuantity ? inserted.differenceQuantity.toString() : null,
        differenceValue: null,
        status: inserted.status as any,
        resolutionStatus: inserted.resolutionStatus as any,
        resolutionCategory: inserted.resolutionCategory as any,
        notes: inserted.notes,
        createdAt: inserted.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    }
  }

  // Mark run completed
  await db
    .update(reconciliationRuns)
    .set({ status: "completed", summary: JSON.stringify({ itemsCount: items.length, walletAddress: wallet.address }) })
    .where(eq(reconciliationRuns.id, reconciliationRunId));

  return items;
}

export async function getReconciliationItems(runId: string): Promise<ReconciliationItem[]> {
  const rows = await db
    .select({
      id: reconciliationItems.id,
      reconciliationRunId: reconciliationItems.reconciliationRunId,
      walletIdentityId: reconciliationItems.walletIdentityId,
      walletAddress: walletIdentities.address,
      assetId: reconciliationItems.assetId,
      assetSymbol: assets.symbol,
      externalAssetId: reconciliationItems.externalAssetId,
      ledgerQuantity: reconciliationItems.ledgerQuantity,
      ledgerValue: reconciliationItems.ledgerValue,
      observedQuantity: reconciliationItems.observedQuantity,
      observedValue: reconciliationItems.observedValue,
      differenceQuantity: reconciliationItems.differenceQuantity,
      differenceValue: reconciliationItems.differenceValue,
      status: reconciliationItems.status,
      resolutionStatus: reconciliationItems.resolutionStatus,
      resolutionCategory: reconciliationItems.resolutionCategory,
      notes: reconciliationItems.notes,
      createdAt: reconciliationItems.createdAt,
    })
    .from(reconciliationItems)
    .leftJoin(walletIdentities, eq(walletIdentities.id, reconciliationItems.walletIdentityId))
    .leftJoin(assets, eq(assets.id, reconciliationItems.assetId))
    .where(eq(reconciliationItems.reconciliationRunId, runId))
    .orderBy(reconciliationItems.createdAt);

  return rows.map((r) => ({
    id: r.id,
    reconciliationRunId: r.reconciliationRunId,
    walletIdentityId: r.walletIdentityId,
    walletAddress: r.walletAddress ?? undefined,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol ?? undefined,
    externalAssetId: r.externalAssetId,
    ledgerQuantity: r.ledgerQuantity ? r.ledgerQuantity.toString() : null,
    ledgerValue: r.ledgerValue ? r.ledgerValue.toString() : null,
    observedQuantity: r.observedQuantity ? r.observedQuantity.toString() : null,
    observedValue: r.observedValue ? r.observedValue.toString() : null,
    differenceQuantity: r.differenceQuantity ? r.differenceQuantity.toString() : null,
    differenceValue: r.differenceValue ? r.differenceValue.toString() : null,
    status: r.status as any,
    resolutionStatus: r.resolutionStatus as any,
    resolutionCategory: r.resolutionCategory as any,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
  }));
}
