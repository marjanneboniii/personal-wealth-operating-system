/**
 * How many assets of each checklist category the user has ACTUALLY registered.
 *
 * This is the other half of the checklist: the claim is worthless without a
 * fact to compare it against. It lives apart from service.ts so the decision
 * logic there stays pure and testable without a database.
 *
 * Counting is deliberately conservative — a count is only ever used to decide
 * whether to STOP nagging, so over-counting would silence a reminder the user
 * still needs. Positions are counted from open FIFO lots (`qty_remaining > 0`),
 * which is the same definition the portfolio uses for "still held"; a fully
 * sold position correctly stops counting.
 *
 * READ-ONLY. No writes, no ledger posting, no valuation.
 */
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses, assets, lots, realEstateProperties, vehicleAssets } from "@/db/schema";
import { ASSET_CATEGORIES, type AssetCategory } from "./service";

/**
 * Asset-class codes that stand for each market category.
 *
 * `fund`, `stock` and `online_gold` have no dedicated storage yet, so they are
 * counted through the asset class a holding would carry. Until those
 * registration flows exist the count is legitimately zero, and a user who said
 * «بله» keeps being reminded — which is the correct behaviour, not a bug to
 * paper over: the asset really is missing from their net worth.
 */
const CLASS_CODES: Partial<Record<AssetCategory, string[]>> = {
  crypto: ["crypto", "stable"],
  fund: ["fund", "etf"],
  stock: ["stock", "security"],
  online_gold: ["gold"],
};

export async function countAssetsByCategory(
  userId: string,
): Promise<Partial<Record<AssetCategory, number>>> {
  const counts: Partial<Record<AssetCategory, number>> = {};
  for (const category of ASSET_CATEGORIES) counts[category] = 0;

  // The two categories with their own registries are counted directly.
  const [properties, vehicles] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(realEstateProperties)
      .where(eq(realEstateProperties.userId, userId)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(vehicleAssets)
      .where(eq(vehicleAssets.userId, userId)),
  ]);
  counts.real_estate = properties[0]?.n ?? 0;
  counts.vehicle = vehicles[0]?.n ?? 0;

  // Market instruments: distinct assets still held, grouped by class code.
  const held = await db
    .select({
      code: assetClasses.code,
      n: sql<number>`count(distinct ${lots.assetId})::int`,
    })
    .from(lots)
    .innerJoin(assets, eq(assets.id, lots.assetId))
    .innerJoin(assetClasses, eq(assetClasses.id, assets.classId))
    .where(and(eq(lots.userId, userId), gt(lots.qtyRemaining, "0")))
    .groupBy(assetClasses.code);

  const byCode = new Map(held.map((row) => [row.code.toLowerCase(), row.n]));
  for (const [category, codes] of Object.entries(CLASS_CODES) as [AssetCategory, string[]][]) {
    counts[category] = codes.reduce((sum, code) => sum + (byCode.get(code) ?? 0), 0);
  }

  return counts;
}
