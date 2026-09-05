/**
 * Data loader for the «دارایی واقعی و کالا» workspace (`/asset-registry`).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The page used to build its view model with a positional
 * `const [a, b, c] = await Promise.all([…])`. The destructuring order had
 * drifted one slot out of step with the query order, so the real-estate
 * module received the portfolio SUMMARY where it expected the property LIST,
 * the city list where it expected the summary, and so on. The visible result:
 * «املاک من» never rendered and clicking it threw `dashboard.map is not a
 * function` into the global error boundary.
 *
 * Loading the data here, by NAME (see `allNamed`), makes that class of bug
 * impossible: a value can only be read through the name it was produced
 * under, and the exported type is what the page and its tests check against.
 *
 * READ MODEL ONLY — nothing here mutates financial data. The two
 * `ensure…ModuleReady()` bootstraps are idempotent schema/master-data
 * guarantees (never destructive), exactly as they were on the page.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { commodityCategories, commodityItems, commodityPriceRecords } from "@/db/schema";
import {
  ensureRealEstateModuleReady,
  getRealEstateDashboard,
  getRealEstatePortfolioSummary,
} from "@/features/rwa/realEstate/service";
import { listCities, listNeighborhoods, listPropertyTypes } from "@/features/rwa/realEstate/masterData";
import {
  ensureVehicleModuleReady,
  getVehicleDashboard,
  getVehiclePortfolioSummary,
  listVehicleAssets,
} from "@/features/rwa/vehicle/service";
import { listVehicleBrands, listVehicleCatalogModels } from "@/features/rwa/vehicle/catalog";
import { listOwnershipRecords } from "@/features/rwa/ownership/service";
import { getAccountBalances } from "@/features/ledger/queries";
import { isLiquidAccount } from "@/features/accounts/classification";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";
import { allNamed } from "@/lib/namedPromises";

export type PayoutAccount = { id: string; name: string; symbol: string | null };

export type CommodityItemRow = Awaited<ReturnType<typeof loadCommodityItems>>;
export type CommodityPriceRow = Awaited<ReturnType<typeof loadCommodityPrices>>;

function loadCommodityItems() {
  return db
    .select({
      id: commodityItems.id,
      name: commodityItems.name,
      unit: commodityItems.defaultUnit,
      category: commodityCategories.name,
    })
    .from(commodityItems)
    .leftJoin(commodityCategories, eq(commodityItems.categoryId, commodityCategories.id));
}

function loadCommodityPrices() {
  return db
    .select({
      id: commodityPriceRecords.id,
      commodityId: commodityPriceRecords.commodityId,
      item: commodityItems.name,
      unitPrice: commodityPriceRecords.unitPrice,
      quantity: commodityPriceRecords.quantity,
      total: commodityPriceRecords.totalAmount,
      unit: commodityPriceRecords.unit,
      merchant: commodityPriceRecords.merchantName,
      notes: commodityPriceRecords.notes,
      purchasedAt: commodityPriceRecords.purchasedAt,
    })
    .from(commodityPriceRecords)
    .innerJoin(commodityItems, eq(commodityPriceRecords.commodityId, commodityItems.id))
    .orderBy(desc(commodityPriceRecords.purchasedAt))
    .limit(30);
}

/** Current USD/IRT rate of this tenant, as a plain string. */
async function loadFxRate(userId?: string | null): Promise<string> {
  try {
    const snapshot = await getLatestUsdIrtRateForUser(userId ?? null);
    return snapshot.rate;
  } catch {
    // A display-only figure: never let an FX lookup block the whole workspace.
    return "0";
  }
}

/**
 * Receiving accounts for a vehicle sale (audit F-08): a liquid account of THIS
 * tenant only, so the proceeds land in a wallet the user actually owns.
 */
function loadPayoutAccounts(userId?: string | null) {
  return getAccountBalances(userId ?? undefined).then((rows) =>
    rows
      .filter((r) => r.type === "asset" && isLiquidAccount(r))
      .map((r) => ({ id: r.accountId, name: r.name, symbol: r.symbol })),
  );
}

export type AssetRegistryData = Awaited<ReturnType<typeof loadAssetRegistryData>>;

/**
 * Everything the `/asset-registry` view needs, fetched in parallel and keyed
 * by name. SECURITY: every tenant-scoped read receives the tenant id so
 * isolation is enforced at the DB query level, never by filtering afterwards.
 */
export async function loadAssetRegistryData(
  userId?: string | null,
  opts: { vehicleDemo?: boolean } = {},
) {
  // Module bootstrap: schema + master-data seed (cities, neighborhoods,
  // property types) + legacy row migration. Never destructive.
  await ensureRealEstateModuleReady();

  // Vehicle module bootstrap: seed the (dynamic) catalog once and attach
  // legacy vehicle rows to it. Never destructive — existing data is preserved.
  await ensureVehicleModuleReady();
  if (opts.vehicleDemo) {
    // Opt-in developer sample data only (see demoData.ts) — never in production.
    const { demoSeedVehicles } = await import("@/features/rwa/vehicle/demoData");
    await demoSeedVehicles(userId ?? null);
  }

  return allNamed({
    // SECURITY: pass the tenant id so reads are scoped at the DB level.
    vehicles: listVehicleAssets(userId ?? undefined),
    ownerships: listOwnershipRecords(userId ?? undefined),
    categories: db.select().from(commodityCategories),
    items: loadCommodityItems(),
    prices: loadCommodityPrices(),
    vehicleBrands: listVehicleBrands(),
    vehicleModels: listVehicleCatalogModels(),
    vehicleDashboard: getVehicleDashboard(userId ?? null),
    vehicleSummary: getVehiclePortfolioSummary(userId ?? null),
    /** LIST of properties — an ARRAY of `RealEstateDashboardItem`. */
    realEstateDashboard: getRealEstateDashboard(userId ?? null),
    /** Portfolio TOTALS for those properties — a single summary OBJECT. */
    realEstateSummary: getRealEstatePortfolioSummary(userId ?? null),
    cities: listCities(true), // include inactive so the admin tab can manage them
    neighborhoods: listNeighborhoods(undefined, true),
    propertyTypes: listPropertyTypes(true),
    payoutAccounts: loadPayoutAccounts(userId ?? null),
    // Current USD/IRT rate of THIS tenant — the real-estate summary shows it
    // as «نرخ جاری سیستم» (used only for dates with no stored rate).
    fxRate: loadFxRate(userId ?? null),
    // Read model only — the same valuation every other asset view reads, so
    // «دارایی‌های واقعی» values a property exactly as «همه دارایی‌ها» does.
    portfolioValuation: getPortfolioValuation(undefined, userId ?? undefined),
  });
}
