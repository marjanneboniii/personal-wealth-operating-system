/**
 * Portfolio → «خودروها»
 *
 * Vehicles are real assets, not ledger positions: they have no FIFO lots and
 * no market feed. They are therefore shown as their OWN portfolio category,
 * side by side with the ledger holdings but never merged into them.
 *
 * Every figure here comes from the vehicle module's immutable valuation
 * snapshots. Nothing on this card is recomputed with today's FX rate:
 *
 *      FX rate update  ≠  vehicle valuation update
 */
import Link from "next/link";
import { Section } from "@/components/ui/Card";
import { D } from "@/domain/decimal";
import { formatJalaliIso, formatMoney, formatNumber, toFaDigits } from "@/lib/format";
import type { VehiclePortfolioSummary } from "@/features/rwa/vehicle/dto";

function Signed({
  value,
  currency,
}: {
  value: string | null;
  currency: "IRT" | "USD";
}) {
  if (value === null || value === "") return <span className="muted">—</span>;
  const n = D(value);
  const zero = n.isZero();
  const color = zero ? "var(--text-3)" : n.gt(0) ? "var(--positive)" : "var(--negative)";
  const sign = zero ? "" : n.gt(0) ? "+" : "−";
  return (
    <span className="num" style={{ color }} dir={currency === "IRT" ? "rtl" : "ltr"}>
      {sign}
      {formatMoney(n.abs().toString(), currency)}
    </span>
  );
}

function SignedPct({ value }: { value: string | null }) {
  if (value === null || value === "") return <span className="muted">—</span>;
  const n = D(value);
  const zero = n.isZero();
  const color = zero ? "var(--text-3)" : n.gt(0) ? "var(--positive)" : "var(--negative)";
  const sign = zero ? "" : n.gt(0) ? "+" : "−";
  return (
    <span className="num" style={{ color }} dir="ltr">
      {sign}
      {formatNumber(n.abs().toString(), { decimals: 2, digits: "en" })}٪
    </span>
  );
}

export default function VehiclePortfolioSection({
  summary,
  ledgerNetWorthUsd,
}: {
  summary: VehiclePortfolioSummary;
  /** ارزش روز سبد سرمایه‌گذاری (دلاری) — فقط برای نمایش جمع کل، بدون دخالت در دفترکل */
  ledgerNetWorthUsd?: string;
}) {
  if (!summary || summary.count === 0) return null;

  const gainToman = D(summary.totalGainToman);
  const gainUsd = D(summary.totalGainUsd);

  return (
    <Section
      title="خودروها"
      hint="ارزش هر خودرو از آخرین «ارزش‌گذاری ثبت‌شده» خوانده می‌شود — نه از نرخ لحظه‌ای دلار."
      action={
        <Link href="/asset-registry#vehicle" className="inline-flex items-center gap-1 text-[12px] font-medium" style={{ color: "var(--brand)" }}>
          مدیریت خودروها
        </Link>
      }
    >
      <div className="card p-4 sm:p-5">
        {/* Totals */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <div className="min-w-0">
            <div className="muted text-[11px] font-medium">ارزش خودروهای در اختیار</div>
            <div className="num mt-1 text-lg font-bold tracking-tight" dir="rtl">
              {formatMoney(summary.totalCurrentToman, "IRT")}
            </div>
            <div className="muted num mt-0.5 text-[11px]" dir="ltr">
              {formatMoney(summary.totalCurrentUsd, "USD")}
            </div>
          </div>

          <div className="min-w-0">
            <div className="muted text-[11px] font-medium">مجموع بهای خرید</div>
            <div className="num mt-1 text-lg font-bold tracking-tight" dir="rtl">
              {formatMoney(summary.totalPurchaseToman, "IRT")}
            </div>
            <div className="muted num mt-0.5 text-[11px]" dir="ltr">
              {formatMoney(summary.totalPurchaseUsd, "USD")} — با نرخ دلارِ روز خرید
            </div>
          </div>

          <div className="min-w-0">
            <div className="muted text-[11px] font-medium">سود/زیان تومانی</div>
            <div className="mt-1 text-lg font-bold tracking-tight">
              <Signed value={summary.totalGainToman} currency="IRT" />
            </div>
            <div className="muted mt-0.5 text-[11px]">
              بازده: <SignedPct value={summary.roiToman} />
            </div>
          </div>

          <div className="min-w-0">
            <div className="muted text-[11px] font-medium">سود/زیان دلاری</div>
            <div className="mt-1 text-lg font-bold tracking-tight">
              <Signed value={summary.totalGainUsd} currency="USD" />
            </div>
            <div className="muted mt-0.5 text-[11px]">
              بازده: <SignedPct value={summary.roiUsd} />
            </div>
          </div>
        </div>

        {/* Divergence note — the two currencies can tell opposite stories. */}
        {gainToman.gt(0) && gainUsd.lt(0) && (
          <p
            className="mt-4 rounded-[var(--r-md)] p-2.5 text-[11px] leading-5"
            style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
          >
            ارزش تومانی خودروها رشد کرده اما ارزش دلاری آن‌ها کاهش یافته است؛ بخشی از رشد اسمی ناشی از تضعیف ریال است.
          </p>
        )}

        {/* Per-vehicle rows — no FIFO, no live price feed. */}
        <div className="mt-4 overflow-x-auto border-t pt-1" style={{ borderColor: "var(--border)" }}>
          <table className="table">
            <thead>
              <tr>
                <th>خودرو</th>
                <th className="td-num">ارزش فعلی / قیمت فروش</th>
                <th className="td-num">معادل دلاری</th>
                <th className="td-num">بازده تومانی</th>
                <th className="td-num">آخرین ارزش‌گذاری</th>
              </tr>
            </thead>
            <tbody>
              {summary.items.map((v) => (
                <tr key={v.id} style={v.status === "sold" ? { opacity: 0.62 } : undefined}>
                  <td className="font-semibold">
                    {v.title}
                    {v.status === "sold" && (
                      <span className="muted mr-1.5 text-[10px]">(فروخته‌شده — خارج از مجموع)</span>
                    )}
                  </td>
                  <td className="td-num num" dir="rtl">
                    {v.currentValueToman ? formatMoney(v.currentValueToman, "IRT") : <span className="muted">ثبت نشده</span>}
                  </td>
                  <td className="td-num num" dir="ltr">
                    {v.currentValueUsd ? formatMoney(v.currentValueUsd, "USD") : <span className="muted">—</span>}
                  </td>
                  <td className="td-num">
                    <SignedPct value={v.roiToman} />
                  </td>
                  <td className="td-num num text-[11.5px]">
                    {v.lastValuationDate ? formatJalaliIso(v.lastValuationDate) : <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary.soldCount > 0 && (
          <div
            className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t pt-3 text-[11.5px]"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="muted">
              {toFaDigits(String(summary.soldCount))} خودروی فروخته‌شده (در ارزش سبد لحاظ نمی‌شود):
            </span>
            <span>
              مبلغ فروش <span className="num" dir="rtl">{formatMoney(summary.soldProceedsToman, "IRT")}</span>
            </span>
            <span>
              سود/زیان تحقق‌یافته <Signed value={summary.realisedGainToman} currency="IRT" /> ·{" "}
              <Signed value={summary.realisedGainUsd} currency="USD" />
            </span>
          </div>
        )}

        {ledgerNetWorthUsd !== undefined && (
          <div
            className="mt-4 flex flex-wrap items-baseline justify-between gap-2 border-t pt-3"
            style={{ borderColor: "var(--border)" }}
          >
            <span className="muted text-[11.5px]">ارزش کل: سبد سرمایه‌گذاری + خودروها</span>
            <span className="num text-[13.5px] font-bold" dir="ltr">
              {formatMoney(D(ledgerNetWorthUsd).add(summary.totalCurrentUsd).toFixed(2), "USD")}
            </span>
          </div>
        )}

        {summary.unvaluedCount > 0 && (
          <p
            className="mt-3 rounded-[var(--r-md)] p-2.5 text-[11px] leading-5"
            style={{ background: "var(--info-soft)", color: "var(--info)" }}
          >
            {toFaDigits(String(summary.unvaluedCount))} خودرو هنوز ارزش‌گذاری نشده است و در مجموع‌ها لحاظ نمی‌شود. برای
            محاسبه ارزش فعلی، یک «ارزش‌گذاری جدید» ثبت کنید.
          </p>
        )}
      </div>
    </Section>
  );
}
