import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  assets,
  currencies,
  portfolioSnapshots,
  portfolioValuations,
  users,
} from "@/db/schema";
import {
  getAccountBalances,
  getHoldings,
  getOpenLots,
} from "@/features/ledger/queries";
import { getMarketPrices } from "@/features/marketData/service";
import { D, Decimal } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import { calculateAssetValue, calculateRoi, calculateUnrealizedPnl } from "./valuation";
import { calculateAssetAllocation } from "./allocation";
import { AssetValuation, PortfolioSummary } from "./types";

/**
 * Service: Calculates complete Portfolio Valuation
 *
 * CRITICAL ARCHITECTURE RULE:
 * This service is READ-ONLY with respect to the Accounting Layer.
 * It reads balances, FIFO lots, and market prices, but NEVER creates journal entries,
 * postings, or modifies ledger records.
 */
export async function getPortfolioValuation(
  valuationDate = todayIso(),
  userId?: string,
): Promise<PortfolioSummary> {
  const [holdings, openLots, marketQuotes, balances] = await Promise.all([
    getHoldings(userId),
    getOpenLots(undefined, userId),
    getMarketPrices(),
    getAccountBalances(userId),
  ]);

  const quoteMap = new Map(marketQuotes.map((q) => [q.assetId, q]));

  let totalNetWorth = Decimal.zero();
  let totalCostBasis = Decimal.zero();
  let totalUnrealizedPnl = Decimal.zero();

  const activeHoldings = holdings.filter((h) => D(h.quantity).abs().gt("0.00000001"));
  const assetValuations: AssetValuation[] = [];

  for (const h of activeHoldings) {
    const qty = D(h.quantity);
    const quote = quoteMap.get(h.assetId);
    const mktPrice = quote ? D(quote.price) : D(h.price ?? "0");

    // Calculate FIFO cost basis for this asset from open lots
    const assetLots = openLots.filter((l) => l.assetId === h.assetId);
    let costBasisDec = Decimal.zero();
    if (assetLots.length > 0) {
      for (const lot of assetLots) {
        costBasisDec = costBasisDec.add(D(lot.qtyRemaining).mul(lot.unitCostBase));
      }
    } else {
      costBasisDec = D(h.costBase);
    }
    const costBasis = costBasisDec.toString();

    // Current Market Value: Quantity * Market Price if price is available, else fallback to Cost Basis
    const currentValue = mktPrice.gt(0)
      ? calculateAssetValue(qty.toString(), mktPrice.toString())
      : costBasis;

    const unrealizedPnl = calculateUnrealizedPnl(currentValue, costBasis);
    const roiPercentage = calculateRoi(currentValue, costBasis);

    totalNetWorth = totalNetWorth.add(currentValue);
    totalCostBasis = totalCostBasis.add(costBasis);
    totalUnrealizedPnl = totalUnrealizedPnl.add(unrealizedPnl);

    assetValuations.push({
      assetId: h.assetId,
      symbol: h.symbol,
      name: h.name,
      className: h.className,
      classColor: h.classColor,
      decimals: h.decimals,
      quantity: qty.toString(),
      marketPrice: mktPrice.toString(),
      marketCurrencyCode: quote?.currencyCode ?? "USD",
      currentValue,
      costBasis,
      unrealizedPnl,
      roiPercentage,
      sharePercentage: "0", // computed below after total is known
    });
  }

  // Calculate percentage shares and allocation
  const totalValStr = totalNetWorth.toString();
  for (const av of assetValuations) {
    if (totalNetWorth.gt(0)) {
      av.sharePercentage = D(av.currentValue).div(totalNetWorth).mul("100").toFixed(2);
    }
  }

  const overallRoiPercentage = calculateRoi(totalNetWorth.toString(), totalCostBasis.toString());
  const allocationByClass = calculateAssetAllocation(assetValuations, totalValStr);

  return {
    totalNetWorth: totalValStr,
    totalCostBasis: totalCostBasis.toString(),
    totalUnrealizedPnl: totalUnrealizedPnl.toString(),
    overallRoiPercentage,
    assetValuations: assetValuations.sort((a, b) => Number(b.currentValue) - Number(a.currentValue)),
    allocationByClass,
    valuationDate,
    baseCurrencyCode: "USD",
  };
}

/**
 * Creates a historical wealth snapshot in portfolio_snapshots and portfolio_valuations.
 *
 * CRITICAL RULE: Writes ONLY to portfolio_snapshots and portfolio_valuations.
 * NEVER touches journal_entries or postings.
 */
export async function createPortfolioSnapshot(
  snapshotDate = todayIso(),
  userId?: string,
): Promise<{ id: string }> {
  const valuation = await getPortfolioValuation(snapshotDate, userId);

  const [usdCur] = await db.select().from(currencies).where(eq(currencies.code, "USD")).limit(1);

  return db.transaction(async (tx) => {
    const [snap] = await tx
      .insert(portfolioSnapshots)
      .values({
        userId: userId ?? null,
        snapshotDate,
        totalPortfolioValue: valuation.totalNetWorth,
        baseCurrencyId: usdCur?.id ?? null,
      })
      .onConflictDoUpdate({
        target: portfolioSnapshots.snapshotDate,
        set: { totalPortfolioValue: valuation.totalNetWorth },
      })
      .returning();

    // Store individual asset valuations
    for (const av of valuation.assetValuations) {
      await tx.insert(portfolioValuations).values({
        userId: userId ?? null,
        assetId: av.assetId,
        quantity: av.quantity,
        marketPrice: av.marketPrice,
        totalValue: av.currentValue,
        valuationDate: snapshotDate,
      });
    }

    return { id: snap.id };
  });
}

/**
 * Fetch detailed asset valuation info for Asset Detail View
 */
export async function getAssetValuationDetail(assetId: string, userId?: string) {
  const summary = await getPortfolioValuation(undefined, userId);
  const assetVal = summary.assetValuations.find((v) => v.assetId === assetId);
  if (!assetVal) return null;

  const openLots = await getOpenLots(assetId, userId);
  return {
    ...assetVal,
    openLots,
  };
}
