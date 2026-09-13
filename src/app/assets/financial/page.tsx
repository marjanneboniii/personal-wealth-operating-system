import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { getPortfolioValuation, listRegisteredWithoutHoldings } from "@/features/portfolio/service";
import { getRealizedPnl } from "@/features/ledger/queries";
import { EmptyState, PageHeader, Section, SectionLink } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { ASSET_TABS } from "@/components/ui/ModuleTabs";
import HoldingsTable from "@/components/assets/HoldingsTable";
import AllocationBar from "@/components/assets/AllocationBar";
import UnheldRegistrations from "@/components/assets/UnheldRegistrations";
import AssetValuationSummary, { valuationTotalsOf } from "@/components/assets/AssetValuationSummary";
import { splitAssetFamilies } from "@/features/portfolio/assetFamilies";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, toIrtMoney, usdToIrt } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "دارایی‌های مالی" };

/**
 * دارایی‌ها → دارایی‌های مالی
 *
 * READ MODEL ONLY. Buckets (نقد / رمزارز / سهام / صندوق / سایر) are a
 * PRESENTATION grouping over the asset classes returned by
 * `getPortfolioValuation()`. Realised P&L is read from the existing ledger
 * query. Nothing here re-computes cost basis, touches FIFO, or writes state.
 */

/** Map an accounting asset class onto a human product bucket. */
const BUCKET_OF: Record<string, string> = {
  "نقد و بانک": "نقد",
  Cash: "نقد",
  "استیبل‌کوین": "نقد",
  Stablecoin: "نقد",
  "رمزارز": "رمزارز",
  Crypto: "رمزارز",
  "سهام": "سهام",
  Stock: "سهام",
  "صندوق سرمایه‌گذاری": "صندوق",
  Fund: "صندوق",
  ETF: "صندوق",
};

const BUCKET_ORDER = ["نقد", "رمزارز", "سهام", "صندوق", "سایر"] as const;

const BUCKET_COLOR: Record<string, string> = {
  "نقد": "var(--asset-cash)",
  "رمزارز": "var(--asset-crypto)",
  "سهام": "var(--asset-investment)",
  "صندوق": "var(--asset-other)",
  "سایر": "var(--border-strong)",
};

export default async function FinancialAssetsPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, pnl, fx, unheld] = await Promise.all([
    getPortfolioValuation(),
    getRealizedPnl(),
    getLatestUsdIrtRate(),
    // Registered identities with no position yet. They are OUTSIDE the
    // valuation (a registration is not a holding) and get their own list.
    listRegisteredWithoutHoldings(),
  ]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const { financial } = splitAssetFamilies(valuation.assetValuations);

  const buckets = new Map<string, typeof financial>();
  for (const a of financial) {
    const key = BUCKET_OF[a.className] ?? "سایر";
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }

  // Summary and table are fed by ONE set of Toman-canonical totals.
  const totals = valuationTotalsOf(financial);
  const totalUsd = D(totals.valueUsd);
  const ordered = BUCKET_ORDER.filter((b) => buckets.has(b)).map((name) => {
    const rows = buckets.get(name)!;
    const usd = Decimal.sum(rows.map((a) => a.currentValue));
    return {
      name,
      rows,
      percent: totalUsd.isZero() ? 0 : Number(usd.div(totalUsd).mul(100).toFixed(1)),
      toman: formatMoney(Decimal.sum(rows.map((a) => a.currentValueToman)).toFixed(0), "IRT"),
    };
  });

  const financialSymbols = new Set(financial.map((a) => a.symbol));
  const realized = Decimal.sum(pnl.bySymbol.filter((p) => financialSymbols.has(p.symbol)).map((p) => p.pnl)).toString();

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="دارایی‌های مالی"
          action={
            <Link href="/new?type=buy" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت خرید
            </Link>
          }
        />
        <ModuleTabs tabs={ASSET_TABS} active="/assets/financial" label="بخش‌های دارایی" />
      </div>

      {ordered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="coins"
            title="دارایی مالی‌ای ثبت نشده است"
            action={
              <Link href="/new?type=buy" className="btn btn-soft">
                ثبت اولین خرید
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <AssetValuationSummary
            totals={totals}
            extra={{
              name: "سود/زیان تحقق‌یافته",
              toman: fx.rate ? usdToIrt(realized, fx.rate) : null,
              usd: realized,
              signed: true,
            }}
          />

          {ordered.length > 1 && (
            <Section title="ترکیب">
              <AllocationBar
                label="ترکیب دارایی‌های مالی"
                slices={ordered.map((b) => ({
                  key: b.name,
                  label: b.name,
                  percent: b.percent,
                  value: b.toman,
                  color: BUCKET_COLOR[b.name],
                }))}
              />
            </Section>
          )}

          {ordered.map((b) => (
            <Section
              key={b.name}
              title={b.name}
              action={
                b.name === "رمزارز" ? (
                  <SectionLink href="/crypto" label="کیف‌های رمزارز" />
                ) : (
                  <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                    {b.toman}
                  </span>
                )
              }
            >
              <HoldingsTable rows={b.rows} toIrt={toIrt} />
            </Section>
          ))}
        </>
      )}

      <UnheldRegistrations rows={unheld} />
    </div>
  );
}
