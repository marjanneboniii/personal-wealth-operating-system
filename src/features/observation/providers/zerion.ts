/**
 * Zerion API Provider Client — Wraps Zerion API v1
 * Uses ZERION_API_KEY from environment variables
 * Implements: getPortfolio, getPositions (tokens, staking, deposits, loans, perps), getTransactions, getNfts, getPerpPositions
 * CRITICAL RULE: Observation only — never writes to Financial Core, never imports postEntry/recordBuy/recordSell
 * No FK to accounts/journal_entries/postings/lots
 */

import { D } from "@/domain/decimal";

export type ZerionPortfolio = {
  totalValueUSD: string;
  netUnrealizedPnlUSD: string;
  netRealizedPnlUSD: string;
  positionsCount: number;
};

export type ZerionPosition = {
  id: string;
  protocolId: string | null;
  marketSymbol: string | null;
  positionType: string; // deposit, loan, staked, perp, yield
  quantity: string;
  priceUSD: string | null;
  valueUSD: string | null;
  unrealizedPnlUSD: string | null;
  rawJson: string;
};

export type ZerionTransaction = {
  id: string;
  txHash: string | null;
  txType: string | null;
  status: string | null;
  feeUSD: string | null;
  summary: string | null;
  detailsJson: string;
  minedAt: Date | null;
};

export type ZerionNft = {
  id: string;
  walletAddress: string;
  collectionName: string | null;
  nftId: string | null;
  floorPriceUSD: string | null;
  estimatedValueUSD: string | null;
  rawJson: string;
};

export type ZerionPerp = {
  id: string;
  walletAddress: string;
  exchangeProtocol: string | null;
  marketPair: string | null;
  side: string | null; // long/short
  leverage: string | null;
  marginUSD: string | null;
  size: string | null;
  entryPriceUSD: string | null;
  markPriceUSD: string | null;
  unrealizedPnlUSD: string | null;
  rawJson: string;
};

function getApiKey(): string {
  const key = process.env.ZERION_API_KEY;
  if (!key) {
    console.warn("[ZerionProvider] ZERION_API_KEY is not set in environment variables. Provider will return empty results. Please set ZERION_API_KEY in .env.local");
    return "";
  }
  return key;
}

function toDecimalString(value: any): string | null {
  if (value === null || value === undefined) return null;
  try {
    // Convert float to 18-decimal string via D()
    return D(String(value)).toString();
  } catch {
    return null;
  }
}

export class ZerionProvider {
  private baseUrl = "https://api.zerion.io/v1";
  private apiKey: string;

  constructor() {
    this.apiKey = getApiKey();
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (this.apiKey) {
      // Zerion uses Basic auth with API key as username per docs
      const encoded = Buffer.from(`${this.apiKey}:`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }
    return headers;
  }

  private async fetchWithErrorHandling(url: string): Promise<any> {
    if (!this.apiKey) {
      console.warn(`[ZerionProvider] Skipping fetch ${url} — missing API key`);
      return null;
    }
    try {
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) {
        const text = await res.text();
        console.error(`[ZerionProvider] API error ${res.status} for ${url}: ${text.slice(0, 500)}`);
        if (res.status === 401) {
          console.error("[ZerionProvider] Unauthorized — check ZERION_API_KEY");
        }
        return null;
      }
      return await res.json();
    } catch (e) {
      console.error(`[ZerionProvider] Network error for ${url}:`, e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /**
   * Get portfolio overview for address — total value, unrealized/realized PnL
   * Endpoint: GET /v1/wallets/{address}/overview
   */
  async getPortfolio(address: string): Promise<ZerionPortfolio | null> {
    const normalizedAddress = address.trim().toLowerCase();
    const url = `${this.baseUrl}/wallets/${normalizedAddress}/overview`;
    const data = await this.fetchWithErrorHandling(url);
    if (!data) return null;

    try {
      // Zerion overview structure: data.attributes.positions_distribution? or data.data.attributes
      const attrs = data?.data?.attributes || data?.attributes || {};
      const positions = attrs?.positions_count ?? 0;
      const totalValue = attrs?.total?.positions ?? attrs?.total_value ?? 0;
      const unrealized = attrs?.changes?.absolute_1d ?? 0; // placeholder mapping

      return {
        totalValueUSD: toDecimalString(totalValue) ?? "0",
        netUnrealizedPnlUSD: toDecimalString(unrealized) ?? "0",
        netRealizedPnlUSD: "0", // Zerion overview may not provide realized directly
        positionsCount: positions,
      };
    } catch (e) {
      console.error("[ZerionProvider] Failed to parse portfolio", e);
      return null;
    }
  }

  /**
   * Get positions for address — filters for tokens, staking, deposits, loans, perps
   * Endpoint: GET /v1/wallets/{address}/positions?filter[positions]=no_filter&currency=usd
   */
  async getPositions(address: string): Promise<ZerionPosition[]> {
    const normalizedAddress = address.trim().toLowerCase();
    const url = `${this.baseUrl}/wallets/${normalizedAddress}/positions?filter[positions]=no_filter&currency=usd&sort=-value`;

    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.data)) return [];

    const positions: ZerionPosition[] = [];

    for (const item of data.data) {
      try {
        const attrs = item.attributes || {};
        const quantity = attrs?.quantity?.float ?? attrs?.quantity ?? 0;
        const price = attrs?.price ?? 0;
        const value = attrs?.value ?? 0;
        const pnl = attrs?.absolute_profit ?? attrs?.pnl ?? null;
        const protocolId = attrs?.protocol ?? attrs?.dapp?.id ?? null;
        const marketSymbol = attrs?.fungible_info?.symbol ?? attrs?.symbol ?? null;
        const positionTypeRaw = attrs?.position_type ?? attrs?.type ?? "deposit";
        // Map to allowed position_type: deposit, loan, staked, perp, yield
        let positionType = "deposit";
        const lowerType = String(positionTypeRaw).toLowerCase();
        if (lowerType.includes("loan") || lowerType.includes("borrow")) positionType = "loan";
        else if (lowerType.includes("stake")) positionType = "staked";
        else if (lowerType.includes("perp") || lowerType.includes("perpetual")) positionType = "perp";
        else if (lowerType.includes("yield") || lowerType.includes("reward")) positionType = "yield";
        else positionType = "deposit";

        positions.push({
          id: item.id || `${normalizedAddress}-${marketSymbol}-${protocolId}-${Date.now()}`,
          protocolId: protocolId ? String(protocolId) : null,
          marketSymbol: marketSymbol ? String(marketSymbol) : null,
          positionType,
          quantity: toDecimalString(quantity) ?? "0",
          priceUSD: toDecimalString(price),
          valueUSD: toDecimalString(value),
          unrealizedPnlUSD: toDecimalString(pnl),
          rawJson: JSON.stringify(item).slice(0, 10000), // limit size
        });
      } catch (e) {
        console.warn("[ZerionProvider] Failed to parse position", e);
        continue;
      }
    }

    return positions;
  }

  /**
   * Get transactions for address with pagination
   * Endpoint: GET /v1/wallets/{address}/transactions?currency=usd&page[after]=pageBefore
   */
  async getTransactions(address: string, pageBefore?: string): Promise<{ transactions: ZerionTransaction[]; nextPageCursor: string | null }> {
    const normalizedAddress = address.trim().toLowerCase();
    let url = `${this.baseUrl}/wallets/${normalizedAddress}/transactions?currency=usd&sort=-mined_at&page[size]=50`;
    if (pageBefore) {
      url += `&page[after]=${encodeURIComponent(pageBefore)}`;
    }

    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.data)) {
      return { transactions: [], nextPageCursor: null };
    }

    const transactions: ZerionTransaction[] = [];

    for (const item of data.data) {
      try {
        const attrs = item.attributes || {};
        const txHash = attrs?.hash ?? attrs?.tx_hash ?? null;
        const txType = attrs?.operation_type ?? attrs?.type ?? null;
        const status = attrs?.status ?? null;
        const fee = attrs?.fee?.value ?? attrs?.fee ?? null;
        const summary = attrs?.name ?? attrs?.summary ?? null;
        const minedAtRaw = attrs?.mined_at ?? null;
        const minedAt = minedAtRaw ? new Date(minedAtRaw) : null;

        transactions.push({
          id: item.id,
          txHash: txHash ? String(txHash) : null,
          txType: txType ? String(txType) : null,
          status: status ? String(status) : null,
          feeUSD: toDecimalString(fee),
          summary: summary ? String(summary) : null,
          detailsJson: JSON.stringify(item).slice(0, 10000),
          minedAt,
        });
      } catch (e) {
        console.warn("[ZerionProvider] Failed to parse transaction", e);
        continue;
      }
    }

    // Pagination cursor from links or meta
    const nextCursor = data?.links?.next ? new URL(data.links.next).searchParams.get("page[after]") : null;
    const metaAfter = data?.meta?.next_page_cursor || null;

    return {
      transactions,
      nextPageCursor: nextCursor ?? metaAfter ?? null,
    };
  }

  /**
   * Get NFTs for address
   * Endpoint: GET /v1/wallets/{address}/nft-positions?currency=usd
   */
  async getNfts(address: string): Promise<ZerionNft[]> {
    const normalizedAddress = address.trim().toLowerCase();
    const url = `${this.baseUrl}/wallets/${normalizedAddress}/nft-positions?currency=usd`;

    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.data)) return [];

    const nfts: ZerionNft[] = [];

    for (const item of data.data) {
      try {
        const attrs = item.attributes || {};
        const collectionName = attrs?.collection_info?.name ?? attrs?.collection ?? null;
        const nftId = attrs?.token_id ?? attrs?.nft_id ?? item.id;
        const floorPrice = attrs?.collection_info?.floor_price ?? attrs?.floor_price ?? null;
        const estimatedValue = attrs?.value ?? attrs?.estimated_value ?? null;

        nfts.push({
          id: `${normalizedAddress}-${nftId}-${Date.now()}`,
          walletAddress: normalizedAddress,
          collectionName: collectionName ? String(collectionName) : null,
          nftId: nftId ? String(nftId) : null,
          floorPriceUSD: toDecimalString(floorPrice),
          estimatedValueUSD: toDecimalString(estimatedValue),
          rawJson: JSON.stringify(item).slice(0, 10000),
        });
      } catch (e) {
        console.warn("[ZerionProvider] Failed to parse NFT", e);
        continue;
      }
    }

    return nfts;
  }

  /**
   * Get perp positions for address — Zerion may return perps via positions endpoint with filter, or via separate endpoint
   * We filter positions where position_type includes perp
   * Endpoint: GET /v1/wallets/{address}/positions?filter[position_types]=perp
   */
  async getPerpPositions(address: string): Promise<ZerionPerp[]> {
    const normalizedAddress = address.trim().toLowerCase();
    const url = `${this.baseUrl}/wallets/${normalizedAddress}/positions?filter[position_types]=perp&currency=usd`;

    const data = await this.fetchWithErrorHandling(url);
    if (!data || !Array.isArray(data?.data)) {
      // Fallback: filter from general positions
      const allPositions = await this.getPositions(address);
      const perps = allPositions.filter((p) => p.positionType === "perp");
      return perps.map((p) => ({
        id: p.id,
        walletAddress: normalizedAddress,
        exchangeProtocol: p.protocolId,
        marketPair: p.marketSymbol,
        side: null,
        leverage: null,
        marginUSD: null,
        size: p.quantity,
        entryPriceUSD: null,
        markPriceUSD: p.priceUSD,
        unrealizedPnlUSD: p.unrealizedPnlUSD,
        rawJson: p.rawJson,
      }));
    }

    const perps: ZerionPerp[] = [];

    for (const item of data.data) {
      try {
        const attrs = item.attributes || {};
        const protocol = attrs?.protocol ?? attrs?.dapp?.id ?? null;
        const pair = attrs?.fungible_info?.symbol ?? attrs?.symbol ?? null;
        const side = attrs?.side ?? null;
        const leverage = attrs?.leverage ?? null;
        const margin = attrs?.margin ?? attrs?.collateral ?? null;
        const size = attrs?.quantity?.float ?? attrs?.quantity ?? null;
        const entryPrice = attrs?.entry_price ?? attrs?.avg_price ?? null;
        const markPrice = attrs?.price ?? attrs?.mark_price ?? null;
        const pnl = attrs?.absolute_profit ?? attrs?.pnl ?? null;

        perps.push({
          id: item.id || `${normalizedAddress}-${pair}-${Date.now()}`,
          walletAddress: normalizedAddress,
          exchangeProtocol: protocol ? String(protocol) : null,
          marketPair: pair ? String(pair) : null,
          side: side ? String(side) : null,
          leverage: leverage ? String(leverage) : null,
          marginUSD: toDecimalString(margin),
          size: toDecimalString(size) ?? "0",
          entryPriceUSD: toDecimalString(entryPrice),
          markPriceUSD: toDecimalString(markPrice),
          unrealizedPnlUSD: toDecimalString(pnl),
          rawJson: JSON.stringify(item).slice(0, 10000),
        });
      } catch (e) {
        console.warn("[ZerionProvider] Failed to parse perp", e);
        continue;
      }
    }

    return perps;
  }
}
