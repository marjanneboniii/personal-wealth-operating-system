import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import HoldingsTable from "@/components/assets/HoldingsTable";
import AssetValuationSummary, { valuationTotalsOf } from "@/components/assets/AssetValuationSummary";
import { splitAssetFamilies } from "@/features/portfolio/assetFamilies";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatNumber, formatPct, formatSignedMoney, faCount, toIrtMoney, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "همه دارایی‌ها" };

/**
 * دارایی‌ها → همه دارایی‌ها
 *
 * READ MODEL ONLY (§60, §69). Everything here is derived from the existing
 * `getPortfolioValuation()` output — the same valuation the Portfolio page
 * consumes. This page:
 *   • creates no journal entry, posting, lot or account mutation,
 *   • holds no asset state of its own,
 *   • never re-prices anything itself.
 *
 * It separates "view an asset" from "perform a financial operation": every
 * action link routes into the existing, validated transaction workflow.
 */

/** Product classification of an asset class — presentation grouping only. */
export default async function AssetsPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, fx] = await Promise.all([getPortfolioValuation(), getLatestUsdIrtRate()]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const all = valuation.assetValuations;
  // مالی/واقعی are a product grouping over the SAME read-model rows — one
  // definition for every asset view (src/features/portfolio/assetFamilies).
  const { financial, real } = splitAssetFamilies(all);

  const financialValue = Decimal.sum(financial.map((a) => a.currentValue));
  const realValue = Decimal.sum(real.map((a) => a.currentValue));
  const totalValue = D(valuation.totalNetWorth);
  // THE ONE VALUATION SOURCE for this view. The summary card and the
  // «ارزش‌گذاری دارایی‌ها» box below read the same Toman-canonical figures, so
  // the page can never state a value twice with two different numbers (the old
  // strip scaled the USD aggregate by TODAY's rate while the table showed the
  // stored Toman — they disagreed for every Toman-anchored asset).
  const totals = valuationTotalsOf(all);

  const share = (v: Decimal) =>
    formatNumber(totalValue.isZero() ? "0.0" : v.div(totalValue).mul(100).toFixed(1), { decimals: 1 });

  const families: { label: string; icon: IconName; href: string; count: number; value: string; hint: string }[] = [
    {
      label: "دارایی‌های مالی",
      icon: "coins",
      href: "/assets/financial",
      count: financial.length,
      value: financialValue.toString(),
      hint: "نقد، رمزارز، سهام، صندوق و سایر",
    },
    {
      label: "دارایی‌های واقعی",
      icon: "home",
      href: "/asset-registry",
      count: real.length,
      value: realValue.toString(),
      hint: "املاک، خودرو، طلا و سایر دارایی‌های واقعی",
    },
    {
      label: "سبد دارایی",
      icon: "pie",
      href: "/portfolio",
      count: all.length,
      value: totalValue.toString(),
      hint: "تحلیل ترکیب، عملکرد و سود/زیان",
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="همه دارایی‌ها"
        subtitle="یک فهرست واحد از هرچه دارید. ارزش‌ها از ارزش‌گذاری موجود مشتق می‌شوند و این صفحه هیچ سندی ثبت نمی‌کند."
        action={
          <Link href="/new?type=buy" className="btn btn-primary">
            <Icon name="plus" size={16} />
            ثبت خرید دارایی
          </Link>
        }
      />

      <section className="grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش کل دارایی‌ها" value={formatMoney(totals.valueToman, "IRT")} hint={formatMoney(totals.valueUsd, "USD")} />
        <Metric label="تعداد دارایی" value={faCount(all.length)} hint={`${faCount(financial.length)} مالی · ${faCount(real.length)} واقعی`} />
        <Metric
          label="سود/زیان تحقق‌نیافته"
          value={formatSignedMoney(totals.pnlToman, "IRT")}
          tone={trendTone(totals.pnlToman)}
          hint={formatSignedMoney(totals.pnlUsd, "USD")}
        />
        {/* Price status reports EXCEPTIONS only. A fresh price is the normal
            case, so the «… تازه» headline is gone from the UI; the counts
            themselves are unchanged in the valuation layer. */}
        <Metric
          label="وضعیت قیمت‌ها"
          value={
            valuation.priceStatus.stale + valuation.priceStatus.unavailable === 0
              ? "بدون اشکال"
              : `${faCount(valuation.priceStatus.stale + valuation.priceStatus.unavailable)} نیازمند بررسی`
          }
          tone={valuation.priceStatus.unavailable > 0 ? "down" : "neutral"}
          hint={`${faCount(valuation.priceStatus.stale)} قدیمی · ${faCount(valuation.priceStatus.unavailable)} بدون قیمت`}
        />
      </section>

      <AssetValuationSummary
        totals={totals}
        hint={`برای ${faCount(all.length)} دارایی · تومان ملاک محاسبه، دلار معادل نمایشی`}
      />

      <Section title="دارایی‌های شما در چه خانواده‌هایی هستند؟">
        <ul className="grid gap-2.5 sm:grid-cols-3">
          {families.map((f) => (
            <li key={f.href}>
              <Link href={f.href} className="card interactive-card block p-4 sm:p-5" style={{ touchAction: "manipulation" }}>
                <span className="flex items-center gap-2.5">
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
                    style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
                  >
                    <Icon name={f.icon} size={18} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13.5px] font-semibold">{f.label}</span>
                    <span className="muted block truncate text-[10.5px]">{f.hint}</span>
                  </span>
                </span>
                <span className="mt-3.5 flex items-end justify-between gap-2">
                  <span className="flex flex-col items-start">
                    <span className="num text-lg font-bold" dir="rtl">
                      {toIrt(f.value) ?? formatMoney(f.value)}
                    </span>
                    {fx.rate && (
                      <span className="muted num text-[9.5px]" dir="rtl">
                        ≈ {formatMoney(f.value)}
                      </span>
                    )}
                  </span>
                  <span className="muted num text-[10.5px]" dir="rtl">
                    {faCount(f.count)} مورد
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="ترکیب بر اساس کلاس دارایی" hint="مستقیماً از ارزش‌گذاری جاری">
        {valuation.allocationByClass.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="portfolio"
              title="هنوز دارایی‌ای ثبت نشده است"
              body="با ثبت اولین خرید یا موجودی اولیه، ترکیب دارایی‌های شما اینجا ساخته می‌شود."
              action={
                <Link href="/new?type=buy" className="btn btn-primary">
                  ثبت خرید دارایی
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            {valuation.allocationByClass.map((c) => (
              <li
                key={c.className}
                className="flex items-center justify-between gap-3 border-b py-2.5 last:border-0"
                style={{ borderColor: "var(--border)" }}
              >
                <span className="flex min-w-0 items-center gap-2.5 text-[13px]">
                  <i className="h-2.5 w-2.5 shrink-0 rounded-[4px]" style={{ background: c.color }} />
                  <span className="truncate">{c.className}</span>
                </span>
                <span className="flex shrink-0 items-baseline gap-2">
                  <span className="flex flex-col items-end">
                    <span className="num text-[12px] sm:text-[13px] font-bold money-nowrap" dir="rtl">
                      {toIrt(c.value) ?? formatMoney(c.value)}
                    </span>
                    {fx.rate && (
                      <span className="muted num text-[9.5px]" dir="rtl">
                        ≈ {formatMoney(c.value)}
                      </span>
                    )}
                  </span>
                  <span className="num muted w-10 text-[10.5px]" dir="rtl">
                    {formatPct(Number(c.percentage), 1)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {all.length > 0 && (
        <Section
          title="فهرست کامل دارایی‌ها"
          hint={`${faCount(all.length)} دارایی · ${faCount(share(financialValue))}٪ مالی، ${faCount(share(realValue))}٪ واقعی`}
        >
          <HoldingsTable rows={all} toIrt={toIrt} />
        </Section>
      )}

      <p className="muted flex items-center gap-1.5 text-[11px]">
        <Icon name="info" size={13} />
        این صفحه فقط نمایشی است. هر عملیات مالی (خرید، فروش، انتقال) از مسیر ثبت تراکنش عبور می‌کند تا اثر آن در سوابق
        مالی ثبت شود.
      </p>
    </div>
  );
}
