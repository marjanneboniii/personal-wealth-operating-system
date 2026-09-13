import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { getPortfolioValuation } from "@/features/portfolio/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { ASSET_TABS } from "@/components/ui/ModuleTabs";
import HoldingsTable from "@/components/assets/HoldingsTable";
import AllocationBar from "@/components/assets/AllocationBar";
import AssetValuationSummary, { valuationTotalsOf } from "@/components/assets/AssetValuationSummary";
import { splitAssetFamilies } from "@/features/portfolio/assetFamilies";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatMoney, formatPct, toIrtMoney } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "همه دارایی‌ها" };

/**
 * دارایی‌ها → همه دارایی‌ها
 *
 * READ MODEL ONLY. Everything here is derived from `getPortfolioValuation()` —
 * the same valuation the Portfolio page consumes. No journal entry, lot or
 * account is touched, and nothing is re-priced here.
 */
export default async function AssetsPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [valuation, fx] = await Promise.all([getPortfolioValuation(), getLatestUsdIrtRate()]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const all = valuation.assetValuations;
  const { financial, real } = splitAssetFamilies(all);
  // ONE valuation source: the summary and the table read the same
  // Toman-canonical rows, so a figure is never stated twice with two numbers.
  const totals = valuationTotalsOf(all);

  // Per-class Toman is summed from the rows themselves. The class aggregate
  // only carries USD, and scaling that by today's rate disagreed with the
  // table for every Toman-anchored asset (ملک، خودرو، نقد تومانی).
  const tomanByClass = new Map<string, Decimal>();
  for (const a of all) {
    tomanByClass.set(a.className, (tomanByClass.get(a.className) ?? Decimal.zero()).add(D(a.currentValueToman)));
  }
  const slices = valuation.allocationByClass.map((c) => {
    const toman = tomanByClass.get(c.className);
    return {
      key: c.className,
      label: c.className,
      percent: Number(c.percentage),
      color: c.color,
      value: toman ? formatMoney(toman.toFixed(0), "IRT") : (toIrt(c.value) ?? formatMoney(c.value)),
    };
  });

  const totalUsd = D(valuation.totalNetWorth);
  const share = (rows: typeof all) =>
    formatPct(totalUsd.isZero() ? "0" : Decimal.sum(rows.map((a) => a.currentValue)).div(totalUsd).mul(100).toFixed(1), 0);
  const priceIssues = valuation.priceStatus.stale + valuation.priceStatus.unavailable;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="دارایی‌ها"
          action={
            <Link href="/new?type=buy" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت خرید
            </Link>
          }
        />
        <ModuleTabs tabs={ASSET_TABS} active="/assets" label="بخش‌های دارایی" />
      </div>

      {all.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="portfolio"
            title="هنوز دارایی‌ای ثبت نشده است"
            action={
              <Link href="/new?type=buy" className="btn btn-soft">
                ثبت اولین خرید
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {priceIssues > 0 && (
              <p className="price-flag">
                <Icon name="alert" size={14} />
                قیمت {faCount(priceIssues)} دارایی به‌روز نیست
              </p>
            )}
            <AssetValuationSummary totals={totals} />
          </div>

          {slices.length > 0 && (
            <Section
              title="ترکیب"
              action={
                financial.length > 0 && real.length > 0 ? (
                  <span className="muted text-[length:var(--fs-xs)]">
                    مالی {share(financial)} · واقعی {share(real)}
                  </span>
                ) : undefined
              }
            >
              <AllocationBar slices={slices} label="ترکیب دارایی‌ها بر اساس کلاس" />
            </Section>
          )}

          <Section
            title="فهرست دارایی‌ها"
            action={<span className="muted num text-[length:var(--fs-xs)]">{faCount(all.length)}</span>}
          >
            <HoldingsTable rows={all} toIrt={toIrt} />
          </Section>
        </>
      )}
    </div>
  );
}
