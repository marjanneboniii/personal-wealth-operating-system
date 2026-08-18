import { seedIfEmpty } from "@/db/seed";
import { ensureAuth } from "@/lib/authGuard";
import { getOpenLots, getRealizedPnl } from "@/features/ledger/queries";
import { getPortfolioValuation } from "@/features/portfolio/service";
import {
  ensureVehicleModuleReady,
  getVehiclePortfolioSummary,
} from "@/features/rwa/vehicle/service";
import { Alert, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import { Donut } from "@/components/charts/Charts";
import HoldingsTable from "@/components/assets/HoldingsTable";
import VehiclePortfolioSection from "@/components/portfolio/VehiclePortfolioSection";
import { D } from "@/domain/decimal";
import { currencyLabel, formatDualDate, formatMoney, formatQty } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  await seedIfEmpty();

  const [valuation, lots, pnl, fx, vehicles] = await Promise.all([
    getPortfolioValuation(),
    getOpenLots(),
    getRealizedPnl(),
    getLatestUsdIrtRate(),
    // «خودروها» is its own portfolio category: real assets valued from their
    // own immutable snapshots, deliberately kept out of the FIFO ledger.
    ensureVehicleModuleReady()
      .then(() => getVehiclePortfolioSummary(userId))
      .catch(() => null),
  ]);

  const toIrt = (usd: string | number) => (fx.rate ? formatMoney(D(usd).mul(fx.rate).toFixed(0), "IRT") : null);
  const unrealized = D(valuation.totalUnrealizedPnl);
  const hasVehicles = (vehicles?.count ?? 0) > 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="سبد دارایی"
        action={<Link href="/new?type=buy" className="btn btn-primary">ثبت خرید دارایی</Link>}
      />

      {(valuation.priceStatus.stale > 0 || valuation.priceStatus.unavailable > 0) && (
        <Alert tone="warn" title="بخشی از قیمت‌های جاری قطعی نیست">
          {valuation.priceStatus.stale > 0 ? `${valuation.priceStatus.stale} قیمت Stale است. ` : ""}
          {valuation.priceStatus.unavailable > 0 ? `${valuation.priceStatus.unavailable} ارزش‌گذاری Unavailable است و با Cost Basis مشخص نمایش داده می‌شود.` : ""}
          هیچ fallback دستی برای قیمت جاری Crypto استفاده نشده است.
        </Alert>
      )}

      {/* KPI strip */}
      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش روز سبد" value={formatMoney(valuation.totalNetWorth)} hint={formatMoney(valuation.totalNetWorthToman, "IRT")} />
        <Metric label="بهای تمام‌شده" value={formatMoney(valuation.totalCostBasis)} />
        <Metric
          label="سود/زیان تحقق‌نیافته"
          value={`${unrealized.gte(0) ? "+" : "−"}${formatMoney(unrealized.abs().toString())}`}
          tone={unrealized.gte(0) ? "up" : "down"}
        />
        <Metric
          label="سود تحقق‌یافته"
          value={`${D(pnl.total).gte(0) ? "+" : "−"}${formatMoney(D(pnl.total).abs().toString())}`}
          tone={D(pnl.total).gte(0) ? "up" : "down"}
        />
      </section>

      {valuation.assetValuations.length === 0 && !hasVehicles ? (
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
          {/* Allocation — where is the money? */}
          <div className="grid gap-8 lg:grid-cols-[minmax(0,380px)_1fr]">
            <Section title="ثروت شما کجا قرار دارد؟">
              <div className="card p-4 sm:p-5">
                <Donut
                  centerLabel="ارزش سبد"
                  data={valuation.allocationByClass.map((c) => ({
                    label: c.className,
                    value: Number(c.value),
                    color: c.color,
                  }))}
                />
              </div>
            </Section>
            <Section title="ارزش‌گذاری دارایی‌ها" hint={`به‌روزرسانی با آخرین قیمت‌ها · نرخ مرجع ${fx.rate ? formatMoney(fx.rate, "IRT") : "—"}`}>
              <HoldingsTable rows={valuation.assetValuations} toIrt={toIrt} />
            </Section>
          </div>

          {/* FIFO lots — accounting reference, tucked away until needed */}
          {lots.length > 0 && (
            <details className="card overflow-hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 marker:hidden [&::-webkit-details-marker]:hidden">
                <span className="text-[13px] font-semibold">
                  بسته‌های FIFO باز <span className="muted num text-[11px]">({lots.length})</span>
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
                          {currencyLabel(l.symbol)}
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
                  <span key={p.symbol} className="num text-[11.5px]" dir="rtl" style={{ color: D(p.pnl).gte(0) ? "var(--positive)" : "var(--negative)" }}>
                    {D(p.pnl).gte(0) ? "+" : "−"}
                    {formatMoney(D(p.pnl).abs().toString(), p.symbol)}
                  </span>
                ))}
              </div>
            </Alert>
          )}
        </>
      )}

      {vehicles && hasVehicles && (
        <VehiclePortfolioSection summary={vehicles} ledgerNetWorthUsd={valuation.totalNetWorth} />
      )}
    </div>
  );
}
