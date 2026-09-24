import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { listVehicleOverview, VEHICLE_DUE_HORIZON_DAYS, type VehicleOverview } from "@/features/vehicles/service";
import { listPolicies } from "@/features/insurance/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { ASSET_TABS } from "@/components/ui/ModuleTabs";
import VehicleDueDates from "@/components/vehicles/VehicleDueDates";
import { D } from "@/domain/decimal";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, formatSignedMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "خودروها" };

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

function VehicleCard({ v, today, cover }: { v: VehicleOverview; today: string; cover: { thirdParty: string | null; body: string | null } }) {
  const change = v.valueChangeToman ? D(v.valueChangeToman) : null;
  const addCost = `/new?${new URLSearchParams({ type: "expense", tags: `#${v.tag}` }).toString()}`;
  return (
    <li id={`vehicle-${v.id}`} className="reconcile-row card p-4">
      <div className="flex items-start gap-3">
        <span className="plan-icon" style={{ background: "var(--sunken)", color: "var(--text-2)" }} aria-hidden="true">
          <Icon name="car" size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[length:var(--fs-sm)] font-semibold">
            {v.label}
            {v.status === "sold" && <span className="badge badge-neutral ms-2">فروخته‌شده</span>}
          </p>
          <p className="muted text-[length:var(--fs-xs)]">
            {v.ownershipDate ? `از ${formatJalaliIso(v.ownershipDate)}` : "تاریخ تملک ثبت نشده"} · هزینه‌ها با برچسب <span dir="auto">{`#${v.tag}`}</span>
          </p>
        </div>
      </div>

      <dl className="reconcile-figures mt-3">
        {v.currentToman && <Figure label={v.status === "sold" ? "قیمت فروش" : "ارزش روز"} value={formatMoney(v.currentToman, "IRT")} />}
        {change && <Figure label="تغییر ارزش از خرید" value={formatSignedMoney(change.toFixed(0), "IRT")} tone={change.isNegative() ? "neg" : "pos"} />}
        <Figure label="هزینه‌های نگه‌داری" value={formatMoney(v.costs.total, "IRT")} />
        <Figure label="۱۲ ماه اخیر" value={formatMoney(v.costs.last12Months, "IRT")} />
        {v.monthlyCostToman && <Figure label="هزینه‌ی واقعی ماهانه" value={formatMoney(v.monthlyCostToman, "IRT")} tone={D(v.monthlyCostToman).gt(0) ? "neg" : "pos"} />}
      </dl>
      {v.costs.topCategories.length > 0 && (
        <p className="muted mt-2 text-[length:var(--fs-xs)]">
          بیشترین: {v.costs.topCategories.map((c) => `${c.name} ${formatMoney(c.toman, "IRT")}`).join(" · ")}
        </p>
      )}
      {v.status === "active" && (
        <p className="mt-2 text-[length:var(--fs-xs)]">
          <span className="muted">بیمه: </span>
          <span style={{ color: cover.thirdParty ? undefined : "var(--negative)" }}>{cover.thirdParty ? `ثالث تا ${cover.thirdParty}` : "ثالث ثبت نشده"}</span>
          {cover.body && <span className="muted"> · بدنه تا {cover.body}</span>}
        </p>
      )}

      {v.status === "active" && (
        <div className="mt-3 grid gap-3">
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
          <div className="flex flex-wrap justify-end gap-2">
            <Link href={addCost} className="btn btn-soft !min-h-9 !px-3 text-[length:var(--fs-xs)]">
              <Icon name="plus" size={13} />
              ثبت هزینه‌ی این خودرو
            </Link>
            <Link href={`/transactions?${new URLSearchParams({ tag: v.tag, range: "all" }).toString()}`} className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]">
              همه‌ی هزینه‌ها
            </Link>
            {!cover.thirdParty && (
              <Link href={`/insurance?kind=third_party&vehicle=${v.id}#new-policy`} className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]">
                ثبت بیمه ثالث
              </Link>
            )}
          </div>
        </div>
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
    <div className="space-y-7">
      <div>
        <PageHeader
          title="خودروها"
          subtitle={`هزینه‌ی واقعی نگه‌داشتن هر خودرو و سررسیدهایش (یادآوری از ${faCount(VEHICLE_DUE_HORIZON_DAYS)} روز قبل).`}
        />
        <ModuleTabs tabs={ASSET_TABS} active="/asset-registry" label="بخش‌های دارایی" />
      </div>

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
            <ul className="grid gap-3">
              {active.map((v) => (
                <VehicleCard key={v.id} v={v} today={today} cover={coverOf(v.id)} />
              ))}
            </ul>
          </Section>
          {sold.length > 0 && (
            <Section title="فروخته‌شده">
              <ul className="grid gap-3">
                {sold.map((v) => (
                  <VehicleCard key={v.id} v={v} today={today} cover={coverOf(v.id)} />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        هزینه‌ی هر خودرو از تراکنش‌هایی می‌آید که برچسبش را دارند؛ هزینه‌های قبلی را هم می‌توانید در «تراکنش‌ها» با همین برچسب علامت بزنید. حق بیمه‌ی بیمه‌نامه‌های متصل به خودرو خودکار حساب می‌شود.
      </p>
    </div>
  );
}
