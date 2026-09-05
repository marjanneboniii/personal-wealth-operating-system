import { ensureAuth } from "@/lib/authGuard";
import { ensureSchemaOnce } from "@/db/init-schema";
import { loadAssetRegistryData, type CommodityPriceRow } from "@/features/registry/loadAssetRegistryData";
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
  const data = await loadAssetRegistryData(userId, {
    vehicleDemo: process.env.PWOS_VEHICLE_DEMO === "1",
  });

  // The real-asset slice of the portfolio valuation (املاک / خودرو / طلا /
  // کالا) — same classification as every other asset view.
  const { real: realValuations } = splitAssetFamilies(data.portfolioValuation.assetValuations);

  // `Date` is not serialisable across the server→client boundary — the
  // workspace is a client component, so timestamps cross as ISO strings.
  const prices: (Omit<CommodityPriceRow[number], "purchasedAt"> & { purchasedAt: string })[] = data.prices.map((p) => ({
    ...p,
    unitPrice: String(p.unitPrice),
    quantity: String(p.quantity),
    total: String(p.total),
    purchasedAt: p.purchasedAt.toISOString(),
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="دارایی واقعی و کالا" />

      <AssetValuationSummary
        totals={valuationTotalsOf(realValuations)}
        hint={`برای ${faCount(realValuations.length)} دارایی واقعی · تومان ملاک محاسبه، دلار معادل نمایشی`}
      />
      <RegistryWorkspace
        vehicles={data.vehicles}
        ownerships={data.ownerships}
        categories={data.categories}
        items={data.items}
        prices={prices}
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
