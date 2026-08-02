import { D, Decimal } from "@/domain/decimal";
import { RiskMetricsReport } from "./types";

export type AssetValuationInput = {
  symbol: string;
  className: string;
  currentValue: string;
};

/**
 * Calculates maximum drawdown from historical peak portfolio values
 */
export function calculateMaxDrawdown(historicalValues: string[]): string {
  if (historicalValues.length < 2) return "0";

  let peak = Decimal.zero();
  let maxDrawdownPct = Decimal.zero();

  for (const valStr of historicalValues) {
    const val = D(valStr);
    if (val.gt(peak)) {
      peak = val;
    } else if (peak.gt(0)) {
      const drawdown = peak.sub(val);
      const drawdownPct = drawdown.div(peak).mul("100");
      if (drawdownPct.gt(maxDrawdownPct)) {
        maxDrawdownPct = drawdownPct;
      }
    }
  }

  return maxDrawdownPct.toFixed(2);
}

/**
 * Calculates risk concentration, single asset dominance, and crypto exposure
 */
export function calculateRiskMetrics(
  valuations: AssetValuationInput[],
  totalPortfolioValue: string,
  historicalValues: string[] = [],
  snapshotDate = "2026-08-02",
): RiskMetricsReport {
  const total = D(totalPortfolioValue);
  if (total.isZero() || total.isNegative()) {
    return {
      snapshotDate,
      largestAssetSymbol: "—",
      largestAssetPercentage: "0",
      cryptoExposurePercentage: "0",
      maxDrawdownPercentage: "0",
      riskScore: "low",
      concentrationWarning: null,
    };
  }

  let largestSymbol = "—";
  let largestVal = Decimal.zero();
  let cryptoVal = Decimal.zero();

  for (const v of valuations) {
    const val = D(v.currentValue);
    if (val.gt(largestVal)) {
      largestVal = val;
      largestSymbol = v.symbol;
    }
    if (v.className === "Crypto" || v.className === "رمزارز" || v.symbol === "BTC" || v.symbol === "ETH") {
      cryptoVal = cryptoVal.add(val);
    }
  }

  const largestPct = largestVal.div(total).mul("100");
  const cryptoPct = cryptoVal.div(total).mul("100");
  const maxDrawdownPct = calculateMaxDrawdown(historicalValues);

  let riskScore: RiskMetricsReport["riskScore"] = "low";
  let concentrationWarning: string | null = null;

  if (largestPct.gt(60) || cryptoPct.gt(80)) {
    riskScore = "critical";
    concentrationWarning = `هشدار تمرکز ریسک بحرانی: دارایی ${largestSymbol} بیش از ۶۰٪ از کل ثروت شما را تشکیل می‌دهد.`;
  } else if (largestPct.gt(40) || cryptoPct.gt(50)) {
    riskScore = "high";
    concentrationWarning = `تمرکز ریسک بالا: دارایی ${largestSymbol} بیش از ۴۰٪ از پرتفوی شما را تشکیل می‌دهد.`;
  } else if (largestPct.gt(25)) {
    riskScore = "moderate";
    concentrationWarning = `تمرکز متوسط: دارایی ${largestSymbol} بیش از ۲۵٪ از پرتفوی شما را شامل می‌شود.`;
  }

  return {
    snapshotDate,
    largestAssetSymbol: largestSymbol,
    largestAssetPercentage: largestPct.toFixed(2),
    cryptoExposurePercentage: cryptoPct.toFixed(2),
    maxDrawdownPercentage: maxDrawdownPct,
    riskScore,
    concentrationWarning,
  };
}
