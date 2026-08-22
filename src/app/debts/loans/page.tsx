import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader, Progress, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { D } from "@/domain/decimal";
import { formatDualDate, formatMoney, formatPct, formatQty, todayIso, faCount, toIrtMoney } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "وام‌ها" };

/**
 * بدهی → وام‌ها
 *
 * READ-ONLY VIEW. Every number comes from the existing `listDebts()` service,
 * whose outstanding balance is derived from the ledger (or, for planning-only
 * debts, from the existing scheduled-installment logic). This page performs no
 * mutation, creates no journal entry/posting and holds no debt state of its own.
 *
 * A "loan" here is presentation-only: an interest-bearing or instalment-backed
 * debt. The underlying record and its financial semantics are unchanged.
 */
export default async function LoansPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [debts, fx] = await Promise.all([listDebts(), getLatestUsdIrtRate()]);
  const toIrt = (usd: string | number) => toIrtMoney(usd, fx.rate);

  const today = todayIso();
  // Presentation split only — the stored records are identical.
  const loans = debts.filter((d) => Number(d.interestRate) > 0 || d.totalCount > 0);
  const active = loans.filter((d) => d.status !== "settled");
  const settled = loans.filter((d) => d.status === "settled");

  const totalOutstanding = active.reduce((s, d) => s + Number(d.outstandingBase), 0);
  const totalPrincipal = loans.reduce((s, d) => s + Number(d.principalBase), 0);
  const totalPaid = loans.reduce((s, d) => s + d.paidCount, 0);
  const totalInstallments = loans.reduce((s, d) => s + d.totalCount, 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="وام‌ها"
        subtitle="تسهیلات و بدهی‌های دارای برنامه بازپرداخت. مانده هر وام از سوابق مالی مشتق می‌شود."
        action={
          <Link href="/debts" className="btn btn-soft">
            <Icon name="debts" size={16} />
            همه بدهی‌ها
          </Link>
        }
      />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="مانده وام‌های فعال" value={toIrt(totalOutstanding) ?? formatMoney(totalOutstanding)} tone={totalOutstanding > 0 ? "down" : "neutral"} hint={fx.rate ? formatMoney(totalOutstanding) : `${faCount(active.length)} وام فعال`} />
        <Metric label="اصل کل تسهیلات" value={toIrt(totalPrincipal) ?? formatMoney(totalPrincipal)} hint={fx.rate ? formatMoney(totalPrincipal) : undefined} />
        <Metric
          label="اقساط پرداخت‌شده"
          value={`${faCount(totalPaid)} از ${faCount(totalInstallments)}`}
          tone={totalInstallments > 0 && totalPaid === totalInstallments ? "up" : "neutral"}
        />
        <Metric label="تسویه‌شده" value={faCount(settled.length)} />
      </section>

      <Section title="وضعیت هر وام" hint="ترتیب بر اساس مانده قابل پرداخت">
        {loans.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="card"
              title="وامی ثبت نشده است"
              body="بدهی‌های دارای نرخ سود یا برنامه اقساط، به‌عنوان وام در این بخش دیده می‌شوند."
              action={
                <Link href="/debts" className="btn btn-primary">
                  ثبت بدهی جدید
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {[...loans]
              .sort((a, b) => Number(b.outstandingBase) - Number(a.outstandingBase))
              .map((d) => {
                const progress = d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0;
                const isSettled = d.status === "settled";
                const late = d.nextDue && d.nextDue.dueDate < today;
                const repaid = D(d.principalBase).sub(isSettled ? d.principalBase : d.outstandingBase);
                return (
                  <li key={d.id} className="card p-4 sm:p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight">
                          {d.title}
                          <span className={isSettled ? "badge badge-pos" : "badge badge-neutral"}>{isSettled ? "تسویه شد" : "فعال"}</span>
                          {late && <span className="badge badge-neg">قسط معوق</span>}
                        </p>
                        <p className="muted mt-1 text-[11.5px]">
                          {d.creditor} · شروع {formatDualDate(d.startDate)} · نرخ سود{" "}
                          <span className="num" dir="rtl">
                            {formatQty(d.interestRate, 2)}٪
                          </span>
                        </p>
                      </div>
                      <div className="text-left">
                        <p className="muted text-[10.5px]">مانده قابل پرداخت</p>
                        <p className="num text-xl font-bold" dir="rtl" style={{ color: isSettled ? "var(--positive)" : "var(--negative)" }}>
                          {d.outstandingToman != null
                            ? formatMoney(isSettled ? 0 : d.outstandingToman, "IRT")
                            : toIrt(isSettled ? 0 : d.outstandingBase) ?? formatMoney(isSettled ? 0 : d.outstandingBase)}
                        </p>
                        <p className="muted num mt-0.5 text-[10.5px]" dir="rtl">
                          ≈ {formatMoney(isSettled ? 0 : d.outstandingBase)} · بازپرداخت‌شده:{" "}
                          {toIrt(repaid.toString()) ?? formatMoney(repaid.toString())}
                        </p>
                      </div>
                    </div>

                    {d.totalCount > 0 && (
                      <div className="mt-4">
                        <div className="mb-1.5 flex items-center justify-between text-[11px]">
                          <span className="muted">
                            <span className="num" dir="rtl">
                              {faCount(d.paidCount)} از {faCount(d.totalCount)}
                            </span>{" "}
                            قسط پرداخت شده
                          </span>
                          <span className="num" dir="rtl">
                            {formatPct(progress, 0)}
                          </span>
                        </div>
                        <Progress value={progress} color={isSettled ? "var(--positive)" : "var(--brand)"} />
                      </div>
                    )}

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3.5" style={{ borderColor: "var(--border)" }}>
                      <p className="text-[12px]" style={{ color: late ? "var(--negative)" : "var(--text-2)" }}>
                        {d.nextDue ? (
                          <>
                            قسط بعدی:{" "}
                            <b className="num">
                              {d.nextDue.amountToman != null
                                ? formatMoney(d.nextDue.amountToman, "IRT")
                                : toIrt(d.nextDue.amountBase) ?? formatMoney(d.nextDue.amountBase)}
                            </b>{" "}
                            · {formatDualDate(d.nextDue.dueDate)}
                          </>
                        ) : isSettled ? (
                          "همه اقساط پرداخت شدند."
                        ) : (
                          "اقساطی تعریف نشده است."
                        )}
                      </p>
                      <Link href="/debts/installments" className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[12px]">
                        برنامه اقساط
                      </Link>
                    </div>
                  </li>
                );
              })}
          </ul>
        )}
      </Section>
    </div>
  );
}
