import { D, Decimal } from "@/domain/decimal";
import { AllocationGroup, AssetValuation } from "./types";

/**
 * Calculates asset allocation percentages grouped by Asset Class
 */
export function calculateAssetAllocation(
  valuations: AssetValuation[],
  totalPortfolioValue: string,
): AllocationGroup[] {
  const total = D(totalPortfolioValue);
  if (total.isZero() || total.isNegative()) return [];

  const classMap = new Map<string, { color: string; value: Decimal }>();

  for (const v of valuations) {
    const val = D(v.currentValue);
    if (val.isZero() || val.isNegative()) continue;

    const existing = classMap.get(v.className) ?? { color: v.classColor, value: Decimal.zero() };
    existing.value = existing.value.add(val);
    classMap.set(v.className, existing);
  }

  return [...classMap.entries()]
    .map(([className, item]) => {
      const share = item.value.div(total).mul("100").toFixed(2);
      return {
        className,
        color: item.color,
        value: item.value.toString(),
        percentage: share,
      };
    })
    .sort((a, b) => Number(b.value) - Number(a.value));
}
