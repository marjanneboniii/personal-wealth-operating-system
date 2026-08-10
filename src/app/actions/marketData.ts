"use server";

import { z } from "zod";
import {
  syncAllCoinGeckoPrices,
  syncHistoricalPricePoint,
  mapAssetToCoinGecko,
  getCoingeckoMappings,
  searchCoingeckoCoins,
} from "@/features/marketData/service";
import { getCurrentUser } from "@/lib/auth";
import { isAdminOrOwner } from "@/lib/authGuard";
import { db } from "@/db";
import { users } from "@/db/schema";
import { isNotNull } from "drizzle-orm";

/**
 * SECURITY: market prices are GLOBAL reference data.
 * - Read → any authenticated user.
 * - Modify (sync / insert / mapping) → owner/admin only (or system mode when
 *   no auth users exist, i.e. legacy single-tenant).
 * Role is always taken from the server-side session, never from the request.
 */
async function guardMarketData(mutate: boolean): Promise<string | null> {
  try {
    const user = await getCurrentUser();
    const [row] = await db.select().from(users).where(isNotNull(users.username)).limit(1);
    const hasAuth = !!row;
    if (hasAuth && !user) return "برای این عملیات ابتدا وارد شوید.";
    if (mutate && hasAuth && user && !isAdminOrOwner(user)) {
      return "دسترسی غیرمجاز: تغییر داده‌های بازار فقط برای مدیر امکان‌پذیر است.";
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes("وارد شوید")) return e.message;
  }
  return null;
}

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
  const denied = await guardMarketData(true);
  if (denied) {
    return { ok: false, message: denied, data: { synced: 0, failed: 0, details: [] } };
  }
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
  const denied = await guardMarketData(true);
  if (denied) return { ok: false, message: denied, data: null };
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
  const denied = await guardMarketData(true);
  if (denied) return { ok: false, message: denied, data: null };
  try {
    const parsed = mapAssetSchema.parse({ internalAssetId, coingeckoId });

    const result = await mapAssetToCoinGecko(parsed.internalAssetId, parsed.coingeckoId);

    return { ok: true, message: `Mapped asset ${internalAssetId} to CoinGecko ${coingeckoId}`, data: result };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Mapping failed", data: null };
  }
}

export async function getCoingeckoMappingsAction() {
  const denied = await guardMarketData(false);
  if (denied) return { ok: false, message: denied, data: [] };
  try {
    const mappings = await getCoingeckoMappings();
    return { ok: true, data: mappings };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch mappings", data: [] };
  }
}

export async function searchCoingeckoAction(query: string) {
  const denied = await guardMarketData(false);
  if (denied) return { ok: false, message: denied, data: [] };
  try {
    const q = z.string().min(1).max(100).parse(query);
    const results = await searchCoingeckoCoins(q);
    return { ok: true, data: results };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Search failed", data: [] };
  }
}
