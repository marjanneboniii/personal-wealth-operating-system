/**
 * Display Valuation Engine — Main Service (Phase 2.6)
 *
 * CRITICAL ARCHITECTURE GUARANTEE:
 * This service is a READ-ONLY consumer of Portfolio Valuation + FX Engine.
 * It NEVER creates journal entries, postings, or any financial events.
 * It NEVER modifies Accounting Core in any way.
 *
 * Architecture:
 *   Accounting Core (frozen) → Portfolio Valuation → Display Valuation Engine → UI
 *
 * The Display Valuation Engine:
 *   - Reads portfolio valuation output (USD)
 *   - Reads FX rates from exchange_rates table
 *   - Converts display values for UI presentation
 *   - NEVER writes to Accounting Core tables
 *   - NEVER changes asset ownership, quantities, or cost basis
 *
 * Supported display currencies:
 *   USD — US Dollar (identity, no conversion)
 *   IRT — Iranian Toman (FX conversion)
 *   BTC — Bitcoin (display reference unit only)
 *   ETH — Ethereum (display reference unit only)
 *   XAUT — Tether Gold (tokenized gold, display reference only)
 *   PAXG — Pax Gold (tokenized gold, display reference only)
 *
 * IRR (Iranian Rial) is explicitly NOT supported.
 *
 * Physical gold (طلای آب‌شده, سکه, شمش, طلای زینتی) remains separate
 * from XAUT/PAXG tokenized gold assets.
 */
import { D } from "@/domain/decimal";
import type { DisplayCurrency } from "@/features/fx/types";
import { getLatestFxRate } from "@/features/fx/rates";
import { safeConvert } from "@/features/fx/convert";
import { getPortfolioValuation } from "@/features/portfolio/service";
import type { PortfolioSummary } from "@/features/portfolio/types";
import { getDisplayPreference } from "./preferences";
import type { DisplayPortfolioSummary } from "./types";

/**
 * Convert a portfolio valuation to the user's display currency.
 *
 * SAFETY:
 * - Reads from Portfolio Valuation (read-only)
 * - Reads from exchange_rates (read-only)
 * - NEVER writes to any table
 * - NEVER creates financial events
 * - Missing FX rate produces incomplete status, never silent fallback
 *
 * @param userId - Optional user ID for preference lookup
 * @param valuationDate - Optional valuation date (defaults to today)
 * @returns DisplayPortfolioSummary with values in display currency
 */
export async function getDisplayValuation(
  userId?: string,
  valuationDate?: string,
): Promise<DisplayPortfolioSummary> {
  // 1. Get user's display preference
  const pref = await getDisplayPreference(userId);
  const displayCurrency = pref.displayCurrency;

  // 2. Get portfolio valuation in accounting base currency (USD)
  const valuation: PortfolioSummary = await getPortfolioValuation(valuationDate);

  // 3. If display currency is USD, no conversion needed
  if (displayCurrency === "USD") {
    return {
      nativeNetWorth: valuation.totalNetWorth,
      displayNetWorth: valuation.totalNetWorth,
      displayCurrency: "USD",
      assetValuations: valuation.assetValuations.map((av) => ({
        assetId: av.assetId,
        symbol: av.symbol,
        name: av.name,
        className: av.className,
        classColor: av.classColor,
        quantity: av.quantity,
        nativeMarketPrice: av.marketPrice,
        nativeValue: av.currentValue,
        displayValue: av.currentValue,
        displayCurrency: "USD",
        fxRateAvailable: true,
      })),
      fxRateUsed: null,
      fxRateSource: null,
      fxRateDate: null,
      conversionComplete: true,
      conversionWarning: null,
    };
  }

  // 4. Look up FX rate: USD → displayCurrency
  const fxRate = await getLatestFxRate("USD", displayCurrency, valuationDate);

  if (!fxRate) {
    // SAFETY: Missing FX rate → return incomplete status, NEVER silently fallback
    return {
      nativeNetWorth: valuation.totalNetWorth,
      displayNetWorth: "0",
      displayCurrency,
      assetValuations: valuation.assetValuations.map((av) => ({
        assetId: av.assetId,
        symbol: av.symbol,
        name: av.name,
        className: av.className,
        classColor: av.classColor,
        quantity: av.quantity,
        nativeMarketPrice: av.marketPrice,
        nativeValue: av.currentValue,
        displayValue: "0",
        displayCurrency,
        fxRateAvailable: false,
      })),
      fxRateUsed: null,
      fxRateSource: null,
      fxRateDate: null,
      conversionComplete: false,
      conversionWarning: `نرخ تبدیل USD → ${displayCurrency} در دسترس نیست. ارزش‌گذاری به ارز نمایشی ناقص است.`,
    };
  }

  // 5. Convert each asset valuation
  const convertedAssets = valuation.assetValuations.map((av) => {
    const result = safeConvert(
      av.currentValue,
      fxRate.rate,
      "USD",
      displayCurrency,
      fxRate.effectiveDate,
      fxRate.source,
    );

    return {
      assetId: av.assetId,
      symbol: av.symbol,
      name: av.name,
      className: av.className,
      classColor: av.classColor,
      quantity: av.quantity,
      nativeMarketPrice: av.marketPrice,
      nativeValue: av.currentValue,
      displayValue: result?.convertedAmount ?? "0",
      displayCurrency,
      fxRateAvailable: result?.success ?? false,
    };
  });

  // 6. Convert total net worth
  const totalResult = safeConvert(
    valuation.totalNetWorth,
    fxRate.rate,
    "USD",
    displayCurrency,
    fxRate.effectiveDate,
    fxRate.source,
  );

  return {
    nativeNetWorth: valuation.totalNetWorth,
    displayNetWorth: totalResult?.convertedAmount ?? "0",
    displayCurrency,
    assetValuations: convertedAssets,
    fxRateUsed: fxRate.rate,
    fxRateSource: fxRate.source,
    fxRateDate: fxRate.effectiveDate,
    conversionComplete: totalResult?.success ?? false,
    conversionWarning: totalResult?.success
      ? null
      : `تبدیل ارز ناموفق بود: ${totalResult?.failureReason ?? "خطای ناشناخته"}`,
  };
}
