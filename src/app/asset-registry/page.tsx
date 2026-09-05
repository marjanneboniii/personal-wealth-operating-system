import { ensureAuth } from "@/lib/authGuard";
import { ensureSchemaOnce } from "@/db/init-schema";
import { loadAssetRegistryData } from "@/features/registry/loadAssetRegistryData";
import { PageHeader } from "@/components/ui/Card";
import { faCount } from "@/lib/format";
import { splitAssetFamilies } from "@/features/portfolio/assetFamilies";
import AssetValuationSummary, { valuationTotalsOf } from "@/components/assets/AssetValuationSummary";
import RegistryWorkspace from "@/components/registry/RegistryWorkspace";

export const dynamic = "force-dynamic";

export default async function AssetRegistryPage() {
  // Cold start safety: `ensureAuth` reads the `users` table, so the schema has
  // to exist before the guard runs — otherwise a fresh database turns a normal
  // first visit into a fail-closed "Access denied". Idempotent + memoised.
  await ensureSchemaOnce();

  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;

  // The whole view model is loaded by NAME (src/features/registry/loadAssetRegistryData).
  // It used to be a positional `Promise.all([…])` destructure; a one-slot drift
  // there handed the real-estate module the portfolio summary instead of the
  // property list, which hid «املاک من» and threw `dashboard.map is not a
  // function` when the tab was opened. Names make that class of bug impossible.
  //
  // NOTE: consumable price tracking («ردیاب تورم شخصی») lives at `/inflation`
  // as an independent analytical module — it is not a real asset and is not
  // loaded here.
  const data = await loadAssetRegistryData(userId, {
    vehicleDemo: process.env.PWOS_VEHICLE_DEMO === "1",
  });

  // The real-asset slice of the portfolio valuation (املاک / خودرو / طلا) —
  // same classification as every other asset view.
  const { real: realValuations } = splitAssetFamilies(data.portfolioValuation.assetValuations);

  return (
    <div className="space-y-6">
      <PageHeader title="دارایی‌های واقعی" />

      <AssetValuationSummary
        totals={valuationTotalsOf(realValuations)}
        hint={`برای ${faCount(realValuations.length)} دارایی واقعی · تومان ملاک محاسبه، دلار معادل نمایشی`}
      />
      <RegistryWorkspace
        vehicles={data.vehicles}
        ownerships={data.ownerships}
        vehicleBrands={data.vehicleBrands}
        vehicleModels={data.vehicleModels}
        vehicleDashboard={data.vehicleDashboard}
        vehicleSummary={data.vehicleSummary}
        payoutAccounts={data.payoutAccounts}
        realEstateDashboard={data.realEstateDashboard}
        realEstateSummary={data.realEstateSummary}
        cities={data.cities}
        neighborhoods={data.neighborhoods}
        propertyTypes={data.propertyTypes}
        ownerName={(user as { name?: string } | null)?.name ?? "کاربر فعلی"}
        fxRate={data.fxRate}
      />
    </div>
  );
}
