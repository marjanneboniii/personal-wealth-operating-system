import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { getRealizedPnl } from "@/features/ledger/queries";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import HoldingsTable from "@/components/assets/HoldingsTable";
import AssetValuationSummary, { valuationTotalsOf } from "@/components/assets/AssetValuationSummary";
import { splitAssetFamilies } from "@/features/portfolio/assetFamilies";
import { D, Decimal } from "@/domain/decimal";
import { formatMoney, formatPct, formatSignedMoney, toIrtMoney, faCount, trendTone } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "دارایی‌های مالی" };

/**
 * دارایی‌ها → دارایی‌های مالی
 *
 * READ MODEL ONLY. Buckets (نقد / رمزارز / سهام / صندوق / سایر) are a
 * PRESENTATION grouping over the existing asset classes returned by
 * `getPortfolioValuation()`. Realised P&L is read from the existing ledger
 * query. Nothing here re-computes cost basis, touches FIFO, or writes state.
 */

/** Map an accounting asset class onto a human product bucket. */
const BUCKET_OF: Record<string, string> = {
  "نقد و بانک": "نقد",
  Cash: "نقد",
  "استیبل‌کوین": "نقد",
  Stablecoin: "نقد",
  "رمزارز": "رمزارز",
  Crypto: "رمزارز",
  "سهام": "سهام",
  Stock: "سهام",
  "صندوق سرمایه‌گذاری": "صندوق",
  Fund: "صندوق",
  ETF: "صندوق",
};

const BUCKET_ORDER = ["نقد", "رمزارز", "سهام", "صندوق", "سایر"] as const;

const BUCKET_ICON: Record<string, IconName> = {
  "نقد": "wallet",
  "رمزارز": "crypto",
  "سهام": "trend-up",
  "صندوق": "layers",
  "سایر": "coins",
};

export default async function FinancialAssetsPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, pnl, fx] = await Promise.all([
    getPortfolioValuation(),
    getRealizedPnl(),
    getLatestUsdIrtRate(),
  ]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const { financial } = splitAssetFamilies(valuation.assetValuations);

  const buckets = new Map<string, typeof financial>();
  for (const a of financial) {
    const key = BUCKET_OF[a.className] ?? "سایر";
    buckets.set(key, [...(buckets.get(key) ?? []), a]);
  }
  const ordered = BUCKET_ORDER.filter((b) => buckets.has(b)).map((b) => ({
    name: b,
    icon: BUCKET_ICON[b],
    rows: buckets.get(b)!,
    value: Decimal.sum(buckets.get(b)!.map((a) => a.currentValue)),
  }));

  // The strip on the summary card and the «ارزش‌گذاری دارایی‌ها» box below are
  // fed by ONE set of totals, so a figure is never stated twice with two
  // different numbers (Toman-canonical value/cost/P&L; USD stays the read
  // model's own figure, never a Toman amount re-scaled at today's rate).
  const totals = valuationTotalsOf(financial);
  const totalValue = D(totals.valueUsd);
  const financialSymbols = new Set(financial.map((a) => a.symbol));
  const realized = Decimal.sum(pnl.bySymbol.filter((p) => financialSymbols.has(p.symbol)).map((p) => p.pnl));

  return (
    <div className="space-y-8">
      <PageHeader
        title="دارایی‌های مالی"
        subtitle="نقد، رمزارز، سهام و صندوق — ارزش روز از ارزش‌گذاری موجود و بهای تمام‌شده از سوابق مالی خوانده می‌شود."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/crypto" className="btn btn-ghost">
              <Icon name="crypto" size={16} />
              رمزارزها
            </Link>
            <Link href="/assets" className="btn btn-soft">
              <Icon name="layers" size={16} />
              همه دارایی‌ها
            </Link>
          </div>
        }
      />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="ارزش روز" value={formatMoney(totals.valueToman, "IRT")} hint={formatMoney(totals.valueUsd, "USD")} />
        <Metric label="بهای تمام‌شده" value={formatMoney(totals.costToman, "IRT")} hint={formatMoney(totals.costUsd, "USD")} />
        <Metric label="سود/زیان تحقق‌نیافته" value={formatSignedMoney(totals.pnlToman, "IRT")} tone={trendTone(totals.pnlToman)} hint={formatSignedMoney(totals.pnlUsd, "USD")} />
        <Metric label="سود/زیان تحقق‌یافته" value={toIrt(realized.toString()) ?? formatMoney(realized.toString())} tone={trendTone(realized.toString())} hint="از فروش‌های ثبت‌شده" />
      </section>

      <AssetValuationSummary
        totals={totals}
        hint={`برای ${faCount(financial.length)} دارایی مالی · تومان ملاک محاسبه، دلار معادل نمایشی`}
      />

      {ordered.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="coins"
            title="دارایی مالی‌ای ثبت نشده است"
            body="با ثبت موجودی اولیه یا اولین خرید، نقد، رمزارز و صندوق‌های شما اینجا دیده می‌شوند."
            action={
              <Link href="/new?type=buy" className="btn btn-primary">
                ثبت خرید دارایی
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Section title="ترکیب دارایی‌های مالی">
            <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
              {ordered.map((b) => (
                <li key={b.name} className="card p-4">
                  <span className="flex items-center gap-2">
                    <span style={{ color: "var(--brand)" }}>
                      <Icon name={b.icon} size={16} />
                    </span>
                    <span className="text-[12.5px] font-semibold">{b.name}</span>
                  </span>
                  <p className="num mt-2.5 text-lg font-bold" dir="rtl">
                    {toIrt(b.value.toString()) ?? formatMoney(b.value.toString())}
                  </p>
                  {fx.rate && (
                    <p className="muted num text-[9.5px]" dir="rtl">
                      ≈ {formatMoney(b.value.toString())}
                    </p>
                  )}
                  <p className="muted num text-[10.5px]" dir="rtl">
                    {faCount(b.rows.length)} دارایی ·{" "}
                    {formatPct(totalValue.isZero() ? "0.0" : b.value.div(totalValue).mul(100).toFixed(1), 1)}
                  </p>
                </li>
              ))}
            </ul>
          </Section>

          {ordered.map((b) => (
            <Section key={b.name} title={b.name} hint={`${faCount(b.rows.length)} دارایی · ${toIrt(b.value.toString()) ?? formatMoney(b.value.toString())}${fx.rate ? ` ≈ ${formatMoney(b.value.toString())}` : ""}`}>
              <HoldingsTable rows={b.rows} toIrt={toIrt} />
            </Section>
          ))}
        </>
      )}

      <p className="muted flex items-center gap-1.5 text-[11px]">
        <Icon name="info" size={13} />
        قیمت‌های بازار فقط داده مرجع برای ارزش‌گذاری‌اند؛ هرگز تاریخچه تراکنش، بهای تمام‌شده یا سود محقق‌شده را تغییر
        نمی‌دهند.
      </p>
    </div>
  );
}
