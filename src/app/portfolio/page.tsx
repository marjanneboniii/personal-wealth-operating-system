import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getHoldings, getNetWorth, getOpenLots, getRealizedPnl } from "@/features/ledger/queries";
import { Card, Money, PageHeader, Stat } from "@/components/ui/Card";
import { Donut } from "@/components/charts/Charts";
import { averageCost } from "@/domain/fifo";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatQty, formatShortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function PortfolioPage() {
  await seedIfEmpty();
  const [holdings, nw, lots, pnl, balances] = await Promise.all([
    getHoldings(),
    getNetWorth(),
    getOpenLots(),
    getRealizedPnl(),
    getAccountBalances(),
  ]);

  const active = holdings.filter((h) => D(h.quantity).abs().gt("0.00000001"));
  const rows = active.map((h) => {
    const qty = D(h.quantity);
    const price = D(h.price ?? "0");
    const value = qty.mul(price);
    const assetLots = lots.filter((l) => l.assetId === h.assetId);
    const avg = D(averageCost(assetLots));
    const cost = avg.isZero() ? D(h.costBase) : qty.mul(avg);
    const unrealized = value.sub(cost);
    const pct = cost.isZero() ? Decimal.zero() : unrealized.div(cost).mul(100);
    return { h, qty, price, value, avg, cost, unrealized, pct };
  }).sort((a, b) => b.value.toNumber() - a.value.toNumber());

  const totalUnrealized = Decimal.sum(rows.map((r) => r.unrealized.toString()));

  return (
    <div className="space-y-4">
      <PageHeader title="سبد دارایی" subtitle="مقدارها از دفترکل، ارزش‌ها از آخرین قیمت ثبت‌شده محاسبه می‌شوند." />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="ارزش سبد" value={formatMoney(nw.totalAssets)} />
        <Stat label="سود تحقق‌نیافته" value={formatMoney(totalUnrealized.toString())} tone={totalUnrealized.isNegative() ? "down" : "up"} />
        <Stat label="سود تحقق‌یافته" value={formatMoney(pnl.total)} tone={Number(pnl.total) >= 0 ? "up" : "down"} />
        <Stat label="تعداد دارایی" value={String(active.length)} hint={`${lots.length} بسته FIFO باز`} />
      </div>

      <Card title="تخصیص بر اساس کلاس دارایی">
        <Donut data={nw.byClass.map((c) => ({ label: c.className, value: Number(c.value), color: c.color }))} />
      </Card>

      <Card title="دارایی‌ها">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">دارایی</th>
                <th className="py-2 font-normal">مقدار</th>
                <th className="py-2 font-normal">قیمت</th>
                <th className="py-2 font-normal">میانگین خرید</th>
                <th className="py-2 font-normal">ارزش</th>
                <th className="py-2 font-normal">سود تحقق‌نیافته</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ h, qty, price, value, avg, unrealized, pct }) => (
                <tr key={h.assetId} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <i className="h-2.5 w-2.5 rounded-full" style={{ background: h.classColor }} />
                      <div>
                        <div className="font-medium">{h.symbol}</div>
                        <div className="muted text-[10px]">{h.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="num py-3" dir="ltr">{formatQty(qty.toString(), h.decimals)}</td>
                  <td className="num py-3" dir="ltr">{formatMoney(price.toString())}</td>
                  <td className="num py-3" dir="ltr">{avg.isZero() ? "—" : formatMoney(avg.toString())}</td>
                  <td className="num py-3" dir="ltr">{formatMoney(value.toString())}</td>
                  <td className="num py-3" dir="ltr" style={{ color: unrealized.isNegative() ? "var(--danger)" : "var(--accent)" }}>
                    {formatMoney(unrealized.toString())}
                    <span className="muted mr-1 text-[10px]">({pct.toFixed(1)}٪)</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بسته‌های FIFO باز">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {lots.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2.5">
                <div>
                  <div>{l.symbol}</div>
                  <div className="muted text-[10px]">باز شده در {formatShortDate(l.openedAt)}</div>
                </div>
                <div className="text-left">
                  <div className="num" dir="ltr">{formatQty(l.qtyRemaining, 8)}</div>
                  <div className="muted num text-[10px]" dir="ltr">بهای واحد {formatMoney(l.unitCostBase)}</div>
                </div>
              </li>
            ))}
            {!lots.length && <li className="muted py-6 text-center">بسته بازی وجود ندارد</li>}
          </ul>
        </Card>

        <Card title="موجودی حساب‌های دارایی">
          <ul className="divide-y text-xs" style={{ borderColor: "var(--line)" }}>
            {balances
              .filter((b) => b.type === "asset" && D(b.quantity).abs().gt("0.00000001"))
              .map((b) => (
                <li key={b.accountId} className="flex items-center justify-between py-2.5">
                  <div>
                    <div>{b.name}</div>
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
