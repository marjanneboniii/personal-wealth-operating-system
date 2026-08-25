/* eslint-disable @next/next/no-img-element */
import { D } from "@/domain/decimal";
import { currencyLabel, formatMoney, formatPct, formatQty, formatSignedMoney, trendArrow, trendColor, trendTone } from "@/lib/format";
import Icon from "@/components/ui/Icon";
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
    <div className="card overflow-x-auto">
      <table className="table table-sticky">
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
                        {currencyLabel(a.symbol)}
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
                <td className="td-num money-nowrap" dir="rtl">
                  {a.marketPrice !== "0" && toIrt(a.marketPrice) ? (
                    <>
                      <div className="text-[11px] font-medium money-nowrap sm:text-[12px]">
                        {toIrt(a.marketPrice)}
                      </div>
                      <div className="muted num text-[9px] money-nowrap sm:text-[9.5px]" dir="rtl">
                        ≈ {formatMoney(a.marketPrice)}
                      </div>
                    </>
                  ) : (
                    <div className="text-[11px] font-medium money-nowrap sm:text-[12px]">
                      {a.priceFreshness === "unavailable" && a.valuationBasis === "cost_basis_fallback"
                        ? "در دسترس نیست"
                        : formatMoney(a.marketPrice)}
                    </div>
                  )}
                </td>
                <td className="td-num hidden lg:table-cell money-nowrap text-[11px]" dir="rtl">
                  <div>{formatMoney(a.costBasis)}</div>
                  <div className="mt-1"><span className="chip text-[9px]">FIFO</span></div>
                </td>
                <td className="td-num money-nowrap" dir="rtl">
                  <div className="num text-[11px] font-bold money-nowrap sm:text-[12px]">{formatMoney(a.currentValueToman, "IRT")}</div>
                  <div className="muted num text-[9px] money-nowrap sm:text-[9.5px]" dir="rtl">
                    ≈ {formatMoney(a.currentValue)}
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell money-nowrap" dir="rtl" style={{ color: trendColor(a.unrealizedPnl) }}>
                  <div className="text-[11px] font-semibold money-nowrap sm:text-[12px]">
                    {pnlTone === "up" ? "+" : pnlTone === "down" ? "−" : ""}
                    {formatMoney(pnl.abs().toString())}
                  </div>
                  <div className="num text-[9px] money-nowrap sm:text-[10px]">
                    {trendArrow(a.roiPercentage)} {formatQty(D(a.roiPercentage).abs().toString(), 2)}٪
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell money-nowrap text-[11px]" dir="rtl">
                  <span className="num">{formatPct(a.sharePercentage, 2)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div
        className="muted flex items-center gap-1 border-t px-3 py-2 text-[10.5px] sm:hidden"
        style={{ borderColor: "var(--border)" }}
        aria-hidden="true"
      >
        <Icon name="chevronLeft" size={13} />
        برای دیدن قیمت‌ها، جدول را بکشید
      </div>
    </div>
  );
}
