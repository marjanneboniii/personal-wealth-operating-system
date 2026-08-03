/**
 * PWOS — Phase 2.7: External Market Data Provider Layer
 *
 * Types and interfaces for external market providers, mappings, price caching,
 * and portfolio wallet observations.
 *
 * ARCHITECTURAL GUARANTEES:
 * 1. Market Data is reference data only.
 * 2. MUST NOT modify or write to Ledger, Journal Entries, Postings, Accounts,
 *    FIFO Engine, Lot Tracking, Cost Basis Engine, or Accounting Core.
 * 3. Profit & Loss calculations remain internally calculated using recorded
 *    transactions, cost basis engine, and FIFO lot tracking.
 * 4. Wallet observations prevent double counting between blockchain balances
 *    and manually recorded transactions. Manual transactions remain the source
 *    of accounting truth.
 */

export interface ExternalPriceQuote {
  provider: string;
  symbol: string;
  price: string; // Numeric decimal string
  currency: string; // e.g., "USD"
  timestamp: string; // ISO timestamp
  asOfDate?: string; // YYYY-MM-DD if historical
  sourceType: "api" | "cache" | "manual";
  rawResponse?: string;
}

export interface ExternalAssetMetadata {
  name: string;
  symbol: string;
  assetType: "crypto" | "tokenized_asset" | "stock" | string;
  providerId: string; // External provider ID (e.g., "bitcoin", "tether-gold", "pax-gold")
  logoUrl?: string;
  supportedMarkets?: string[]; // e.g. ["USD", "IRT", "USDT"]
  metadata?: Record<string, unknown>;
}

export interface ExternalMarketProvider {
  name: string; // unique identifier e.g., "coingecko", "binance", "coinbase", "mock"
  displayName: string;
  type: "crypto" | "stocks" | "tokenized_assets" | "fx";

  getCurrentPrice(symbolOrId: string, currency?: string): Promise<ExternalPriceQuote | null>;
  getHistoricalPrice(
    symbolOrId: string,
    asOfDate: string, // YYYY-MM-DD
    currency?: string,
  ): Promise<ExternalPriceQuote | null>;
  getAssetMetadata(symbolOrId: string): Promise<ExternalAssetMetadata | null>;
}

export interface ProviderMappingDTO {
  assetId: string;
  providerId?: string;
  providerName?: string; // e.g. "coingecko"
  externalSymbol: string;
  externalName?: string;
  providerAssetId?: string;
  assetType?: "crypto" | "tokenized_asset" | "stock" | string;
  logoUrl?: string;
  supportedMarkets?: string; // Comma separated e.g. "USD,IRT,USDT"
  metadataJson?: string;
}

export interface WalletObservationInput {
  userId?: string;
  walletId?: string;
  assetId: string;
  observedBalance: string; // Decimal string representing external blockchain balance
  observationDate: string; // YYYY-MM-DD
  source?: string; // Default "manual_observation"
  notes?: string;
}

export interface WalletObservationResult {
  id: string;
  assetId: string;
  observedBalance: string;
  recordedBalance: string; // Internal accounting ledger balance at observation time
  discrepancy: string; // observedBalance - recordedBalance
  observationDate: string;
  source: string;
  notes?: string;
  isReconciled: boolean; // true if discrepancy is 0 or within rounding epsilon (1e-9)
}
