import { seedIfEmpty } from "@/db/seed";
import { getAnalyticsSummary } from "@/features/analytics/service";
import { Card, PageHeader, Stat } from "@/components/ui/Card";
import { AreaChart } from "@/components/charts/Charts";
import { D } from "@/domain/decimal";
import { formatMoney, formatPercent, formatShortDate } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await seedIfEmpty();

  const [analytics, fx] = await Promise.all([getAnalyticsSummary(), getLatestUsdIrtRate()]);
  const { growth, risk, timeline } = analytics;
  const rate = fx.rate;

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
          value={formatMoney(growth.endingValue, "USD")}
          hint={formatMoney(D(growth.endingValue).mul(rate).toFixed(0), "IRT")}
        />
        <Stat
          label="تغییرات کل ثروت"
          value={formatMoney(growth.absoluteChange, "USD")}
          tone={D(growth.absoluteChange).isNegative() ? "down" : "up"}
          hint={`${formatMoney(D(growth.absoluteChange).mul(rate).toFixed(0), "IRT")} · از ${formatShortDate(growth.periodStart)} تا ${formatShortDate(growth.periodEnd)}`}
        />
        <Stat
          label="بازدهی خالص سرمایه‌گذاری"
          value={formatMoney(growth.netInvestmentReturn, "USD")}
          tone={D(growth.netInvestmentReturn).isNegative() ? "down" : "up"}
          hint={`${formatMoney(D(growth.netInvestmentReturn).mul(rate).toFixed(0), "IRT")} · بدون احتساب واریز/برداشت‌ها (${formatMoney(growth.netExternalCapitalFlows, "USD")})`}
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
