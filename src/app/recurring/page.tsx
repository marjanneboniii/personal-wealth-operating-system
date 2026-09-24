import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { listRecurringPayments } from "@/features/recurring/service";
import { getCashflow } from "@/features/ledger/queries";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import CommitmentMonths from "@/components/recurring/CommitmentMonths";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import { PREMIUM_FREQUENCY_LABEL } from "@/features/insurance/service";
import { D } from "@/domain/decimal";
import { faCount, formatJalaliIso, formatMoney, formatPct, JALALI_MONTHS, todayIso, toJalali } from "@/lib/format";
import { monthToman } from "@/lib/cashflowToman";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "پرداخت‌های تکراری" };

function Row({
  icon,
  title,
  meta,
  metaTone,
  amount,
  unit,
  href,
}: {
  icon: "receipt" | "shield" | "installments";
  title: string;
  meta: string;
  metaTone?: string;
  amount: string;
  unit: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="flow-icon" aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="acct-title truncate text-[length:var(--fs-sm)] font-semibold">{title}</p>
        <p className="muted truncate text-[length:var(--fs-xs)]" style={metaTone ? { color: metaTone } : undefined}>
          {meta}
        </p>
      </div>
      <div className="acct-amount shrink-0 text-left">
        <p className="num money-nowrap text-[length:var(--fs-sm)] font-semibold" dir="rtl">
          {amount}
        </p>
        <p className="muted text-[length:var(--fs-xs)]">{unit}</p>
      </div>
    </>
  );
  return <li>{href ? <Link href={href} className="list-row">{body}</Link> : <div className="list-row">{body}</div>}</li>;
}

const monthOf = (iso: string) => {
  const j = toJalali(iso);
  return `${JALALI_MONTHS[j.m - 1]} ${j.y.toLocaleString("fa-IR", { useGrouping: false })}`;
};

export default async function RecurringPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;
  const today = todayIso();
  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="پرداخت‌های تکراری" />
        <div className="card">
          <EmptyState icon="lock" title="وارد شوید" />
        </div>
      </div>
    );
  }
  const [data, flow, fx] = await Promise.all([listRecurringPayments(userId, today), getCashflow(3, userId), getLatestUsdIrtRateForUser(userId)]);
  const [thisMonth, nextMonth] = data.months;
  // Share of an average month's income that THIS month's payments already take.
  const incomes = flow.map((f) => monthToman(f, fx.rate)?.inflow).filter((v): v is string => !!v && D(v).gt(0));
  const avgIncome = incomes.length ? incomes.reduce((s, v) => s.add(v), D("0")).div(incomes.length) : null;
  const share = avgIncome && avgIncome.gt(0) ? D(thisMonth.totalToman).mul(100).div(avgIncome) : null;
  const delta = D(nextMonth.totalToman).sub(thisMonth.totalToman);
  const empty = !data.detected.length && !data.premiums.length && !data.installments.length;
  const why = [
    data.endingThisMonth.length ? `${data.endingThisMonth.map((t) => `«${t}»`).join("، ")} این ماه تمام می‌شود` : null,
    data.startingNextMonth.length ? `${data.startingNextMonth.map((t) => `«${t}»`).join("، ")} شروع می‌شود` : null,
  ].filter(Boolean);

  return (
    <div className="space-y-7">
      <div>
        <PageHeader title="پرداخت‌های تکراری" subtitle="اقساط، حق بیمه‌ها و اشتراک‌ها — ماه‌به‌ماه، همان‌طور که واقعاً سررسید می‌شوند." />
        <ModuleTabs tabs={MONEY_TABS} active="/recurring" label="بخش‌های پول" />
      </div>

      {empty ? (
        <div className="card">
          <EmptyState icon="receipt" title="پرداخت تکراری‌ای پیدا نشد" body="اقساط، حق بیمه‌ها و هزینه‌ای که در سه ماه جدا تکرار شده باشد، اینجا خودکار می‌آید." />
        </div>
      ) : (
        <>
          <section className="card commit-hero">
            <p className="muted text-[length:var(--fs-xs)] font-medium">مانده‌ی پرداخت‌های {thisMonth.label}</p>
            <p className="commit-hero-value num money-nowrap" dir="rtl">
              {formatMoney(thisMonth.totalToman, "IRT")}
            </p>
            {share && (
              <p className="text-[length:var(--fs-xs)]" style={{ color: share.gt(50) ? "var(--negative)" : "var(--text-3)" }}>
                {formatPct(share.toFixed(0), 0)} درآمد ماهانه
              </p>
            )}
            <div className="commit-next">
              <span className="muted">{nextMonth.label}</span>
              <b className="num money-nowrap" dir="rtl">
                {formatMoney(nextMonth.totalToman, "IRT")}
              </b>
              {!delta.isZero() && (
                <span className={`commit-delta ${delta.isNegative() ? "is-down" : "is-up"}`}>
                  {delta.isNegative() ? "↓" : "↑"} <span className="num money-nowrap">{formatMoney(delta.abs().toFixed(0), "IRT")}</span>
                </span>
              )}
            </div>
            {why.length > 0 && <p className="muted text-[length:var(--fs-xs)] leading-5">{why.join(" · ")}</p>}
          </section>

          <Section title="ماه‌های پیش رو">
            <div className="card p-3">
              <CommitmentMonths months={data.months.slice(0, 6)} />
            </div>
            <p className="muted mt-2 text-[length:var(--fs-xs)]">
              ۱۲ ماه آینده، طبق سررسیدها:{" "}
              <b className="num money-nowrap" dir="rtl">
                {formatMoney(data.next12Toman, "IRT")}
              </b>
            </p>
          </Section>

          {data.installments.length > 0 && (
            <Section title="اقساط">
              <ul className="card list-card" role="list">
                {data.installments.map((i) => {
                  const ending = i.remainingCount === 1 || i.lastDueDate < nextMonth.start;
                  const meta = [
                    i.overdueCount > 0 ? `${faCount(i.overdueCount)} قسط عقب‌افتاده` : null,
                    i.intervalMonths && i.intervalMonths > 1 ? `هر ${faCount(i.intervalMonths)} ماه` : null,
                    ending ? "آخرین قسط" : `${faCount(i.remainingCount)} قسط مانده · تا ${monthOf(i.lastDueDate)}`,
                  ].filter(Boolean);
                  return (
                    <Row
                      key={i.debtId}
                      icon="installments"
                      title={i.title}
                      meta={meta.join(" · ")}
                      metaTone={i.overdueCount > 0 ? "var(--warning)" : ending ? "var(--positive)" : undefined}
                      amount={formatMoney(i.nextToman, "IRT")}
                      unit={`قسط ${formatJalaliIso(i.nextDueDate)}`}
                      href="/debts/installments"
                    />
                  );
                })}
              </ul>
            </Section>
          )}
          {data.premiums.length > 0 && (
            <Section title="حق بیمه‌ها">
              <ul className="card list-card" role="list">
                {data.premiums.map((p) => (
                  <Row
                    key={p.id}
                    icon="shield"
                    title={p.title}
                    meta={[p.kind, p.nextDate ? `بعدی ${formatJalaliIso(p.nextDate)}` : null, p.endDate ? `تا ${monthOf(p.endDate)}` : null].filter(Boolean).join(" · ")}
                    amount={formatMoney(p.perPaymentToman, "IRT")}
                    unit={PREMIUM_FREQUENCY_LABEL[p.frequency]}
                    href={`/insurance#policy-${p.id}`}
                  />
                ))}
              </ul>
            </Section>
          )}
          {data.detected.length > 0 && (
            <Section title="اشتراک‌ها و قبض‌ها">
              <ul className="card list-card" role="list">
                {data.detected.map((d) => (
                  <Row
                    key={d.key}
                    icon="receipt"
                    title={d.label}
                    meta={[d.category, `${faCount(d.months)} ماه اخیر`].filter(Boolean).join(" · ")}
                    amount={formatMoney(d.monthlyToman, "IRT")}
                    unit="ماهانه · تخمینی"
                    href={`/transactions?${new URLSearchParams({ q: d.label, range: "m6" }).toString()}`}
                  />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
