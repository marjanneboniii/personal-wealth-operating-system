/**
 * PWOS — Phase 2.7: External Market Provider Registry
 *
 * Manages active external market data providers (CoinGecko, Binance, Coinbase, Mock).
 *
 * READ-ONLY reference data registry.
 */
import { ExternalMarketProvider, ExternalPriceQuote } from "../types";
import { BinanceProvider } from "./binance";
import { CoinbaseProvider } from "./coinbase";
import { CoinGeckoProvider } from "./coingecko";
import { MockExternalProvider } from "./mock";

export class MarketProviderRegistry {
  private providers = new Map<string, ExternalMarketProvider>();

  constructor() {
    this.registerDefaultProviders();
  }

  private registerDefaultProviders(): void {
    this.registerProvider(new CoinGeckoProvider());
    this.registerProvider(new BinanceProvider());
    this.registerProvider(new CoinbaseProvider());
    this.registerProvider(new MockExternalProvider());
  }

  public registerProvider(provider: ExternalMarketProvider): void {
    this.providers.set(provider.name.toLowerCase(), provider);
  }

  public getProvider(name: string): ExternalMarketProvider | undefined {
    return this.providers.get(name.toLowerCase());
  }

  public listProviders(): ExternalMarketProvider[] {
    return Array.from(this.providers.values());
  }

  /**
   * Attempt to retrieve current price from specified provider, or iterate providers
   */
  public async getCurrentPriceQuote(
    symbolOrId: string,
    providerName?: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    if (providerName) {
      const p = this.getProvider(providerName);
      if (p) {
        return p.getCurrentPrice(symbolOrId, currency);
      }
    }

    for (const p of this.providers.values()) {
      const q = await p.getCurrentPrice(symbolOrId, currency);
      if (q) return q;
    }
    return null;
  }

  /**
   * Attempt to retrieve historical price quote from specified provider, or iterate providers
   */
  public async getHistoricalPriceQuote(
    symbolOrId: string,
    asOfDate: string,
    providerName?: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    if (providerName) {
      const p = this.getProvider(providerName);
      if (p) {
        return p.getHistoricalPrice(symbolOrId, asOfDate, currency);
      }
    }

    for (const p of this.providers.values()) {
      const q = await p.getHistoricalPrice(symbolOrId, asOfDate, currency);
      if (q) return q;
    }
    return null;
  }
}

export const marketProviderRegistry = new MarketProviderRegistry();
export { BinanceProvider, CoinbaseProvider, CoinGeckoProvider, MockExternalProvider };
