import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getOpenLots, getRealizedPnl } from "@/features/ledger/queries";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { Alert, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import { Donut } from "@/components/charts/Charts";
import HoldingsTable from "@/components/assets/HoldingsTable";
import { D } from "@/domain/decimal";
import { currencySymbol, faCount, formatDualDate, formatMoney, formatPct, formatQty, formatSignedMoney, usdToIrt, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, lots, pnl, fx] = await Promise.all([
    getPortfolioValuation(),
    getOpenLots(),
    getRealizedPnl(),
    getLatestUsdIrtRate(),
  ]);

  const tomanOf = (usd: string | number) => (fx.rate ? usdToIrt(usd, fx.rate) : null);
  const toIrt = (usd: string | number) => {
    const t = tomanOf(usd);
    return t ? formatMoney(t, "IRT") : null;
  };
  const unrealized = D(valuation.totalUnrealizedPnl);

  return (
    <div className="space-y-8">
      <PageHeader
        title="سبد دارایی"
        subtitle="ترکیب دارایی‌ها، ارزش روز و سود و زیان — این صفحه فقط نمایشی است و سندی ثبت نمی‌کند."
        action={<Link href="/new?type=buy" className="btn btn-primary">ثبت خرید دارایی</Link>}
      />

      {(valuation.priceStatus.stale > 0 || valuation.priceStatus.unavailable > 0) && (
        <Alert tone="warn" title="بخشی از قیمت‌های جاری قطعی نیست">
          {valuation.priceStatus.stale > 0 ? `${faCount(valuation.priceStatus.stale)} قیمت Stale است. ` : ""}
          {valuation.priceStatus.unavailable > 0 ? `${faCount(valuation.priceStatus.unavailable)} ارزش‌گذاری Unavailable است و با Cost Basis مشخص نمایش داده می‌شود.` : ""}
          هیچ fallback دستی برای قیمت جاری Crypto استفاده نشده است.
        </Alert>
      )}

      <section className="grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش روز سبد" value={formatMoney(valuation.totalNetWorthToman, "IRT")} hint={formatMoney(valuation.totalNetWorth)} />
        <Metric label="بهای تمام‌شده" value={toIrt(valuation.totalCostBasis) ?? formatMoney(valuation.totalCostBasis)} hint={fx.rate ? formatMoney(valuation.totalCostBasis) : undefined} />
        <Metric
          label="سود/زیان تحقق‌نیافته"
          value={tomanOf(unrealized.toString()) != null ? formatSignedMoney(tomanOf(unrealized.toString())!, "IRT") : formatSignedMoney(unrealized.toString())}
          tone={trendTone(unrealized.toString())}
          hint={fx.rate ? formatSignedMoney(unrealized.toString()) : undefined}
        />
        <Metric
          label="سود تحقق‌یافته"
          value={tomanOf(pnl.total) != null ? formatSignedMoney(tomanOf(pnl.total)!, "IRT") : formatSignedMoney(pnl.total)}
          tone={trendTone(pnl.total)}
          hint={fx.rate ? formatSignedMoney(pnl.total) : undefined}
        />
      </section>

      {valuation.assetValuations.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="portfolio"
            title="هنوز سرمایه‌گذاری‌ای ثبت نشده است"
            body="یک دارایی اضافه کنید یا حساب متصل کنید تا سبد شما از همین‌جا ردیابی شود."
            action={
              <Link href="/new?type=buy" className="btn btn-primary">
                ثبت خرید دارایی
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Section title="ثروت شما کجا قرار دارد؟" hint="ترکیب سبد بر اساس کلاس دارایی">
            {valuation.allocationByClass.length === 0 ? (
              <p className="muted py-6 text-center text-xs">هنوز ترکیبی برای نمایش ساخته نشده است.</p>
            ) : (
              <div className="card relative z-0 overflow-visible p-4 sm:p-6">
                <div
                  className="comp-bar mb-5"
                  role="img"
                  aria-label="نوار ترکیب ثروت"
                >
                  {valuation.allocationByClass.map((c) => (
                    <span
                      key={c.className}
                      style={{ width: `${Math.max(0, Math.min(100, Number(c.percentage)))}%`, background: c.color }}
                    />
                  ))}
                </div>
                <div className="grid min-w-0 items-center gap-6 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                  <Donut
                    size={200}
                    centerLabel="ارزش سبد"
                    showLegend={false}
                    data={valuation.allocationByClass.map((c) => ({
                      label: c.className,
                      value: Number(c.value),
                      color: c.color,
                    }))}
                  />
                  <ul className="min-w-0 space-y-3">
                    {valuation.allocationByClass.map((c) => (
                      <li key={c.className}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
                          <span className="flex min-w-0 items-center gap-2 font-medium">
                            <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: c.color }} />
                            <span className="truncate">{c.className}</span>
                          </span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            <span className="flex flex-col items-end">
                              <span className="num text-[12px] sm:text-[13px] font-bold money-nowrap" dir="rtl">
                                {toIrt(c.value) ?? formatMoney(c.value)}
                              </span>
                              {fx.rate && (
                                <span className="muted num text-[9.5px]" dir="rtl">
                                  ≈ {formatMoney(c.value)}
                                </span>
                              )}
                            </span>
                            <span className="num muted w-11 text-left text-[11px]" dir="rtl">
                              {formatPct(c.percentage, 1)}
                            </span>
                          </span>
                        </div>
                        <div className="meter" aria-hidden="true">
                          <i style={{ width: `${Math.max(0, Math.min(100, Number(c.percentage)))}%`, background: c.color }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </Section>

          <Section title="ارزش‌گذاری دارایی‌ها" hint={`به‌روزرسانی با آخرین قیمت‌ها · نرخ مرجع ${fx.rate ? formatMoney(fx.rate, "IRT") : "—"}`}>
            <HoldingsTable rows={valuation.assetValuations} toIrt={toIrt} />
          </Section>

          {lots.length > 0 && (
            <details className="card overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="text-[13px] font-semibold">
                  بسته‌های FIFO باز <span className="muted num text-[11px]">({faCount(lots.length)})</span>
                </span>
                <span className="muted text-[11px]">مرجع بهای تمام‌شده — باز کنید</span>
              </summary>
              <div className="border-t" style={{ borderColor: "var(--border)" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>دارایی</th>
                      <th>تاریخ خرید</th>
                      <th className="td-num">مانده بسته</th>
                      <th className="td-num">قیمت واحد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((l) => (
                      <tr key={l.id}>
                        <td className="font-bold" dir="rtl">
                          {currencySymbol(l.symbol)}
                        </td>
                        <td className="num text-[11.5px]">{formatDualDate(l.openedAt)}</td>
                        <td className="td-num" dir="rtl">
                          {formatQty(l.qtyRemaining, 8)}
                        </td>
                        <td className="td-num" dir="rtl">
                          {formatMoney(l.unitCostBase)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          {pnl.bySymbol.length > 0 && (
            <Alert tone="info" icon="info" title="سود/زیان تحقق‌یافته بر اساس دارایی">
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {pnl.bySymbol.map((p) => (
                  <span key={p.symbol} className="num text-[11.5px]" dir="rtl" style={{ color: trendTone(p.pnl) === "up" ? "var(--positive)" : trendTone(p.pnl) === "down" ? "var(--negative)" : "var(--text-2)" }}>
                    {formatSignedMoney(p.pnl, p.symbol)}
                  </span>
                ))}
              </div>
            </Alert>
          )}
        </>
      )}
    </div>
  );
}
