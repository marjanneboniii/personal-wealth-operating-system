import { D } from "@/domain/decimal";
import { formatMoney, formatQty } from "@/lib/format";
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
                    <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: a.classColor }} />
                    <div className="min-w-0">
                      <div className="text-[13px] font-bold tracking-tight" dir="ltr">
                        {a.symbol}
                      </div>
                      <div className="muted truncate text-[10.5px]">{a.name}</div>
                    </div>
                  </div>
                </td>
                <td className="td-num" dir="ltr">
                  {formatQty(a.quantity, a.decimals, "en")}
                </td>
                <td className="td-num" dir="ltr">
                  <div className="text-[12.5px] font-medium">{formatMoney(a.marketPrice)}</div>
                  {toIrt(a.marketPrice) && (
                    <div className="muted num text-[9.5px]" dir="rtl">
                      ≈ {toIrt(a.marketPrice)}
                    </div>
                  )}
                </td>
                <td className="td-num hidden lg:table-cell" dir="ltr">
                  <div className="text-[12px]">{formatMoney(a.costBasis)}</div>
                  <div className="muted text-[9.5px]">FIFO</div>
                </td>
                <td className="td-num" dir="ltr">
                  <div className="num text-[13px] font-bold">{formatMoney(a.currentValue)}</div>
                  {toIrt(a.currentValue) && (
                    <div className="muted num text-[9.5px]" dir="rtl">
                      ≈ {toIrt(a.currentValue)}
                    </div>
                  )}
                </td>
                <td className="td-num hidden sm:table-cell" dir="ltr" style={{ color: pnl.isNegative() ? "var(--negative)" : "var(--positive)" }}>
                  <div className="text-[12.5px] font-semibold">
                    {pnl.gte(0) ? "+" : "−"}
                    {formatMoney(pnl.abs().toString())}
                  </div>
                  <div className="num text-[10px]">
                    {D(a.roiPercentage).gte(0) ? "↑" : "↓"} {formatQty(D(a.roiPercentage).abs().toString(), 2, "en")}٪
                  </div>
                </td>
                <td className="td-num hidden sm:table-cell" dir="ltr">
                  <span className="num text-[12px]">{a.sharePercentage}٪</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
