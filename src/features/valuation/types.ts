/**
 * Valuation Engine — Separate Domain, Do Not Mix Price With Valuation
 * Different assets require different policies: Crypto Market Price, Gold Spot Price, Real Estate Appraisal, Private Equity Manual Valuation
 * Architecture: Asset -> Valuation Source -> Valuation Event -> Valuation Engine
 */

export type ValuationSourceType = "market_price" | "spot_price" | "appraisal" | "manual" | "book_value";
export type ValuationProviderName = "COINGECKO" | "ZERION" | "TSETMC" | "MANUAL" | "APPRAISAL" | "DEBANK" | "GOLD_API";

export type ValuationSource = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  sourceType: ValuationSourceType;
  primaryProviderName: ValuationProviderName;
  backupProviderName: string | null;
  isActive: boolean;
  config: string | null;
  createdAt: string;
};

export type ValuationEvent = {
  id: string;
  assetId: string;
  assetSymbol?: string;
  valuationDate: string;
  price: string;
  currencyId: string | null;
  currencyCode?: string;
  sourceType: ValuationSourceType;
  providerName: ValuationProviderName;
  sourceId: string | null;
  metadata: string | null;
  note: string | null;
  createdAt: string;
};

export type ValuationResult = {
  assetId: string;
  assetSymbol: string;
  valuationDate: string;
  price: string;
  currencyCode: string;
  sourceType: ValuationSourceType;
  providerName: ValuationProviderName;
  valuationEventId: string | null;
  isFallback: boolean;
  fallbackReason?: string;
};

export type CreateValuationSourceInput = {
  assetId: string;
  sourceType?: ValuationSourceType;
  primaryProviderName?: ValuationProviderName;
  backupProviderName?: string;
  isActive?: boolean;
  config?: string;
};

export type CreateValuationEventInput = {
  assetId: string;
  valuationDate: string;
  price: string;
  currencyId?: string;
  sourceType?: ValuationSourceType;
  providerName?: ValuationProviderName;
  sourceId?: string;
  metadata?: string;
  note?: string;
};
