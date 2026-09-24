import Link from "next/link";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ensureAuth } from "@/lib/authGuard";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import {
  coverageGaps,
  INSURANCE_KIND_META,
  listPolicies,
  PREMIUM_FREQUENCY_LABEL,
  RENEWAL_HORIZON_DAYS,
  type PolicyRow,
} from "@/features/insurance/service";
import { listRealEstateAssets } from "@/features/rwa/realEstate/service";
import { listUserVehicles } from "@/features/rwa/vehicle/service";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import DisclosurePanel from "@/components/ui/DisclosurePanel";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { DEBT_TABS } from "@/components/ui/ModuleTabs";
import PolicyForm from "@/components/insurance/PolicyForm";
import PolicyRowActions from "@/components/insurance/PolicyRowActions";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "بیمه‌نامه‌ها" };

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function PolicyList({ rows, today }: { rows: PolicyRow[]; today: string }) {
  return (
    <ul className="card plan-list">
      {rows.map((p) => {
        const active = p.status === "active";
        const toEnd = p.endDate ? daysBetween(today, p.endDate) : null;
        const renewSoon = active && toEnd != null && toEnd <= RENEWAL_HORIZON_DAYS;
        const meta = [
          INSURANCE_KIND_META[p.kind].label,
          p.insurer,
          p.insuredLabel,
          p.endDate ? `تا ${formatJalaliIso(p.endDate)}${active && toEnd != null ? ` · ${formatDaysUntil(toEnd)}` : ""}` : "بدون تاریخ پایان",
        ].filter(Boolean);
        const detail = [
          active && p.nextPremiumDate ? `حق بیمه‌ی بعدی ${formatJalaliIso(p.nextPremiumDate)}` : null,
          p.coverageToman ? `سرمایه ${formatMoney(D(p.coverageToman).toFixed(0), "IRT")}` : null,
          p.savingsBalanceToman != null ? `اندوخته ${formatMoney(D(p.savingsBalanceToman).toFixed(0), "IRT")}` : null,
        ].filter(Boolean);
        return (
          <li key={p.id} id={`policy-${p.id}`} className="plan-queue-row reconcile-row flex-wrap">
            <span className="plan-icon" style={{ background: "var(--info-soft)", color: "var(--info)" }} aria-hidden="true">
              <Icon name="shield" size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-2 text-[length:var(--fs-sm)]">
                <span className="min-w-0 break-words">{p.title}</span>
                {!active && <span className="badge badge-neutral shrink-0">{p.status === "renewed" ? "تمدیدشده" : "لغوشده"}</span>}
              </b>
              <span className="expense-sub block" style={renewSoon ? { color: toEnd! < 0 ? "var(--negative)" : "var(--warning)" } : undefined}>
                {meta.join(" · ")}
              </span>
              {detail.length > 0 && <span className="expense-sub block">{detail.join(" · ")}</span>}
            </span>
            <span className="flex shrink-0 flex-col items-end max-sm:w-full max-sm:items-start max-sm:ps-11">
              <span className="num plan-amount money-nowrap" dir="rtl">
                {formatMoney(D(p.premiumToman).toFixed(0), "IRT")}
              </span>
              <span className="muted text-[length:var(--fs-xs)]">{PREMIUM_FREQUENCY_LABEL[p.premiumFrequency]}</span>
            </span>
            <PolicyRowActions
              id={p.id}
              active={active}
              payHref={p.nextPlanId ? `/new?type=${p.savingsAccountId ? "transfer" : "expense"}&planId=${p.nextPlanId}` : null}
              endDate={p.endDate}
              premiumToman={D(p.premiumToman).toFixed(0)}
              coverageToman={p.coverageToman ? D(p.coverageToman).toFixed(0) : null}
              today={today}
              renewSoon={renewSoon}
            />
          </li>
        );
      })}
    </ul>
  );
}

export default async function InsurancePage({ searchParams }: { searchParams: Promise<{ kind?: string; vehicle?: string; property?: string }> }) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  const today = todayIso();
  const params = await searchParams;

  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="بیمه‌نامه‌ها" />
        <div className="card">
          <EmptyState icon="lock" title="برای بیمه‌نامه‌ها وارد شوید" />
        </div>
      </div>
    );
  }

  const [rows, gaps, accountRows, vehicles, properties] = await Promise.all([
    listPolicies(userId),
    coverageGaps(userId, today),
    db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .innerJoin(assets, eq(assets.id, accounts.assetId))
      .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), isNull(accounts.deletedAt), eq(assets.symbol, "IRT")))
      .orderBy(asc(accounts.code)),
    listUserVehicles(userId).catch(() => []),
    listRealEstateAssets(userId).catch(() => []),
  ]);

  const active = rows.filter((r) => r.status === "active");
  const past = rows.filter((r) => r.status !== "active");
  const yearly = Decimal.sum(active.map((r) => r.annualPremiumToman));
  const nextPremium = active.map((r) => r.nextPremiumDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const expiring = active.filter((r) => r.endDate && daysBetween(today, r.endDate) <= RENEWAL_HORIZON_DAYS);
  const opened = !!(params.kind || params.vehicle || params.property) || rows.length === 0;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="بیمه‌نامه‌ها"
          action={
            <Link href="#new-policy" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت بیمه‌نامه
            </Link>
          }
        />
        <ModuleTabs tabs={DEBT_TABS} active="/insurance" label="بخش‌های تعهدات مالی" />
      </div>

      <section className="metric-strip">
        <Metric label="بیمه‌نامه‌ی فعال" value={faCount(active.length)} tone="neutral" />
        <Metric label="حق بیمه‌ی سالانه" value={formatMoney(yearly.toFixed(0), "IRT")} tone="neutral" />
        <Metric label="حق بیمه‌ی بعدی" value={nextPremium ? formatJalaliIso(nextPremium) : "—"} tone="neutral" hint={nextPremium ? formatDaysUntil(daysBetween(today, nextPremium)) : undefined} />
        <Metric label={`تمدید تا ${faCount(RENEWAL_HORIZON_DAYS)} روز`} value={faCount(expiring.length)} tone={expiring.length ? "down" : "neutral"} />
      </section>

      {gaps.length > 0 && (
        <Section title="پوشش" hint={`${faCount(gaps.length)} مورد`}>
          <ul className="card list-card" role="list">
            {gaps.map((g) => (
              <li key={`${g.kind}-${g.vehicleId ?? g.propertyId}`} className="list-row">
                <span
                  className="flow-icon"
                  aria-hidden="true"
                  style={g.kind === "vehicle_no_third_party" ? { background: "var(--negative-soft)", color: "var(--negative)" } : { background: "var(--warning-soft)", color: "var(--warning)" }}
                >
                  <Icon name={g.kind === "vehicle_no_third_party" ? "alert" : "shield"} size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[length:var(--fs-sm)] font-semibold">{g.title}</p>
                  <p className="muted text-[length:var(--fs-xs)]">{g.detail}</p>
                </div>
                <Link
                  href={`/insurance?${new URLSearchParams({ kind: g.suggestKind, ...(g.vehicleId ? { vehicle: g.vehicleId } : {}), ...(g.propertyId ? { property: g.propertyId } : {}) }).toString()}#new-policy`}
                  className="btn btn-soft !min-h-9 shrink-0 !px-3 text-[length:var(--fs-xs)]"
                >
                  ثبت
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <DisclosurePanel anchor="new-policy" label="ثبت بیمه‌نامه" defaultOpen={opened}>
        <PolicyForm
          key={`${params.kind ?? ""}-${params.vehicle ?? ""}-${params.property ?? ""}`}
          accounts={accountRows.map((a) => ({ id: a.id, label: a.name }))}
          vehicles={vehicles.filter((v) => v.status !== "sold").map((v) => ({ id: v.id, label: `${v.brand} ${v.model} ${v.year}` }))}
          properties={properties.map((p) => ({ id: p.id, label: [p.label, p.neighborhoodNameFa ?? p.area, p.cityNameFa].filter(Boolean).join(" · ") || "ملک" }))}
          today={today}
          initial={{ kind: params.kind, vehicleId: params.vehicle, propertyId: params.property }}
        />
      </DisclosurePanel>

      <Section title="بیمه‌نامه‌های فعال" hint={active.length ? `${faCount(active.length)} مورد` : undefined}>
        {active.length === 0 ? (
          <div className="card">
            <EmptyState icon="shield" title="بیمه‌نامه‌ی فعالی ثبت نشده" body="بیمه‌ی ثالث، بدنه، آتش‌سوزی، عمر یا درمان را ثبت کنید تا حق بیمه و تمدید یادآوری شود و در پیش‌بینی نقدینگی بیاید." />
          </div>
        ) : (
          <PolicyList rows={active} today={today} />
        )}
      </Section>

      {past.length > 0 && (
        <Section title="دوره‌های گذشته">
          <PolicyList rows={past} today={today} />
        </Section>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        بیمه‌نامه سندی در دفترکل نمی‌سازد. حق بیمه هزینه ثبت می‌شود؛ در بیمه‌ی عمرِ دارای اندوخته، انتقال به حساب اندوخته است و در ارزش خالص می‌ماند.
      </p>
    </div>
  );
}
