export type GrowthSummary = {
  periodStart: string;
  periodEnd: string;
  startingValue: string;
  endingValue: string;
  absoluteChange: string;
  percentageChange: string; // Simple percentage wealth growth
  netExternalCapitalFlows: string; // Deposits/Capital Additions minus Withdrawals
  netInvestmentReturn: string; // Pure Investment Growth = Absolute Change - Net Capital Flows
  adjustedWealthReturnPercentage: string; // Adjusted Wealth Return % excluding capital flows (Reserves future TWR / MWR)
  calculationVersion: string; // "v1.0"
  calculationStatus: "complete" | "partial" | "missing_data" | "invalid_period";
  missingDataWarning: string | null;
};

export type AssetAttributionItem = {
  assetId: string;
  symbol: string;
  name: string;
  startingValue: string;
  endingValue: string;
  absoluteChange: string;
  percentageChange: string;
  contributionPercentage: string; // % share of total portfolio growth
  hasMissingPriceData?: boolean;
};

export type AttributionReport = {
  topWinner: AssetAttributionItem | null;
  topLoser: AssetAttributionItem | null;
  largestContributor: AssetAttributionItem | null;
  largestRiskSource: AssetAttributionItem | null;
  attributions: AssetAttributionItem[];
};

export type BenchmarkComparisonItem = {
  symbol: string;
  name: string;
  portfolioReturnPercentage: string;
  benchmarkReturnPercentage: string;
  alphaPercentage: string; // portfolioReturn - benchmarkReturn
  outperformed: boolean;
};

export type RiskMetricsReport = {
  snapshotDate: string;
  largestAssetSymbol: string;
  largestAssetPercentage: string;
  cryptoExposurePercentage: string;
  maxDrawdownPercentage: string;
  riskScore: "low" | "moderate" | "high" | "critical";
  concentrationWarning: string | null;
};

export type WealthTimelinePoint = {
  date: string;
  portfolioValue: string;
};

export type AnalyticsDashboardSummary = {
  growth: GrowthSummary;
  attribution: AttributionReport;
  benchmarks: BenchmarkComparisonItem[];
  risk: RiskMetricsReport;
  timeline: WealthTimelinePoint[];
};
