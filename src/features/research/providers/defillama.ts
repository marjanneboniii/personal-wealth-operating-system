/**
 * DefiLlama Provider Client — Wraps DefiLlama public APIs (no API key required, but handle optional key)
 * Implements: getProtocolsTVL, getChainTVL, getYieldPools, getStablecoins, getFeesAndRevenue
 * CRITICAL RULE: Research only — never writes to Financial Core, never imports postEntry/recordBuy/recordSell
 * Isolated cache tables: defi_protocol_metrics, defi_chain_tvl, defi_yield_opportunities, defi_stablecoins_cache, defi_fees_revenue
 */

export type DefiLlamaProtocol = {
  slug: string;
  name: string;
  category: string | null;
  chain: string | null;
  tvlUSD: string | null;
  tvlChange24h: string | null;
  fees24h: string | null;
  revenue24h: string | null;
};

export type DefiLlamaChainTVL = {
  chainName: string;
  tvlUSD: string | null;
  tokenSymbol: string | null;
};

export type DefiLlamaYieldPool = {
  poolId: string;
  protocolSlug: string | null;
  chain: string | null;
  symbol: string | null;
  tvlUSD: string | null;
  apy: string | null;
  apyBase: string | null;
  apyReward: string | null;
  ilRisk: string | null;
  rawJson: string;
};

export type DefiLlamaStablecoin = {
  stablecoinId: string;
  name: string | null;
  symbol: string | null;
  circulatingUSD: string | null;
  priceUSD: string | null;
  pegType: string | null;
  pegMechanism: string | null;
};

export type DefiLlamaFeesRevenue = {
  targetSlug: string;
  targetType: "protocol" | "chain";
  dailyFeesUSD: string | null;
  dailyRevenueUSD: string | null;
};

function toDecimalString(value: any): string | null {
  if (value === null || value === undefined) return null;
  const num = Number(value);
  if (isNaN(num)) return null;
  return String(num);
}

export class DefiLlamaProvider {
  private baseUrl = "https://api.llama.fi";
  private yieldsUrl = "https://yields.llama.fi";
  private stablecoinsUrl = "https://stablecoins.llama.fi";

  private async fetchWithErrorHandling(url: string): Promise<any> {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[DefiLlamaProvider] API error ${res.status} for ${url}: ${text.slice(0, 500)}`);
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[DefiLlamaProvider] Network error for ${url}:`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Get all protocols TVL
   * Endpoint: GET https://api.llama.fi/protocols
   */
  async getProtocolsTVL(): Promise<DefiLlamaProtocol[]> {
    const url = `${this.baseUrl}/protocols`;
    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data)) return [];

    return data.map((p: any) => ({
      slug: String(p.slug || p.name || "").toLowerCase(),
      name: String(p.name || p.slug || ""),
      category: p.category ? String(p.category) : null,
      chain: p.chain ? String(p.chain) : (Array.isArray(p.chains) && p.chains.length > 0 ? String(p.chains[0]) : null),
      tvlUSD: toDecimalString(p.tvl ?? p.tvlUsd ?? p.currentChainTvls?.Ethereum ?? null),
      tvlChange24h: toDecimalString(p.change_1d ?? p.change_24h ?? null),
      fees24h: null, // Fees from separate endpoint
      revenue24h: null,
    }));
  }

  /**
   * Get chain TVL — all chains or specific chain
   * Endpoint: GET https://api.llama.fi/v2/chains or https://api.llama.fi/v2/historicalChainTvl/{chain}
   */
  async getChainTVL(chain?: string): Promise<DefiLlamaChainTVL[]> {
    const url = chain ? `${this.baseUrl}/v2/historicalChainTvl/${encodeURIComponent(chain)}` : `${this.baseUrl}/v2/chains`;
    const data = await this.fetchWithErrorHandling(url);

    if (!data) return [];

    if (chain) {
      // Historical response is array of {date, tvl}
      // For simplicity, take latest entry
      if (Array.isArray(data) && data.length > 0) {
        const latest = data[data.length - 1];
        return [
          {
            chainName: chain,
            tvlUSD: toDecimalString(latest.tvl),
            tokenSymbol: null,
          },
        ];
      }
      return [];
    } else {
      // Chains list: array of {gecko_id, tvl, tokenSymbol, name, chainId}
      if (!Array.isArray(data)) return [];
      return data.map((c: any) => ({
        chainName: String(c.name || c.gecko_id || ""),
        tvlUSD: toDecimalString(c.tvl),
        tokenSymbol: c.tokenSymbol ? String(c.tokenSymbol) : null,
      }));
    }
  }

  /**
   * Get yield pools
   * Endpoint: GET https://yields.llama.fi/pools
   */
  async getYieldPools(): Promise<DefiLlamaYieldPool[]> {
    const url = `${this.yieldsUrl}/pools`;
    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.data)) return [];

    return data.data.map((pool: any) => ({
      poolId: String(pool.pool || pool.poolId || `${pool.project}-${pool.chain}-${pool.symbol}`),
      protocolSlug: pool.project ? String(pool.project).toLowerCase() : null,
      chain: pool.chain ? String(pool.chain) : null,
      symbol: pool.symbol ? String(pool.symbol) : null,
      tvlUSD: toDecimalString(pool.tvlUsd),
      apy: toDecimalString(pool.apy),
      apyBase: toDecimalString(pool.apyBase),
      apyReward: toDecimalString(pool.apyReward),
      ilRisk: pool.ilRisk ? String(pool.ilRisk) : null,
      rawJson: JSON.stringify(pool).slice(0, 10000),
    }));
  }

  /**
   * Get stablecoins with prices
   * Endpoint: GET https://stablecoins.llama.fi/stablecoins?includePrices=true/false
   */
  async getStablecoins(includePrices: boolean = true): Promise<DefiLlamaStablecoin[]> {
    const url = `${this.stablecoinsUrl}/stablecoins?includePrices=${includePrices}`;
    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.peggedAssets)) return [];

    return data.peggedAssets.map((s: any) => ({
      stablecoinId: String(s.id || s.name || ""),
      name: s.name ? String(s.name) : null,
      symbol: s.symbol ? String(s.symbol) : null,
      circulatingUSD: toDecimalString(s.circulating?.peggedUSD ?? s.circulating ?? null),
      priceUSD: toDecimalString(s.price ?? s.peggedUSD ?? null),
      pegType: s.pegType ? String(s.pegType) : null,
      pegMechanism: s.pegMechanism ? String(s.pegMechanism) : null,
    }));
  }

  /**
   * Get fees and revenue — dailyFees or dailyRevenue
   * Endpoints:
   * - Fees: https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyFees
   * - Revenue: https://api.llama.fi/overview/fees?dataType=dailyRevenue
   */
  async getFeesAndRevenue(dataType: "dailyFees" | "dailyRevenue" = "dailyFees"): Promise<DefiLlamaFeesRevenue[]> {
    const url = `${this.baseUrl}/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=${dataType}`;
    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.protocols)) return [];

    const isFees = dataType === "dailyFees";

    return data.protocols.map((p: any) => ({
      targetSlug: String(p.name || p.slug || p.displayName || ""),
      targetType: "protocol" as const,
      dailyFeesUSD: isFees ? toDecimalString(p.total24h ?? p.dailyFees ?? null) : null,
      dailyRevenueUSD: !isFees ? toDecimalString(p.total24h ?? p.dailyRevenue ?? null) : toDecimalString(p.total24h ?? null),
    }));
  }
}
