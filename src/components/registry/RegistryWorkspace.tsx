"use client";
import VehicleModule from "@/components/registry/vehicle/VehicleModule";
import RealEstateModule from "@/components/registry/realestate/RealEstateModule";
import ErrorBoundary from "@/components/ui/ErrorBoundary";
import type { PayoutAccount } from "@/features/registry/loadAssetRegistryData";
import type { RealEstateDashboardItem, RealEstatePortfolioSummary } from "@/features/rwa/realEstate/service";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";
import type { MarketSegmentSummary, PropertyMarketView } from "@/features/rwa/realEstate/market/service";
import type { MarketReminder } from "@/features/rwa/realEstate/market/reminders";

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
  /** Toman bank accounts a property or vehicle bought now may be paid from. */
  bankAccounts?: PayoutAccount[];
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
  /** Market insight per property id — analytics read model only. */
  realEstateMarket?: Record<string, PropertyMarketView>;
  marketSegments?: MarketSegmentSummary[];
  marketReminders?: MarketReminder[];
  canManageMasterData?: boolean;
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
  bankAccounts = [],
  realEstateDashboard = [],
  realEstateSummary,
  cities = [],
  neighborhoods = [],
  propertyTypes = [],
  ownerName = "کاربر فعلی",
  fxRate = "0",
  realEstateMarket = {},
  marketSegments = [],
  marketReminders = [],
  canManageMasterData = false,
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
            bankAccounts={bankAccounts}
            marketViews={realEstateMarket}
            marketSegments={marketSegments}
            marketReminders={marketReminders}
            canManageMasterData={canManageMasterData}
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
          bankAccounts={bankAccounts}
        />
        )}
      </div>
    </>
  );
}
