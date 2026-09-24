import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { getCashflow, getLiabilitiesTotal, countUnreviewed } from "@/features/ledger/queries";
import { getFlowByCategory } from "@/features/categories/service";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { listDebts, projectCashflow } from "@/features/planning/service";
import { computeDebtService, WINDOW_DAYS } from "@/features/planning/debtService";
import { Alert, EmptyState, Metric, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import { D, Decimal } from "@/domain/decimal";
import { formatDaysUntil, formatMoney, formatNumber, formatPct, formatShortDate, todayIso, faCount, toIrtMoney } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { coverageGaps, gapHref, insuranceReminders } from "@/features/insurance/service";
import { reconcileMismatches } from "@/features/reconcile/service";
import { dataCoverage } from "@/features/coverage/service";
import CoverageRing from "@/components/ui/CoverageRing";

export const dynamic = "force-dynamic";

export const metadata = { title: "بینش‌ها" };

/**
 * بینش‌ها — System-driven observations.
 *
 * STRICT READ MODEL (§27, §58, §67):
 *   Read → Analyze → Explain → Alert.
 *
 * This page must never create a journal entry, posting, lot or account
 * mutation, and must never write derived state. It does not call
 * `getAnalyticsSummary()` — that engine is reserved for the wealth page,
 * and run tracking is an explicit mutation (`recordAnalyticsRun` /
 * `fetchAnalyticsSummaryAction`), never a page render. All figures come
 * from existing read primitives:
 *   getCurrentNetWorth · getCashflow · getFlowByCategory ·
 *   listDebts · projectCashflow · getLiabilitiesTotal · countUnreviewed
 * and pure derivations of them (computeDebtService).
 */

type Insight = {
  tone: "pos" | "warn" | "neg" | "info";
  icon: IconName;
  title: string;
  body: string;
  href?: string;
  action?: string;
};

const TONE_COLOR: Record<Insight["tone"], { c: string; bg: string }> = {
  pos: { c: "var(--positive)", bg: "var(--positive-soft)" },
  warn: { c: "var(--warning)", bg: "var(--warning-soft)" },
  neg: { c: "var(--negative)", bg: "var(--negative-soft)" },
  info: { c: "var(--info)", bg: "var(--info-soft)" },
};

export default async function InsightsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  await seedIfEmpty();

  const today = todayIso();
  const [nw, flow, categories, debts, projection, liabilities, unreviewed, fx, gaps, mismatches, coverage, insurance] = await Promise.all([
    getCurrentNetWorth(),
    getCashflow(6),
    getFlowByCategory(3),
    listDebts(),
    projectCashflow(12),
    getLiabilitiesTotal(),
    countUnreviewed(),
    getLatestUsdIrtRate(),
    userId ? coverageGaps(userId).catch(() => []) : Promise.resolve([]),
    userId ? reconcileMismatches(userId).catch(() => []) : Promise.resolve([]),
    userId ? dataCoverage(userId).catch(() => null) : Promise.resolve(null),
    userId ? insuranceReminders(userId, today, today).catch(() => ({ premiums: [], expiring: [] })) : Promise.resolve({ premiums: [], expiring: [] }),
  ]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  /* ── Financial health ─────────────────────────────────────────── */

  const totalAssets = D(nw.totalAssets);
  const totalLiabilities = D(liabilities);
  const liquid = D(nw.liquid);

  // Debt-to-asset ratio
  const debtRatio = totalAssets.isZero() ? Decimal.zero() : totalLiabilities.div(totalAssets).mul(100);

  // Monthly average outflow across the observed window → liquidity runway
  const monthsWithFlow = flow.filter((f) => Number(f.outflow) > 0);
  const avgOutflow = monthsWithFlow.length
    ? Decimal.sum(monthsWithFlow.map((f) => f.outflow)).div(String(monthsWithFlow.length))
    : Decimal.zero();
  // FROZEN Toman average of the same past outflows — valid only when every
  // outflow entry of the window carries its commit-time FX snapshot. A dollar
  // rate change can never move this figure; with partial coverage the UI falls
  // back to the dynamic current-rate equivalent.
  const outflowCovered = monthsWithFlow.length > 0 && monthsWithFlow.every((f) => f.outflowEntries === f.outflowEntriesSnap);
  const avgOutflowToman = outflowCovered
    ? monthsWithFlow.reduce((sum, f) => sum.add(D(f.outflowToman ?? "0")), Decimal.zero()).div(String(monthsWithFlow.length)).toFixed(0)
    : null;
  const runwayMonths = avgOutflow.isZero() ? null : liquid.div(avgOutflow);

  // Savings rate over the window
  const totalIn = Decimal.sum(flow.map((f) => f.inflow));
  const totalOut = Decimal.sum(flow.map((f) => f.outflow));
  const savingsRate = totalIn.isZero() ? Decimal.zero() : totalIn.sub(totalOut).div(totalIn).mul(100);

  const liquidShare = totalAssets.isZero() ? Decimal.zero() : liquid.div(totalAssets).mul(100);

  // Installments vs income — what share of a month's income is already promised.
  const service = computeDebtService({ today, rate: fx.rate, debts, cashflow: flow });
  const serviceRatio = service.ratioPct != null ? D(service.ratioPct) : null;

  /* ── Spending analysis ────────────────────────────────────────── */

  const spendTotal = Decimal.sum(categories.map((c) => c.total));
  const topCategories = [...categories].sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 6);

  // Month-over-month expense movement
  const lastTwo = flow.slice(-2);
  const spendDelta =
    lastTwo.length === 2 && Number(lastTwo[0].outflow) > 0
      ? D(lastTwo[1].outflow).sub(lastTwo[0].outflow).div(lastTwo[0].outflow).mul(100)
      : null;

  /* ── Asset concentration ──────────────────────────────────────── */

  const byClass = [...nw.byClass].sort((a, b) => Number(b.value) - Number(a.value));
  const topClass = byClass[0] ?? null;

  /* ── Alerts (derived, never stored) ───────────────────────────── */

  const insights: Insight[] = [];

  const deficit = projection.points.find((p) => p.deficit);
  if (deficit) {
    insights.push({
      tone: "neg",
      icon: "alert",
      title: "کسری نقدینگی پیش‌بینی می‌شود",
      body: `اگر برنامه‌ها و اقساط طبق زمان‌بندی فعلی پیش بروند، در ${formatShortDate(deficit.month)} نقدینگی شما منفی می‌شود.`,
      href: "/planning",
      action: "دیدن پیش‌بینی",
    });
  }

  const overdue = debts.flatMap((d) => d.installments.filter((i) => i.status === "pending" && i.dueDate < today));
  if (overdue.length > 0) {
    insights.push({
      tone: "neg",
      icon: "clock",
      title: `${faCount(overdue.length)} قسط سررسید گذشته دارید`,
      body: `مجموع ${toIrt(Decimal.sum(overdue.map((i) => i.amountBase)).toString()) ?? formatMoney(Decimal.sum(overdue.map((i) => i.amountBase)).toString())} در انتظار پرداخت است.`,
      href: "/debts/installments",
      action: "مشاهده اقساط",
    });
  }

  if (debtRatio.gt("50")) {
    insights.push({
      tone: "warn",
      icon: "scale",
      title: "نسبت بدهی به دارایی بالاست",
      body: `بدهی‌های شما ${formatPct(debtRatio.toFixed(1), 1)} از کل دارایی‌ها را تشکیل می‌دهند. کاهش این نسبت، انعطاف مالی شما را بیشتر می‌کند.`,
      href: "/debts",
      action: "مدیریت بدهی",
    });
  }

  if (serviceRatio && serviceRatio.gt("40")) {
    insights.push({
      tone: "warn",
      icon: "calendar",
      title: "اقساط سهم بزرگی از درآمد را گرفته است",
      body: `در ${faCount(WINDOW_DAYS)} روز آینده، به‌طور میانگین ${formatPct(serviceRatio.toFixed(0), 0)} از درآمد ماهانه‌تان صرف قسط می‌شود. پیش از بدهی تازه، به این عدد نگاه کنید.`,
      href: "/debts/installments",
      action: "مشاهده اقساط",
    });
  }

  if (runwayMonths && runwayMonths.lt("3")) {
    insights.push({
      tone: "warn",
      icon: "wallet",
      title: "ذخیره نقدی کمتر از سه ماه است",
      body: `با میانگین هزینه ماهانه فعلی، نقدینگی شما حدود ${formatNumber(runwayMonths.toFixed(1), { decimals: 1 })} ماه دوام می‌آورد.`,
      href: "/accounts",
      action: "بررسی حساب‌ها",
    });
  }

  if (topClass && Number(topClass.share) > 60) {
    insights.push({
      tone: "warn",
      icon: "pie",
      title: "تمرکز دارایی بالاست",
      body: `${formatPct(Number(topClass.share), 1)} از دارایی‌های شما در «${topClass.className}» است. تمرکز زیاد، نوسان ثروت را بیشتر می‌کند.`,
      href: "/portfolio",
      action: "بررسی سبد",
    });
  }

  if (spendDelta && spendDelta.gt("25")) {
    insights.push({
      tone: "warn",
      icon: "trend-up",
      title: "هزینه‌های ماه اخیر جهش داشته است",
      body: `هزینه ماه گذشته نسبت به ماه پیش از آن ${formatPct(spendDelta.toFixed(0), 0)} بیشتر شده است.`,
      href: "/cash-flow",
      action: "تحلیل جریان نقدی",
    });
  }

  if (unreviewed > 0) {
    insights.push({
      tone: "info",
      icon: "check",
      title: `${faCount(unreviewed)} رکورد درون‌ریزی‌شده بازبینی نشده است`,
      body: "پیش از اتکا به گزارش‌ها، این رکوردها را تأیید کنید.",
      href: "/transactions?review=unreviewed",
      action: "بازبینی",
    });
  }

  // Books that disagree with the bank make every other figure on this page suspect.
  if (mismatches.length > 0) {
    insights.push({
      tone: "warn",
      icon: "scale",
      title: `موجودی ${faCount(mismatches.length)} حساب با بانک یکی نیست`,
      body: "احتمالاً تراکنشی ثبت نشده است؛ تا تطبیق نشود، مانده‌ها و گزارش‌ها کامل نیستند.",
      href: "/accounts/reconcile",
      action: "تطبیق",
    });
  }

  const uninsuredCars = gaps.filter((g) => g.kind === "vehicle_no_third_party");
  if (uninsuredCars.length > 0) {
    insights.push({
      tone: "neg",
      icon: "shield",
      title: uninsuredCars.length === 1 ? uninsuredCars[0].title : `${faCount(uninsuredCars.length)} خودرو بیمه‌ی شخص ثالث فعال ندارد`,
      body: "رانندگی بدون ثالث جریمه دارد و خسارت طرف مقابل با شماست.",
      // Straight into the form, already set to third-party for that car.
      href: uninsuredCars.length === 1 ? gapHref(uninsuredCars[0]) : "/insurance",
      action: "ثبت بیمه",
    });
  }
  const homeGaps = gaps.filter((g) => g.kind !== "vehicle_no_third_party");
  if (homeGaps.length > 0) {
    insights.push({
      tone: "warn",
      icon: "shield",
      title: homeGaps.length === 1 ? homeGaps[0].title : `${faCount(homeGaps.length)} ملک بیمه‌ی کافی ندارد`,
      body: homeGaps[0].kind === "property_underinsured" ? "هنگام تمدید، سرمایه‌ی بیمه را به ارزش روز برسانید." : "حق بیمه‌ی آتش‌سوزی کسر کوچکی از ارزش ملک است.",
      href: homeGaps.length === 1 ? gapHref(homeGaps[0]) : "/insurance",
      action: homeGaps[0].kind === "property_underinsured" ? "بیمه‌نامه‌ها" : "ثبت بیمه",
    });
  }
  // A policy about to end (or just ended, unrenewed) — the same reminder «بیمه‌نامه‌ها» shows.
  for (const p of insurance.expiring) {
    const days = p.endDate ? Math.round((Date.parse(`${p.endDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000) : 0;
    insights.push({
      tone: days < 0 ? "neg" : "warn",
      icon: "shield",
      title: days < 0 ? `«${p.title}» تمام شده است` : `«${p.title}» ${formatDaysUntil(days)} تمام می‌شود`,
      body: "با تمدید، حق بیمه‌ی دوره‌ی تازه یادآوری می‌شود.",
      href: `/insurance#policy-${p.id}`,
      action: "تمدید",
    });
  }

  if (savingsRate.gte("20") && !totalIn.isZero()) {
    insights.push({
      tone: "pos",
      icon: "trend-up",
      title: "نرخ پس‌انداز شما سالم است",
      body: `در بازه اخیر ${formatPct(savingsRate.toFixed(1), 1)} از درآمدتان باقی مانده است.`,
      href: "/net-worth",
      action: "دیدن رشد ثروت",
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="بینش‌ها"
        subtitle="آنچه داده‌هایتان می‌گوید."
      />

      {/* ── سلامت مالی ── */}
      <section className="metric-strip" id="insights-health">
        <Metric
          label="نسبت بدهی به دارایی"
          value={formatPct(debtRatio.toFixed(1), 1)}
          tone={debtRatio.gt("50") ? "down" : debtRatio.gt("30") ? "neutral" : "up"}
          hint={toIrt(totalLiabilities.toString()) ?? formatMoney(totalLiabilities.toString())}
        />
        <Metric
          label="نسبت اقساط به درآمد"
          value={serviceRatio ? formatPct(serviceRatio.toFixed(1), 1) : "—"}
          tone={serviceRatio ? (serviceRatio.gt("40") ? "down" : serviceRatio.gt("30") ? "neutral" : "up") : "neutral"}
          hint={
            service.monthlyIncomeToman == null
              ? "درآمدی در ۶ ماه اخیر ثبت نشده"
              : service.installmentsInWindow === 0
                ? `قسطی در ${faCount(WINDOW_DAYS)} روز آینده نیست`
                : `قسط ماهانه ${formatMoney(service.monthlyInstallmentsToman, "IRT")} از درآمد ${service.incomeFrozen ? "" : "≈ "}${formatMoney(service.monthlyIncomeToman, "IRT")}`
          }
        />
        <Metric
          label="نرخ پس‌انداز"
          value={formatPct(savingsRate.toFixed(1), 1)}
          tone={savingsRate.gte("15") ? "up" : savingsRate.gte("0") ? "neutral" : "down"}
          hint="بازه ۶ ماه اخیر"
        />
        <Metric
          label="دوام نقدینگی"
          value={runwayMonths ? `${formatNumber(runwayMonths.toFixed(1), { decimals: 1 })} ماه` : "—"}
          tone={runwayMonths ? (runwayMonths.gte("6") ? "up" : runwayMonths.gte("3") ? "neutral" : "down") : "neutral"}
          hint={
            avgOutflow.isZero()
              ? "هزینه ثبت‌شده‌ای نیست"
              : `میانگین هزینه ${avgOutflowToman ? formatMoney(avgOutflowToman, "IRT") : toIrt(avgOutflow.toString()) ?? formatMoney(avgOutflow.toString())}`
          }
        />
        <Metric
          label="سهم دارایی نقدشونده"
          value={formatPct(liquidShare.toFixed(1), 1)}
          tone={liquidShare.gte("15") ? "up" : "neutral"}
          hint={toIrt(liquid.toString()) ?? formatMoney(liquid.toString())}
        />
      </section>

      {/* ── پوشش داده: how much of the picture the numbers above stand on ── */}
      {coverage && coverage.total > 0 && (
        <Section id="data-coverage" title="پوشش داده">
          <div className="card list-card">
            <div className="coverage-head">
              <CoverageRing percent={coverage.percent} size={52} />
              <div className="min-w-0 flex-1">
                <b className="block text-[length:var(--fs-sm)]">
                  {coverage.percent >= 100 ? "داده‌ها کامل است" : `${faCount(coverage.total - coverage.passed)} مورد ناقص`}
                </b>
                <span className="muted block text-[length:var(--fs-xs)]">گزارش‌ها به اندازه‌ی همین داده‌ها دقیق‌اند.</span>
              </div>
            </div>
            <ul role="list">
              {coverage.checks
                .filter((c) => !c.ok)
                .map((c) => (
                  <li key={c.key} className="list-row" style={{ borderTop: "1px solid var(--border)" }}>
                    <span className="flow-icon" aria-hidden="true" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
                      <Icon name={c.icon} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[length:var(--fs-sm)] font-medium">{c.detail ?? c.label}</p>
                    </div>
                    <Link href={c.href} className="btn btn-soft !min-h-9 shrink-0 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
                      {c.action}
                    </Link>
                  </li>
                ))}
            </ul>
            {coverage.passed > 0 && (
              <p className="coverage-done">
                <Icon name="check" size={13} />
                {coverage.checks
                  .filter((c) => c.ok)
                  .map((c) => c.label)
                  .join("، ")}
              </p>
            )}
          </div>
        </Section>
      )}

      {/* ── هشدارها ── */}
      <Section id="insights-alerts" title="هشدارها">
        {insights.length === 0 ? (
          <Alert tone="pos" title="هشداری نیست">
            ریسک نقدینگی، تمرکز دارایی یا قسط معوقی دیده نشد.
          </Alert>
        ) : (
          <ul className="card plan-list">
            {insights.map((n, i) => {
              const t = TONE_COLOR[n.tone];
              return (
                <li key={i} className="plan-queue-row">
                  <span className="plan-icon" style={{ background: t.bg, color: t.c }} aria-hidden="true">
                    <Icon name={n.icon} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block text-[length:var(--fs-sm)]">{n.title}</b>
                    <span className="expense-sub line-clamp-2 block">{n.body}</span>
                  </span>
                  {n.href && (
                    <Link href={n.href} className="btn btn-soft !min-h-9 shrink-0 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
                      {n.action}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── تحلیل هزینه ── */}
      <Section id="insights-spending" title="تحلیل هزینه" hint="سه ماه اخیر، بر اساس دسته‌بندی سند">
        {topCategories.length === 0 ? (
          <div className="card">
            <EmptyState icon="cashflow" title="هزینه‌ای در این بازه ثبت نشده است" body="با ثبت تراکنش‌های هزینه، تحلیل دسته‌بندی اینجا ساخته می‌شود." />
          </div>
        ) : (
          <ul className="card plan-list">
            {topCategories.map((c) => {
              const shareNum = spendTotal.isZero() ? 0 : D(c.total).div(spendTotal).mul(100).toNumber();
              // FROZEN Toman (commit-time snapshot) when every entry of this
              // category is snapshot-covered — never re-derived via the
              // current rate; dynamic «≈» only for legacy rows without a freeze.
              const frozen = c.entries > 0 && c.entries === c.entriesWithSnap && D(c.totalToman).gt(0);
              return (
                <li key={c.categoryId} className="plan-row">
                  <div className="plan-row-head">
                    <span className="plan-row-title">
                      <b className="truncate">{c.name}</b>
                      {c.parentName && <span className="expense-sub shrink-0">· {c.parentName}</span>}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="num muted text-[length:var(--fs-xs)]" dir="rtl">
                        {formatPct(shareNum, 1)}
                      </span>
                      <span className="flex flex-col items-end">
                        <span className="num plan-amount money-nowrap" dir="rtl">
                          {frozen ? formatMoney(c.totalToman, "IRT") : toIrt(c.total) ?? formatMoney(c.total)}
                        </span>
                        {(frozen || fx.rate) && (
                          <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                            ≈ {formatMoney(c.total)}
                          </span>
                        )}
                      </span>
                    </span>
                  </div>
                  <Progress value={shareNum} aria-label={`سهم ${c.name}`} />
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      {/* ── تحلیل دارایی ── */}
      <Section id="insights-assets" title="تحلیل دارایی" hint="تمرکز و پراکندگی ثروت شما">
        {byClass.length === 0 ? (
          <div className="card">
            <EmptyState icon="portfolio" title="دارایی‌ای برای تحلیل نیست" body="با ثبت دارایی، تحلیل تمرکز و ترکیب اینجا ساخته می‌شود." />
          </div>
        ) : (
          <ul className="card plan-list">
            {byClass.map((c) => (
              <li key={c.className} className="plan-queue-row">
                <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: c.color }} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{c.className}</span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="flex flex-col items-end">
                    <span className="num plan-amount money-nowrap" dir="rtl">
                      {toIrt(c.value) ?? formatMoney(c.value)}
                    </span>
                    {fx.rate && (
                      <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                        ≈ {formatMoney(c.value)}
                      </span>
                    )}
                  </span>
                  <span className="num muted w-10 text-[length:var(--fs-xs)]" dir="rtl">
                    {formatPct(Number(c.share), 1)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

    </div>
  );
}
