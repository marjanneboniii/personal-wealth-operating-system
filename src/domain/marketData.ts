export type AssetClassificationType =
  | "crypto"
  | "stock"
  | "tokenized_security"
  | "commodity"
  | "precious_metal"
  | "etf"
  | "real_estate"
  | "fiat"
  | "other";

export interface PriceQuery {
  assetSymbol: string;
  currencyCode?: string;
  asOfDate?: string;
}

export interface PriceQuote {
  assetSymbol: string;
  price: string;
  currencyCode: string;
  timestamp: string;
  sourceName: string;
}

/**
 * Provider Abstraction Interface
 * All future price providers (CoinGecko, Binance, TSETMC, Yahoo Finance, etc.)
 * will implement this interface without altering the Accounting Core or Ledger.
 */
export interface MarketDataProvider {
  getPrices(queries: PriceQuery[]): Promise<PriceQuote[]>;
  getHistoricalPrices(query: PriceQuery, startDate: string, endDate: string): Promise<PriceQuote[]>;
  getProviderName(): string;
}
