import type { PriceFreshness } from "@/features/pricing/types";

export type AssetClassValuationModel =
  | "crypto"
  | "stock"
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
  /** Presentation-layer Toman cost basis, consistent with `currentValueToman`
   *  and `unrealizedPnlToman` (cost = current − unrealized P&L). For assets
   *  that are inherently Toman-denominated (ملک، خودرو، نقد تومانی) this is
   *  the static purchase Toman; for USD-denominated assets it is their USD
   *  cost translated at the reference rate. Never derived by re-scaling a
   *  frozen USD figure with today's rate, so it cannot contradict the other
   *  two Toman figures. */
  costBasisToman: string;
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
  /** Presentation-layer aggregate Toman cost basis. Computed so that the
   *  headline Toman figures are always internally consistent:
   *  `totalNetWorthToman = totalCostBasisToman + totalUnrealizedPnlToman`.
   *  This is what the «بهای تمامشده» metric displays (never a re-scale of
   *  the frozen USD cost basis at today's rate). */
  totalCostBasisToman: string;
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
