import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import { EmptyState, Card, Metric, PageHeader, Progress, Section, SectionLink } from "@/components/ui/Card";
import DebtForm from "@/components/forms/DebtForm";
import Icon from "@/components/ui/Icon";
import { formatDualDate, formatMoney, formatPct, formatQty, todayIso, faCount } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

export default async function DebtsPage() {
  await ensureAuth();
  await seedIfEmpty();
  const [debts, fx] = await Promise.all([listDebts(), getLatestUsdIrtRate()]);
  const toIrt = (usd: string | number) => (fx.rate ? formatMoney(Math.round(Number(usd) * Number(fx.rate)), "IRT") : null);

  const today = todayIso();
  const totalOutstanding = debts.reduce((s, d) => s + Number(d.outstandingBase), 0);
  const overdue = debts.flatMap((d) => d.installments.filter((i) => i.status === "pending" && i.dueDate < today));
  const active = debts.filter((d) => d.status === "active");
  const nextPayment = debts
    .flatMap((d) => (d.nextDue ? [{ ...d.nextDue, title: d.title }] : []))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  return (
    <div className="space-y-8">
      <PageHeader
        title="بدهی‌ها"
        subtitle="نمای کامل تعهدات شما. مانده هر بدهی از سوابق مالی مشتق می‌شود و این صفحه آن را تغییر نمی‌دهد."
        action={
          <div className="flex flex-wrap items-center gap-3">
            <Link href="#manual-debt" className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[12px]">
              <Icon name="plus" size={15} />
              ثبت بدهی دستی
            </Link>
            <SectionLink href="/debts/installments" label="برنامه اقساط" />
          </div>
        }
      />

      {/* Debt is its own domain: بدهی‌ها · وام‌ها · اقساط · تعهدات آینده */}
      <nav className="seg flex-wrap" aria-label="بخش‌های بدهی">
        <span className="seg-on">بدهی‌ها</span>
        <Link href="/debts/loans">وام‌ها</Link>
        <Link href="/debts/installments">اقساط</Link>
        <Link href="/debts/obligations">تعهدات آینده</Link>
      </nav>

      <section className="grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric
          label="مانده کل بدهی"
          value={toIrt(totalOutstanding) ?? formatMoney(totalOutstanding)}
          tone={totalOutstanding > 0 ? "down" : "up"}
          hint={totalOutstanding === 0 ? "بدهی‌ای ندارید" : fx.rate ? formatMoney(totalOutstanding) : `${active.length} بدهی فعال`}
        />
        <Metric label="اقساط معوق" value={String(overdue.length)} tone={overdue.length ? "down" : "up"} />
        <Metric
          label="قسط بعدی"
          value={nextPayment ? (toIrt(nextPayment.amountBase) ?? formatMoney(nextPayment.amountBase)) : "—"}
          hint={nextPayment ? `${nextPayment.title} · ${formatDualDate(nextPayment.dueDate)}` : "قسطی در انتظار نیست"}
        />
        <Metric
          label="تسویه‌شده"
          value={String(debts.filter((d) => d.status === "settled").length)}
          hint={debts.length ? `از مجموع ${debts.length} بدهی` : undefined}
        />
      </section>

      <section id="manual-debt" className="scroll-mt-24">
        <Section title="تعریف دستی بدهی" hint="اول پیش‌نمایش را ببینید؛ فقط بعد از تأیید نهایی، بدهی و اقساط در برنامه‌ریزی ذخیره می‌شوند.">
          <Card className="p-4 sm:p-5" title="بدهی جدید">
            <DebtForm today={today} initialRate={fx.rate} initialRateDate={fx.effectiveDate} initialRateSource={fx.source} />
          </Card>
        </Section>
      </section>

      <Section title="وضعیت هر بدهی">
        {debts.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="debts"
              title="هیچ بدهی‌ای ثبت نشده است"
              body="وقتی وام یا بدهی راه‌اندازی شود، مانده‌اش از دفترکل محاسبه و برنامه بازپرداختش اینجا دنبال می‌شود."
            />
          </div>
        ) : (
          <ul className="space-y-2.5">
            {debts.map((d) => {
              const progress = d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0;
              const settled = d.status === "settled";
              const late = d.nextDue && d.nextDue.dueDate < today;
              const dDays = d.nextDue ? daysUntil(d.nextDue.dueDate) : null;
              return (
                <li key={d.id} className="card p-4 sm:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold tracking-tight">
                        {settled && (
                          <span style={{ color: "var(--positive)" }}>
                            <Icon name="check-circle" size={17} />
                          </span>
                        )}
                        {d.title}
                        <span className={settled ? "badge badge-pos" : "badge badge-neutral"}>{settled ? "تسویه شد" : "فعال"}</span>
                        {late && <span className="badge badge-neg">قسط معوق</span>}
                      </p>
                      <p className="muted mt-1 text-[11.5px]">
                        {d.creditor} · شروع {formatDualDate(d.startDate)} · نرخ سود <span className="num" dir="rtl">{formatQty(d.interestRate, 2)}٪</span>
                      </p>
                    </div>
                    <div className="text-left">
                      <p className="muted text-[10.5px]">مانده قابل پرداخت</p>
                      <p className="num text-xl font-bold" dir="rtl" style={{ color: settled ? "var(--positive)" : "var(--negative)" }}>
                        {d.outstandingToman != null
                          ? formatMoney(settled ? 0 : d.outstandingToman, "IRT")
                          : formatMoney(settled ? 0 : d.outstandingBase)}
                      </p>
                      <p className="muted num mt-0.5 text-[10.5px]" dir="rtl">
                        {d.outstandingToman != null
                          ? <>≈ {formatMoney(settled ? 0 : d.outstandingBase)}</>
                          : <>اصل: {formatMoney(d.principalBase)}</>}
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
                      <Progress value={progress} color={settled ? "var(--positive)" : "var(--brand)"} />
                    </div>
                  )}

                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-3.5" style={{ borderColor: "var(--border)" }}>
                    <p className="text-[12px]" style={{ color: late ? "var(--negative)" : "var(--text-2)" }}>
                      {d.nextDue ? (
                        <>
                          قسط بعدی: <b className="num">{d.nextDue.amountToman != null ? formatMoney(d.nextDue.amountToman, "IRT") : formatMoney(d.nextDue.amountBase)}</b> ·{" "}
                          {dDays != null && dDays < 0 ? (
                            <b>{faCount(Math.abs(dDays))} روز گذشته</b>
                          ) : dDays === 0 ? (
                            <b>امروز</b>
                          ) : (
                            <span className="num">{faCount(dDays ?? 0)} روز دیگر</span>
                          )}
                        </>
                      ) : settled ? (
                        "همه اقساط پرداخت شدند."
                      ) : (
                        "اقساطی تعریف نشده است."
                      )}
                    </p>
                    <div className="flex gap-1.5">
                      {d.nextDue && (
                        <Link
                          href={`/new?type=debt_repayment&installmentId=${d.nextDue.id}&entryDate=${d.nextDue.dueDate}&title=${encodeURIComponent(`قسط ${d.nextDue.seq} — ${d.title}`)}`}
                          className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[12px]"
                        >
                          پرداخت قسط بعدی
                        </Link>
                      )}
                      <Link href="/debts/installments" className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[12px]">
                        همه اقساط
                      </Link>
                    </div>
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
