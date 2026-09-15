import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import { isReceivable } from "@/features/planning/obligations";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import DebtForm from "@/components/forms/DebtForm";
import Icon from "@/components/ui/Icon";
import ModuleTabs, { DEBT_TABS } from "@/components/ui/ModuleTabs";
import ObligationCard, { daysUntil } from "@/components/debts/ObligationCard";
import NewObligationPanel from "@/components/debts/NewObligationPanel";
import { faCount, formatDaysUntil, formatTomanPrimary, sumToman, todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "تعهدات مالی" };

export default async function DebtsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [all, fx] = await Promise.all([listDebts(), getLatestUsdIrtRate()]);

  const today = todayIso();
  // DIRECTION SPLIT. The two sides are never summed together: netting a
  // receivable against a debt would report neither correctly.
  const debts = all.filter((d) => !isReceivable(d.direction));
  const receivables = all.filter((d) => isReceivable(d.direction));

  // Toman is authoritative — never rebuild from USD × live rate.
  const totalDebtToman = sumToman(debts.map((d) => d.outstandingToman));
  const debtDisp = formatTomanPrimary(totalDebtToman, fx.rate);
  const receivableDisp = formatTomanPrimary(sumToman(receivables.map((d) => d.outstandingToman)), fx.rate);
  const overdueCount = all.reduce(
    (n, d) => n + d.installments.filter((i) => i.status !== "paid" && i.dueDate < today).length,
    0,
  );
  const nextPayment = debts
    .flatMap((d) => (d.nextDue ? [{ ...d.nextDue, title: d.title }] : []))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const nextDisp =
    nextPayment?.amountToman != null ? formatTomanPrimary(String(nextPayment.amountToman), fx.rate) : null;

  return (
    <div className="space-y-7">
      <div>
        <PageHeader
          title="تعهدات مالی"
          action={
            <Link href="#new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت تعهد
            </Link>
          }
        />
        <ModuleTabs tabs={DEBT_TABS} active="/debts" label="بخش‌های تعهدات" />
      </div>

      <section className="metric-strip">
        <Metric
          label="کل بدهی‌ها"
          value={debtDisp.primary}
          tone={Number(totalDebtToman) > 0 ? "down" : "neutral"}
          hint={debtDisp.usdHint ? `≈ ${debtDisp.usdHint}` : undefined}
        />
        {/* Shown only when the user actually has a receivable. */}
        {receivables.length > 0 && (
          <Metric
            label="کل مطالبات"
            value={receivableDisp.primary}
            tone="up"
            hint={receivableDisp.usdHint ? `≈ ${receivableDisp.usdHint}` : undefined}
          />
        )}
        <Metric
          label="قسط بعدی"
          value={nextDisp?.primary ?? "—"}
          hint={nextPayment ? `${nextPayment.title} · ${formatDaysUntil(daysUntil(nextPayment.dueDate))}` : undefined}
        />
        <Metric label="اقساط معوق" value={faCount(overdueCount)} tone={overdueCount ? "down" : "neutral"} />
      </section>

      {all.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="debts"
            title="تعهدی ثبت نشده است"
            action={
              <Link href="#new" className="btn btn-soft">
                ثبت اولین تعهد
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <Section
            title="بدهی‌های من"
            action={<span className="muted num text-[length:var(--fs-xs)]">{faCount(debts.length)}</span>}
          >
            {debts.length === 0 ? (
              <p className="card muted text-center text-[length:var(--fs-sm)]">بدهی‌ای ندارید</p>
            ) : (
              <ul className="obl-list">
                {debts.map((d) => (
                  <ObligationCard key={d.id} d={d} today={today} rate={fx.rate} />
                ))}
              </ul>
            )}
          </Section>

          {receivables.length > 0 && (
            <Section
              title="مطالبات من"
              action={<span className="muted num text-[length:var(--fs-xs)]">{faCount(receivables.length)}</span>}
            >
              <ul className="obl-list">
                {receivables.map((d) => (
                  <ObligationCard key={d.id} d={d} today={today} rate={fx.rate} />
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      <NewObligationPanel>
        <DebtForm
          today={today}
          initialRate={fx.rate}
          initialRateDate={fx.effectiveDate}
          initialRateSource={fx.source}
        />
      </NewObligationPanel>
    </div>
  );
}
