import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { desc } from "drizzle-orm";
import { db } from "@/db";
import { snapshots } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import {
  getFirstSnapshotAfter,
  getLiabilitiesTotal,
  getNetSavingsBetween,
  getSnapshotAsOf,
} from "@/features/ledger/queries";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { getAnalyticsSummary } from "@/features/analytics/service";
import { Alert, Delta, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import NetWorthChart from "@/components/charts/NetWorthChart";
import RowAction from "@/components/RowAction";
import { D } from "@/domain/decimal";
import { formatMoney, formatPct, formatPercent, todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RANGES = [
  { key: "1M", label: "۱ ماه", months: 1 },
  { key: "3M", label: "۳ ماه", months: 3 },
  { key: "6M", label: "۶ ماه", months: 6 },
  { key: "YTD", label: "امسال" },
  { key: "1Y", label: "۱ سال", months: 12 },
  { key: "ALL", label: "همه" },
] as const;

function fromDateFor(range: string, today: string): string {
  const r = RANGES.find((x) => x.key === range);
  if (!r) return today;
  if (r.key === "ALL") return "1970-01-01";
  if (r.key === "YTD") return `${today.slice(0, 4)}-01-01`;
  const d = new Date(today + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() - (r as { months?: number }).months!);
  return d.toISOString().slice(0, 10);
}

/** Group asset classes into the four human buckets. */
function bucketize(byClass: { className: string; color: string; value: string; share: string }[]) {
  const buckets = new Map<string, { value: number; members: { name: string; value: number }[] }>();
  const map: Record<string, string> = {
    "نقد و بانک": "نقد",
    "استیبل‌کوین": "نقد",
    "صندوق سرمایه‌گذاری": "سرمایه‌گذاری",
    "رمزارز": "رمزارز",
  };
  for (const c of byClass) {
    const b = map[c.className] ?? "سایر دارایی‌ها";
    const cur = buckets.get(b) ?? { value: 0, members: [] };
    cur.value += Number(c.value);
    cur.members.push({ name: c.className, value: Number(c.value) });
    buckets.set(b, cur);
  }
  const order = ["نقد", "سرمایه‌گذاری", "رمزارز", "سایر دارایی‌ها"];
  const colors: Record<string, string> = {
    "نقد": "#3d8bfd",
    "سرمایه‌گذاری": "#7048e8",
    "رمزارز": "#12b886",
    "سایر دارایی‌ها": "#e8a33d",
  };
  return order
    .filter((k) => buckets.has(k))
    .map((k) => ({ name: k, color: colors[k], value: buckets.get(k)!.value, members: buckets.get(k)!.members }));
}

export default async function NetWorthPage({ searchParams }: { searchParams: SearchParams }) {
  await ensureAuth();
  await seedIfEmpty();
  const sp = await searchParams;
  const range = RANGES.some((r) => r.key === sp.range) ? (sp.range as string) : "6M";
  const today = todayIso();
  const from = fromDateFor(range, today);

  const [nw, snaps, analytics, fx] = await Promise.all([
    getCurrentNetWorth(),
    db.select().from(snapshots).orderBy(desc(snapshots.asOf)).limit(420),
    getAnalyticsSummary(),
    getLatestUsdIrtRate(),
  ]);
  const valuation = nw.valuation;

  // Baseline for the chosen range — prefer actual history, else earliest point
  const baseline = (await getSnapshotAsOf(from)) ?? (await getFirstSnapshotAfter(from)) ?? null;
  const liabilitiesNow = await getLiabilitiesTotal();

  const nwNow = D(nw.netWorth);
  const deltaAbs = baseline ? nwNow.sub(baseline.netWorth) : D("0");
  const deltaPct = baseline && !D(baseline.netWorth).isZero() ? deltaAbs.div(baseline.netWorth).abs().mul(100).toFixed(2) : null;

  // Series: baseline-as-of chart slice + live today point
  const series = [...snaps]
    .reverse()
    .filter((s) => (range === "ALL" ? true : s.asOf >= from))
    .map((s) => ({ date: s.asOf, value: Number(s.netWorth) }));
  if (baseline && !series.find((p) => p.date === baseline.asOf) && baseline.asOf >= from) {
    series.unshift({ date: baseline.asOf, value: Number(baseline.netWorth) });
    series.sort((a, b) => a.date.localeCompare(b.date));
  }
  series.push({ date: today, value: Number(nw.netWorth) });

  // Attribution — honest decomposition of the change
  const savings = baseline ? D(await getNetSavingsBetween(baseline.asOf, today)) : D("0");
  const debtReduction = baseline ? D(baseline.totalLiabilities).sub(liabilitiesNow) : D("0");
  const marketAndRevaluation = deltaAbs.sub(savings).sub(debtReduction);

  const buckets = bucketize(nw.byClass);
  const totalAssets = buckets.reduce((s, b) => s + b.value, 0) || 1;

  const { risk, growth } = analytics;

  return (
    <div className="space-y-9">
      <PageHeader
        title="ارزش خالص"
        action={<RowAction kind="snapshot" label="ثبت اسنپ‌شات امروز" />}
      />

      {/* Hero — the number leads, the chart supports */}
      <section className="rise">
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <p className="muted text-[12px] font-medium">ارزش خالص فعلی</p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-4 gap-y-2">
              <span className="display-num text-[38px] font-bold leading-none tracking-tight sm:text-[50px]" dir="rtl">
                {formatMoney(nw.netWorth)}
              </span>
              {baseline ? (
                <Delta value={deltaAbs.toString()} pct={deltaPct} className="text-[15px]" />
              ) : (
                <span className="muted text-[12px]">تاریخچه‌ای برای این بازه هنوز ساخته نشده است</span>
              )}
            </div>
            <p className="muted mt-2 text-[12px]">
              {fx.rate && (
                <>
                  ≈ <span className="num">{formatMoney(nw.netWorthToman, "IRT")}</span>
                  <span className="mx-1.5 opacity-50">·</span>
                </>
              )}
              دارایی {formatMoney(nw.totalAssets)} <span className="opacity-50">−</span> بدهی {formatMoney(D(nw.totalLiabilities).neg().toString())}
            </p>
          </div>

          {/* Range control — URL state, shareable & back-button friendly */}
          <div className="seg" role="group" aria-label="بازه زمانی">
            {RANGES.map((r) => (
              <Link key={r.key} href={`/net-worth?range=${r.key}`} className={range === r.key ? "seg-on" : ""} aria-current={range === r.key ? "true" : undefined}>
                {r.label}
              </Link>
            ))}
          </div>
        </div>

        <div className="card mt-5 p-3 sm:p-5">
          <NetWorthChart data={series} height={210} />
        </div>
      </section>

      {/* Composition */}
      <Section id="wealth-composition" title="ثروت شما از چه تشکیل شده است؟">
        {buckets.length === 0 ? (
          <EmptyState icon="portfolio" title="دارایی‌ای ثبت نشده است" body="با افزودن دارایی، ترکیب ثروت شما اینجا نمایش داده می‌شود." />
        ) : (
          <div>
            <div className="comp-bar mb-4" role="img" aria-label="ترکیب ثروت">
              {buckets.map((b) => (
                <span key={b.name} style={{ width: `${(b.value / totalAssets) * 100}%`, background: b.color }} />
              ))}
            </div>
            <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
              {buckets.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0 sm:border-0" style={{ borderColor: "var(--border)" }}>
                  <span className="flex min-w-0 items-center gap-2.5 text-[13px]">
                    <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: b.color }} />
                    <span className="truncate">{b.name}</span>
                    <span className="muted text-[10px]">{b.members.map((m) => m.name).join("، ")}</span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="num text-[13px] font-bold" dir="rtl">
                      {formatMoney(b.value)}
                    </span>
                    <span className="num muted w-10 text-[10.5px]" dir="rtl">
                      {formatPct(((b.value / totalAssets) * 100), 1)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* Attribution */}
      <Section
        id="wealth-growth"
        title="چرا ارزش خالص شما تغییر کرد؟"
        hint={baseline ? `از ${baseline.asOf} تا امروز — برآیند اجزاء با تغییر واقعی برابر است` : "برای تحلیل تغییر، به حداقل دو اسنپ‌شات نیاز است"}
      >
        {baseline ? (
          <ul className="divide-y border-t border-b" style={{ borderColor: "var(--border)" }}>
            {[
              {
                name: "پس‌انداز خالص",
                desc: "درآمد منهای هزینه — سهمی که خودتان ساختید",
                value: savings.toString(),
              },
              {
                name: "کاهش بدهی",
                desc: "اصل بدهی که در این بازه پرداخت شد",
                value: debtReduction.toString(),
              },
              {
                name: "عملکرد بازار و بازارزش‌گذاری",
                desc: "تغییر قیمت دارایی‌ها، سود فروش و اثر نرخ ارز",
                value: marketAndRevaluation.toString(),
              },
            ].map((r) => (
              <li key={r.name} className="flex items-center justify-between gap-4 py-3.5">
                <div className="min-w-0">
                  <p className="text-[13.5px] font-medium">{r.name}</p>
                  <p className="muted text-[11px]">{r.desc}</p>
                </div>
                <span
                  className="num shrink-0 text-[15px] font-bold"
                  dir="rtl"
                  style={{ color: D(r.value).gt(0) ? "var(--positive)" : D(r.value).lt(0) ? "var(--negative)" : "var(--text-2)" }}
                >
                  {D(r.value).gt(0) ? "+" : D(r.value).lt(0) ? "−" : ""}
                  {formatMoney(D(r.value).abs().toString())}
                </span>
              </li>
            ))}
            <li className="flex items-center justify-between gap-4 py-3.5">
              <p className="text-[13.5px] font-bold">مجموع تغییر در این بازه</p>
              <span className="num text-[15px] font-bold" dir="rtl">
                {deltaAbs.gte(0) ? "+" : "−"}
                {formatMoney(deltaAbs.abs().toString())}
              </span>
            </li>
          </ul>
        ) : (
          <div className="card">
            <EmptyState
              icon="snapshot"
              title="تاریخچه کافی برای تحلیل نیست"
              body="با «ثبت اسنپ‌شات امروز» و ادامه ثبت روزانه، تحلیل علت تغییر ثروت ساخته می‌شود."
              action={<RowAction kind="snapshot" label="ثبت اولین اسنپ‌شات" primary />}
            />
          </div>
        )}
      </Section>

      {/* Intelligence strip */}
      <Section id="wealth-performance" title="شاخص‌های سلامت ثروت">
        {growth.calculationStatus === "missing_data" && growth.missingDataWarning ? (
          <Alert tone="warn" title="داده تاریخی محدود است">
            {growth.missingDataWarning}
          </Alert>
        ) : (
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Metric
              label="بازده تعدیل‌شده"
              value={formatPercent(growth.adjustedWealthReturnPercentage)}
              tone={D(growth.adjustedWealthReturnPercentage).gte(0) ? "up" : "down"}
            />
            <Metric
              label="بازده سرمایه‌گذاری خالص"
              value={formatMoney(growth.netInvestmentReturn)}
              tone={D(growth.netInvestmentReturn).gte(0) ? "up" : "down"}
              hint="بدون احتساب واریز/برداشت‌ها"
            />
            <Metric label="بیشترین افت از سقف" value={`−${formatPct(risk.maxDrawdownPercentage, 2)}`} tone={Number(risk.maxDrawdownPercentage) > 15 ? "down" : "neutral"} />
            <Metric label="ریسک رمزارز" value={`${formatPct(risk.cryptoExposurePercentage, 2)}`} hint={`بزرگ‌ترین دارایی: ${risk.largestAssetSymbol}`} />
          </div>
        )}
        {risk.concentrationWarning && (
          <div className="mt-4">
            <Alert tone={risk.riskScore === "critical" ? "neg" : "warn"} title="هشدار تمرکز">
              {risk.concentrationWarning}
            </Alert>
          </div>
        )}
      </Section>
    </div>
  );
}
