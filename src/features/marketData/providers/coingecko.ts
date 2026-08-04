/**
 * CoinGecko API Provider Client — Supports optional COINGECKO_API_KEY
 * Implements: getSimplePrice, getHistoricalPrice (DD-MM-YYYY), getCoinMarketData, searchCoin
 * CRITICAL RULE: Provider returns market data, but only Market Data Service writes to SSOT tables market_prices, market_snapshots, prices
 * No FK to Financial Core, never imports postEntry/recordBuy/recordSell
 */

import type {
  ExternalAssetMetadata,
  ExternalMarketProvider,
  ExternalPriceQuote,
} from "../types";

export type SimplePriceResult = Record<string, Record<string, number>>;

export type CoinMarketData = {
  id: string;
  symbol: string;
  name: string;
  currentPrice: Record<string, number> | null;
  marketCap: Record<string, number> | null;
  totalVolume: Record<string, number> | null;
  priceChange24h: number | null;
  lastUpdated: string | null;
  rawJson: string;
};

export type CoinSearchResult = {
  id: string;
  symbol: string;
  name: string;
  thumb?: string;
};

function getApiKey(): string | null {
  const key = process.env.COINGECKO_API_KEY;
  if (!key) {
    console.log("[CoinGeckoProvider] COINGECKO_API_KEY not set — using public API rate limits. Set COINGECKO_API_KEY in .env.local for higher limits.");
    return null;
  }
  return key;
}

export class CoinGeckoProvider {
  private baseUrl = "https://api.coingecko.com/api/v3";
  private proBaseUrl = "https://pro-api.coingecko.com/api/v3";
  private apiKey: string | null;

  constructor() {
    this.apiKey = getApiKey();
  }

  private getBaseUrl(): string {
    // If API key present, use pro API, else public
    return this.apiKey ? this.proBaseUrl : this.baseUrl;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };
    if (this.apiKey) {
      headers["x-cg-pro-api-key"] = this.apiKey;
    }
    return headers;
  }

  private async fetchWithErrorHandling(url: string): Promise<any> {
    try {
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[CoinGeckoProvider] API error ${res.status} for ${url}: ${text.slice(0, 1000)}`);
        if (res.status === 429) {
          console.error("[CoinGeckoProvider] Rate limited — consider setting COINGECKO_API_KEY");
        }
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[CoinGeckoProvider] Network error for ${url}:`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Get simple price for coinIds
   * Endpoint: GET /simple/price?ids=bitcoin,ethereum&vs_currencies=usd,eur,irt
   */
  async getSimplePrice(coinIds: string[], vsCurrencies: string[] = ["usd"]): Promise<SimplePriceResult | null> {
    if (coinIds.length === 0) return {};

    const idsParam = coinIds.map((id) => encodeURIComponent(id)).join(",");
    const vsParam = vsCurrencies.map((c) => encodeURIComponent(c)).join(",");

    const url = `${this.getBaseUrl()}/simple/price?ids=${idsParam}&vs_currencies=${vsParam}&include_last_updated_at=true`;

    const data = await this.fetchWithErrorHandling(url);
    return data;
  }

  /**
   * Get historical price for coinId on date (format DD-MM-YYYY)
   * Endpoint: GET /coins/{id}/history?date=DD-MM-YYYY
   */
  async getHistoricalPrice(coinId: string, date: string): Promise<{ price: number | null; rawJson: string } | null> {
    // Validate date format DD-MM-YYYY
    if (!/^\d{2}-\d{2}-\d{4}$/.test(date)) {
      throw new Error(`Invalid date format for CoinGecko historical price, expected DD-MM-YYYY, got ${date}`);
    }

    const url = `${this.getBaseUrl()}/coins/${encodeURIComponent(coinId)}/history?date=${encodeURIComponent(date)}&localization=false`;

    const data = await this.fetchWithErrorHandling(url);
    if (!data) return null;

    try {
      const priceUSD = data?.market_data?.current_price?.usd ?? null;
      return {
        price: priceUSD ? Number(priceUSD) : null,
        rawJson: JSON.stringify(data).slice(0, 10000),
      };
    } catch (e) {
      console.error("[CoinGeckoProvider] Failed to parse historical price", e);
      return { price: null, rawJson: JSON.stringify(data).slice(0, 10000) };
    }
  }

  /**
   * Get coin market data
   * Endpoint: GET /coins/{id}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false
   */
  async getCoinMarketData(coinId: string): Promise<CoinMarketData | null> {
    const url = `${this.getBaseUrl()}/coins/${encodeURIComponent(coinId)}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;

    const data = await this.fetchWithErrorHandling(url);
    if (!data) return null;

    try {
      return {
        id: String(data.id),
        symbol: String(data.symbol || ""),
        name: String(data.name || ""),
        currentPrice: data.market_data?.current_price || null,
        marketCap: data.market_data?.market_cap || null,
        totalVolume: data.market_data?.total_volume || null,
        priceChange24h: data.market_data?.price_change_percentage_24h ? Number(data.market_data.price_change_percentage_24h) : null,
        lastUpdated: data.last_updated ? String(data.last_updated) : null,
        rawJson: JSON.stringify(data).slice(0, 10000),
      };
    } catch (e) {
      console.error("[CoinGeckoProvider] Failed to parse market data", e);
      return null;
    }
  }

  /**
   * Search coin
   * Endpoint: GET /search?query=bitcoin
   */
  async searchCoin(query: string): Promise<CoinSearchResult[]> {
    const url = `${this.getBaseUrl()}/search?query=${encodeURIComponent(query)}`;

    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.coins)) return [];

    return data.coins.map((coin: any) => ({
      id: String(coin.id),
      symbol: String(coin.symbol || ""),
      name: String(coin.name || ""),
      thumb: coin.thumb ? String(coin.thumb) : undefined,
    }));
  }
}

/**
 * CoinGeckoMarketProvider — ExternalMarketProvider adapter over the raw
 * CoinGeckoProvider API client.
 *
 * The raw client keeps its low-level API (DD-MM-YYYY history dates, raw JSON
 * payloads) used by the legacy market data service; this adapter normalizes it
 * to the Phase 2.7 ExternalMarketProvider contract used by the provider
 * registry (YYYY-MM-DD dates, ExternalPriceQuote records).
 *
 * READ-ONLY reference data provider. No ledger mutations.
 */
export class CoinGeckoMarketProvider implements ExternalMarketProvider {
  public readonly name = "coingecko";
  public readonly displayName = "CoinGecko API";
  public readonly type = "crypto";

  private readonly client: CoinGeckoProvider;

  constructor(client?: CoinGeckoProvider) {
    this.client = client ?? new CoinGeckoProvider();
  }

  async getCurrentPrice(
    symbolOrId: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    const coinId = symbolOrId.toLowerCase();
    const vsCurrency = currency.toLowerCase();

    const data = await this.client.getSimplePrice([coinId], [vsCurrency]);
    const entry = data ? data[coinId] : undefined;
    const price = entry ? entry[vsCurrency] : undefined;
    if (price == null) return null;

    const lastUpdatedAt = entry?.last_updated_at;
    return {
      provider: this.name,
      symbol: symbolOrId.toUpperCase(),
      price: String(price),
      currency: currency.toUpperCase(),
      timestamp:
        typeof lastUpdatedAt === "number"
          ? new Date(lastUpdatedAt * 1000).toISOString()
          : new Date().toISOString(),
      sourceType: "api",
      rawResponse: JSON.stringify(data).slice(0, 10000),
    };
  }

  async getHistoricalPrice(
    symbolOrId: string,
    asOfDate: string,
    currency = "USD",
  ): Promise<ExternalPriceQuote | null> {
    // Raw client requires DD-MM-YYYY; registry contract is YYYY-MM-DD.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(asOfDate);
    if (!match) {
      throw new Error(`Invalid date format, expected YYYY-MM-DD, got ${asOfDate}`);
    }
    const coinGeckoDate = `${match[3]}-${match[2]}-${match[1]}`;

    const result = await this.client.getHistoricalPrice(
      symbolOrId.toLowerCase(),
      coinGeckoDate,
    );
    if (!result || result.price == null) return null;

    return {
      provider: this.name,
      symbol: symbolOrId.toUpperCase(),
      price: String(result.price),
      currency: currency.toUpperCase(),
      timestamp: new Date().toISOString(),
      asOfDate,
      sourceType: "api",
      rawResponse: result.rawJson,
    };
  }

  async getAssetMetadata(
    symbolOrId: string,
  ): Promise<ExternalAssetMetadata | null> {
    const data = await this.client.getCoinMarketData(symbolOrId.toLowerCase());
    if (!data) return null;

    return {
      name: data.name,
      symbol: data.symbol.toUpperCase(),
      assetType: "crypto",
      providerId: data.id,
      supportedMarkets: data.currentPrice
        ? Object.keys(data.currentPrice).map((c) => c.toUpperCase())
        : undefined,
    };
  }
}
