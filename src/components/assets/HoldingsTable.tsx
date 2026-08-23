/* eslint-disable @next/next/no-img-element */
import { D } from "@/domain/decimal";
import { currencySymbol, formatMoney, formatMoneyLong, formatPct, formatQty, trendArrow, trendColor, trendTone } from "@/lib/format";
import { MoneyCell } from "@/components/ui/Card";
import type { AssetValuation } from "@/features/portfolio/types";

/**
 * Holdings valuation table — compact for mobile PWA, nowrap money.
 */
export default function HoldingsTable({
  rows,
  toIrt,
}: {
  rows: AssetValuation[];
  toIrt: (usd: string | number) => string | null;
}) {
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>دارایی</th>
            <th className="td-num">مقدار</th>
            <th className="td-num">قیمت بازار</th>
            <th className="td-num hidden lg:table-cell">بهای تمام‌شده</th>
            <th className="td-num">ارزش روز</th>
            <th className="td-num hidden sm:table-cell">سود/زیان</th>
            <th className="td-num hidden sm:table-cell">سهم</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const pnl = D(a.unrealizedPnl);
            const pnlTone = trendTone(a.unrealizedPnl);
            return (
              <tr key={a.assetId}>
                <td className="min-w-0">
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    {a.logoUrl ? (
                      <img src={a.logoUrl} alt="" width={28} height={28} className="h-6 w-6 shrink-0 rounded-full sm:h-7 sm:w-7" referrerPolicy="no-referrer" />
                    ) : (
                      <i className="h-2 w-2 shrink-0 rounded-[3px] sm:h-2.5 sm:w-2.5" style={{ background: a.classColor }} />
                    )}
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-semibold tracking-tight sm:text-[13px]" dir="rtl">
                        {a.name}
                      </div>
                      <div className="muted truncate text-[10px] font-normal sm:text-[10.5px]" dir="ltr">
                        {currencySymbol(a.symbol)}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {a.priceFreshness === "fresh" && <span className="chip text-[9px]">Fresh</span>}
                        {a.priceFreshness === "stale" && <span className="chip text-[9px]" style={{ color: "var(--warning)" }}>Stale</span>}
                        {a.priceFreshness === "unavailable" && <span className="chip text-[9px]" style={{ color: "var(--negative)" }}>Unavailable</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="td-num money-nowrap text-[11px] sm:text-[12px]" dir="rtl">
                  {formatQty(a.quantity, a.decimals)}
                </td>
                <td className="td-num" dir="rtl">
                  {a.marketPrice !== "0" && toIrt(a.marketPrice) ? (
                    <MoneyCell
                      align="end"
                      strong={false}
                      className="text-[11px] sm:text-[12px]"
                      title={formatMoneyLong(a.marketPrice)}
                      value={toIrt(a.marketPrice)}
                      sub={`≈ ${formatMoney(a.marketPrice)}`}
                    />
                  ) : (
                    <MoneyCell
                      align="end"
                      strong={false}
                      className="text-[11px] sm:text-[12px]"
                      title={formatMoneyLong(a.marketPrice)}
                      value={
                        a.priceFreshness === "unavailable" && a.valuationBasis === "cost_basis_fallback"
                          ? "در دسترس نیست"
                          : formatMoney(a.marketPrice)
                      }
                    />
                  )}
                </td>
                <td className="td-num hidden lg:table-cell text-[11px]" dir="rtl">
                  <MoneyCell align="end" strong={false} className="text-[11px]" title={formatMoneyLong(a.costBasis)} value={formatMoney(a.costBasis)} />
                  <div className="mt-1"><span className="chip text-[9px]">FIFO</span></div>
                </td>
                <td className="td-num" dir="rtl">
                  <MoneyCell
                    align="end"
                    className="text-[11px] sm:text-[12px]"
                    title={formatMoneyLong(a.currentValueToman, "IRT")}
                    value={formatMoney(a.currentValueToman, "IRT")}
                    sub={`≈ ${formatMoney(a.currentValue)}`}
                  />
                </td>
                <td className="td-num hidden sm:table-cell" dir="rtl">
                  <MoneyCell
                    align="end"
                    className="text-[11px] sm:text-[12px]"
                    color={trendColor(a.unrealizedPnl)}
                    title={formatMoneyLong(pnl.abs().toString())}
                    value={`${pnlTone === "up" ? "+" : pnlTone === "down" ? "−" : ""}${formatMoney(pnl.abs().toString())}`}
                    sub={`${trendArrow(a.roiPercentage)} ${formatQty(D(a.roiPercentage).abs().toString(), 2)}٪`}
                  />
                </td>
                <td className="td-num hidden sm:table-cell money-nowrap text-[11px]" dir="rtl">
                  <span className="num">{formatPct(a.sharePercentage, 2)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
