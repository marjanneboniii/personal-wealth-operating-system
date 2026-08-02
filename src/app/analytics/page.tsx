import { seedIfEmpty } from "@/db/seed";
import { getAnalyticsSummary } from "@/features/analytics/service";
import { Card, PageHeader, Stat } from "@/components/ui/Card";
import { AreaChart } from "@/components/charts/Charts";
import { D } from "@/domain/decimal";
import { formatMoney, formatPercent, formatShortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await seedIfEmpty();

  const analytics = await getAnalyticsSummary();
  const { growth, attribution, benchmarks, risk, timeline } = analytics;

  const areaSeries = timeline.map((pt) => ({
    date: pt.date,
    value: Number(pt.portfolioValue),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="تحلیل ثروت و هوش عملکرد (Wealth Analytics & Intelligence)"
        subtitle="تحلیل هوشمند رشد ثروت، جداسازی واریزها/برداشت‌ها از بازدهی سرمایه‌گذاری، مقایسه با بنچمارک‌ها و سنجش ریسک"
        action={
          <span className="chip num font-bold text-[11px]" dir="ltr">
            فرموا محاسباتی: {growth.calculationVersion}
          </span>
        }
      />

      {/* Missing Data Protection Warning Banner */}
      {growth.calculationStatus === "missing_data" && growth.missingDataWarning && (
        <div className="card soft border p-4 text-xs font-bold leading-6 style={{ borderColor: 'var(--warn)', color: 'var(--warn)' }}">
          ⚠️ {growth.missingDataWarning}
        </div>
      )}

      {/* SECTION 1: Wealth Growth Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="ارزش فعلی ثروت"
          value={formatMoney(growth.endingValue)}
        />
        <Stat
          label="تغییرات کل ثروت"
          value={formatMoney(growth.absoluteChange)}
          tone={D(growth.absoluteChange).isNegative() ? "down" : "up"}
          hint={`از ${formatShortDate(growth.periodStart)} تا ${formatShortDate(growth.periodEnd)}`}
        />
        <Stat
          label="بازدهی خالص سرمایه‌گذاری"
          value={formatMoney(growth.netInvestmentReturn)}
          tone={D(growth.netInvestmentReturn).isNegative() ? "down" : "up"}
          hint={`بدون احتساب واریز/برداشت‌ها (${formatMoney(growth.netExternalCapitalFlows)})`}
        />
        <Stat
          label="بازدهی تعدیل‌شده ثروت (Adjusted Return)"
          value={formatPercent(growth.adjustedWealthReturnPercentage)}
          tone={D(growth.adjustedWealthReturnPercentage).isNegative() ? "down" : "up"}
        />
      </div>

      {/* External Cash Flow Breakdown Card */}
      <div className="soft rounded-2xl p-4 text-xs flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="font-bold">تحلیل جریان سرمایه بیرونی:</span> مجموع واریزها و تزریق سرمایه جدید در این دوره برابر{" "}
          <strong className="num font-bold">{formatMoney(growth.netExternalCapitalFlows)}</strong> می‌باشد.
        </div>
        <div className="muted text-[11px]">
          تزریق سرمایه بیرونی به عنوان بازدهی سرمایه‌گذاری محاسبه نمی‌شود.
        </div>
      </div>

      {/* Risk Warning Banner */}
      {risk.concentrationWarning && (
        <div
          className="card soft border p-4 text-xs font-bold leading-6"
          style={{
            borderColor: risk.riskScore === "critical" ? "var(--danger)" : "var(--warn)",
            color: risk.riskScore === "critical" ? "var(--danger)" : "var(--warn)",
          }}
        >
          {risk.concentrationWarning}
        </div>
      )}

      {/* SECTION 2: Wealth Timeline Chart */}
      <Card title="روند تاریخی تغییرات ثروت (Wealth Timeline)">
        {areaSeries.length > 0 ? (
          <AreaChart data={areaSeries} />
        ) : (
          <p className="muted py-8 text-center text-xs">
            اسنپ‌شات تاریخی برای نمایش نمودار ثبت نشده است.
          </p>
        )}
      </Card>

      {/* SECTION 3: Best & Worst Performers & Asset Attribution */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="بهترین و بدترین عملکرد دارایی‌ها">
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">بهترین عملکرد (Top Winner)</div>
              {attribution.topWinner ? (
                <div>
                  <div className="font-bold text-sm mt-1">{attribution.topWinner.symbol}</div>
                  <div className="num font-bold text-xs" style={{ color: "var(--accent)" }}>
                    +{attribution.topWinner.percentageChange}% ({formatMoney(attribution.topWinner.absoluteChange)})
                  </div>
                </div>
              ) : (
                <div className="muted text-xs mt-1">—</div>
              )}
            </div>

            <div className="soft rounded-2xl p-3">
              <div className="muted text-[10px]">بدترین عملکرد (Top Loser)</div>
              {attribution.topLoser ? (
                <div>
                  <div className="font-bold text-sm mt-1">{attribution.topLoser.symbol}</div>
                  <div className="num font-bold text-xs" style={{ color: "var(--danger)" }}>
                    {attribution.topLoser.percentageChange}% ({formatMoney(attribution.topLoser.absoluteChange)})
                  </div>
                </div>
              ) : (
                <div className="muted text-xs mt-1">—</div>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="muted">
                <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                  <th className="py-2 font-normal">نماد</th>
                  <th className="py-2 font-normal">بهای اولیه</th>
                  <th className="py-2 font-normal">ارزش فعلی</th>
                  <th className="py-2 font-normal">سود/زیان</th>
                  <th className="py-2 font-normal">سهم در رشد٪</th>
                </tr>
              </thead>
              <tbody>
                {attribution.attributions.map((a) => {
                  const isNeg = D(a.absoluteChange).isNegative();
                  return (
                    <tr key={a.assetId} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                      <td className="font-bold py-2.5">{a.symbol}</td>
                      <td className="num py-2.5" dir="ltr">{formatMoney(a.startingValue)}</td>
                      <td className="num py-2.5 font-bold" dir="ltr">{formatMoney(a.endingValue)}</td>
                      <td className="num py-2.5 font-bold" dir="ltr" style={{ color: isNeg ? "var(--danger)" : "var(--accent)" }}>
                        {formatMoney(a.absoluteChange)} ({a.percentageChange}٪)
                      </td>
                      <td className="num py-2.5" dir="ltr">{a.contributionPercentage}٪</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* SECTION 4: Benchmark Comparison */}
        <Card title="مقایسه عملکرد با شاخص‌های بازار (Benchmark Comparison)">
          <p className="muted mb-4 text-[11px] leading-5">
            شاخص‌های بنچمارک ابزارهای تحلیلی بیرونی هستند و کاملاً از اسناد دفترکل و حساب‌های شما جدا نگهداری می‌شوند.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="muted">
                <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                  <th className="py-2 font-normal">شاخص بنچمارک</th>
                  <th className="py-2 font-normal">بازدهی شما</th>
                  <th className="py-2 font-normal">بازدهی بنچمارک</th>
                  <th className="py-2 font-normal">اختلاف (Alpha)</th>
                  <th className="py-2 font-normal">ارزیابی</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map((b) => (
                  <tr key={b.symbol} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                    <td className="font-bold py-2.5">{b.name}</td>
                    <td className="num py-2.5 font-bold" dir="ltr">{b.portfolioReturnPercentage}٪</td>
                    <td className="num py-2.5" dir="ltr">{b.benchmarkReturnPercentage}٪</td>
                    <td className="num py-2.5 font-bold" dir="ltr" style={{ color: b.outperformed ? "var(--accent)" : "var(--danger)" }}>
                      {b.alphaPercentage}%
                    </td>
                    <td className="py-2.5">
                      {b.outperformed ? (
                        <span className="chip" style={{ color: "var(--accent)" }}>
                          عملکرد برتر 🏆
                        </span>
                      ) : (
                        <span className="chip" style={{ color: "var(--danger)" }}>
                          عقب‌تر از بنچمارک 🔻
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {/* SECTION 5: Risk Dashboard */}
      <Card title="داشبورد سنجش ریسک و افت تاریخی (Risk Dashboard)">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">بزرگ‌ترین تمرکز تک‌دارایی</div>
            <div className="num font-bold text-base mt-1" dir="ltr">
              {risk.largestAssetSymbol} ({risk.largestAssetPercentage}٪)
            </div>
          </div>

          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">مجموع ریسک رمزارزها</div>
            <div className="num font-bold text-base mt-1" dir="ltr">
              {risk.cryptoExposurePercentage}٪
            </div>
          </div>

          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">بیشترین افت از سقف (Max Drawdown)</div>
            <div className="num font-bold text-base mt-1" dir="ltr" style={{ color: "var(--danger)" }}>
              −{risk.maxDrawdownPercentage}٪
            </div>
          </div>

          <div className="soft rounded-2xl p-3">
            <div className="muted text-[10px]">ارزیابی ریسک کل</div>
            <div className="font-bold text-base mt-1">
              {risk.riskScore === "critical"
                ? "بحرانی"
                : risk.riskScore === "high"
                  ? "بالا"
                  : risk.riskScore === "moderate"
                    ? "متوسط"
                    : "پایین"}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
