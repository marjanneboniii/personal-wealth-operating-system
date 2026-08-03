/**
 * Scenario Engine — Isolated Bounded Context
 * Types never touch ledger tables.
 */

export type ScenarioStatus = "active" | "archived" | "closed";

export type ScenarioSimulation = {
  id: string;
  userId: string | null;
  name: string;
  description: string | null;
  assetId: string;
  assetSymbol?: string;
  assetName?: string;
  initialCapital: string;
  capitalCurrencyId: string | null;
  capitalCurrencyCode?: string;
  startDate: string; // YYYY-MM-DD
  initialPrice: string;
  initialQuantity: string;
  status: ScenarioStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type ScenarioEvaluationRun = {
  id: string;
  scenarioId: string;
  evaluationDate: string;
  currentPrice: string;
  currentValue: string;
  profitLoss: string;
  roiPercentage: string;
  annualizedReturnPercentage: string | null;
  benchmarkComparisons: string | null; // JSON
  createdAt: string;
};

export type SimulationResult = {
  scenarioId?: string;
  name?: string;
  assetId: string;
  assetSymbol: string;
  assetName?: string;
  initialCapital: string;
  capitalCurrencyCode: string;
  startDate: string;
  initialPrice: string;
  initialQuantity: string;
  evaluationDate: string;
  currentPrice: string;
  currentValue: string;
  profitLoss: string;
  roiPercentage: string;
  annualizedReturnPercentage: string;
  calculationVersion: string;
  calculationStatus: "complete" | "missing_data";
  missingDataWarning?: string | null;
};

export type TimeRangePoint = {
  date: string;
  price: string;
  value: string;
  profitLoss: string;
  roiPercentage: string;
};

export type TimeRangeSimulationResult = {
  scenarioId: string;
  assetId: string;
  assetSymbol: string;
  startDate: string;
  endDate: string;
  initialCapital: string;
  initialPrice: string;
  initialQuantity: string;
  timeline: TimeRangePoint[];
  finalResult: SimulationResult;
};

export type AssetComparisonItem = {
  assetId: string;
  symbol: string;
  name: string;
  startPrice: string;
  currentPrice: string;
  quantity: string;
  currentValue: string;
  profitLoss: string;
  roiPercentage: string;
  annualizedReturnPercentage: string;
};

export type AssetComparisonResult = {
  primaryAsset: AssetComparisonItem;
  benchmarks: AssetComparisonItem[];
  performanceDifference: string; // primary ROI - average benchmark ROI
  comparisonDetails: Array<{
    benchmarkSymbol: string;
    roiDifference: string;
    valueDifference: string;
    outperformed: boolean;
  }>;
};

export type BenchmarkComparisonResult = {
  symbol: string;
  name: string;
  startPrice: string;
  currentPrice: string;
  quantity: string;
  currentValue: string;
  roiPercentage: string;
  alphaPercentage: string; // scenario ROI - benchmark ROI
  outperformed: boolean;
};

export type LiveScenarioResult = SimulationResult & {
  benchmarkComparisons?: BenchmarkComparisonResult[];
  evaluationRunId?: string;
};

export type CreateScenarioInput = {
  name: string;
  description?: string;
  assetId: string;
  initialCapital: string; // e.g. "10000"
  capitalCurrencyId?: string;
  startDate: string; // YYYY-MM-DD
  initialPrice?: string; // optional override, otherwise fetched from market data SSOT
  notes?: string;
  userId?: string;
};

export type EvaluateScenarioInput = {
  scenarioId: string;
  evaluationDate?: string; // default todayIso()
};

export type CompareBenchmarksInput = {
  scenarioId: string;
  benchmarkSymbols: string[]; // e.g. ["BTC","GOLD","SP500","USD"]
  evaluationDate?: string;
};

export type TimeRangeInput = {
  scenarioId: string;
  startDate?: string; // defaults to scenario start
  endDate?: string; // defaults to today
};
