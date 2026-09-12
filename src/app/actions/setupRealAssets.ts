"use server";

import { getCurrentUser } from "@/lib/auth";
import { authUsersExistCached } from "@/lib/tenantState";
import {
  ensureVehicleModuleReady,
  listUserVehicles,
} from "@/features/rwa/vehicle/service";
import { listVehicleBrands, listVehicleCatalogModels } from "@/features/rwa/vehicle/catalog";
import { ensureRealEstateModuleReady } from "@/features/rwa/realEstate/service";
import {
  listCities,
  listNeighborhoods,
  listPropertyTypes,
} from "@/features/rwa/realEstate/masterData";
import type { VehicleBrand, VehicleCatalogModel } from "@/features/rwa/vehicle/types";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";

/**
 * The master data the «خودرو و ملک» setup step needs, and nothing else.
 *
 * WHY AN ACTION RATHER THAN PROPS FROM THE PAGE
 * `/setup` is a client component (the whole wizard is one controlled form), so
 * it cannot read the database directly. This is the same shape the crypto
 * picker already uses: a thin read-only action the client calls on mount.
 *
 * IT BUILDS NOTHING. Every list here comes from the EXISTING registry modules —
 * the same `listVehicleBrands` / `listCities` / … that «دارایی‌های واقعی»
 * renders from — behind the same idempotent `ensure…ModuleReady()` bootstraps
 * that seed the catalogue and master data on first use. A second catalogue for
 * the wizard would have drifted from the registry's the first time a brand or
 * a neighbourhood was added.
 *
 * Read-only: no asset, no account, no posting, no valuation is written.
 */
export type RealAssetCatalogs = {
  ok: boolean;
  brands: VehicleBrand[];
  models: VehicleCatalogModel[];
  cities: City[];
  neighborhoods: Neighborhood[];
  propertyTypes: PropertyType[];
  /** Vehicles this tenant already registered, so the step can say so. */
  existingVehicleCount: number;
  message?: string;
};

const EMPTY: RealAssetCatalogs = {
  ok: false,
  brands: [],
  models: [],
  cities: [],
  neighborhoods: [],
  propertyTypes: [],
  existingVehicleCount: 0,
};

export async function loadRealAssetCatalogsAction(): Promise<RealAssetCatalogs> {
  try {
    const hasAuth = await authUsersExistCached();
    const user = await getCurrentUser();
    if (hasAuth && !user) {
      return { ...EMPTY, message: "برای ادامه ابتدا وارد شوید." };
    }

    // Idempotent bootstraps — they seed the vehicle catalogue and the city /
    // neighbourhood / property-type master data exactly once.
    await ensureVehicleModuleReady();
    await ensureRealEstateModuleReady();

    const [brands, models, cities, neighborhoods, propertyTypes, vehicles] = await Promise.all([
      listVehicleBrands(),
      listVehicleCatalogModels(),
      listCities(),
      listNeighborhoods(),
      listPropertyTypes(),
      listUserVehicles(user?.id ?? null),
    ]);

    return {
      ok: true,
      brands,
      models,
      cities,
      neighborhoods,
      propertyTypes,
      existingVehicleCount: vehicles.length,
    };
  } catch (error) {
    return {
      ...EMPTY,
      message: error instanceof Error ? error.message : "بارگذاری فهرست خودرو و ملک ناموفق بود.",
    };
  }
}
