import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import {
  coverageGaps,
  gapHref,
  INSURANCE_KIND_META,
  listLinkableDebts,
  listPolicies,
  listPremiumAccounts,
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
import { POLICY_KIND_VISUAL, policyKindStyle } from "@/components/insurance/kindVisual";
import AssetLogo from "@/components/ui/AssetLogo";
import type { PickerAccount } from "@/components/ui/AccountPicker";
import { resolveAssetLogoDetailed } from "@/features/branding/assetLogo";
import { getAccountBalances } from "@/features/ledger/queries";
import { D, Decimal } from "@/domain/decimal";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "بیمه‌نامه‌ها" };

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function PolicyList({
  rows,
  today,
  bankAccounts,
  balances,
}: {
  rows: PolicyRow[];
  today: string;
  bankAccounts: PickerAccount[];
  balances: Record<string, string>;
}) {
  return (
    <ul className="card plan-list">
      {rows.map((p) => {
        const active = p.status === "active";
        const toEnd = p.endDate ? daysBetween(today, p.endDate) : null;
        const renewSoon = active && toEnd != null && toEnd <= RENEWAL_HORIZON_DAYS;
        const onDebt = !!p.debtId;
        const meta = [
          INSURANCE_KIND_META[p.kind].label,
          p.insurer,
          p.endDate ? `تا ${formatJalaliIso(p.endDate)}${active && toEnd != null ? ` · ${formatDaysUntil(toEnd)}` : ""}` : null,
        ].filter(Boolean);
        const detail = onDebt
          ? [
              p.debtTotalCount ? `اقساطی · ${faCount(p.debtPaidCount ?? 0)} از ${faCount(p.debtTotalCount)} قسط پرداخت شده` : "اقساطی",
              p.debtRemainingToman && D(p.debtRemainingToman).gt(0) ? `مانده ${formatMoney(D(p.debtRemainingToman).toFixed(0), "IRT")}` : "تسویه شده",
            ]
          : [
              active && p.nextPremiumDate ? `حق بیمه‌ی بعدی ${formatJalaliIso(p.nextPremiumDate)}` : null,
              p.savingsBalanceToman != null ? `اندوخته ${formatMoney(D(p.savingsBalanceToman).toFixed(0), "IRT")}` : null,
            ].filter(Boolean);
        const debtPct = onDebt && p.debtTotalCount ? Math.round(((p.debtPaidCount ?? 0) * 100) / p.debtTotalCount) : null;
        return (
          <li key={p.id} id={`policy-${p.id}`} className="plan-queue-row reconcile-row flex-wrap">
            {p.insurer && resolveAssetLogoDetailed({ assetType: "insurance", brandName: p.insurer, name: p.insurer }).source === "persianlabs" ? (
              <span className="flex shrink-0" aria-hidden="true">
                <AssetLogo assetType="insurance" brandName={p.insurer} name={p.insurer} size={36} />
              </span>
            ) : (
              <span className="plan-icon" style={policyKindStyle(p.kind)} aria-hidden="true">
                <Icon name={(POLICY_KIND_VISUAL[p.kind] ?? POLICY_KIND_VISUAL.other).icon} size={16} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-2 text-[length:var(--fs-sm)]">
                <span className="min-w-0 truncate">{p.title}</span>
                {!active && <span className="badge badge-neutral shrink-0">{p.status === "renewed" ? "تمدیدشده" : "لغوشده"}</span>}
              </b>
              <span className="expense-sub block truncate" style={renewSoon ? { color: toEnd! < 0 ? "var(--negative)" : "var(--warning)" } : undefined}>
                {meta.join(" · ")}
              </span>
              {detail.length > 0 && <span className="expense-sub block">{detail.join(" · ")}</span>}
              {debtPct != null && active && (
                <span className="policy-progress" aria-hidden="true">
                  <span style={{ width: `${debtPct}%` }} />
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end">
              <span className="num plan-amount money-nowrap" dir="rtl">
                {formatMoney(D(p.premiumToman).toFixed(0), "IRT")}
              </span>
              <span className="muted text-[length:var(--fs-xs)]">{onDebt ? "کل" : PREMIUM_FREQUENCY_LABEL[p.premiumFrequency]}</span>
            </span>
            <PolicyRowActions
              id={p.id}
              active={active}
              payHref={p.nextPlanId ? `/new?type=${p.savingsAccountId ? "transfer" : "expense"}&planId=${p.nextPlanId}` : null}
              debtHref={onDebt ? "/debts/installments" : null}
              endDate={p.endDate}
              premiumToman={D(p.premiumToman).toFixed(0)}
              coverageToman={p.coverageToman ? D(p.coverageToman).toFixed(0) : null}
              today={today}
              renewSoon={renewSoon}
              bankAccounts={bankAccounts}
              balances={balances}
              needsAccount={!p.payAccountId}
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

  const [rows, gaps, accountRows, linkableDebts, vehicles, properties, balanceRows] = await Promise.all([
    listPolicies(userId),
    coverageGaps(userId, today),
    // Premiums and down payments leave from a Toman BANK account only — no Tether, fund, exchange or cash box.
    listPremiumAccounts(userId),
    listLinkableDebts(userId).catch(() => []),
    listUserVehicles(userId).catch(() => []),
    listRealEstateAssets(userId).catch(() => []),
    getAccountBalances(userId).catch(() => []),
  ]);

  const active = rows.filter((r) => r.status === "active");
  const past = rows.filter((r) => r.status !== "active");
  const yearly = Decimal.sum(active.map((r) => r.annualPremiumToman));
  const nextPremium = active.map((r) => r.nextPremiumDate).filter((d): d is string => !!d).sort()[0] ?? null;
  const expiring = active.filter((r) => r.endDate && daysBetween(today, r.endDate) <= RENEWAL_HORIZON_DAYS);
  const opened = !!(params.kind || params.vehicle || params.property) || rows.length === 0;
  const bankAccounts: PickerAccount[] = accountRows;
  const balances = Object.fromEntries(balanceRows.map((b) => [b.accountId, b.quantity]));

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

      {/* Figures only once there is something to sum — four zeros are noise, not information. */}
      {active.length > 0 && (
        <section className="metric-strip">
          <Metric label="بیمه‌نامه‌ی فعال" value={faCount(active.length)} tone="neutral" />
          <Metric label="حق بیمه‌ی سالانه" value={formatMoney(yearly.toFixed(0), "IRT")} tone="neutral" />
          <Metric label="حق بیمه‌ی بعدی" value={nextPremium ? formatJalaliIso(nextPremium) : "—"} tone="neutral" hint={nextPremium ? formatDaysUntil(daysBetween(today, nextPremium)) : undefined} />
          <Metric label={`تمدید تا ${faCount(RENEWAL_HORIZON_DAYS)} روز`} value={faCount(expiring.length)} tone={expiring.length ? "down" : "neutral"} />
        </section>
      )}

      {gaps.length > 0 && (
        <Section title="بدون بیمه">
          <ul className="card list-card" role="list">
            {gaps.map((g) => (
              <li key={`${g.kind}-${g.vehicleId ?? g.propertyId}`} className="list-row gap-row">
                <span
                  className="flow-icon"
                  aria-hidden="true"
                  style={g.kind === "vehicle_no_third_party" ? { background: "var(--negative-soft)", color: "var(--negative)" } : { background: "var(--warning-soft)", color: "var(--warning)" }}
                >
                  <Icon name={g.kind === "vehicle_no_third_party" ? "alert" : "shield"} size={15} />
                </span>
                <p className="min-w-0 flex-1 text-[length:var(--fs-sm)] font-medium leading-6" title={g.detail}>
                  {g.title}
                </p>
                <Link
                  href={gapHref(g)}
                  className="btn btn-soft !min-h-9 shrink-0 !px-3 text-[length:var(--fs-xs)]"
                  aria-label={`ثبت بیمه برای ${g.title}`}
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
          accounts={bankAccounts}
          balances={balances}
          debts={linkableDebts}
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
          <PolicyList rows={active} today={today} bankAccounts={bankAccounts} balances={balances} />
        )}
      </Section>

      {past.length > 0 && (
        <Section title="دوره‌های گذشته">
          <PolicyList rows={past} today={today} bankAccounts={bankAccounts} balances={balances} />
        </Section>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        ثبت بیمه‌نامه سندی نمی‌سازد؛ هر پرداخت در سررسیدش یادآوری و با یک ضربه ثبت می‌شود.
      </p>
    </div>
  );
}
