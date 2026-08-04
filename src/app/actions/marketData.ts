"use server";

import { z } from "zod";
import {
  syncAllCoinGeckoPrices,
  syncHistoricalPricePoint,
  mapAssetToCoinGecko,
  getCoingeckoMappings,
  searchCoingeckoCoins,
} from "@/features/marketData/service";

const assetIdsSchema = z.array(z.string().uuid()).optional();

const historicalPriceSchema = z.object({
  assetId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
});

const mapAssetSchema = z.object({
  internalAssetId: z.string().uuid(),
  coingeckoId: z.string().min(1).max(100),
});

export async function syncCoinGeckoPricesAction(assetIds?: string[]) {
  try {
    // Validate assetIds if provided (optional filter, not yet implemented per-asset filter, but validated)
    if (assetIds) {
      assetIdsSchema.parse(assetIds);
    }

    // Check env key presence — graceful handling per spec
    if (!process.env.COINGECKO_API_KEY) {
      console.log("[syncCoinGeckoPricesAction] COINGECKO_API_KEY not set — using public API rate limits");
    }

    const result = await syncAllCoinGeckoPrices();

    return {
      ok: true,
      message: `CoinGecko sync completed: ${result.synced} synced, ${result.failed} failed`,
      data: result,
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "CoinGecko sync failed",
      data: { synced: 0, failed: 0, details: [] },
    };
  }
}

export async function fetchHistoricalPriceAction(assetId: string, date: string) {
  try {
    const parsed = historicalPriceSchema.parse({ assetId, date });

    const result = await syncHistoricalPricePoint(parsed.assetId, parsed.date);

    if (!result) {
      return { ok: false, message: `No historical price found for asset on ${date}`, data: null };
    }

    return { ok: true, message: `Historical price synced: ${result.price}`, data: result };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Failed to fetch historical price",
      data: null,
    };
  }
}

export async function mapAssetToCoinGeckoAction(internalAssetId: string, coingeckoId: string) {
  try {
    const parsed = mapAssetSchema.parse({ internalAssetId, coingeckoId });

    const result = await mapAssetToCoinGecko(parsed.internalAssetId, parsed.coingeckoId);

    return { ok: true, message: `Mapped asset ${internalAssetId} to CoinGecko ${coingeckoId}`, data: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Mapping failed", data: null };
  }
}

export async function getCoingeckoMappingsAction() {
  try {
    const mappings = await getCoingeckoMappings();
    return { ok: true, data: mappings };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch mappings", data: [] };
  }
}

export async function searchCoingeckoAction(query: string) {
  try {
    const q = z.string().min(1).max(100).parse(query);
    const results = await searchCoingeckoCoins(q);
    return { ok: true, data: results };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Search failed", data: [] };
  }
}
