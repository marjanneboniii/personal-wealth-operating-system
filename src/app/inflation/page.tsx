import { ensureAuth } from "@/lib/authGuard";
import { ensureSchemaOnce } from "@/db/init-schema";
import { PageHeader } from "@/components/ui/Card";
import {
  ensureInflationModuleReady,
  getInflationDashboard,
  getInflationHistory,
  listInflationItems,
} from "@/features/inflation/service";
import { commodityAnalyticsService } from "@/features/commodities/service";
import InflationTracker from "@/components/inflation/InflationTracker";

export const dynamic = "force-dynamic";

export const metadata = { title: "ردیاب تورم شخصی" };

/**
 * ردیاب تورم شخصی — independent analytical module.
 *
 * READ MODEL + own-table writes ONLY. This page never touches the accounting
 * core: no journal entry, posting, lot, account or asset is created or read
 * here, and nothing on this page feeds Portfolio, Net Worth or P&L.
 * Consumable prices are observations, not wealth.
 */
export default async function InflationPage() {
  // Cold start safety (same pattern as /asset-registry): schema first, then
  // the auth guard — otherwise a fresh database fails closed.
  await ensureSchemaOnce();

  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;

  // Idempotent shared-catalog seed (suggested Persian categories). Never
  // destructive; production PostgreSQL is seeded by migration 0012.
  await ensureInflationModuleReady();

  const [items, dashboard, categoryRows] = await Promise.all([
    listInflationItems(userId),
    getInflationDashboard(userId),
    commodityAnalyticsService.listCategories(userId),
  ]);

  // `createdAt` is a Date — not serialisable across the server→client
  // boundary, so the form receives plain {id, name} pairs only.
  const categories = categoryRows.map((c) => ({ id: c.id, name: c.name }));

  const histories: Record<string, Awaited<ReturnType<typeof getInflationHistory>>> = {};
  for (const item of items) {
    histories[item.id] = await getInflationHistory(item.id, userId, 200);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="ردیاب تورم شخصی"
        subtitle="قیمت کالاهای مصرفی را در طول زمان ثبت کنید و تورم سبد خود را بسنجید. این یک ابزار تحلیلی است: کالا دارایی نیست و هیچ اثری در ثروت خالص، سبد دارایی یا سوابق مالی ندارد."
      />
      <InflationTracker items={items} histories={histories} dashboard={dashboard} categories={categories} />
    </div>
  );
}
