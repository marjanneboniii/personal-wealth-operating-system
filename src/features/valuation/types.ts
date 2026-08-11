import type { PriceFreshness } from "@/features/pricing/types";

export type MarketValuationInput = {
  quantity: string;
  currentPriceUsd: string;
  costBasisUsd: string;
  currentTomanPerUsd: string;
  /** Historical Toman cost, if an immutable purchase FX snapshot exists. */
  historicalCostToman?: string | null;
};

export type MarketValuationResult = {
  currentValueUsd: string;
  currentValueToman: string;
  costBasisUsd: string;
  historicalCostToman: string | null;
  unrealizedPnlUsd: string;
  unrealizedPnlToman: string;
};

export type CurrentValuationInput = {
  assetId: string;
  symbol: string;
  coingeckoId: string;
  quantity: string;
  costBasisUsd: string;
  currentTomanPerUsd: string;
  historicalCostToman?: string | null;
};

export type CurrentValuationResult = MarketValuationResult & {
  assetId: string;
  symbol: string;
  coingeckoId: string;
  currentPriceUsd: string | null;
  freshness: PriceFreshness;
  observedAt: string | null;
  failureCode?: string;
};
