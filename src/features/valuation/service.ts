/**
 * Valuation Layer
 *
 * Accounting is read-only upstream input: quantity and FIFO cost basis enter
 * this module as values. CoinGecko and current FX can change only the returned
 * valuation; this module has no database writes and imports no accounting
 * mutation primitive.
 */
import { D } from "@/domain/decimal";
import { getCurrentUsdPrices } from "@/features/pricing/service";
import type { MarketAssetIdentity } from "@/features/pricing/types";
import type {
  CurrentValuationInput,
  CurrentValuationResult,
  MarketValuationInput,
  MarketValuationResult,
} from "./types";

export function calculateMarketValuation(input: MarketValuationInput): MarketValuationResult {
  const currentValueUsd = D(input.quantity).mul(input.currentPriceUsd);
  const currentValueToman = currentValueUsd.mul(input.currentTomanPerUsd);
  const costBasisUsd = D(input.costBasisUsd);
  const unrealizedPnlUsd = currentValueUsd.sub(costBasisUsd);
  const historicalCostToman = input.historicalCostToman ? D(input.historicalCostToman) : null;

  // When an immutable purchase-currency cost is available, use it. Older
  // records without that presentation snapshot report the current-currency
  // equivalent of USD unrealized P&L; USD cost basis itself never changes.
  const unrealizedPnlToman = historicalCostToman
    ? currentValueToman.sub(historicalCostToman)
    : unrealizedPnlUsd.mul(input.currentTomanPerUsd);

  return {
    currentValueUsd: currentValueUsd.toString(),
    currentValueToman: currentValueToman.toFixed(0),
    costBasisUsd: costBasisUsd.toString(),
    historicalCostToman: historicalCostToman?.toFixed(0) ?? null,
    unrealizedPnlUsd: unrealizedPnlUsd.toString(),
    unrealizedPnlToman: unrealizedPnlToman.toFixed(0),
  };
}

export async function valueCoinGeckoAssets(
  inputs: CurrentValuationInput[],
): Promise<Map<string, CurrentValuationResult>> {
  const identities: MarketAssetIdentity[] = inputs.map((input) => ({
    assetId: input.assetId,
    coingeckoId: input.coingeckoId,
    symbol: input.symbol,
    name: input.symbol,
    logoUrl: null,
  }));
  const quotes = await getCurrentUsdPrices(identities);
  const result = new Map<string, CurrentValuationResult>();

  for (const input of inputs) {
    const quote = quotes.get(input.coingeckoId);
    if (!quote?.priceUsd) {
      result.set(input.assetId, {
        assetId: input.assetId,
        symbol: input.symbol,
        coingeckoId: input.coingeckoId,
        currentPriceUsd: null,
        freshness: "unavailable",
        observedAt: quote?.observedAt ?? null,
        failureCode: quote?.failureCode,
        currentValueUsd: input.costBasisUsd,
        currentValueToman: D(input.costBasisUsd).mul(input.currentTomanPerUsd).toFixed(0),
        costBasisUsd: input.costBasisUsd,
        historicalCostToman: input.historicalCostToman ?? null,
        unrealizedPnlUsd: "0",
        unrealizedPnlToman: "0",
      });
      continue;
    }

    result.set(input.assetId, {
      assetId: input.assetId,
      symbol: input.symbol,
      coingeckoId: input.coingeckoId,
      currentPriceUsd: quote.priceUsd,
      freshness: quote.freshness,
      observedAt: quote.observedAt,
      failureCode: quote.failureCode,
      ...calculateMarketValuation({
        quantity: input.quantity,
        currentPriceUsd: quote.priceUsd,
        costBasisUsd: input.costBasisUsd,
        currentTomanPerUsd: input.currentTomanPerUsd,
        historicalCostToman: input.historicalCostToman,
      }),
    });
  }

  return result;
}
