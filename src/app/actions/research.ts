"use server";

import { z } from "zod";
import {
  syncDefiProtocolsAndTVL,
  syncYieldOpportunities,
  syncStablecoinsMetrics,
  syncFeesAndRevenue,
  getYieldPools,
  getStablecoinOverview,
  getProtocolFeesRevenue,
} from "@/features/research/service";

const syncFiltersSchema = z.object({
  minTVL: z.number().optional().default(1000000),
  minAPY: z.number().optional().default(0),
});

const yieldPoolsFilterSchema = z.object({
  chain: z.string().optional(),
  minApy: z.number().optional(),
});

export async function syncResearchDataAction() {
  try {
    const protocolsResult = await syncDefiProtocolsAndTVL();
    const yieldCount = await syncYieldOpportunities();
    const stablecoinsCount = await syncStablecoinsMetrics();
    const feesResult = await syncFeesAndRevenue();

    return {
      ok: true,
      message: `Research sync completed: ${protocolsResult.protocols} protocols, ${protocolsResult.chains} chains, ${yieldCount} yield pools, ${stablecoinsCount} stablecoins, ${feesResult.fees} fees, ${feesResult.revenue} revenue`,
      data: {
        protocols: protocolsResult.protocols,
        chains: protocolsResult.chains,
        yieldPools: yieldCount,
        stablecoins: stablecoinsCount,
        fees: feesResult.fees,
        revenue: feesResult.revenue,
      },
    };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : "Research sync failed",
    };
  }
}

export async function getYieldPoolsAction(filters?: { chain?: string; minApy?: number }) {
  try {
    const parsed = filters ? yieldPoolsFilterSchema.parse(filters) : {};
    const pools = await getYieldPools(parsed);
    return { ok: true, data: pools };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch yield pools", data: [] };
  }
}

export async function getStablecoinOverviewAction() {
  try {
    const stablecoins = await getStablecoinOverview();
    return { ok: true, data: stablecoins };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch stablecoins", data: [] };
  }
}

export async function getProtocolFeesRevenueAction(slug?: string) {
  try {
    const data = await getProtocolFeesRevenue(slug);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Failed to fetch fees/revenue", data: [] };
  }
}
