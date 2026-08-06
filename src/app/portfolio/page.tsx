import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getOpenLots, getRealizedPnl } from "@/features/ledger/queries";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { Card, Money, PageHeader, Stat } from "@/components/ui/Card";
import { Donut } from "@/components/charts/Charts";
import { D } from "@/domain/decimal";
import { formatMoney, formatQty, getDualDate } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  await seedIfEmpty();

  const [valuation, lots, pnl, balances, fxSnap] = await Promise.all([
    getPortfolioValuation(),
    getOpenLots(),
    getRealizedPnl(),
    getAccountBalances(),
    getLatestUsdIrtRate(),
  ]);

  const rate = fxSnap.rate;
  const toIrt = (usd: string) => (rate ? D(usd).mul(rate).toFixed(0) : "—");
  const dualMoney = (usd: string) => (
    <span className="flex flex-col items-end gap-0.5">
      <span className="num font-bold" dir="ltr">{formatMoney(usd, "USD")}</span>
      <span className="num text-[10px]" dir="rtl" style={{ color: "var(--accent)" }}>{rate ? formatMoney(toIrt(usd), "IRT") : "—"}</span>
    </span>
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="سبد دارایی و ارزش‌گذاری (Portfolio Valuation)"
        subtitle="مالکیت و قیمت تمام‌شده از دفترکل (FIFO) — ارزش روز از لایه Market Data — نمایش دوگانه تومان/دلار فقط نمایشی است و هیچ محاسبه حسابی را تغییر نمی‌دهد."
      />

      <div className="soft rounded-2xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <span>نرخ دلار مرجع: <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>
        <span className="muted">تاریخ نرخ: <span dir="ltr" className="num">{fxSnap.effectiveDate}</span> · منبع: {fxSnap.source} · بهای تمام‌شده و ارزش دارایی هم‌زمان به تومان و دلار نمایش داده می‌شوند (خوانش مستقیم از FIFO)</span>
      </div>

      {/* Primary Wealth Metrics — dual */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-3">
          <div className="muted text-[10px]">ارزش روز سبد دارایی</div>
          <div className="num font-bold text-sm" dir="ltr">{formatMoney(valuation.totalNetWorth, "USD")}</div>
          <div className="num text-[11px]" dir="rtl" style={{ color: "var(--accent)" }}>{formatMoney(toIrt(valuation.totalNetWorth), "IRT")}</div>
        </div>
        <div className="card p-3">
          <div className="muted text-[10px]">قیمت تمام‌شده (Cost Basis) — FIFO</div>
          <div className="num font-bold text-sm" dir="ltr">{formatMoney(valuation.totalCostBasis, "USD")}</div>
          <div className="num text-[11px]" dir="rtl" style={{ color: "var(--accent)" }}>{formatMoney(toIrt(valuation.totalCostBasis), "IRT")}</div>
          <div className="muted text-[10px]">خوانش مستقیم از FIFO — بدون تغییر محاسبات</div>
        </div>
        <div className="card p-3">
          <div className="muted text-[10px]">سود/زیان تحقق‌نیافته</div>
          <div className="num font-bold text-sm" dir="ltr" style={{ color: D(valuation.totalUnrealizedPnl).isNegative() ? "var(--danger)" : "var(--accent)" }}>{formatMoney(valuation.totalUnrealizedPnl, "USD")}</div>
          <div className="num text-[11px]" dir="rtl" style={{ color: D(valuation.totalUnrealizedPnl).isNegative() ? "var(--danger)" : "var(--accent)" }}>{formatMoney(toIrt(valuation.totalUnrealizedPnl), "IRT")}</div>
          <div className="muted text-[10px]">ROI: {valuation.overallRoiPercentage}%</div>
        </div>
        <div className="card p-3">
          <div className="muted text-[10px]">سود تحقق‌یافته (Realized)</div>
          <div className="num font-bold text-sm" dir="ltr" style={{ color: Number(pnl.total) >= 0 ? "var(--accent)" : "var(--danger)" }}>{formatMoney(pnl.total, "USD")}</div>
          <div className="num text-[11px]" dir="rtl" style={{ color: Number(pnl.total) >= 0 ? "var(--accent)" : "var(--danger)" }}>{formatMoney(toIrt(pnl.total), "IRT")}</div>
          <div className="muted text-[10px]">{lots.length} بسته FIFO باز</div>
        </div>
      </div>

      {/* Allocation Chart */}
      <Card title="تخصیص ثروت بر اساس کلاس دارایی">
        <Donut
          data={valuation.allocationByClass.map((c) => ({
            label: c.className,
            value: Number(c.value),
            color: c.color,
          }))}
        />
      </Card>

      {/* Multi-Asset Valuation Table — dual */}
      <Card title="ارزش‌گذاری تفکیکی دارایی‌ها — نمایش دوگانه">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">مقدار</th>
                <th className="py-2 font-normal">قیمت بازار (USD / IRT)</th>
                <th className="py-2 font-normal">بهای تمام‌شده (USD / IRT)</th>
                <th className="py-2 font-normal">ارزش روز (USD / IRT)</th>
                <th className="py-2 font-normal">سود/زیان تحقق‌نیافته</th>
                <th className="py-2 font-normal">ROI</th>
              </tr>
            </thead>
            <tbody>
              {valuation.assetValuations.map((a) => {
                const pnlDec = D(a.unrealizedPnl);
                return (
                  <tr key={a.assetId} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <i className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: a.classColor }} />
                        <div>
                          <div className="font-bold">{a.symbol}</div>
                          <div className="muted text-[10px]">{a.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="num py-3" dir="ltr">{formatQty(a.quantity, a.decimals)}</td>
                    <td className="py-3">
                      <div className="num font-bold" dir="ltr">{formatMoney(a.marketPrice, "USD")}</div>
                      <div className="num text-[10px]" dir="rtl" style={{ color: "var(--accent)" }}>{formatMoney(toIrt(a.marketPrice), "IRT")}</div>
                    </td>
                    <td className="py-3">
                      <div className="num" dir="ltr">{formatMoney(a.costBasis, "USD")}</div>
                      <div className="num text-[10px]" dir="rtl">{formatMoney(toIrt(a.costBasis), "IRT")}</div>
                      <div className="muted text-[10px]">FIFO</div>
                    </td>
                    <td className="py-3">
                      <div className="num font-bold" dir="ltr">{formatMoney(a.currentValue, "USD")}</div>
                      <div className="num text-[10px]" dir="rtl" style={{ color: "var(--accent)" }}>{formatMoney(toIrt(a.currentValue), "IRT")}</div>
                    </td>
                    <td className="num py-3" dir="ltr" style={{ color: pnlDec.isNegative() ? "var(--danger)" : "var(--accent)" }}>
                      <div>{formatMoney(a.unrealizedPnl, "USD")}</div>
                      <div className="text-[10px]">{formatMoney(toIrt(a.unrealizedPnl), "IRT")}</div>
                    </td>
                    <td className="num py-3 font-bold" dir="ltr" style={{ color: pnlDec.isNegative() ? "var(--danger)" : "var(--accent)" }}>
                      {a.roiPercentage}%
                    </td>
                  </tr>
                );
              })}
              {!valuation.assetValuations.length && (
                <tr>
                  <td colSpan={7} className="muted py-8 text-center text-xs">
                    دارایی‌ای برای ارزش‌گذاری ثبت نشده است.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="muted text-[10px] mt-2">بهای تمام‌شده از FIFO و ارزش روز از Market Data خوانده می‌شود — نمایش دوگانه فقط نمایشی است.</p>
      </Card>

      {/* FIFO Lots & Account Balances — dual */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بسته‌های FIFO باز (Cost Basis Reference) — نمایش دوگانه">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {lots.map((l) => {
              const dual = getDualDate(l.openedAt);
              return (
                <li key={l.id} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-bold">{l.symbol}</div>
                    <div className="muted text-[10px]">تاریخ خرید شمسی: {dual.jalali} · میلادی: <span dir="ltr" className="num">{dual.gregorian}</span></div>
                  </div>
                  <div className="text-left">
                    <div className="num" dir="ltr">{formatQty(l.qtyRemaining, 8)}</div>
                    <div className="num text-[10px]" dir="ltr">قیمت خرید واحد {formatMoney(l.unitCostBase, "USD")} ≈ {formatMoney(toIrt(l.unitCostBase), "IRT")}</div>
                    <div className="muted text-[10px]">بهای تمام‌شده از FIFO — بدون تغییر محاسبات</div>
                  </div>
                </li>
              );
            })}
            {!lots.length && <li className="muted py-6 text-center">بسته بازی وجود ندارد</li>}
          </ul>
        </Card>

        <Card title="موجودی حساب‌های دفترکل — ارزش دوگانه">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {balances
              .filter((b) => b.type === "asset" && D(b.quantity).abs().gt("0.00000001"))
              .map((b) => (
                <li key={b.accountId} className="flex items-center justify-between py-2.5">
                  <div>
                    <div className="font-bold">{b.name}</div>
                    <div className="muted text-[10px]">{b.walletName ?? "—"} · {b.code}</div>
                  </div>
                  <div className="text-left">
                    <div className="num" dir="ltr">{formatQty(b.quantity, b.assetDecimals)} {b.symbol}</div>
                    <div className="num font-bold" dir="ltr">{formatMoney(b.baseValue, "USD")}</div>
                    <div className="num text-[10px]" dir="rtl" style={{ color: "var(--accent)" }}>{formatMoney(toIrt(b.baseValue), "IRT")}</div>
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
