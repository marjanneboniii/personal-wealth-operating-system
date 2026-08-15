import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { getCashflow, getLiabilitiesTotal, countUnreviewed } from "@/features/ledger/queries";
import { getFlowByCategory } from "@/features/categories/service";
import { getCurrentNetWorth } from "@/features/portfolio/service";
import { listDebts, projectCashflow } from "@/features/planning/service";
import { Alert, EmptyState, Metric, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatShortDate, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "بینش‌ها" };

/**
 * بینش‌ها — System-driven observations.
 *
 * STRICT READ MODEL (§27, §58, §67):
 *   Read → Analyze → Explain → Alert.
 *
 * This page must never create a journal entry, posting, lot or account
 * mutation, and must never write derived state. It deliberately does NOT call
 * `getAnalyticsSummary()`, because that service appends a row to
 * `analytics_runs` on every invocation — rendering an insight page must not
 * produce writes (§62/§65). All figures come from existing read primitives:
 *   getCurrentNetWorth · getCashflow · getFlowByCategory ·
 *   listDebts · projectCashflow · getLiabilitiesTotal · countUnreviewed
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
  await ensureAuth();
  await seedIfEmpty();

  const [nw, flow, categories, debts, projection, liabilities, unreviewed] = await Promise.all([
    getCurrentNetWorth(),
    getCashflow(6),
    getFlowByCategory(3),
    listDebts(),
    projectCashflow(12),
    getLiabilitiesTotal(),
    countUnreviewed(),
  ]);

  const today = todayIso();

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
  const runwayMonths = avgOutflow.isZero() ? null : liquid.div(avgOutflow);

  // Savings rate over the window
  const totalIn = Decimal.sum(flow.map((f) => f.inflow));
  const totalOut = Decimal.sum(flow.map((f) => f.outflow));
  const savingsRate = totalIn.isZero() ? Decimal.zero() : totalIn.sub(totalOut).div(totalIn).mul(100);

  const liquidShare = totalAssets.isZero() ? Decimal.zero() : liquid.div(totalAssets).mul(100);

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
      title: `${overdue.length} قسط سررسید گذشته دارید`,
      body: `مجموع ${formatMoney(Decimal.sum(overdue.map((i) => i.amountBase)).toString())} در انتظار پرداخت است.`,
      href: "/debts/installments",
      action: "مشاهده اقساط",
    });
  }

  if (debtRatio.gt("50")) {
    insights.push({
      tone: "warn",
      icon: "scale",
      title: "نسبت بدهی به دارایی بالاست",
      body: `بدهی‌های شما ${debtRatio.toFixed(1)}٪ از کل دارایی‌ها را تشکیل می‌دهند. کاهش این نسبت، انعطاف مالی شما را بیشتر می‌کند.`,
      href: "/debts",
      action: "مدیریت بدهی",
    });
  }

  if (runwayMonths && runwayMonths.lt("3")) {
    insights.push({
      tone: "warn",
      icon: "wallet",
      title: "ذخیره نقدی کمتر از سه ماه است",
      body: `با میانگین هزینه ماهانه فعلی، نقدینگی شما حدود ${runwayMonths.toFixed(1)} ماه دوام می‌آورد.`,
      href: "/accounts",
      action: "بررسی حساب‌ها",
    });
  }

  if (topClass && Number(topClass.share) > 60) {
    insights.push({
      tone: "warn",
      icon: "pie",
      title: "تمرکز دارایی بالاست",
      body: `${Number(topClass.share).toFixed(1)}٪ از دارایی‌های شما در «${topClass.className}» است. تمرکز زیاد، نوسان ثروت را بیشتر می‌کند.`,
      href: "/portfolio",
      action: "بررسی سبد",
    });
  }

  if (spendDelta && spendDelta.gt("25")) {
    insights.push({
      tone: "warn",
      icon: "trend-up",
      title: "هزینه‌های ماه اخیر جهش داشته است",
      body: `هزینه ماه گذشته نسبت به ماه پیش از آن ${spendDelta.toFixed(0)}٪ بیشتر شده است.`,
      href: "/cash-flow",
      action: "تحلیل جریان نقدی",
    });
  }

  if (unreviewed > 0) {
    insights.push({
      tone: "info",
      icon: "check",
      title: `${unreviewed} رکورد درون‌ریزی‌شده بازبینی نشده است`,
      body: "پیش از اتکا به گزارش‌ها، این رکوردها را تأیید کنید.",
      href: "/transactions?review=unreviewed",
      action: "بازبینی",
    });
  }

  if (savingsRate.gte("20") && !totalIn.isZero()) {
    insights.push({
      tone: "pos",
      icon: "trend-up",
      title: "نرخ پس‌انداز شما سالم است",
      body: `در بازه اخیر ${savingsRate.toFixed(1)}٪ از درآمدتان باقی مانده است.`,
      href: "/net-worth",
      action: "دیدن رشد ثروت",
    });
  }

  return (
    <div className="space-y-9">
      <PageHeader
        title="بینش‌ها"
        subtitle="مشاهدات سیستم از داده‌های شما. این صفحه فقط می‌خواند و تحلیل می‌کند — هیچ سند، مانده یا وضعیت مالی‌ای را تغییر نمی‌دهد."
      />

      {/* ── سلامت مالی ── */}
      <Section id="insights-health" title="سلامت مالی" hint="چهار شاخص کلیدی، مشتق از داده‌های موجود">
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
          <Metric
            label="نسبت بدهی به دارایی"
            value={`${debtRatio.toFixed(1)}٪`}
            tone={debtRatio.gt("50") ? "down" : debtRatio.gt("30") ? "neutral" : "up"}
            hint={formatMoney(totalLiabilities.toString())}
          />
          <Metric
            label="نرخ پس‌انداز"
            value={`${savingsRate.toFixed(1)}٪`}
            tone={savingsRate.gte("15") ? "up" : savingsRate.gte("0") ? "neutral" : "down"}
            hint="بازه ۶ ماه اخیر"
          />
          <Metric
            label="دوام نقدینگی"
            value={runwayMonths ? `${runwayMonths.toFixed(1)} ماه` : "—"}
            tone={runwayMonths ? (runwayMonths.gte("6") ? "up" : runwayMonths.gte("3") ? "neutral" : "down") : "neutral"}
            hint={avgOutflow.isZero() ? "هزینه ثبت‌شده‌ای نیست" : `میانگین هزینه ${formatMoney(avgOutflow.toString())}`}
          />
          <Metric
            label="سهم دارایی نقدشونده"
            value={`${liquidShare.toFixed(1)}٪`}
            tone={liquidShare.gte("15") ? "up" : "neutral"}
            hint={formatMoney(liquid.toString())}
          />
        </div>
      </Section>

      {/* ── هشدارها ── */}
      <Section id="insights-alerts" title="هشدارها" hint="فقط مواردی که واقعاً به تصمیم شما نیاز دارند">
        {insights.length === 0 ? (
          <Alert tone="pos" title="نکته‌ای برای هشدار وجود ندارد">
            بر اساس داده‌های فعلی، هیچ ریسک نقدینگی، تمرکز دارایی یا قسط معوقی شناسایی نشد.
          </Alert>
        ) : (
          <ul className="space-y-2">
            {insights.map((n, i) => {
              const t = TONE_COLOR[n.tone];
              return (
                <li key={i} className="card flex flex-wrap items-start gap-3 p-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: t.bg, color: t.c }}>
                    <Icon name={n.icon} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13.5px] font-semibold">{n.title}</p>
                    <p className="muted mt-0.5 text-[11.5px] leading-5">{n.body}</p>
                  </div>
                  {n.href && (
                    <Link href={n.href} className="btn btn-ghost !min-h-8 !px-3 !py-1 text-[11.5px]">
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
          <ul className="space-y-3">
            {topCategories.map((c) => {
              const shareNum = spendTotal.isZero() ? 0 : D(c.total).div(spendTotal).mul(100).toNumber();
              return (
                <li key={c.categoryId}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[12.5px]">
                    <span className="min-w-0 truncate font-medium">
                      {c.name}
                      {c.parentName && <span className="muted mr-1.5 text-[10px]">· {c.parentName}</span>}
                    </span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <span className="num muted text-[10.5px]" dir="ltr">
                        {shareNum.toFixed(1)}٪
                      </span>
                      <span className="num font-bold" dir="ltr">
                        {formatMoney(c.total)}
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
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {byClass.map((c) => (
              <li key={c.className} className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0" style={{ borderColor: "var(--border)" }}>
                <span className="flex min-w-0 items-center gap-2.5 text-[13px]">
                  <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: c.color }} />
                  <span className="truncate">{c.className}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="num text-[13px] font-bold" dir="ltr">
                    {formatMoney(c.value)}
                  </span>
                  <span className="num muted w-10 text-[10.5px]" dir="ltr">
                    {Number(c.share).toFixed(1)}٪
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <p className="muted flex items-center gap-1.5 text-[11px]">
        <Icon name="info" size={13} />
        بینش‌ها مشتق از سوابق مالی موجودند و هرگز آن را تغییر نمی‌دهند. برای دیدن اثر حسابداری هر رویداد، به «سوابق مالی»
        مراجعه کنید.
      </p>
    </div>
  );
}
