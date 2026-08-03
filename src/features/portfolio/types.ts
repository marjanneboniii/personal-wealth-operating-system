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

export type AssetValuation = {
  assetId: string;
  symbol: string;
  name: string;
  className: string;
  classColor: string;
  decimals: number;
  quantity: string;
  marketPrice: string;
  marketCurrencyCode: string;
  currentValue: string;
  costBasis: string;
  unrealizedPnl: string;
  roiPercentage: string;
  sharePercentage: string;
};

export type AllocationGroup = {
  className: string;
  color: string;
  value: string;
  percentage: string;
};

export type PortfolioSummary = {
  totalNetWorth: string;
  totalCostBasis: string;
  totalUnrealizedPnl: string;
  overallRoiPercentage: string;
  assetValuations: AssetValuation[];
  allocationByClass: AllocationGroup[];
  valuationDate: string;
  baseCurrencyCode: string;
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
