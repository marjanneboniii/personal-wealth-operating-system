import { D } from "@/domain/decimal";
import { currencyLabel, formatMoney, formatPct, formatQty, trendArrow, trendColor, trendTone } from "@/lib/format";
import Icon from "@/components/ui/Icon";
import AssetLogo from "@/components/ui/AssetLogo";
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
            // ── Presentation-layer Toman figures ──────────────────────────────
            // The row is shown Toman-canonical so every column is internally
            // consistent and cannot contradict the others. For inherently-Toman
            // assets (ملک/خودرو/نقد تومانی) the market price is the asset's own
            // static Toman value — never a frozen USD figure re-scaled by the
            // current rate (that used to inflate the Toman price when USD rose).
            const pnlToman = D(a.unrealizedPnlToman);
            const pnlToneToman = trendTone(a.unrealizedPnlToman);
            const qtyD = D(a.quantity);
            const priceToman = qtyD.isZero()
              ? D(a.currentValueToman)
              : D(a.currentValueToman).div(qtyD);
            const costToman = D(a.costBasisToman ?? a.currentValueToman);
            const roiToman = costToman.isZero() || costToman.isNegative()
              ? "0"
              : pnlToman.div(costToman).mul("100").toFixed(2);
            return (
              <tr key={a.assetId}>
                <td className="min-w-0">
                  <div className="flex items-center gap-2 sm:gap-2.5">
                    <AssetLogo
                      symbol={a.symbol}
                      name={a.name}
                      logoUrl={a.logoUrl}
                      assetClassName={a.className}
                      size={32}
                      radius={9}
                    />
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
                  {a.marketPrice !== "0" ? (
                    <>
                      <div className="text-[11px] font-medium money-nowrap sm:text-[12px]">
                        {a.symbol === "IRT" || a.symbol === "IRR"
                          ? formatMoney(a.currentValueToman, "IRT")
                          : formatMoney(priceToman.toFixed(0), "IRT")}
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
                  <div className="text-[11px] font-medium money-nowrap sm:text-[12px]">{formatMoney(costToman.toFixed(0), "IRT")}</div>
                  <div className="muted num text-[9px] money-nowrap sm:text-[9.5px]" dir="rtl">
                    ≈ {formatMoney(a.costBasis)}
                  </div>
                </td>
                <td className="td-num money-nowrap" dir="rtl">
                  <div className="num text-[11px] font-bold money-nowrap sm:text-[12px]">{formatMoney(a.currentValueToman, "IRT")}</div>
                  <div className="muted num text-[9px] money-nowrap sm:text-[9.5px]" dir="rtl">
                    ≈ {formatMoney(a.currentValue)}
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell money-nowrap" dir="rtl" style={{ color: trendColor(a.unrealizedPnlToman) }}>
                  <div className="text-[11px] font-semibold money-nowrap sm:text-[12px]">
                    {pnlToneToman === "up" ? "+" : pnlToneToman === "down" ? "−" : ""}
                    {formatMoney(pnlToman.abs().toString(), "IRT")}
                  </div>
                  <div className="num text-[9px] money-nowrap sm:text-[10px]">
                    {trendArrow(roiToman)} {formatQty(D(roiToman).abs().toString(), 2)}٪
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
