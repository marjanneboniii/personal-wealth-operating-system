import { ensureAuth } from "@/lib/authGuard";
import { ensureWallexCatalog, listMarketRows } from "@/features/pricing/wallexCatalog";
import MarketView from "@/components/assets/MarketView";
import { tseMarketRows } from "@/features/pricing/tseMarketRows";
import { referenceMarketRows } from "@/features/pricing/referenceMarketRows";
import { readReferenceQuotes, readSourceStatus, scheduleReferenceRefresh } from "@/features/pricing/referenceQuotes";
import { referenceViewsFor, rowKey, tseRowsFromQuotes } from "@/features/pricing/referencePresentation";

export const dynamic = "force-dynamic";

export const metadata = { title: "نمای بازار — توازن" };

/**
 * نمای بازار — every listed symbol by what it is: رمزارز، استیبل‌کوین، سهام
 * توکنیزه، شاخص، کامودیتی، اوراق قرضه، فلز توکنیزه — and the reference
 * markets: طلا، سکه، ارز، انرژی، بورس و فرابورس.
 *
 * Renders from what is persisted and never waits on a provider. The exchange
 * catalogue is refreshed after the response when stale; the reference prices
 * are refreshed after the response too, and a lease in the database decides
 * whether any instance actually asks a source (features/pricing/
 * referenceQuotes). Search and section switching run in the browser.
 *
 * Crypto rows name no exchange. Reference prices are credited to their data
 * provider with the source's own time, as the product requires for them.
 * Market data only — nothing here touches the ledger.
 */
export default async function MarketPage() {
  await ensureAuth();
  scheduleReferenceRefresh();
  const [status, exchangeRows, quotes, sources] = await Promise.all([
    ensureWallexCatalog(),
    listMarketRows(),
    readReferenceQuotes(),
    readSourceStatus(),
  ]);

  // Gold, coins, cash currencies, oil and the Tehran exchange are appended
  // here, not persisted in the exchange catalogue, so no picker offers them.
  // They are kept apart from the exchange rows so a manual refresh of those
  // cannot drop them from the screen.
  const listed = [...referenceMarketRows(), ...tseMarketRows()];
  const known = new Set([...exchangeRows, ...listed].map(rowKey));
  const supplementalRows = [...listed, ...tseRowsFromQuotes(quotes, known)];
  const referenceQuotes = referenceViewsFor(supplementalRows, quotes, sources, new Date());

  return (
    <div className="mx-auto max-w-3xl space-y-5 py-6">
      <header className="space-y-1">
        <h1 className="text-[length:var(--fs-lg)] font-bold tracking-tight">نمای بازار</h1>
        <p className="muted text-[length:var(--fs-sm)] leading-7">
          طلا، سکه، ارز و نفت؛ بورس و فرابورس؛ رمزارزها، سهام و شاخص‌های توکنیزه.
        </p>
      </header>
      <MarketView
        initial={{
          ok: true,
          rows: exchangeRows,
          freshness: status.freshness,
          total: exchangeRows.length,
          syncedAt: status.lastSyncedAt ? status.lastSyncedAt.toISOString() : null,
        }}
        supplementalRows={supplementalRows}
        referenceQuotes={referenceQuotes}
      />
    </div>
  );
}
