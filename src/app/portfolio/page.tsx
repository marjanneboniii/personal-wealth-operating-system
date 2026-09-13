import Link from "next/link";
import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getRealizedPnl } from "@/features/ledger/queries";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import { Donut } from "@/components/charts/Charts";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { ASSET_TABS } from "@/components/ui/ModuleTabs";
import HoldingsTable from "@/components/assets/HoldingsTable";
import AllocationBar from "@/components/assets/AllocationBar";
import AssetValuationSummary from "@/components/assets/AssetValuationSummary";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatMoney, formatSignedMoney, toneColor, trendTone, usdToIrt } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, pnl, fx] = await Promise.all([getPortfolioValuation(), getRealizedPnl(), getLatestUsdIrtRate()]);

  const tomanOf = (usd: string | number) => (fx.rate ? usdToIrt(usd, fx.rate) : null);
  const toIrt = (usd: string | number) => {
    const t = tomanOf(usd);
    return t ? formatMoney(t, "IRT") : null;
  };
  // The headline Toman/USD figures come straight from the read model: they are
  // Toman-canonical and internally consistent (value = cost + unrealized P&L),
  // never the frozen USD aggregates re-scaled at the current rate.

  const tomanByClass = new Map<string, Decimal>();
  for (const a of valuation.assetValuations) {
    tomanByClass.set(a.className, (tomanByClass.get(a.className) ?? Decimal.zero()).add(D(a.currentValueToman)));
  }
  const priceIssues = valuation.priceStatus.stale + valuation.priceStatus.unavailable;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="سبد دارایی"
          action={
            <Link href="/new?type=buy" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت خرید
            </Link>
          }
        />
        <ModuleTabs tabs={ASSET_TABS} active="/portfolio" label="بخش‌های دارایی" />
      </div>

      {valuation.assetValuations.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="portfolio"
            title="هنوز سرمایه‌گذاری‌ای ثبت نشده است"
            action={
              <Link href="/new?type=buy" className="btn btn-soft">
                ثبت اولین خرید
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {priceIssues > 0 && (
              <p className="price-flag">
                <Icon name="alert" size={14} />
                قیمت {faCount(priceIssues)} دارایی به‌روز نیست
              </p>
            )}
            <AssetValuationSummary
              totals={{
                valueToman: valuation.totalNetWorthToman,
                valueUsd: valuation.totalNetWorth,
                costToman: valuation.totalCostBasisToman,
                costUsd: valuation.totalCostBasis,
                pnlToman: valuation.totalUnrealizedPnlToman,
                pnlUsd: valuation.totalUnrealizedPnl,
              }}
              extra={{
                name: "سود/زیان تحقق‌یافته",
                toman: tomanOf(pnl.total),
                usd: pnl.total,
                signed: true,
              }}
            />
          </div>

          {valuation.allocationByClass.length > 0 && (
            <Section title="ترکیب سبد">
              <div className="grid items-stretch gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
                <div className="card hidden items-center justify-center p-4 lg:flex">
                  <Donut
                    size={188}
                    centerLabel="ارزش سبد"
                    showLegend={false}
                    data={valuation.allocationByClass.map((c) => ({
                      label: c.className,
                      value: Number(c.value),
                      color: c.color,
                    }))}
                  />
                </div>
                <AllocationBar
                  label="نوار ترکیب سبد"
                  slices={valuation.allocationByClass.map((c) => {
                    const toman = tomanByClass.get(c.className);
                    return {
                      key: c.className,
                      label: c.className,
                      percent: Number(c.percentage),
                      color: c.color,
                      value: toman ? formatMoney(toman.toFixed(0), "IRT") : (toIrt(c.value) ?? formatMoney(c.value)),
                    };
                  })}
                />
              </div>
            </Section>
          )}

          <Section
            title="فهرست دارایی‌ها"
            action={<span className="muted num text-[length:var(--fs-xs)]">{faCount(valuation.assetValuations.length)}</span>}
          >
            <HoldingsTable rows={valuation.assetValuations} toIrt={toIrt} />
          </Section>

          {pnl.bySymbol.length > 0 && (
            <Section title="سود/زیان تحقق‌یافته">
              <div className="card realized-list">
                {pnl.bySymbol.map((p) => (
                  <span
                    key={p.symbol}
                    className="num money-nowrap text-[length:var(--fs-sm)] font-medium"
                    dir="rtl"
                    style={{ color: toneColor(trendTone(p.pnl)) }}
                  >
                    {formatSignedMoney(p.pnl, p.symbol)}
                  </span>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
