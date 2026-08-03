/**
 * PWOS — Phase 2.7: CoinGecko Market Data Provider
 *
 * Implements ExternalMarketProvider for Crypto and Tokenized Assets
 * (e.g., BTC, ETH, XAUT, PAXG).
 *
 * READ-ONLY reference data provider. No ledger mutations.
 */
import {
  ExternalAssetMetadata,
  ExternalMarketProvider,
  ExternalPriceQuote,
} from "../types";

export class CoinGeckoProvider implements ExternalMarketProvider {
  public readonly name = "coingecko";
  public readonly displayName = "CoinGecko API";
  public readonly type = "crypto";

  // Built-in symbol to CoinGecko ID mapping for major crypto and tokenized assets
  private symbolToId: Record<string, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    XAUT: "tether-gold",
    PAXG: "pax-gold",
    USDT: "tether",
    SOL: "solana",
  };

  // Built-in metadata for tokenized assets and top crypto
  private metadataRegistry: Record<string, ExternalAssetMetadata> = {
    bitcoin: {
      name: "Bitcoin",
      symbol: "BTC",
      assetType: "crypto",
      providerId: "bitcoin",
      logoUrl: "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
      supportedMarkets: ["USD", "IRT", "USDT", "EUR"],
    },
    ethereum: {
      name: "Ethereum",
      symbol: "ETH",
      assetType: "crypto",
      providerId: "ethereum",
      logoUrl: "https://assets.coingecko.com/coins/images/279/large/ethereum.png",
      supportedMarkets: ["USD", "IRT", "USDT", "EUR"],
    },
    "tether-gold": {
      name: "Tether Gold",
      symbol: "XAUT",
      assetType: "tokenized_asset",
      providerId: "tether-gold",
      logoUrl: "https://assets.coingecko.com/coins/images/10481/large/Tether_Gold.png",
      supportedMarkets: ["USD", "USDT"],
    },
    "pax-gold": {
      name: "PAX Gold",
      symbol: "PAXG",
      assetType: "tokenized_asset",
      providerId: "pax-gold",
      logoUrl: "https://assets.coingecko.com/coins/images/9519/large/paxg.png",
      supportedMarkets: ["USD", "USDT"],
    },
  };

  // Test override cache for deterministic offline integration testing
  private testPriceOverrides = new Map<string, ExternalPriceQuote>();

  /**
   * Register test override for offline test determinism
   */
  public setTestOverride(symbolOrId: string, quote: ExternalPriceQuote): void {
    this.testPriceOverrides.set(symbolOrId.toUpperCase(), quote);
    const id = this.resolveId(symbolOrId);
    this.testPriceOverrides.set(id, quote);
  }

  public clearTestOverrides(): void {
    this.testPriceOverrides.clear();
  }

  private resolveId(symbolOrId: string): string {
    const upper = symbolOrId.toUpperCase();
    if (this.symbolToId[upper]) {
      return this.symbolToId[upper];
    }
    return symbolOrId.toLowerCase();
  }

  public async getCurrentPrice(
    symbolOrId: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const coinId = this.resolveId(symbolOrId);
    const key = `${coinId}_${currency.toUpperCase()}`;

    // 1. Check test overrides first (for deterministic unit/integration tests)
    if (this.testPriceOverrides.has(coinId)) {
      return this.testPriceOverrides.get(coinId)!;
    }
    if (this.testPriceOverrides.has(symbolOrId.toUpperCase())) {
      return this.testPriceOverrides.get(symbolOrId.toUpperCase())!;
    }

    // 2. Try fetching from CoinGecko API when online
    try {
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
        coinId,
      )}&vs_currencies=${encodeURIComponent(currency.toLowerCase())}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as Record<string, Record<string, number>>;
        const priceVal = data[coinId]?.[currency.toLowerCase()];
        if (typeof priceVal === "number") {
          return {
            provider: this.name,
            symbol: symbolOrId.toUpperCase(),
            price: priceVal.toString(),
            currency: currency.toUpperCase(),
            timestamp: new Date().toISOString(),
            sourceType: "api",
            rawResponse: JSON.stringify(data),
          };
        }
      }
    } catch {
      // Network error or offline mode: do not throw, return null
    }

    return null;
  }

  public async getHistoricalPrice(
    symbolOrId: string,
    asOfDate: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const coinId = this.resolveId(symbolOrId);
    const overrideKey = `${coinId}_${asOfDate}`;
    if (this.testPriceOverrides.has(overrideKey)) {
      return this.testPriceOverrides.get(overrideKey)!;
    }

    try {
      // CoinGecko historical date format is DD-MM-YYYY
      const parts = asOfDate.split("-");
      let formattedDate = asOfDate;
      if (parts.length === 3 && parts[0].length === 4) {
        formattedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
      }

      const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(
        coinId,
      )}/history?date=${encodeURIComponent(formattedDate)}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = (await res.json()) as {
          market_data?: { current_price?: Record<string, number> };
        };
        const priceVal = data.market_data?.current_price?.[currency.toLowerCase()];
        if (typeof priceVal === "number") {
          return {
            provider: this.name,
            symbol: symbolOrId.toUpperCase(),
            price: priceVal.toString(),
            currency: currency.toUpperCase(),
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
    const coinId = this.resolveId(symbolOrId);
    if (this.metadataRegistry[coinId]) {
      return this.metadataRegistry[coinId];
    }
    return null;
  }
}
