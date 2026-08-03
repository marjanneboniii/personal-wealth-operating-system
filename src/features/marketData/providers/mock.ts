/**
 * PWOS — Phase 2.7: Mock External Market Data Provider
 *
 * Implements ExternalMarketProvider for deterministic offline testing and
 * fallback simulation of Crypto, Tokenized Assets (XAUT, PAXG), and Stocks.
 *
 * READ-ONLY reference data provider. No ledger mutations.
 */
import {
  ExternalAssetMetadata,
  ExternalMarketProvider,
  ExternalPriceQuote,
} from "../types";

export class MockExternalProvider implements ExternalMarketProvider {
  public readonly name = "mock";
  public readonly displayName = "Mock Market Data Provider";
  public readonly type = "crypto";

  private currentPrices = new Map<string, ExternalPriceQuote>();
  private historicalPrices = new Map<string, ExternalPriceQuote>();
  private metadataMap = new Map<string, ExternalAssetMetadata>();

  public setMockPrice(symbol: string, price: string, currency = "USD"): void {
    const quote: ExternalPriceQuote = {
      provider: this.name,
      symbol: symbol.toUpperCase(),
      price,
      currency: currency.toUpperCase(),
      timestamp: new Date().toISOString(),
      sourceType: "cache",
    };
    this.currentPrices.set(`${symbol.toUpperCase()}_${currency.toUpperCase()}`, quote);
    this.currentPrices.set(symbol.toUpperCase(), quote);
  }

  public setMockHistoricalPrice(
    symbol: string,
    asOfDate: string,
    price: string,
    currency = "USD",
  ): void {
    const quote: ExternalPriceQuote = {
      provider: this.name,
      symbol: symbol.toUpperCase(),
      price,
      currency: currency.toUpperCase(),
      timestamp: new Date().toISOString(),
      asOfDate,
      sourceType: "cache",
    };
    this.historicalPrices.set(
      `${symbol.toUpperCase()}_${asOfDate}_${currency.toUpperCase()}`,
      quote,
    );
  }

  public setMockMetadata(symbol: string, meta: ExternalAssetMetadata): void {
    this.metadataMap.set(symbol.toUpperCase(), meta);
  }

  public async getCurrentPrice(
    symbolOrId: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const key = `${symbolOrId.toUpperCase()}_${currency.toUpperCase()}`;
    if (this.currentPrices.has(key)) {
      return this.currentPrices.get(key)!;
    }
    if (this.currentPrices.has(symbolOrId.toUpperCase())) {
      return this.currentPrices.get(symbolOrId.toUpperCase())!;
    }
    return null;
  }

  public async getHistoricalPrice(
    symbolOrId: string,
    asOfDate: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const key = `${symbolOrId.toUpperCase()}_${asOfDate}_${currency.toUpperCase()}`;
    if (this.historicalPrices.has(key)) {
      return this.historicalPrices.get(key)!;
    }
    return null;
  }

  public async getAssetMetadata(
    symbolOrId: string,
  ): Promise<ExternalAssetMetadata | null> {
    const upper = symbolOrId.toUpperCase();
    if (this.metadataMap.has(upper)) {
      return this.metadataMap.get(upper)!;
    }
    return {
      name: `${upper} Asset`,
      symbol: upper,
      assetType: "crypto",
      providerId: symbolOrId.toLowerCase(),
      supportedMarkets: ["USD", "IRT"],
    };
  }
}
