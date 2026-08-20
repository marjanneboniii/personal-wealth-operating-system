/**
 * Secondary LIVE market-price source.
 *
 * Used only when CoinGecko fails or omits a quote. Quotes are public spot
 * USD/USDT last prices — never a fabricated number, never a user/holding
 * value, and never written here (persistence stays in lastKnownPrice.ts).
 *
 * This module has no ledger / FIFO / schema / DB imports.
 */
const DEFAULT_TIMEOUT_MS = 6_000;
const SPOT_BASE_URL = "https://api.binance.com/api/v3";

/** CoinGecko id → public USDT spot symbol. Unmapped ids are skipped. */
const SPOT_SYMBOL_BY_COINGECKO_ID: Record<string, string> = {
  bitcoin: "BTCUSDT",
  ethereum: "ETHUSDT",
  binancecoin: "BNBUSDT",
  "usd-coin": "USDCUSDT",
  ripple: "XRPUSDT",
  solana: "SOLUSDT",
  tron: "TRXUSDT",
  hyperliquid: "HYPEUSDT",
  dogecoin: "DOGEUSDT",
  litecoin: "LTCUSDT",
  "ethena-usde": "USDEUSDT",
  "avalanche-2": "AVAXUSDT",
  "tether-gold": "XAUTUSDT",
  "pax-gold": "PAXGUSDT",
  "wrapped-bitcoin": "WBTCUSDT",
};

export type SpotQuote = { priceUsd: string; observedAt: string };

export type PublicSpotQuoteClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
};

export class PublicSpotQuoteClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly baseUrl: string;

  constructor(options: PublicSpotQuoteClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.baseUrl = options.baseUrl ?? SPOT_BASE_URL;
  }

  async fetchUsdPrices(ids: string[]): Promise<Map<string, SpotQuote>> {
    const wanted = [...new Set(ids.map((id) => id.trim().toLowerCase()).filter(Boolean))];
    const symbols = [...new Set(wanted.map((id) => SPOT_SYMBOL_BY_COINGECKO_ID[id]).filter(Boolean))];
    if (symbols.length === 0) return new Map();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = `${this.baseUrl}/ticker/price?symbols=${encodeURIComponent(JSON.stringify(symbols))}`;
      const response = await this.fetchImpl(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
        cache: "no-store",
      });
      if (!response.ok) return new Map();
      const data: unknown = await response.json();
      if (!Array.isArray(data)) return new Map();

      const priceBySymbol = new Map<string, string>();
      for (const row of data) {
        if (!row || typeof row !== "object") continue;
        const symbol = (row as { symbol?: unknown }).symbol;
        const price = (row as { price?: unknown }).price;
        if (typeof symbol !== "string" || typeof price !== "string") continue;
        const numeric = Number(price);
        if (!Number.isFinite(numeric) || numeric <= 0) continue;
        priceBySymbol.set(symbol, price);
      }

      const observedAt = new Date().toISOString();
      const result = new Map<string, SpotQuote>();
      for (const id of wanted) {
        const symbol = SPOT_SYMBOL_BY_COINGECKO_ID[id];
        if (!symbol) continue;
        const priceUsd = priceBySymbol.get(symbol);
        if (!priceUsd) continue;
        result.set(id, { priceUsd, observedAt });
      }
      return result;
    } catch {
      return new Map();
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const disabledSpotQuotes: Pick<PublicSpotQuoteClient, "fetchUsdPrices"> = {
  fetchUsdPrices: async () => new Map(),
};
