/**
 * Minimal server-side CoinGecko client.
 *
 * This module only READS public asset identity/current-price data. It has no
 * imports from the ledger, journal, postings, FIFO, lots, accounts, or users.
 * The API key is read from process.env and is never placed in a URL or result.
 */
import type { CoinGeckoCatalogAsset, PriceFailureCode } from "./types";

const DEFAULT_TIMEOUT_MS = 4_000;
const PUBLIC_BASE_URL = "https://api.coingecko.com/api/v3";
const PRO_BASE_URL = "https://pro-api.coingecko.com/api/v3";

export class CoinGeckoRequestError extends Error {
  constructor(
    public readonly code: PriceFailureCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "CoinGeckoRequestError";
  }
}

export type CoinGeckoClientOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  apiKey?: string | null;
  baseUrl?: string;
};

type SimplePricePayload = Record<string, { usd?: number; last_updated_at?: number }>;

type CoinMarketRow = {
  id?: unknown;
  symbol?: unknown;
  name?: unknown;
  image?: unknown;
  market_cap_rank?: unknown;
};

function validMarketRow(row: CoinMarketRow): row is CoinMarketRow & {
  id: string;
  symbol: string;
  name: string;
  image: string;
} {
  return (
    typeof row?.id === "string" && row.id.length > 0 &&
    typeof row?.symbol === "string" && row.symbol.length > 0 &&
    typeof row?.name === "string" && row.name.length > 0 &&
    typeof row?.image === "string" && /^https:\/\//.test(row.image)
  );
}

export class CoinGeckoClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(options: CoinGeckoClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.apiKey = options.apiKey === undefined ? process.env.COINGECKO_API_KEY ?? null : options.apiKey;
    this.baseUrl = options.baseUrl ?? (this.apiKey ? PRO_BASE_URL : PUBLIC_BASE_URL);
  }

  private async request(path: string, query: URLSearchParams): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.apiKey) headers["x-cg-pro-api-key"] = this.apiKey;

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}?${query.toString()}`, {
        method: "GET",
        headers,
        signal: controller.signal,
        cache: "no-store",
      });

      if (response.status === 429) {
        throw new CoinGeckoRequestError("rate_limited", "CoinGecko rate limit reached", 429);
      }
      if ([500, 502, 503, 504].includes(response.status)) {
        throw new CoinGeckoRequestError("upstream_error", "CoinGecko is temporarily unavailable", response.status);
      }
      if (!response.ok) {
        throw new CoinGeckoRequestError(
          response.status === 404 ? "asset_not_found" : "upstream_error",
          `CoinGecko request failed with status ${response.status}`,
          response.status,
        );
      }

      try {
        return await response.json();
      } catch {
        throw new CoinGeckoRequestError("invalid_response", "CoinGecko returned invalid JSON");
      }
    } catch (error) {
      if (error instanceof CoinGeckoRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new CoinGeckoRequestError("timeout", `CoinGecko request exceeded ${this.timeoutMs}ms`);
      }
      throw new CoinGeckoRequestError("network_failure", "CoinGecko network request failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  async fetchUsdPrices(ids: string[]): Promise<Map<string, { priceUsd: string; observedAt: string }>> {
    const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
    if (uniqueIds.length === 0) return new Map();

    const data = await this.request(
      "/simple/price",
      new URLSearchParams({
        ids: uniqueIds.join(","),
        vs_currencies: "usd",
        include_last_updated_at: "true",
      }),
    );

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new CoinGeckoRequestError("invalid_response", "CoinGecko price payload is not an object");
    }

    const payload = data as SimplePricePayload;
    const result = new Map<string, { priceUsd: string; observedAt: string }>();
    for (const id of uniqueIds) {
      const row = payload[id];
      if (!row || typeof row.usd !== "number" || !Number.isFinite(row.usd) || row.usd <= 0) continue;
      const observedAt =
        typeof row.last_updated_at === "number" && Number.isFinite(row.last_updated_at)
          ? new Date(row.last_updated_at * 1000).toISOString()
          : new Date().toISOString();
      result.set(id, { priceUsd: String(row.usd), observedAt });
    }
    return result;
  }

  async fetchTopAssets(limit = 150): Promise<CoinGeckoCatalogAsset[]> {
    return this.fetchAssetPage(
      new URLSearchParams({
        vs_currency: "usd",
        order: "market_cap_desc",
        per_page: String(Math.min(Math.max(limit, 1), 250)),
        page: "1",
        sparkline: "false",
      }),
    );
  }

  private async fetchAssetPage(
    query: URLSearchParams,
  ): Promise<CoinGeckoCatalogAsset[]> {
    const data = await this.request("/coins/markets", query);
    if (!Array.isArray(data)) {
      throw new CoinGeckoRequestError("invalid_response", "CoinGecko catalog payload is not an array");
    }

    return data.filter(validMarketRow).map((row) => ({
      coingeckoId: row.id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      logoUrl: row.image,
      marketCapRank:
        typeof row.market_cap_rank === "number" && Number.isInteger(row.market_cap_rank)
          ? row.market_cap_rank
          : null,
      kind: "crypto",
    }));
  }
}
