import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import {
  getFirstSnapshotAfter,
  getLiabilitiesTotal,
  getNetSavingsBetween,
  getSnapshotAsOf,
  getSnapshotSeries,
} from "@/features/ledger/queries";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { getAnalyticsSummary } from "@/features/analytics/service";
import { Alert, Delta, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import NetWorthChart from "@/components/charts/NetWorthChart";
import RowAction from "@/components/RowAction";
import { D } from "@/domain/decimal";
import { formatJalaliIso, formatMoney, formatPct, formatPercent, formatSignedMoneyFromUsd, todayIso, toIrtMoney, trendColor, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "ارزش خالص" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const RANGES = [
  { key: "1M", label: "۱ ماه", months: 1 },
  { key: "3M", label: "۳ ماه", months: 3 },
  { key: "6M", label: "۶ ماه", months: 6 },
  { key: "YTD", label: "امسال" },
  { key: "1Y", label: "۱ سال", months: 12 },
  { key: "ALL", label: "همه" },
] as const;

const ASSET_CLASS_TOKENS: Record<string, string> = {
  نقد: "var(--asset-cash)",
  سرمایه‌گذاری: "var(--asset-investment)",
  رمزارز: "var(--asset-crypto)",
  "سایر دارایی‌ها": "var(--asset-other)",
};

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
    استیبل‌کوین: "نقد",
    "صندوق سرمایه‌گذاری": "سرمایه‌گذاری",
    رمزارز: "رمزارز",
  };
  for (const c of byClass) {
    const b = map[c.className] ?? "سایر دارایی‌ها";
    const cur = buckets.get(b) ?? { value: 0, members: [] };
    cur.value += Number(c.value);
    cur.members.push({ name: c.className, value: Number(c.value) });
    buckets.set(b, cur);
  }
  const order = ["نقد", "سرمایه‌گذاری", "رمزارز", "سایر دارایی‌ها"];
  return order
    .filter((k) => buckets.has(k))
    .map((k) => ({
      name: k,
      color: ASSET_CLASS_TOKENS[k],
      value: buckets.get(k)!.value,
      members: buckets.get(k)!.members,
    }));
}

/**
 * ارزش خالص — one hero figure, then the three questions about it:
 * چرا تغییر کرد؟ · از چه تشکیل شده؟ · چقدر سالم است؟
 *
 * Presentation only: every figure comes from the same read model as before
 * (snapshots, portfolio valuation, analytics) and nothing here writes.
 */
export default async function NetWorthPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await ensureAuth();
  await seedIfEmpty();
  const userId = (user as { id?: string } | null)?.id;
  const sp = await searchParams;
  const range = RANGES.some((r) => r.key === sp.range) ? (sp.range as string) : "6M";
  const today = todayIso();
  const from = fromDateFor(range, today);

  const [nw, snaps, analytics, fx] = await Promise.all([
    getCurrentNetWorth(userId),
    // Snapshot history is tenant-scoped — never read another account's rows.
    getSnapshotSeries(420, userId),
    // Analytics is tenant-scoped: the authenticated user's id is passed
    // explicitly so growth/risk/timeline/capital-flows can never blend tenants.
    getAnalyticsSummary(userId),
    getLatestUsdIrtRate(),
  ]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const baseline =
    (await getSnapshotAsOf(from, userId)) ?? (await getFirstSnapshotAfter(from, userId)) ?? null;
  const liabilitiesNow = await getLiabilitiesTotal(userId);

  const nwNow = D(nw.netWorth);
  const deltaAbs = baseline ? nwNow.sub(baseline.netWorth) : D("0");
  const deltaPct = baseline && !D(baseline.netWorth).isZero() ? deltaAbs.div(baseline.netWorth).abs().mul(100).toFixed(2) : null;

  const series = [...snaps]
    .reverse()
    .filter((s) => (range === "ALL" ? true : s.asOf >= from))
    .map((s) => ({ date: s.asOf, value: Number(s.netWorth) }));
  if (baseline && !series.find((p) => p.date === baseline.asOf) && baseline.asOf >= from) {
    series.unshift({ date: baseline.asOf, value: Number(baseline.netWorth) });
    series.sort((a, b) => a.date.localeCompare(b.date));
  }
  series.push({ date: today, value: Number(nw.netWorth) });

  const savings = baseline ? D(await getNetSavingsBetween(baseline.asOf, today, userId)) : D("0");
  const debtReduction = baseline ? D(baseline.totalLiabilities).sub(liabilitiesNow) : D("0");
  const marketAndRevaluation = deltaAbs.sub(savings).sub(debtReduction);

  const buckets = bucketize(nw.byClass);
  const totalAssets = buckets.reduce((s, b) => s + b.value, 0) || 1;

  const { risk, growth } = analytics;
  const attrRows = [
    { name: "پس‌انداز", desc: "درآمد منهای هزینه", value: savings.toString() },
    { name: "کاهش بدهی", desc: "اصل بدهی که در این بازه پرداخت شد", value: debtReduction.toString() },
    { name: "بازده بازار", desc: "تغییر قیمت دارایی‌ها، سود فروش و اثر نرخ ارز", value: marketAndRevaluation.toString() },
  ];
  const maxMag = Math.max(...attrRows.map((r) => Math.abs(Number(r.value))), Math.abs(Number(deltaAbs.toString())), 1);

  return (
    <div className="space-y-5">
      <PageHeader
        title="ارزش خالص"
        subtitle="هرچه دارید منهای هرچه بدهکارید — و اینکه چرا این عدد تغییر کرده است."
        action={<RowAction kind="snapshot" label="ثبت اسنپ‌شات امروز" />}
      />

      {/* ── Hero: the figure, its change, the range and the curve ── */}
      <section className="card expense-card">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="expense-sub">ارزش خالص فعلی</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
              <span className="money-hero text-[26px] font-bold leading-[1.15] tracking-tight money-nowrap sm:text-[30px]" dir="rtl">
                {fx.rate ? formatMoney(nw.netWorthToman, "IRT") : formatMoney(nw.netWorth)}
              </span>
              {baseline ? (
                <Delta value={deltaAbs.toString()} pct={deltaPct} />
              ) : (
                <span className="expense-sub">تاریخچه‌ای برای این بازه ساخته نشده است</span>
              )}
            </div>
            <p className="expense-sub mt-1.5 flex flex-wrap items-center gap-x-2">
              {fx.rate && (
                <span className="money-nowrap">
                  ≈ <span className="num">{formatMoney(nw.netWorth)}</span>
                  <span className="mx-1 opacity-50">·</span>
                </span>
              )}
              <span className="money-nowrap">
                دارایی {formatMoney(nw.totalAssets)} <span className="opacity-50">−</span> بدهی{" "}
                {formatMoney(D(nw.totalLiabilities).neg().toString())}
              </span>
            </p>
          </div>

          <div className="seg shrink-0 self-start" role="group" aria-label="بازه زمانی">
            {RANGES.map((r) => (
              <Link
                key={r.key}
                href={`/net-worth?range=${r.key}`}
                className={range === r.key ? "seg-on" : ""}
                aria-current={range === r.key ? "true" : undefined}
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>

        <p className="sr-only">
          {deltaPct
            ? `ارزش خالص در این بازه ${deltaPct} درصد ${deltaAbs.gte(0) ? "افزایش" : "کاهش"} یافته است.`
            : "تاریخچه کافی برای توصیف روند ارزش خالص وجود ندارد."}
        </p>

        <NetWorthChart data={series} height={200} />
      </section>

      {/* ── Why it changed ── */}
      <Section
        id="wealth-growth"
        title="چرا ارزش خالص شما تغییر کرد؟"
        hint={
          baseline
            ? `از ${formatJalaliIso(baseline.asOf)} تا امروز — برآیند اجزاء با تغییر واقعی برابر است`
            : "برای تحلیل تغییر، به حداقل دو اسنپ‌شات نیاز است"
        }
      >
        {baseline ? (
          <ul className="card plan-list">
            {attrRows.map((r) => {
              const n = Number(r.value);
              const pos = n > 0;
              const neg = n < 0;
              return (
                <li key={r.name} className="plan-row">
                  <div className="plan-row-head">
                    <span className="min-w-0">
                      <b className="block text-[length:var(--fs-sm)]">{r.name}</b>
                      <span className="expense-sub block">{r.desc}</span>
                    </span>
                    <span
                      className="shrink-0 text-left"
                      dir="rtl"
                      style={{ color: pos ? "var(--positive)" : neg ? "var(--negative)" : "var(--text-2)" }}
                    >
                      <span className="num plan-amount block money-nowrap">{formatSignedMoneyFromUsd(r.value, fx.rate)}</span>
                      {fx.rate && (
                        <span className="muted num block text-[length:var(--fs-xs)] money-nowrap">
                          ≈ {formatMoney(D(r.value).abs().toString())}
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="attr-meter" aria-hidden="true">
                    <i
                      style={{
                        width: `${Math.min(100, (Math.abs(n) / maxMag) * 100)}%`,
                        background: pos ? "var(--positive)" : neg ? "var(--negative)" : "var(--text-3)",
                      }}
                    />
                  </div>
                </li>
              );
            })}
            <li className="plan-row">
              <div className="plan-row-head">
                <b className="text-[length:var(--fs-sm)]">مجموع تغییر</b>
                <span className="shrink-0 text-left" dir="rtl" style={{ color: trendColor(deltaAbs.toString()) }}>
                  <span className="num plan-amount block money-nowrap">
                    {formatSignedMoneyFromUsd(deltaAbs.toString(), fx.rate)}
                  </span>
                  {fx.rate && (
                    <span className="muted num block text-[length:var(--fs-xs)] money-nowrap">
                      ≈ {formatMoney(deltaAbs.abs().toString())}
                    </span>
                  )}
                </span>
              </div>
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

      {/* ── What it is made of ── */}
      <Section id="wealth-composition" title="ثروت شما از چه تشکیل شده است؟">
        {buckets.length === 0 ? (
          <div className="card">
            <EmptyState icon="portfolio" title="دارایی‌ای ثبت نشده است" body="با افزودن دارایی، ترکیب ثروت شما اینجا نمایش داده می‌شود." />
          </div>
        ) : (
          <div className="card expense-card">
            <div className="comp-bar" role="img" aria-label="ترکیب ثروت">
              {buckets.map((b) => (
                <span key={b.name} style={{ width: `${(b.value / totalAssets) * 100}%`, background: b.color }} />
              ))}
            </div>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {buckets.map((b) => (
                <li key={b.name} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0" style={{ borderColor: "var(--border)" }}>
                  <span className="flex min-w-0 items-center gap-2.5 text-[length:var(--fs-sm)]">
                    <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: b.color }} />
                    <span className="min-w-0">
                      <span className="block truncate">{b.name}</span>
                      <span className="expense-sub block truncate">{b.members.map((m) => m.name).join("، ")}</span>
                    </span>
                  </span>
                  <span className="flex shrink-0 items-baseline gap-2">
                    <span className="flex flex-col items-end">
                      <span className="num text-[length:var(--fs-sm)] font-bold money-nowrap" dir="rtl">
                        {toIrt(b.value) ?? formatMoney(b.value)}
                      </span>
                      {fx.rate && (
                        <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                          ≈ {formatMoney(b.value)}
                        </span>
                      )}
                    </span>
                    <span className="num muted w-10 text-[length:var(--fs-xs)]" dir="rtl">
                      {formatPct((b.value / totalAssets) * 100, 1)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>

      {/* ── How healthy it is ── */}
      <Section id="wealth-performance" title="شاخص‌های سلامت ثروت">
        {growth.calculationStatus === "missing_data" && growth.missingDataWarning ? (
          <Alert tone="warn" title="داده تاریخی محدود است">
            {growth.missingDataWarning}
          </Alert>
        ) : (
          <section className="metric-strip">
            <Metric
              label="بازده تعدیل‌شده"
              value={formatPercent(growth.adjustedWealthReturnPercentage)}
              tone={trendTone(growth.adjustedWealthReturnPercentage)}
            />
            <Metric
              label="بازده سرمایه‌گذاری خالص"
              value={toIrt(growth.netInvestmentReturn) ?? formatMoney(growth.netInvestmentReturn)}
              tone={trendTone(growth.netInvestmentReturn)}
              hint={fx.rate ? `≈ ${formatMoney(growth.netInvestmentReturn)} · بدون واریز و برداشت` : "بدون واریز و برداشت"}
            />
            <Metric
              label="بیشترین افت از سقف"
              value={formatPercent(D(risk.maxDrawdownPercentage).abs().neg().toString())}
              tone={Number(risk.maxDrawdownPercentage) > 15 ? "down" : "neutral"}
            />
            <Metric
              label="ریسک رمزارز"
              value={formatPct(risk.cryptoExposurePercentage, 2)}
              hint={`بزرگ‌ترین دارایی: ${risk.largestAssetSymbol}`}
            />
          </section>
        )}
        {risk.concentrationWarning && (
          <div className="mt-3">
            <Alert tone={risk.riskScore === "critical" ? "neg" : "warn"} title="هشدار تمرکز">
              {risk.concentrationWarning}
            </Alert>
          </div>
        )}
      </Section>
    </div>
  );
}
