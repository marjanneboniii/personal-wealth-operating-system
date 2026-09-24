import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { listRecurringPayments } from "@/features/recurring/service";
import { getCashflow } from "@/features/ledger/queries";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import { PREMIUM_FREQUENCY_LABEL } from "@/features/insurance/service";
import { D } from "@/domain/decimal";
import { faCount, formatJalaliIso, formatMoney, formatPct, todayIso } from "@/lib/format";
import { monthToman } from "@/lib/cashflowToman";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "پرداخت‌های تکراری" };

function Row({ icon, title, meta, amount, href }: { icon: "receipt" | "shield" | "installments"; title: string; meta: string; amount: string; href?: string }) {
  const body = (
    <>
      <span className="flow-icon" aria-hidden="true">
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="acct-title text-[length:var(--fs-sm)] font-semibold">{title}</p>
        <p className="muted text-[length:var(--fs-xs)]">{meta}</p>
      </div>
      <div className="acct-amount shrink-0 text-left">
        <p className="num money-nowrap text-[length:var(--fs-sm)] font-semibold" dir="rtl">
          {amount}
        </p>
        <p className="muted text-[length:var(--fs-xs)]">در ماه</p>
      </div>
    </>
  );
  return <li>{href ? <Link href={href} className="list-row">{body}</Link> : <div className="list-row">{body}</div>}</li>;
}

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
  // Share of an average month's income that is already spoken for.
  const incomes = flow.map((f) => monthToman(f, fx.rate)?.inflow).filter((v): v is string => !!v && D(v).gt(0));
  const avgIncome = incomes.length ? incomes.reduce((s, v) => s.add(v), D("0")).div(incomes.length) : null;
  const share = avgIncome && avgIncome.gt(0) ? D(data.monthlyTotal).mul(100).div(avgIncome) : null;
  const empty = !data.detected.length && !data.premiums.length && !data.installments.length;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader title="پرداخت‌های تکراری" subtitle="اشتراک‌ها، قبض‌ها و کسورات ماهانه‌ای که از روی تراکنش‌هایتان پیدا شده‌اند، به‌همراه حق بیمه‌ها و اقساط." />
        <ModuleTabs tabs={MONEY_TABS} active="/recurring" label="بخش‌های پول" />
      </div>

      <section className="metric-strip">
        <Metric label="تعهد ثابت ماهانه" value={formatMoney(data.monthlyTotal, "IRT")} tone="neutral" />
        <Metric label="سهم از درآمد" value={share ? formatPct(share.toFixed(0), 0) : "—"} tone={share ? (share.gt(50) ? "down" : "neutral") : "neutral"} hint={share ? "میانگین درآمد ۳ ماه اخیر" : "درآمدی ثبت نشده"} />
        <Metric label="در سال" value={formatMoney(D(data.monthlyTotal).mul(12).toFixed(0), "IRT")} tone="neutral" />
      </section>

      {empty ? (
        <div className="card">
          <EmptyState icon="receipt" title="پرداخت تکراری‌ای پیدا نشد" body="هزینه‌ای که در دست‌کم سه ماه جدا با مبلغ نزدیک به هم تکرار شده باشد، اینجا خودکار می‌آید." />
        </div>
      ) : (
        <>
          {data.detected.length > 0 && (
            <Section title="اشتراک‌ها و قبض‌ها" hint={`${faCount(data.detected.length)} مورد · تشخیص خودکار`}>
              <ul className="card list-card" role="list">
                {data.detected.map((d) => (
                  <Row
                    key={d.key}
                    icon="receipt"
                    title={d.label}
                    meta={[d.category, d.accountName, `${faCount(d.months)} ماه`, `بعدی حدود ${formatJalaliIso(d.nextExpected)}`].filter(Boolean).join(" · ")}
                    amount={formatMoney(d.monthlyToman, "IRT")}
                    href={`/transactions?${new URLSearchParams({ q: d.label, range: "m6" }).toString()}`}
                  />
                ))}
              </ul>
            </Section>
          )}
          {data.premiums.length > 0 && (
            <Section title="حق بیمه‌ها">
              <ul className="card list-card" role="list">
                {data.premiums.map((p) => (
                  <Row key={p.id} icon="shield" title={p.title} meta={`${p.kind} · ${PREMIUM_FREQUENCY_LABEL[p.frequency]} · سالانه ${formatMoney(p.annualToman, "IRT")}`} amount={formatMoney(p.monthlyToman, "IRT")} href={`/insurance#policy-${p.id}`} />
                ))}
              </ul>
            </Section>
          )}
          {data.installments.length > 0 && (
            <Section title="اقساط">
              <ul className="card list-card" role="list">
                {data.installments.map((i) => (
                  <Row key={i.title} icon="installments" title={i.title} meta="قسط ماهانه" amount={formatMoney(i.monthlyToman, "IRT")} href="/debts/installments" />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <p className="expense-sub flex items-center gap-1.5">
        <Icon name="info" size={13} />
        فقط خواندنی: تشخیص از روی شرح تراکنش است (نام ماه و عدد نادیده گرفته می‌شود). برای یکی‌شدن دو شرح متفاوت، شرح را در تراکنش‌ها یکسان کنید.
      </p>
    </div>
  );
}
