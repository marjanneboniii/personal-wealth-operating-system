/**
 * Reconciliation Engine — Reporting and Comparison Layer
 * Purpose: Compare Internal Ledger State VS External Observed State
 * Example: Ledger ETH 10 vs DeBank ETH 12 -> Difference +2 ETH Status Needs Review
 * Forbidden: Automatically create Buy 2 ETH — Reconciliation NEVER creates transactions
 */

export type ReconciliationRunType = "wallet_reconciliation" | "portfolio_reconciliation" | "rwa_reconciliation";
export type ReconciliationStatus = "pending" | "completed" | "failed";
export type ReconciliationItemStatus = "matched" | "difference" | "needs_review" | "external_only" | "ledger_only";
export type ResolutionStatus = "pending" | "reviewed" | "ignored" | "resolved";
export type ResolutionCategory =
  | "already_accounted"
  | "not_yet_accounted"
  | "external_research"
  | "duplicate"
  | "new_acquisition_candidate"
  | "reconciled";

export type ReconciliationRun = {
  id: string;
  userId: string | null;
  runType: ReconciliationRunType;
  status: ReconciliationStatus;
  periodStart: string | null;
  periodEnd: string | null;
  summary: string | null;
  createdAt: string;
};

export type ReconciliationItem = {
  id: string;
  reconciliationRunId: string;
  walletIdentityId: string | null;
  walletAddress?: string;
  assetId: string | null;
  assetSymbol?: string;
  externalAssetId: string | null;
  rawSymbol?: string;
  ledgerQuantity: string | null;
  ledgerValue: string | null;
  observedQuantity: string | null;
  observedValue: string | null;
  differenceQuantity: string | null;
  differenceValue: string | null;
  status: ReconciliationItemStatus;
  resolutionStatus: ResolutionStatus;
  resolutionCategory: ResolutionCategory | null;
  notes: string | null;
  createdAt: string;
};

export type CreateReconciliationRunInput = {
  userId?: string;
  runType?: ReconciliationRunType;
  periodStart?: string;
  periodEnd?: string;
};

export type ReconciliationComparison = {
  assetId: string | null;
  assetSymbol: string | null;
  ledgerQuantity: string;
  ledgerValue: string;
  observedQuantity: string;
  observedValue: string;
  differenceQuantity: string;
  differenceValue: string;
  status: ReconciliationItemStatus;
  needsReview: boolean;
};
