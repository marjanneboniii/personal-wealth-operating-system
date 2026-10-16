import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { listVehicleOverview, VEHICLE_DUE_HORIZON_DAYS, type VehicleOverview } from "@/features/vehicles/service";
import { listPolicies } from "@/features/insurance/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { ASSET_TABS } from "@/components/ui/ModuleTabs";
import ModuleHeader from "@/components/money/ModuleHeader";
import VehicleDueDates from "@/components/vehicles/VehicleDueDates";
import { D } from "@/domain/decimal";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, formatSignedMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "هزینه و سررسید خودرو" };

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "pos" | "neg" }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="num money-nowrap" dir="rtl" style={tone ? { color: tone === "pos" ? "var(--positive)" : "var(--negative)" } : undefined}>
        {value}
      </dd>
    </div>
  );
}

/**
 * One car: value and what it really costs, its insurance, its due dates and
 * the actions that fit. Costs come from the transactions linked to the car;
 * the link stays out of sight («ثبت هزینه‌ی این خودرو» attaches it).
 */
function VehicleCard({ v, today, cover }: { v: VehicleOverview; today: string; cover: { thirdParty: string | null; body: string | null } }) {
  const change = v.valueChangeToman ? D(v.valueChangeToman) : null;
  const addCost = `/new?${new URLSearchParams({ type: "expense", tags: `#${v.tag}` }).toString()}`;
  const sold = v.status === "sold";
  return (
    <li id={`vehicle-${v.id}`} className="card rwa-card" data-muted={sold || undefined}>
      <header className="rwa-card-head">
        <span className="rwa-card-icon" aria-hidden="true">
          <Icon name="car" size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="rwa-card-title">
            {v.label}
            {sold && <span className="badge badge-neutral ms-2">فروخته‌شده</span>}
          </h3>
          {v.ownershipDate && <p className="rwa-card-sub">از {formatJalaliIso(v.ownershipDate)}</p>}
        </div>
        {v.monthlyCostToman && (
          <div className="rwa-yield" data-neg={D(v.monthlyCostToman).gt(0) || undefined}>
            <b className="num money-nowrap" dir="rtl">{formatMoney(v.monthlyCostToman, "IRT")}</b>
            <span>هزینه‌ی واقعی ماهانه</span>
          </div>
        )}
      </header>

      <dl className="rwa-figs">
        {v.currentToman && <Figure label={sold ? "قیمت فروش" : "ارزش روز"} value={formatMoney(v.currentToman, "IRT")} />}
        {change && <Figure label="تغییر ارزش از خرید" value={formatSignedMoney(change.toFixed(0), "IRT")} tone={change.isNegative() ? "neg" : "pos"} />}
        <Figure label="هزینه‌ی نگه‌داری" value={formatMoney(v.costs.total, "IRT")} />
        <Figure label="۱۲ ماه اخیر" value={formatMoney(v.costs.last12Months, "IRT")} />
      </dl>

      {v.costs.topCategories.length > 0 && (
        <div className="rwa-chips" aria-label="بیشترین هزینه‌ها">
          {v.costs.topCategories.map((c) => (
            <span key={c.name} className="rwa-chip">
              {c.name}
              <b className="num money-nowrap" dir="rtl">{formatMoney(c.toman, "IRT")}</b>
            </span>
          ))}
        </div>
      )}

      {!sold && (
        <>
          <div className="rwa-cover">
            <span className="rwa-cover-pill" data-tone={cover.thirdParty ? "ok" : "neg"}>
              <Icon name="shield" size={13} />
              {cover.thirdParty ? `ثالث تا ${cover.thirdParty}` : "بیمه ثالث ثبت نشده"}
            </span>
            {cover.body && (
              <span className="rwa-cover-pill" data-tone="ok">
                <Icon name="shield" size={13} />
                بدنه تا {cover.body}
              </span>
            )}
            {!cover.thirdParty && (
              <Link href={`/insurance?kind=third_party&vehicle=${v.id}#new-policy`} className="expense-link">
                ثبت بیمه ثالث
                <Icon name="arrow-start" size={13} />
              </Link>
            )}
          </div>

          <VehicleDueDates
            vehicleId={v.id}
            today={today}
            items={v.dueDates.map((d) => {
              const days = daysBetween(today, d.dueDate);
              return {
                id: d.id,
                title: d.title,
                whenLabel: `${formatJalaliIso(d.dueDate)} · ${formatDaysUntil(days)}`,
                overdue: days < 0,
                repeatLabel: d.repeatMonths ? (d.repeatMonths % 12 === 0 ? `هر ${faCount(d.repeatMonths / 12)} سال` : `هر ${faCount(d.repeatMonths)} ماه`) : null,
              };
            })}
          />

          <footer className="rwa-actions">
            <Link href={addCost} className="btn btn-soft">
              <Icon name="plus" size={14} />
              ثبت هزینه‌ی این خودرو
            </Link>
            <Link href={`/transactions?${new URLSearchParams({ tag: v.tag, range: "all" }).toString()}`} className="expense-link rwa-more">
              همه‌ی هزینه‌ها
              <Icon name="arrow-start" size={13} />
            </Link>
          </footer>
        </>
      )}
    </li>
  );
}

export default async function VehiclesPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  const today = todayIso();
  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="خودروها" />
        <div className="card">
          <EmptyState icon="lock" title="برای خودروها وارد شوید" />
        </div>
      </div>
    );
  }
  const [cars, policies] = await Promise.all([listVehicleOverview(userId, today), listPolicies(userId)]);
  const coverOf = (vehicleId: string) => {
    const live = policies.filter((p) => p.status === "active" && p.insuredVehicleId === vehicleId && (!p.endDate || p.endDate >= today));
    const until = (kind: string) => {
      const p = live.find((x) => x.kind === kind);
      return p ? (p.endDate ? formatJalaliIso(p.endDate) : "نامحدود") : null;
    };
    return { thirdParty: until("third_party"), body: until("car_body") };
  };
  const active = cars.filter((c) => c.status === "active");
  const sold = cars.filter((c) => c.status === "sold");

  return (
    <div className="mny-page">
      <ModuleHeader title="هزینه و سررسید خودرو" tabs={ASSET_TABS} active="/asset-registry" label="بخش‌های دارایی" />

      {cars.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="car"
            title="خودرویی ثبت نشده است"
            action={
              <Link href="/asset-registry" className="btn btn-soft">
                ثبت خودرو
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Section title="خودروهای فعلی">
            <ul className="rwa-list">
              {active.map((v) => (
                <VehicleCard key={v.id} v={v} today={today} cover={coverOf(v.id)} />
              ))}
            </ul>
          </Section>
          {sold.length > 0 && (
            <Section title="فروخته‌شده">
              <ul className="rwa-list">
                {sold.map((v) => (
                  <VehicleCard key={v.id} v={v} today={today} cover={coverOf(v.id)} />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

    </div>
  );
}
