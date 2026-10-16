import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { listPropertyEconomics, type PropertyEconomics } from "@/features/properties/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { ASSET_TABS } from "@/components/ui/ModuleTabs";
import ModuleHeader from "@/components/money/ModuleHeader";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatMoney, formatPct, formatSignedMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "اجاره و بازده املاک" };

/**
 * اجاره و بازده — what each property earns over the last 12 months. Rent and
 * costs come from the transactions linked to the property; the link itself
 * stays out of sight («ثبت اجاره» / «ثبت هزینه» attach it).
 */
function PropertyCard({ p }: { p: PropertyEconomics }) {
  const net = D(p.net12);
  const q = (params: Record<string, string>) => `/new?${new URLSearchParams(params).toString()}`;
  const negYield = p.netYield != null && D(p.netYield).isNegative();
  return (
    <li className="card rwa-card">
      <header className="rwa-card-head">
        <span className="rwa-card-icon" aria-hidden="true">
          <Icon name="home" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="rwa-card-title">{p.label}</h3>
          {p.valueToman && (
            <p className="rwa-card-sub">
              ارزش روز <span className="num money-nowrap" dir="rtl">{formatMoney(p.valueToman, "IRT")}</span>
            </p>
          )}
        </div>
        {p.netYield != null && (
          <div className="rwa-yield" data-neg={negYield || undefined}>
            <b className="num">{formatPct(p.netYield, 1)}</b>
            <span>بازده خالص سالانه</span>
          </div>
        )}
      </header>

      <dl className="rwa-figs">
        <div>
          <dt>اجاره‌ی ۱۲ ماه</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: D(p.rent12).gt(0) ? "var(--positive)" : undefined }}>
            {formatMoney(p.rent12, "IRT")}
          </dd>
        </div>
        <div>
          <dt>هزینه‌ی ۱۲ ماه</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: D(p.costs12).gt(0) ? "var(--negative)" : undefined }}>
            {formatMoney(p.costs12, "IRT")}
          </dd>
        </div>
        <div>
          <dt>خالص</dt>
          <dd className="num money-nowrap" dir="rtl" style={{ color: net.isNegative() ? "var(--negative)" : net.gt(0) ? "var(--positive)" : undefined }}>
            {formatSignedMoney(p.net12, "IRT")}
          </dd>
        </div>
        {p.grossYield != null && (
          <div>
            <dt>بازده ناخالص</dt>
            <dd className="num">{formatPct(p.grossYield, 1)}</dd>
          </div>
        )}
      </dl>

      <footer className="rwa-actions">
        <Link href={q({ type: "income", tags: `#${p.tag}` })} className="btn btn-soft">
          <Icon name="arrow-down" size={14} />
          ثبت اجاره
        </Link>
        <Link href={q({ type: "expense", tags: `#${p.tag}` })} className="btn btn-ghost">
          <Icon name="arrow-up" size={14} />
          ثبت هزینه
        </Link>
        <Link href={`/transactions?${new URLSearchParams({ tag: p.tag, range: "all" }).toString()}`} className="expense-link rwa-more">
          همه‌ی تراکنش‌ها
          <Icon name="arrow-start" size={13} />
        </Link>
      </footer>
    </li>
  );
}

export default async function PropertiesPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="اجاره و بازده املاک" />
        <div className="card">
          <EmptyState icon="lock" title="وارد شوید" />
        </div>
      </div>
    );
  }
  const list = await listPropertyEconomics(userId, todayIso());
  const rent = Decimal.sum(list.map((p) => p.rent12));
  const costs = Decimal.sum(list.map((p) => p.costs12));
  const net = rent.sub(costs);
  return (
    <div className="mny-page">
      <ModuleHeader title="اجاره و بازده املاک" tabs={ASSET_TABS} active="/asset-registry" label="بخش‌های دارایی" />
      {list.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="home"
            title="ملکی ثبت نشده است"
            action={
              <Link href="/asset-registry#real-estate" className="btn btn-soft">
                ثبت ملک
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <section className="mny-stats" style={{ ["--mny-cols" as string]: 4 }} aria-label="خلاصهٔ ۱۲ ماه املاک">
            <StatCard
              tone="ink"
              className="mny-stat-lead"
              icon="home"
              label="خالص ۱۲ ماه"
              period={`${faCount(list.length)} ملک`}
              value={<FormattedMoney value={formatSignedMoney(net.toFixed(0), "IRT")} />}
            />
            <StatCard icon="arrow-down" label="اجاره‌ی ۱۲ ماه" value={<FormattedMoney value={formatMoney(rent.toFixed(0), "IRT")} />} />
            <StatCard icon="arrow-up" label="هزینه‌ی ۱۲ ماه" value={<FormattedMoney value={formatMoney(costs.toFixed(0), "IRT")} />} />
          </section>
          <Section title="املاک">
            <ul className="rwa-list">
              {list.map((p) => (
                <PropertyCard key={p.id} p={p} />
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}
