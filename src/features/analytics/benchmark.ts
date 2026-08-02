import { D } from "@/domain/decimal";
import { BenchmarkComparisonItem } from "./types";

export type BenchmarkReturnData = {
  symbol: string;
  name: string;
  returnPercentage: string;
};

/**
 * Compares user portfolio return percentage against analytical benchmarks
 */
export function calculateBenchmarkComparison(
  portfolioReturnPct: string,
  benchmarks: BenchmarkReturnData[],
): BenchmarkComparisonItem[] {
  const pRet = D(portfolioReturnPct);

  return benchmarks.map((b) => {
    const bRet = D(b.returnPercentage);
    const alpha = pRet.sub(bRet);
    return {
      symbol: b.symbol,
      name: b.name,
      portfolioReturnPercentage: pRet.toFixed(2),
      benchmarkReturnPercentage: bRet.toFixed(2),
      alphaPercentage: alpha.toFixed(2),
      outperformed: alpha.gte(0),
    };
  });
}
