import { D } from "@/domain/decimal";
import { GrowthSummary } from "./types";

export type GrowthCalculationInput = {
  startingValue: string;
  endingValue: string;
  externalInflows?: string;
  externalOutflows?: string;
  netExternalFlow?: string;
  periodStart?: string;
  periodEnd?: string;
  hasMissingData?: boolean;
  missingDataReason?: string;
};

/**
 * Calculates portfolio performance with External Capital Flow Awareness & Calculation Integrity Protection
 */
export function calculateGrowth(input: GrowthCalculationInput): GrowthSummary {
  const periodStart = input.periodStart ?? "2025-01-01";
  const periodEnd = input.periodEnd ?? "2026-08-02";

  // Check for missing data protection
  if (input.hasMissingData) {
    return {
      periodStart,
      periodEnd,
      startingValue: input.startingValue || "0",
      endingValue: input.endingValue || "0",
      absoluteChange: "0",
      percentageChange: "0.00",
      netExternalCapitalFlows: "0",
      netInvestmentReturn: "0",
      adjustedWealthReturnPercentage: "0.00",
      calculationVersion: "v1.0",
      calculationStatus: "missing_data",
      missingDataWarning:
        input.missingDataReason ??
        "Historical performance unavailable because market price data is missing.",
    };
  }

  const start = D(input.startingValue || "0");
  const end = D(input.endingValue || "0");
  const absoluteChange = end.sub(start);

  const netExternalFlows = input.netExternalFlow !== undefined
    ? D(input.netExternalFlow)
    : D(input.externalInflows || "0").sub(D(input.externalOutflows || "0"));

  // Net Investment Return = Ending Wealth - Starting Wealth - Net External Capital Flow
  const netInvestmentReturn = absoluteChange.sub(netExternalFlows);

  // Wealth Growth %
  const percentageChange = start.isZero()
    ? "0.00"
    : absoluteChange.div(start).mul("100").toFixed(2);

  // Adjusted Wealth Return % (Excludes capital flows; reserves future TWR & MWR support)
  const capitalBase = start.add(D(input.externalInflows || (netExternalFlows.gt(0) ? netExternalFlows.toString() : "0")));
  const adjustedWealthReturnPct = capitalBase.isZero() || capitalBase.isNegative()
    ? "0.00"
    : netInvestmentReturn.div(capitalBase).mul("100").toFixed(2);

  return {
    periodStart,
    periodEnd,
    startingValue: start.toString(),
    endingValue: end.toString(),
    absoluteChange: absoluteChange.toString(),
    percentageChange,
    netExternalCapitalFlows: netExternalFlows.toString(),
    netInvestmentReturn: netInvestmentReturn.toString(),
    adjustedWealthReturnPercentage: adjustedWealthReturnPct,
    calculationVersion: "v1.0",
    calculationStatus: "complete",
    missingDataWarning: null,
  };
}
