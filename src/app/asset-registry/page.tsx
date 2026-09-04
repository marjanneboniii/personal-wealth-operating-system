import { desc, eq } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { ensureSchemaOnce } from "@/db/init-schema";
import { db } from "@/db";
import { commodityCategories, commodityItems, commodityPriceRecords } from "@/db/schema";
import {
  ensureRealEstateModuleReady,
  getRealEstateDashboard,
  getRealEstatePortfolioSummary,
} from "@/features/rwa/realEstate/service";
import {
  listCities,
  listNeighborhoods,
  listPropertyTypes,
} from "@/features/rwa/realEstate/masterData";
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
import { PageHeader } from "@/components/ui/Card";
import RegistryWorkspace from "@/components/registry/RegistryWorkspace";

export const dynamic = "force-dynamic";

export default async function AssetRegistryPage() {
  // Cold start safety: `ensureAuth` reads the `users` table, so the schema has
  // to exist before the guard runs — otherwise a fresh database turns a normal
  // first visit into a fail-closed "Access denied". Idempotent + memoised.
  await ensureSchemaOnce();

  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;

  // Real-estate module bootstrap: schema + master-data seed (cities,
  // neighborhoods, property types) + legacy row migration. Never destructive.
  await ensureRealEstateModuleReady();

  // Vehicle module bootstrap: seed the (dynamic) catalog once and attach
  // legacy vehicle rows to it. Never destructive — existing data is preserved.
  await ensureVehicleModuleReady();
  if (process.env.PWOS_VEHICLE_DEMO === "1") {
    // Opt-in developer sample data only (see demoData.ts) — never in production.
    const { demoSeedVehicles } = await import("@/features/rwa/vehicle/demoData");
    await demoSeedVehicles(userId);
  }

  const [
    vehicles,
    ownerships,
    categories,
    items,
    prices,
    vehicleBrands,
    vehicleModels,
    vehicleDashboard,
    vehicleSummary,
    payoutAccounts,
    realEstateDashboard,
    realEstateSummary,
    cities,
    neighborhoods,
    propertyTypes,
  ] = await Promise.all([
    // SECURITY: pass the tenant id so reads are scoped at the DB level.
    listVehicleAssets(userId ?? undefined),
    listOwnershipRecords(userId ?? undefined),
    db.select().from(commodityCategories),
    db
      .select({ id: commodityItems.id, name: commodityItems.name, unit: commodityItems.defaultUnit, category: commodityCategories.name })
      .from(commodityItems)
      .leftJoin(commodityCategories, eq(commodityItems.categoryId, commodityCategories.id)),
    db
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
      .limit(30),
    listVehicleBrands(),
    listVehicleCatalogModels(),
    getVehicleDashboard(userId),
    getVehiclePortfolioSummary(userId),
    getRealEstateDashboard(userId),
    getRealEstatePortfolioSummary(userId),
    listCities(true), // include inactive so the admin tab can manage them
    listNeighborhoods(undefined, true),
    listPropertyTypes(true),
    // Receiving accounts for a vehicle sale (audit F-08): a liquid account of
    // THIS tenant only, so the proceeds land in a wallet the user actually owns.
    getAccountBalances(userId ?? undefined).then((rows) =>
      rows
        .filter((r) => r.type === "asset" && isLiquidAccount(r))
        .map((r) => ({ id: r.accountId, name: r.name, symbol: r.symbol })),
    ),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="دارایی واقعی و کالا" />
      <RegistryWorkspace
        vehicles={vehicles}
        ownerships={ownerships}
        categories={categories}
        items={items}
        prices={prices.map((p) => ({
          ...p,
          unitPrice: String(p.unitPrice),
          quantity: String(p.quantity),
          total: String(p.total),
          purchasedAt: p.purchasedAt.toISOString(),
        }))}
        vehicleBrands={vehicleBrands}
        vehicleModels={vehicleModels}
        vehicleDashboard={vehicleDashboard}
        vehicleSummary={vehicleSummary}
        payoutAccounts={payoutAccounts}
        realEstateDashboard={realEstateDashboard}
        realEstateSummary={realEstateSummary}
        cities={cities}
        neighborhoods={neighborhoods}
        propertyTypes={propertyTypes}
        ownerName={(user as { name?: string } | null)?.name ?? "کاربر فعلی"}
      />
    </div>
  );
}
