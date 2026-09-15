import { D } from "@/domain/decimal";
import {
  currencyLabel,
  formatMoney,
  formatPct,
  formatQty,
  formatSignedMoney,
  persianAssetName,
  trendArrow,
  trendColor,
} from "@/lib/format";
import AssetLogo from "@/components/ui/AssetLogo";
import { vehicleDisplayLabel } from "@/features/rwa/vehicle/display";
import type { AssetValuation } from "@/features/portfolio/types";

/** A money cell: the Toman figure, with its USD equivalent as a quiet second line. */
function MoneyCell({ primary, usd, strong = false }: { primary: string; usd?: string | null; strong?: boolean }) {
  return (
    <>
      <div className={`num money-nowrap text-[length:var(--fs-sm)] ${strong ? "font-semibold" : "font-medium"}`} dir="rtl">
        {primary}
      </div>
      {usd != null && (
        <div className="muted num money-nowrap text-[length:var(--fs-xs)]" dir="rtl">
          ≈ {formatMoney(usd)}
        </div>
      )}
    </>
  );
}

/**
 * Holdings valuation table — Toman-canonical. On a phone it shows the three
 * columns a balance is read from (asset · value · P&L); price, share, cost and
 * average buy price join as the screen widens.
 */
export default function HoldingsTable({
  rows,
}: {
  rows: AssetValuation[];
  toIrt: (usd: string | number) => string | null;
}) {
  return (
    <div className="card overflow-x-auto">
      <table className="table table-sticky">
        <thead>
          <tr>
            <th scope="col">دارایی</th>
            <th scope="col" className="td-num hidden sm:table-cell">قیمت</th>
            <th scope="col" className="td-num hidden lg:table-cell">بهای تمام‌شده</th>
            <th scope="col" className="td-num hidden lg:table-cell">میانگین خرید</th>
            <th scope="col" className="td-num">ارزش روز</th>
            <th scope="col" className="td-num">سود/زیان</th>
            <th scope="col" className="td-num hidden sm:table-cell">سهم</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            // Presentation-layer Toman figures. For inherently-Toman assets
            // (ملک/خودرو/نقد تومانی) the market price is the asset's own static
            // Toman value — never a frozen USD figure re-scaled by today's rate.
            // The unit is printed only when it adds something: «۴» under
            // «اتریوم» needs no second «اتریوم».
            const displayName = persianAssetName(a.symbol, vehicleDisplayLabel(a.name));
            const unitLabel = currencyLabel(a.symbol) || null;
            const showUnit = unitLabel != null && unitLabel !== displayName;

            const pnlToman = D(a.unrealizedPnlToman);
            const qtyD = D(a.quantity);
            const priceToman = qtyD.isZero() ? D(a.currentValueToman) : D(a.currentValueToman).div(qtyD);
            const costToman = D(a.costBasisToman ?? a.currentValueToman);
            // Mixed-currency DCA: Σ(qty × unit cost × FX frozen at the buy) over
            // the lots still held.
            const dca = a.dca;
            const dcaUsable = !!dca && D(dca.quantityHeld).gt(0);
            const roiToman =
              costToman.isZero() || costToman.isNegative() ? "0" : pnlToman.div(costToman).mul("100").toFixed(2);
            return (
              <tr key={a.assetId}>
                <td className="min-w-0">
                  <div className="flex items-center gap-2.5">
                    <AssetLogo
                      symbol={a.symbol}
                      name={a.name}
                      logoUrl={a.logoUrl}
                      assetClassName={a.className}
                      size={32}
                      radius={9}
                    />
                    <div className="min-w-0">
                      {/* The short vehicle label drops the year and the repeated
                          assembler prefix; `title` keeps the full stored name. */}
                      <div className="truncate text-[length:var(--fs-sm)] font-semibold leading-6" dir="rtl" title={a.name}>
                        {displayName}
                      </div>
                      <div className="muted truncate text-[length:var(--fs-xs)] leading-5" dir="rtl">
                        <span className="num">{formatQty(a.quantity, a.decimals)}</span>
                        {showUnit && (
                          <>
                            {" "}
                            <bdi>{unitLabel}</bdi>
                          </>
                        )}
                      </div>
                      {/* Only a real price PROBLEM is surfaced; a current price is the normal case. */}
                      {a.priceFreshness === "stale" && (
                        <span className="badge badge-warn mt-1" title="قیمت این دارایی قدیمی است و باید تازه‌سازی شود">
                          قیمت قدیمی
                        </span>
                      )}
                      {a.priceFreshness === "unavailable" && (
                        <span className="badge badge-neg mt-1" title="قیمت بازار برای این دارایی در دسترس نیست">
                          قیمت در دسترس نیست
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell" dir="rtl">
                  {a.marketPrice !== "0" ? (
                    <MoneyCell
                      primary={
                        a.symbol === "IRT" || a.symbol === "IRR"
                          ? formatMoney(a.currentValueToman, "IRT")
                          : formatMoney(priceToman.toFixed(0), "IRT")
                      }
                      usd={a.marketPrice}
                    />
                  ) : (
                    <span className="muted text-[length:var(--fs-xs)]">
                      {a.priceFreshness === "unavailable" && a.valuationBasis === "cost_basis_fallback"
                        ? "در دسترس نیست"
                        : formatMoney(a.marketPrice)}
                    </span>
                  )}
                </td>
                <td className="td-num hidden lg:table-cell" dir="rtl">
                  <MoneyCell primary={formatMoney(costToman.toFixed(0), "IRT")} usd={a.costBasis} />
                </td>
                <td className="td-num hidden lg:table-cell" dir="rtl">
                  {dcaUsable ? (
                    <>
                      <MoneyCell primary={formatMoney(dca!.dcaUnitPriceToman, "IRT")} usd={dca!.dcaUnitPriceUsd} />
                      {dca!.hasEstimatedFx && <div className="muted text-[length:var(--fs-xs)]">با برآورد نرخ</div>}
                    </>
                  ) : (
                    <span className="muted text-[length:var(--fs-xs)]">—</span>
                  )}
                </td>
                <td className="td-num" dir="rtl">
                  <MoneyCell primary={formatMoney(a.currentValueToman, "IRT")} usd={a.currentValue} strong />
                </td>
                <td className="td-num" dir="rtl" style={{ color: trendColor(a.unrealizedPnlToman) }}>
                  <div className="num money-nowrap text-[length:var(--fs-sm)] font-semibold">
                    {formatSignedMoney(pnlToman.toString(), "IRT")}
                  </div>
                  <div className="num money-nowrap text-[length:var(--fs-xs)]">
                    {trendArrow(roiToman)} {formatPct(D(roiToman).abs().toString(), 2)}
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell" dir="rtl">
                  <span className="num text-[length:var(--fs-xs)]">{formatPct(a.sharePercentage, 1)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
