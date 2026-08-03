import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getOpenLots, getRealizedPnl } from "@/features/ledger/queries";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { Card, Money, PageHeader, Stat } from "@/components/ui/Card";
import { Donut } from "@/components/charts/Charts";
import { D } from "@/domain/decimal";
import { formatMoney, formatQty, formatShortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  await seedIfEmpty();

  const [valuation, lots, pnl, balances] = await Promise.all([
    getPortfolioValuation(),
    getOpenLots(),
    getRealizedPnl(),
    getAccountBalances(),
  ]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="سبد دارایی و ارزش‌گذاری (Portfolio Valuation)"
        subtitle="مالکیت و قیمت تمام‌شده از دفترکل، ارزش روز از لایه Market Data محاسبه می‌شود."
      />

      {/* Primary Wealth Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="ارزش روز سبد دارایی"
          value={formatMoney(valuation.totalNetWorth, valuation.baseCurrencyCode)}
        />
        <Stat
          label="قیمت تمام‌شده (Cost Basis)"
          value={formatMoney(valuation.totalCostBasis, valuation.baseCurrencyCode)}
        />
        <Stat
          label="سود/زیان تحقق‌نیافته"
          value={formatMoney(valuation.totalUnrealizedPnl, valuation.baseCurrencyCode)}
          tone={D(valuation.totalUnrealizedPnl).isNegative() ? "down" : "up"}
          hint={`بازدهی کل (ROI): ${valuation.overallRoiPercentage}%`}
        />
        <Stat
          label="سود تحقق‌یافته (Realized)"
          value={formatMoney(pnl.total, valuation.baseCurrencyCode)}
          tone={Number(pnl.total) >= 0 ? "up" : "down"}
          hint={`${lots.length} بسته FIFO باز`}
        />
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

      {/* Multi-Asset Valuation Table */}
      <Card title="ارزش‌گذاری تفکیکی دارایی‌ها (Digital Assets, Gold, Stocks, Real Estate)">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">مقدار</th>
                <th className="py-2 font-normal">قیمت بازار</th>
                <th className="py-2 font-normal">بهای تمام‌شده</th>
                <th className="py-2 font-normal">ارزش روز</th>
                <th className="py-2 font-normal">سود/زیان تحقق‌نیافته</th>
                <th className="py-2 font-normal">بازدهی (ROI)</th>
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
                    <td className="num py-3" dir="ltr">{formatMoney(a.marketPrice, a.marketCurrencyCode)}</td>
                    <td className="num py-3" dir="ltr">{formatMoney(a.costBasis, valuation.baseCurrencyCode)}</td>
                    <td className="num py-3 font-bold" dir="ltr">{formatMoney(a.currentValue, valuation.baseCurrencyCode)}</td>
                    <td className="num py-3" dir="ltr" style={{ color: pnlDec.isNegative() ? "var(--danger)" : "var(--accent)" }}>
                      {formatMoney(a.unrealizedPnl, valuation.baseCurrencyCode)}
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
      </Card>

      {/* FIFO Lots & Account Balances */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بسته‌های FIFO باز (Cost Basis Reference)">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {lots.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div className="font-bold">{l.symbol}</div>
                  <div className="muted text-[10px]">تاریخ خرید: {formatShortDate(l.openedAt)}</div>
                </div>
                <div className="text-left">
                  <div className="num" dir="ltr">{formatQty(l.qtyRemaining, 8)}</div>
                  <div className="muted num text-[10px]" dir="ltr">قیمت خرید واحد {formatMoney(l.unitCostBase)}</div>
                </div>
              </li>
            ))}
            {!lots.length && <li className="muted py-6 text-center">بسته بازی وجود ندارد</li>}
          </ul>
        </Card>

        <Card title="موجودی حساب‌های دفترکل">
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
                    <div className="muted num text-[10px]" dir="ltr"><Money value={b.baseValue} /></div>
                  </div>
                </li>
              ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
