/**
 * PWOS — Phase 2.7: Binance Market Data Provider
 *
 * Implements ExternalMarketProvider for Crypto and Tokenized Assets trading pairs
 * (e.g., BTCUSDT, ETHUSDT, PAXGUSDT, XAUTUSDT).
 *
 * READ-ONLY reference data provider. No ledger mutations.
 */
import {
  ExternalAssetMetadata,
  ExternalMarketProvider,
  ExternalPriceQuote,
} from "../types";

export class BinanceProvider implements ExternalMarketProvider {
  public readonly name = "binance";
  public readonly displayName = "Binance API";
  public readonly type = "crypto";

  private testPriceOverrides = new Map<string, ExternalPriceQuote>();

  public setTestOverride(symbol: string, quote: ExternalPriceQuote): void {
    this.testPriceOverrides.set(symbol.toUpperCase(), quote);
  }

  public clearTestOverrides(): void {
    this.testPriceOverrides.clear();
  }

  private normalizeSymbol(symbol: string, currency: string): string {
    const clean = symbol.toUpperCase().replace(/[-_]/g, "");
    if (clean.endsWith("USDT") || clean.endsWith("USD")) {
      return clean;
    }
    const quote = currency.toUpperCase() === "USD" ? "USDT" : currency.toUpperCase();
    return `${clean}${quote}`;
  }

  public async getCurrentPrice(
    symbolOrId: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const symbol = this.normalizeSymbol(symbolOrId, currency);
    if (this.testPriceOverrides.has(symbol)) {
      return this.testPriceOverrides.get(symbol)!;
    }
    if (this.testPriceOverrides.has(symbolOrId.toUpperCase())) {
      return this.testPriceOverrides.get(symbolOrId.toUpperCase())!;
    }

    try {
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(
        symbol,
      )}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as { symbol: string; price: string };
        if (data.price) {
          return {
            provider: this.name,
            symbol: symbolOrId.toUpperCase(),
            price: data.price,
            currency: currency.toUpperCase(),
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
    const symbol = this.normalizeSymbol(symbolOrId, currency);
    const key = `${symbol}_${asOfDate}`;
    if (this.testPriceOverrides.has(key)) {
      return this.testPriceOverrides.get(key)!;
    }
    // For historical klines on Binance, fallback to null if offline or no override
    return null;
  }

  public async getAssetMetadata(
    symbolOrId: string,
  ): Promise<ExternalAssetMetadata | null> {
    const symbol = symbolOrId.toUpperCase();
    return {
      name: `${symbol} Trading Pair`,
      symbol,
      assetType: "crypto",
      providerId: symbol,
      supportedMarkets: ["USDT", "USD", "BTC"],
    };
  }
}
