/**
 * Observation Layer — Read-Only Infrastructure
 * Supported providers: DeBank, Zerion, RPC
 * Responsibility: Observe external state, do NOT own financial truth
 * Architecture: External Provider -> Normalizer -> Observation Layer -> Reconciliation -> Dashboard
 * Forbidden: DeBank -> Ledger
 */

export type ObservationProviderName = "DEBANK" | "ZERION" | "RPC" | "COINGECKO" | "MANUAL";
export type ObservationStatus = "pending" | "success" | "failed";
export type PositionType =
  | "token"
  | "lp"
  | "aave_supply"
  | "aave_borrow"
  | "pendle_pt"
  | "pendle_yt"
  | "staking"
  | "vault"
  | "lending"
  | "borrowing";

export type ObservedPosition = {
  id: string;
  observationRunId: string;
  walletIdentityId: string;
  networkId: string | null;
  networkCode?: string;
  assetId: string | null;
  assetSymbol?: string;
  externalAssetId: string | null;
  rawSymbol: string | null;
  rawContractAddress: string | null;
  positionType: PositionType;
  protocol: string | null;
  contractAddress: string | null;
  quantity: string;
  cachedPriceUSD: string | null; // observation cache, NOT SSOT price
  cachedValueUSD: string | null; // observation cache, NOT SSOT
  metadata: string | null; // JSON
  fetchedAt: string;
  snapshotDate: string;
  createdAt: string;
};

export type ObservationRun = {
  id: string;
  walletIdentityId: string;
  walletAddress?: string;
  providerName: ObservationProviderName;
  status: ObservationStatus;
  startedAt: string;
  finishedAt: string | null;
  positionsCount: number;
  rawResponseSummary: string | null;
  errorMessage: string | null;
  createdAt: string;
};

export type ProviderPosition = {
  rawSymbol: string;
  rawName?: string;
  contractAddress?: string;
  chainId?: number;
  networkCode?: string;
  decimals?: number;
  quantity: string;
  priceUSD?: string; // from provider, cached only, NOT SSOT
  valueUSD?: string;
  positionType?: PositionType;
  protocol?: string;
  metadata?: Record<string, any>;
};

export type ProviderResult = {
  providerName: ObservationProviderName;
  walletAddress: string;
  positions: ProviderPosition[];
  rawResponseSummary?: string;
};

export type ObservationProviderType = "api" | "rpc";

export type CreateObservationRunInput = {
  walletIdentityId: string;
  providerName: ObservationProviderName;
};
