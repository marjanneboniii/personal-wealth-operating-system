/**
 * Scenario Calculator — Pure Math Layer
 * Uses src/domain/decimal.ts exact arithmetic, no DB access.
 */
import { D, Decimal } from "@/domain/decimal";

export const CALCULATION_VERSION = "v1.0";

/**
 * quantity = initialCapital / historicalPrice
 */
export function calculateInitialQuantity(initialCapital: string, historicalPrice: string): string {
  const capital = D(initialCapital);
  const price = D(historicalPrice);
  if (price.isZero() || price.isNegative()) {
    throw new Error("Historical price must be greater than zero for quantity calculation");
  }
  if (capital.lte(0)) {
    throw new Error("Initial capital must be greater than zero");
  }
  return capital.div(price).toString();
}

/**
 * currentValue = quantity * currentPrice
 */
export function calculateCurrentValue(quantity: string, currentPrice: string): string {
  return D(quantity).mul(currentPrice).toString();
}

/**
 * profitLoss = currentValue - initialCapital
 */
export function calculateProfitLoss(currentValue: string, initialCapital: string): string {
  return D(currentValue).sub(initialCapital).toString();
}

/**
 * ROI % = (profitLoss / initialCapital) * 100
 * Returns toFixed(2) string for display, but also raw for storage.
 */
export function calculateRoiPercentage(profitLoss: string, initialCapital: string): string {
  const capital = D(initialCapital);
  if (capital.isZero() || capital.isNegative()) return "0.00";
  const pnl = D(profitLoss);
  return pnl.div(capital).mul("100").toFixed(2);
}

/**
 * Annualized Return = (1 + ROI)^(365/days) - 1
 * ROI should be decimal fraction (e.g. 1.2222 for 122.22%)
 * Returns percentage string toFixed(2)
 */
export function calculateAnnualizedReturn(
  roiPercentage: string,
  startDate: string,
  evaluationDate: string,
): string {
  const roiDec = D(roiPercentage);
  // parse dates
  const start = new Date(startDate + "T00:00:00Z");
  const evalD = new Date(evaluationDate + "T00:00:00Z");
  const diffMs = evalD.getTime() - start.getTime();
  const days = diffMs / (1000 * 60 * 60 * 24);
  if (days < 1) {
    // if less than 1 day, annualized = roi
    return roiDec.toFixed(2);
  }
  // Convert ROI% to fraction: roiPct=122.22 => 1.2222 fraction
  const fraction = roiDec.div("100");
  const totalGrowthFactor = D("1").add(fraction);
  if (totalGrowthFactor.lte(0)) {
    // negative growth beyond -100% would lead to negative base, clamp to -100%
    // annualized will be -100% or less? Keep simple
    return roiDec.toFixed(2);
  }
  // Use logarithmic approximation with Decimal? Use number for pow, then back to Decimal
  // Since Decimal doesn't have pow, we use Number for annualized exponent, which is okay for display.
  const growthNum = totalGrowthFactor.toNumber();
  const annualizedFactor = Math.pow(growthNum, 365 / days);
  const annualizedPct = (annualizedFactor - 1) * 100;
  // Clamp and format
  return D(annualizedPct.toString()).toFixed(2);
}

export type SimulationCalculationInput = {
  initialCapital: string;
  initialPrice: string;
  currentPrice: string;
  startDate: string;
  evaluationDate: string;
};

export type SimulationCalculationResult = {
  quantity: string;
  currentValue: string;
  profitLoss: string;
  roiPercentage: string;
  annualizedReturnPercentage: string;
};

/**
 * Core historical investment simulation math — pure
 */
export function calculateHistoricalSimulation(
  input: SimulationCalculationInput,
): SimulationCalculationResult {
  const quantity = calculateInitialQuantity(input.initialCapital, input.initialPrice);
  const currentValue = calculateCurrentValue(quantity, input.currentPrice);
  const profitLoss = calculateProfitLoss(currentValue, input.initialCapital);
  const roiPercentage = calculateRoiPercentage(profitLoss, input.initialCapital);
  const annualizedReturnPercentage = calculateAnnualizedReturn(
    roiPercentage,
    input.startDate,
    input.evaluationDate,
  );

  return {
    quantity,
    currentValue,
    profitLoss,
    roiPercentage,
    annualizedReturnPercentage,
  };
}

export function calculatePerformanceDifference(primaryRoi: string, benchmarkRoi: string): string {
  return D(primaryRoi).sub(benchmarkRoi).toFixed(2);
}

export function calculateValueDifference(primaryValue: string, benchmarkValue: string): string {
  return D(primaryValue).sub(benchmarkValue).toString();
}
