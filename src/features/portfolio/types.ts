import type { PriceFreshness } from "@/features/pricing/types";

export type AssetClassValuationModel =
  | "crypto"
  | "stock"
  | "tokenized_security"
  | "commodity"
  | "precious_metal"
  | "etf"
  | "real_estate"
  | "fiat"
  | "other";

export type ValuationBasis =
  | "coingecko"
  | "manual_real_asset"
  | "manual_reference"
  | "face_value"
  | "cost_basis_fallback";

export type AssetValuation = {
  assetId: string;
  symbol: string;
  name: string;
  logoUrl: string | null;
  className: string;
  classColor: string;
  decimals: number;
  quantity: string;
  marketPrice: string;
  marketCurrencyCode: "USD";
  currentValue: string;
  currentValueToman: string;
  costBasis: string;
  historicalCostToman: string | null;
  unrealizedPnl: string;
  unrealizedPnlToman: string;
  roiPercentage: string;
  sharePercentage: string;
  valuationBasis: ValuationBasis;
  priceFreshness: PriceFreshness;
  priceObservedAt: string | null;
  priceFailureCode?: string;
};

export type AllocationGroup = {
  className: string;
  color: string;
  value: string;
  percentage: string;
};

export type PortfolioSummary = {
  totalNetWorth: string;
  totalNetWorthToman: string;
  totalCostBasis: string;
  totalUnrealizedPnl: string;
  totalUnrealizedPnlToman: string;
  overallRoiPercentage: string;
  assetValuations: AssetValuation[];
  allocationByClass: AllocationGroup[];
  valuationDate: string;
  baseCurrencyCode: "USD";
  currentFxRate: string;
  priceStatus: { fresh: number; stale: number; unavailable: number };
};

export type AssetPerformanceSummary = {
  assetId: string;
  symbol: string;
  periodStart: string;
  periodEnd: string;
  startingValue: string;
  endingValue: string;
  absoluteChange: string;
  percentageChange: string;
};
