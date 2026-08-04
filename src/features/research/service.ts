/**
 * Research Domain Service — DeFi Research Metrics
 * Implements: syncDefiProtocolsAndTVL, syncYieldOpportunities, syncStablecoinsMetrics, syncFeesAndRevenue
 * CRITICAL RULE: Research only — never writes to Financial Core, never imports postEntry/recordBuy/recordSell
 * Isolated cache tables: defi_protocol_metrics, defi_chain_tvl, defi_yield_opportunities, defi_stablecoins_cache, defi_fees_revenue
 * No FK to accounts/journal_entries/postings/lots
 */

import { eq, gte } from "drizzle-orm";
import { db } from "@/db";
import {
  defiChainTvl,
  defiFeesRevenue,
  defiProtocolMetrics,
  defiStablecoinsCache,
  defiYieldOpportunities,
} from "./schema";
import { DefiLlamaProvider } from "./providers/defillama";
import { D } from "@/domain/decimal";

const provider = new DefiLlamaProvider();

export async function syncDefiProtocolsAndTVL(): Promise<{ protocols: number; chains: number }> {
  const protocols = await provider.getProtocolsTVL();
  const chains = await provider.getChainTVL();

  let protoCount = 0;
  for (const p of protocols) {
    try {
      await db
        .insert(defiProtocolMetrics)
        .values({
          protocolSlug: p.slug,
          name: p.name,
          category: p.category,
          chain: p.chain,
          tvlUSD: p.tvlUSD ? D(p.tvlUSD).toString() : null,
          tvlChange24h: p.tvlChange24h,
          fees24h: p.fees24h ? D(p.fees24h).toString() : null,
          revenue24h: p.revenue24h ? D(p.revenue24h).toString() : null,
        })
        .onConflictDoUpdate({
          target: defiProtocolMetrics.protocolSlug,
          set: {
            name: p.name,
            category: p.category,
            chain: p.chain,
            tvlUSD: p.tvlUSD ? D(p.tvlUSD).toString() : null,
            tvlChange24h: p.tvlChange24h,
            fees24h: p.fees24h ? D(p.fees24h).toString() : null,
            revenue24h: p.revenue24h ? D(p.revenue24h).toString() : null,
            fetchedAt: new Date(),
          },
        });
      protoCount++;
    } catch (e) {
      console.warn(`[ResearchService] Failed to upsert protocol ${p.slug}`, e);
    }
  }

  let chainCount = 0;
  for (const c of chains) {
    try {
      await db
        .insert(defiChainTvl)
        .values({
          chainName: c.chainName,
          tvlUSD: c.tvlUSD ? D(c.tvlUSD).toString() : null,
          tokenSymbol: c.tokenSymbol,
        })
        .onConflictDoUpdate({
          target: defiChainTvl.chainName,
          set: {
            tvlUSD: c.tvlUSD ? D(c.tvlUSD).toString() : null,
            tokenSymbol: c.tokenSymbol,
            fetchedAt: new Date(),
          },
        });
      chainCount++;
    } catch (e) {
      console.warn(`[ResearchService] Failed to upsert chain ${c.chainName}`, e);
    }
  }

  return { protocols: protoCount, chains: chainCount };
}

export async function syncYieldOpportunities(minTVL: number = 1000000, minAPY: number = 0): Promise<number> {
  const pools = await provider.getYieldPools();
  let count = 0;

  for (const pool of pools) {
    const tvl = pool.tvlUSD ? Number(pool.tvlUSD) : 0;
    const apy = pool.apy ? Number(pool.apy) : 0;

    if (tvl < minTVL) continue;
    if (apy < minAPY) continue;

    try {
      await db
        .insert(defiYieldOpportunities)
        .values({
          poolId: pool.poolId,
          protocolSlug: pool.protocolSlug,
          chain: pool.chain,
          symbol: pool.symbol,
          tvlUSD: pool.tvlUSD ? D(pool.tvlUSD).toString() : null,
          apy: pool.apy,
          apyBase: pool.apyBase,
          apyReward: pool.apyReward,
          ilRisk: pool.ilRisk,
          rawJson: pool.rawJson,
        })
        .onConflictDoUpdate({
          target: defiYieldOpportunities.poolId,
          set: {
            protocolSlug: pool.protocolSlug,
            chain: pool.chain,
            symbol: pool.symbol,
            tvlUSD: pool.tvlUSD ? D(pool.tvlUSD).toString() : null,
            apy: pool.apy,
            apyBase: pool.apyBase,
            apyReward: pool.apyReward,
            ilRisk: pool.ilRisk,
            rawJson: pool.rawJson,
            fetchedAt: new Date(),
          },
        });
      count++;
    } catch (e) {
      console.warn(`[ResearchService] Failed to upsert yield pool ${pool.poolId}`, e);
    }
  }

  return count;
}

export async function syncStablecoinsMetrics(): Promise<number> {
  const stablecoins = await provider.getStablecoins(true);
  let count = 0;

  for (const s of stablecoins) {
    try {
      await db
        .insert(defiStablecoinsCache)
        .values({
          stablecoinId: s.stablecoinId,
          name: s.name,
          symbol: s.symbol,
          circulatingUSD: s.circulatingUSD ? D(s.circulatingUSD).toString() : null,
          priceUSD: s.priceUSD ? D(s.priceUSD).toString() : null,
          pegType: s.pegType,
          pegMechanism: s.pegMechanism,
        })
        .onConflictDoUpdate({
          target: defiStablecoinsCache.stablecoinId,
          set: {
            name: s.name,
            symbol: s.symbol,
            circulatingUSD: s.circulatingUSD ? D(s.circulatingUSD).toString() : null,
            priceUSD: s.priceUSD ? D(s.priceUSD).toString() : null,
            pegType: s.pegType,
            pegMechanism: s.pegMechanism,
            fetchedAt: new Date(),
          },
        });
      count++;
    } catch (e) {
      console.warn(`[ResearchService] Failed to upsert stablecoin ${s.stablecoinId}`, e);
    }
  }

  return count;
}

export async function syncFeesAndRevenue(): Promise<{ fees: number; revenue: number }> {
  const fees = await provider.getFeesAndRevenue("dailyFees");
  const revenue = await provider.getFeesAndRevenue("dailyRevenue");

  let feesCount = 0;
  for (const f of fees) {
    try {
      await db.insert(defiFeesRevenue).values({
        targetSlug: f.targetSlug,
        targetType: f.targetType,
        dailyFeesUSD: f.dailyFeesUSD ? D(f.dailyFeesUSD).toString() : null,
        dailyRevenueUSD: f.dailyRevenueUSD ? D(f.dailyRevenueUSD).toString() : null,
      });
      feesCount++;
    } catch (e) {
      console.warn(`[ResearchService] Failed to insert fees for ${f.targetSlug}`, e);
    }
  }

  let revenueCount = 0;
  for (const r of revenue) {
    try {
      // Try to update existing fees entry with revenue, or insert new
      // For simplicity, insert new row with revenue
      await db.insert(defiFeesRevenue).values({
        targetSlug: r.targetSlug,
        targetType: r.targetType,
        dailyFeesUSD: r.dailyFeesUSD ? D(r.dailyFeesUSD).toString() : null,
        dailyRevenueUSD: r.dailyRevenueUSD ? D(r.dailyRevenueUSD).toString() : null,
      });
      revenueCount++;
    } catch (e) {
      console.warn(`[ResearchService] Failed to insert revenue for ${r.targetSlug}`, e);
    }
  }

  return { fees: feesCount, revenue: revenueCount };
}

export async function getYieldPools(filters?: { chain?: string; minApy?: number }) {
  let query = db.select().from(defiYieldOpportunities);

  const rows = await query;

  let filtered = rows;
  if (filters?.chain) {
    filtered = filtered.filter((r) => r.chain?.toLowerCase() === filters.chain!.toLowerCase());
  }
  if (filters?.minApy !== undefined) {
    filtered = filtered.filter((r) => {
      const apy = r.apy ? Number(r.apy) : 0;
      return apy >= filters.minApy!;
    });
  }

  return filtered
    .sort((a, b) => {
      const apyA = a.apy ? Number(a.apy) : 0;
      const apyB = b.apy ? Number(b.apy) : 0;
      return apyB - apyA;
    })
    .slice(0, 100);
}

export async function getStablecoinOverview() {
  return db.select().from(defiStablecoinsCache).orderBy(defiStablecoinsCache.circulatingUSD);
}

export async function getProtocolFeesRevenue(slug?: string) {
  if (slug) {
    return db.select().from(defiFeesRevenue).where(eq(defiFeesRevenue.targetSlug, slug));
  }
  return db.select().from(defiFeesRevenue).orderBy(defiFeesRevenue.fetchedAt);
}

export async function getProtocols() {
  return db.select().from(defiProtocolMetrics).orderBy(defiProtocolMetrics.tvlUSD);
}

export async function getChains() {
  return db.select().from(defiChainTvl).orderBy(defiChainTvl.tvlUSD);
}
