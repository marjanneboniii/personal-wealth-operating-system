"use client";
import VehicleModule from "@/components/registry/vehicle/VehicleModule";
import RealEstateModule from "@/components/registry/realestate/RealEstateModule";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import type { PayoutAccount } from "@/features/registry/loadAssetRegistryData";
import type { RealEstateDashboardItem, RealEstatePortfolioSummary } from "@/features/rwa/realEstate/service";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";

type RegistryWorkspaceProps = {
  /** legacy alias kept for older call-sites */
  properties?: any;
  vehicles?: any;
  ownerships?: any;
  vehicleBrands?: any;
  vehicleModels?: any;
  vehicleDashboard?: any;
  vehicleSummary?: any;
  payoutAccounts?: PayoutAccount[];
  /**
   * LIST of properties — an ARRAY. It is the single most confusing prop here:
   * `realEstateSummary` is the TOTALS object for the very same rows. They were
   * once swapped by a positional `Promise.all` destructure, which hid
   * «املاک من» and crashed the tab with `dashboard.map is not a function`.
   * The types below make that swap a compile error instead of a blank page.
   */
  realEstateDashboard?: RealEstateDashboardItem[];
  realEstateSummary?: RealEstatePortfolioSummary;
  cities?: City[];
  neighborhoods?: Neighborhood[];
  propertyTypes?: PropertyType[];
  ownerName?: string;
  fxRate?: string;
};

export default function RegistryWorkspace({
  properties,
  vehicles,
  ownerships,
  vehicleBrands = [],
  vehicleModels = [],
  vehicleDashboard = [],
  vehicleSummary,
  payoutAccounts = [],
  realEstateDashboard = [],
  realEstateSummary,
  cities = [],
  neighborhoods = [],
  propertyTypes = [],
  ownerName = "کاربر فعلی",
  fxRate = "0",
}: RegistryWorkspaceProps) {
  return (
    <>
      <div id="real-estate" className="scroll-mt-24">
        {/* A failure inside the property module must not blank the whole
            workspace behind the route error page. */}
        <ErrorBoundary title="بخش املاک در دسترس نیست">
          <RealEstateModule
            dashboard={realEstateDashboard}
            summary={realEstateSummary}
            cities={cities}
            neighborhoods={neighborhoods}
            propertyTypes={propertyTypes}
            ownerName={ownerName}
            fxRate={fxRate}
          />
        </ErrorBoundary>
      </div>

      <div id="vehicle" className="scroll-mt-24">
        {vehicleSummary && (
          <VehicleModule
          brands={vehicleBrands}
          models={vehicleModels}
          dashboard={vehicleDashboard}
          summary={vehicleSummary}
          ownerName={ownerName}
          payoutAccounts={payoutAccounts}
        />
        )}
      </div>
    </>
  );
}
