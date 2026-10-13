import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import { isReceivable } from "@/features/planning/obligations";
import { EmptyState, Section } from "@/components/ui/Card";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import DebtForm from "@/components/forms/DebtForm";
import Icon from "@/components/ui/Icon";
import { DEBT_TABS } from "@/components/ui/ModuleTabs";
import ModuleHeader from "@/components/money/ModuleHeader";
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
    <div className="mny-page">
      <ModuleHeader title="تعهدات مالی" tabs={DEBT_TABS} active="/debts" label="بخش‌های تعهدات" actions={<Link href="#new" className="btn btn-primary">
              <Icon name="plus" size={16} />
              ثبت بدهی یا طلب
            </Link>} />

      {all.length > 0 && (
        <section className="mny-stats" style={{ ["--mny-cols" as string]: receivables.length > 0 ? 5 : 4 }} aria-label="خلاصهٔ تعهدات">
          <StatCard
            tone="ink"
            className="mny-stat-lead"
            icon="debts"
            label="کل بدهی‌ها"
            period={`${faCount(debts.length)} بدهی`}
            value={<FormattedMoney value={debtDisp.primary} />}
            hint={debtDisp.usdHint ? `≈ ${debtDisp.usdHint}` : undefined}
          />
          {/* Shown only when the user actually has a receivable. */}
          {receivables.length > 0 && (
            <StatCard
              tone="positive"
              icon="arrow-up"
              label="کل مطالبات"
              period={`${faCount(receivables.length)} طلب`}
              value={<FormattedMoney value={receivableDisp.primary} />}
              hint={receivableDisp.usdHint ? `≈ ${receivableDisp.usdHint}` : undefined}
            />
          )}
          <StatCard
            icon="calendar"
            label="قسط بعدی"
            period={nextPayment ? `${nextPayment.title} · ${formatDaysUntil(daysUntil(nextPayment.dueDate))}` : undefined}
            value={nextDisp ? <FormattedMoney value={nextDisp.primary} /> : "—"}
          />
          <StatCard
            tone={overdueCount ? "negative" : "plain"}
            icon="alert"
            label="اقساط معوق"
            period={overdueCount ? "سررسید گذشته و پرداخت‌نشده" : "همه به‌موقع"}
            value={faCount(overdueCount)}
          />
        </section>
      )}

      {all.length === 0 ? (
        <div className="card">
          <EmptyState
            icon="debts"
            title="بدهی یا طلبی ثبت نشده است"
            body="وام، خرید قسطی یا پولی که از کسی طلب دارید را ثبت کنید تا اقساط و سررسیدها اینجا بیاید."
            action={
              <Link href="#new" className="btn btn-soft">
                ثبت بدهی یا طلب
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
