/**
 * Wealth Aggregation Engine — Read-Only Calculated Views Only
 * Architecture: Ledger -> Owned Asset Valuation, RWA -> RWA Valuation, Observation -> Observed Valuation -> Wealth Aggregation -> Net Worth
 * Aggregation must be read only, not own financial data, not write into Ledger, not create transactions
 */

export type AggregationRun = {
  id: string;
  userId: string | null;
  asOf: string;
  totalOwnedUSD: string;
  totalOwnedIRR: string;
  totalRWAUSD: string;
  totalRWAIRR: string;
  totalObservedUSD: string;
  totalObservedIRR: string;
  netWorthUSD: string;
  netWorthIRR: string;
  breakdown: string | null; // JSON
  reconciliationRunId: string | null;
  createdAt: string;
};

export type OwnedValuation = {
  totalAssets: string;
  totalLiabilities: string;
  netWorth: string;
  byClass: Array<{ className: string; color: string; value: string; share: string }>;
  holdings: Array<{
    assetId: string;
    symbol: string;
    quantity: string;
    costBase: string;
    marketPrice: string;
    currentValue: string;
  }>;
};

export type RWAValuation = {
  totalValueIRR: string;
  totalValueUSD: string;
  properties: Array<{
    assetId: string;
    symbol: string;
    city: string;
    area: string | null;
    sizeSqm: string | null;
    currentPriceIRR: string | null;
    currentPriceUSD: string | null;
  }>;
  vehicles: Array<{
    assetId: string;
    symbol: string;
    brand: string;
    model: string;
    year: number;
    currentPriceIRR: string | null;
    currentPriceUSD: string | null;
  }>;
};

export type ObservedValuation = {
  totalValueUSD: string;
  totalValueIRR: string;
  byWallet: Array<{
    walletIdentityId: string;
    address: string;
    label: string | null;
    walletType: string;
    totalValueUSD: string;
  }>;
  positions: Array<{
    walletIdentityId: string;
    assetId: string | null;
    rawSymbol: string | null;
    quantity: string;
    cachedValueUSD: string | null;
  }>;
};

export type WealthAggregationResult = {
  asOf: string;
  owned: OwnedValuation;
  rwa: RWAValuation;
  observed: ObservedValuation;
  reconciled: {
    totalOwnedUSD: string;
    totalRWAUSD: string;
    totalObservedUSD: string; // only self_watch, after deduplication
    netWorthUSD: string;
    netWorthIRR: string;
    duplicates: Array<{
      walletIdentityId: string;
      assetId: string | null;
      assetSymbol?: string;
      ledgerQuantity: string | null;
      observedQuantity: string | null;
      status: string;
      resolutionCategory: string | null;
    }>;
  };
  breakdown: string; // JSON
};

export type CreateAggregationRunInput = {
  userId?: string;
  asOf?: string;
  includeObserved?: boolean;
  includeRWA?: boolean;
};
