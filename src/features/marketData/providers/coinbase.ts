/**
 * PWOS — Phase 2.7: Coinbase Market Data Provider
 *
 * Implements ExternalMarketProvider for Crypto and Tokenized Assets spot rates
 * (e.g., BTC-USD, ETH-USD, PAXG-USD, XAUT-USD).
 *
 * READ-ONLY reference data provider. No ledger mutations.
 */
import {
  ExternalAssetMetadata,
  ExternalMarketProvider,
  ExternalPriceQuote,
} from "../types";

export class CoinbaseProvider implements ExternalMarketProvider {
  public readonly name = "coinbase";
  public readonly displayName = "Coinbase API";
  public readonly type = "crypto";

  private testPriceOverrides = new Map<string, ExternalPriceQuote>();

  public setTestOverride(symbol: string, quote: ExternalPriceQuote): void {
    this.testPriceOverrides.set(symbol.toUpperCase(), quote);
  }

  public clearTestOverrides(): void {
    this.testPriceOverrides.clear();
  }

  private normalizePair(symbol: string, currency: string): string {
    const clean = symbol.toUpperCase().replace(/[-_]/g, "");
    if (symbol.includes("-")) {
      return symbol.toUpperCase();
    }
    return `${clean}-${currency.toUpperCase()}`;
  }

  public async getCurrentPrice(
    symbolOrId: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const pair = this.normalizePair(symbolOrId, currency);
    if (this.testPriceOverrides.has(pair)) {
      return this.testPriceOverrides.get(pair)!;
    }
    if (this.testPriceOverrides.has(symbolOrId.toUpperCase())) {
      return this.testPriceOverrides.get(symbolOrId.toUpperCase())!;
    }

    try {
      const url = `https://api.coinbase.com/v2/prices/${encodeURIComponent(
        pair,
      )}/spot`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { base: string; currency: string; amount: string };
        };
        if (data.data?.amount) {
          return {
            provider: this.name,
            symbol: symbolOrId.toUpperCase(),
            price: data.data.amount,
            currency: data.data.currency.toUpperCase(),
            timestamp: new Date().toISOString(),
            sourceType: "api",
            rawResponse: JSON.stringify(data),
          };
        }
      }
    } catch {
      // Offline / network failure: return null
    }

    return null;
  }

  public async getHistoricalPrice(
    symbolOrId: string,
    asOfDate: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const pair = this.normalizePair(symbolOrId, currency);
    const key = `${pair}_${asOfDate}`;
    if (this.testPriceOverrides.has(key)) {
      return this.testPriceOverrides.get(key)!;
    }
    try {
      const url = `https://api.coinbase.com/v2/prices/${encodeURIComponent(
        pair,
      )}/spot?date=${encodeURIComponent(asOfDate)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as {
          data?: { base: string; currency: string; amount: string };
        };
        if (data.data?.amount) {
          return {
            provider: this.name,
            symbol: symbolOrId.toUpperCase(),
            price: data.data.amount,
            currency: data.data.currency.toUpperCase(),
            timestamp: new Date().toISOString(),
            asOfDate,
            sourceType: "api",
            rawResponse: JSON.stringify(data),
          };
        }
      }
    } catch {
      // Offline / network failure: return null
    }

    return null;
  }

  public async getAssetMetadata(
    symbolOrId: string,
  ): Promise<ExternalAssetMetadata | null> {
    const symbol = symbolOrId.toUpperCase();
    return {
      name: `${symbol} Spot Asset`,
      symbol,
      assetType: "crypto",
      providerId: symbol,
      supportedMarkets: ["USD", "EUR", "GBP"],
    };
  }
}
