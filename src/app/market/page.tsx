import { ensureAuth } from "@/lib/authGuard";
import { ensureWallexCatalog, listMarketRows } from "@/features/pricing/wallexCatalog";
import MarketView from "@/components/assets/MarketView";
import { tseMarketRows } from "@/features/pricing/tseMarketRows";

export const dynamic = "force-dynamic";

export const metadata = { title: "نمای بازار — توازن" };

/**
 * نمای بازار — every listed symbol by what it is: رمزارز، میم‌کوین،
 * استیبل‌کوین، سهام آمریکا، شاخص، کامودیتی، اوراق قرضه، فلز توکنیزه.
 *
 * Renders from the persisted catalogue and never waits on an exchange when
 * there is anything to show — a stale catalogue is served at once and
 * refreshed after the response. Search and section switching run in the
 * browser, in memory, with no request per keystroke.
 *
 * No row names an exchange. Market data only — nothing here touches the ledger.
 */
export default async function MarketPage() {
  await ensureAuth();
  const status = await ensureWallexCatalog();
  // Tehran-exchange funds and stocks are listed without prices until a live
  // feed exists; they are appended here, not persisted, so no picker offers them.
  const rows = [...(await listMarketRows()), ...tseMarketRows()];

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-6">
      <header className="space-y-1">
        <h1 className="text-[length:var(--fs-lg)] font-bold tracking-tight">نمای بازار</h1>
        <p className="muted text-[length:var(--fs-sm)] leading-7">
          قیمت تومانی و تتری رمزارزها، میم‌کوین‌ها، سهام آمریکا، شاخص‌ها، کامودیتی و اوراق.
        </p>
      </header>
      <MarketView
        initial={{
          ok: true,
          rows,
          freshness: status.freshness,
          total: rows.length,
          syncedAt: status.lastSyncedAt ? status.lastSyncedAt.toISOString() : null,
        }}
      />
    </div>
  );
}
