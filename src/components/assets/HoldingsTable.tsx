/* eslint-disable @next/next/no-img-element */
import { D } from "@/domain/decimal";
import { currencyLabel, formatMoney, formatPct, formatQty } from "@/lib/format";
import type { AssetValuation } from "@/features/portfolio/types";

/**
 * Holdings valuation table — shared by Portfolio and Crypto.
 * Dense on desktop, progressive disclosure on mobile (PnL columns drop).
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
            return (
              <tr key={a.assetId}>
                <td>
                  <div className="flex items-center gap-2.5">
                    {a.logoUrl ? (
                      <img src={a.logoUrl} alt="" width={28} height={28} className="h-7 w-7 shrink-0 rounded-full" referrerPolicy="no-referrer" />
                    ) : (
                      <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: a.classColor }} />
                    )}
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold tracking-tight" dir="rtl">
                        {currencyLabel(a.symbol)}
                      </div>
                      <div className="muted truncate text-[10.5px]">{a.name}</div>
                      <div className="mt-0.5 text-[9px]">
                        {a.priceFreshness === "fresh" && <span className="chip">Fresh</span>}
                        {a.priceFreshness === "stale" && <span className="chip" style={{ color: "var(--warning)" }}>Stale</span>}
                        {a.priceFreshness === "unavailable" && <span className="chip" style={{ color: "var(--negative)" }}>Unavailable</span>}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="td-num" dir="rtl">
                  {formatQty(a.quantity, a.decimals)}
                </td>
                <td className="td-num" dir="rtl">
                  {a.marketPrice !== "0" && toIrt(a.marketPrice) ? (
                    <>
                      <div className="text-[12.5px] font-medium">
                        {toIrt(a.marketPrice)}
                      </div>
                      <div className="muted num text-[9.5px]" dir="rtl">
                        ≈ {formatMoney(a.marketPrice)}
                      </div>
                    </>
                  ) : (
                    <div className="text-[12.5px] font-medium">
                      {a.priceFreshness === "unavailable" && a.valuationBasis === "cost_basis_fallback"
                        ? "در دسترس نیست"
                        : formatMoney(a.marketPrice)}
                    </div>
                  )}
                </td>
                <td className="td-num hidden lg:table-cell" dir="rtl">
                  <div className="text-[12px]">{formatMoney(a.costBasis)}</div>
                  <div className="muted text-[9.5px]">FIFO</div>
                </td>
                <td className="td-num" dir="rtl">
                  <div className="num text-[13px] font-bold">{formatMoney(a.currentValueToman, "IRT")}</div>
                  <div className="muted num text-[9.5px]" dir="rtl">
                    ≈ {formatMoney(a.currentValue)}
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell" dir="rtl" style={{ color: pnl.isNegative() ? "var(--negative)" : "var(--positive)" }}>
                  <div className="text-[12.5px] font-semibold">
                    {pnl.gte(0) ? "+" : "−"}
                    {formatMoney(pnl.abs().toString())}
                  </div>
                  <div className="num text-[10px]">
                    {D(a.roiPercentage).gte(0) ? "↑" : "↓"} {formatQty(D(a.roiPercentage).abs().toString(), 2)}٪
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell" dir="rtl">
                  <span className="num text-[12px]">{formatPct(a.sharePercentage, 2)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
