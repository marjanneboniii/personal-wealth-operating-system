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
import { EMPTY_INFLATION_DASHBOARD } from "@/features/inflation/emptyDashboard";
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

  // Idempotent additive schema self-heal + shared-catalog seed (suggested
  // Persian categories). Never destructive; production PostgreSQL is seeded by
  // migration 0012. A failure here must never blank the page.
  try {
    await ensureInflationModuleReady();
  } catch (err) {
    console.error("[inflation] module bootstrap failed:", err);
  }

  // FAIL-SOFT READ MODEL. Previously a single rejected query (typically a
  // database still missing migration 0012's `user_id`/`region` columns) took
  // the whole route down and the user saw an empty screen. Now every source
  // degrades independently and the page always renders.
  const [items, dashboard, categoryRows] = await Promise.all([
    listInflationItems(userId).catch((err) => {
      console.error("[inflation] listInflationItems failed:", err);
      return [] as Awaited<ReturnType<typeof listInflationItems>>;
    }),
    getInflationDashboard(userId).catch((err) => {
      console.error("[inflation] getInflationDashboard failed:", err);
      return null;
    }),
    commodityAnalyticsService.listCategories(userId).catch((err) => {
      console.error("[inflation] listCategories failed:", err);
      return [] as Awaited<ReturnType<typeof commodityAnalyticsService.listCategories>>;
    }),
  ]);

  // `createdAt` is a Date — not serialisable across the server→client
  // boundary, so the form receives plain {id, name} pairs only.
  const categories = categoryRows.map((c) => ({ id: c.id, name: c.name }));

  const histories: Record<string, Awaited<ReturnType<typeof getInflationHistory>>> = {};
  for (const item of items) {
    try {
      histories[item.id] = await getInflationHistory(item.id, userId, 200);
    } catch (err) {
      console.error(`[inflation] history failed for ${item.id}:`, err);
      histories[item.id] = [];
    }
  }

  // Empty-but-valid dashboard: the analysis tabs render their own «داده‌ای
  // ثبت نشده» state instead of the route throwing.
  const safeDashboard = dashboard ?? EMPTY_INFLATION_DASHBOARD;

  return (
    <div className="space-y-6">
      <PageHeader
        title="ردیاب تورم شخصی"
        subtitle="قیمت کالاهای مصرفی را در طول زمان ثبت کنید و تورم سبد خود را بسنجید. این یک ابزار تحلیلی است: کالا دارایی نیست و هیچ اثری در ثروت خالص، سبد دارایی یا سوابق مالی ندارد."
      />
      <InflationTracker items={items} histories={histories} dashboard={safeDashboard} categories={categories} />
    </div>
  );
}
