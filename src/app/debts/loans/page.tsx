import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { isRealLoanDebt, listDebts } from "@/features/planning/service";
import { EmptyState, Progress, Section } from "@/components/ui/Card";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import { DEBT_TABS } from "@/components/ui/ModuleTabs";
import ModuleHeader from "@/components/money/ModuleHeader";
import ObligationCard from "@/components/debts/ObligationCard";
import { faCount, formatTomanPrimary, sumToman, todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "وام‌ها" };

/**
 * بدهی → وام‌ها
 *
 * READ-ONLY VIEW. Every number comes from the existing `listDebts()` service.
 * Contractual Toman amounts are authoritative; USD is display-only and moves
 * with the live FX rate.
 */
export default async function LoansPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [debts, fx] = await Promise.all([listDebts(), getLatestUsdIrtRate()]);

  const today = todayIso();
  // «قسط ≠ وام»: a real Loan / Facility is a debt with financing (interest
  // rate) or one already booked against a ledger liability account. A record
  // that is only a repayment schedule (planning-only debt with 0% interest,
  // e.g. a store installment for a rug) is NOT a loan and stays in
  // «بدهی‌ها»/«اقساط» — it must never be rendered as a Loan here.
  const loans = debts.filter(isRealLoanDebt);
  const active = loans.filter((d) => d.status !== "settled");

  const outDisp = formatTomanPrimary(sumToman(active.map((d) => d.outstandingToman)), fx.rate);
  const prinDisp = formatTomanPrimary(sumToman(loans.map((d) => d.principalToman)), fx.rate);
  const totalPaid = loans.reduce((s, d) => s + d.paidCount, 0);
  const totalInstallments = loans.reduce((s, d) => s + d.totalCount, 0);
  const sorted = [...loans].sort((a, b) => Number(b.outstandingToman ?? 0) - Number(a.outstandingToman ?? 0));

  return (
    <div className="mny-page">
      <ModuleHeader title="وام‌ها" tabs={DEBT_TABS} active="/debts/loans" label="بخش‌های تعهدات" />

      {loans.length > 0 && (
        <section className="mny-stats" style={{ ["--mny-cols" as string]: 4 }} aria-label="خلاصهٔ وام‌ها">
          <StatCard
            tone="ink"
            className="mny-stat-lead"
            icon="debts"
            label="ماندهٔ وام‌ها"
            period={`${faCount(active.length)} وام فعال`}
            value={<FormattedMoney value={outDisp.primary} />}
            hint={outDisp.usdHint ? `≈ ${outDisp.usdHint}` : undefined}
          />
          <StatCard
            icon="coins"
            label="اصل تسهیلات"
            value={<FormattedMoney value={prinDisp.primary} />}
            hint={prinDisp.usdHint ? `≈ ${prinDisp.usdHint}` : undefined}
          />
          <StatCard
            tone={totalInstallments > 0 && totalPaid === totalInstallments ? "positive" : "plain"}
            icon="installments"
            label="اقساط پرداخت‌شده"
            value={`${faCount(totalPaid)} از ${faCount(totalInstallments)}`}
            bar={
              totalInstallments > 0 ? (
                <Progress value={(totalPaid / totalInstallments) * 100} color="var(--positive)" aria-label="سهم اقساط پرداخت‌شده" />
              ) : undefined
            }
          />
        </section>
      )}

      <Section title="وام‌های من" action={<span className="muted num text-[length:var(--fs-xs)]">{faCount(loans.length)}</span>}>
        {loans.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="card"
              title="وامی ثبت نشده است"
              action={
                <Link href="/debts#new" className="btn btn-soft">
                  ثبت وام
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="obl-list">
            {sorted.map((d) => (
              <ObligationCard key={d.id} d={d} today={today} rate={fx.rate} />
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
