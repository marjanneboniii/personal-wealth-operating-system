import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, debts, installments } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import { formatDualDate, formatMoney, todayIso, faCount } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

export default async function InstallmentsPage() {
  const authUser = await ensureAuth();
  await seedIfEmpty();
  const rows = await db
    .select({
      id: installments.id,
      seq: installments.seq,
      dueDate: installments.dueDate,
      amountBase: installments.amountBase,
      amountToman: installments.amountToman,
      status: installments.status,
      paidAt: installments.paidAt,
      debtId: debts.id,
      title: debts.title,
      creditor: debts.creditor,
    })
    .from(installments)
    .innerJoin(debts, eq(debts.id, installments.debtId))
    .where(and(sql`${debts.deletedAt} is null`, authUser ? sql`(${debts.userId} = ${authUser.id} or ${debts.userId} is null)` : sql`1=1`))
    .orderBy(asc(installments.dueDate));

  const cashAccount = await db
    .select({ id: accounts.id })
    .from(accounts)
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .where(
      and(
        sql`${accounts.type} = 'asset' and ${accounts.assetId} is not null and ${accounts.deletedAt} is null`,
        authUser ? sql`(${accounts.userId} = ${authUser.id} or ${accounts.userId} is null)` : sql`1=1`,
      ),
    )
    .orderBy(asc(accounts.code))
    .limit(1);

  const fx = await getLatestUsdIrtRate();
  const toIrt = (usd: string | number) => (fx.rate ? formatMoney(Math.round(Number(usd) * Number(fx.rate)), "IRT") : null);

  const today = todayIso();
  const pending = rows.filter((r) => r.status === "pending");
  const paid = rows.filter((r) => r.status === "paid");
  const overdueList = pending.filter((r) => r.dueDate < today);
  const next30 = pending.filter((r) => r.dueDate >= today && daysUntil(r.dueDate) <= 30);
  const remainingTotal = pending.reduce((s, r) => s + Number(r.amountBase), 0);

  return (
    <div className="space-y-8">
      <PageHeader title="اقساط" />

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="معوق" value={String(overdueList.length)} tone={overdueList.length ? "down" : "up"} />
        <Metric label="در ۳۰ روز آینده" value={faCount(next30.length)} hint={next30.length ? toIrt(next30.reduce((s, r) => s + Number(r.amountBase), 0)) ?? formatMoney(next30.reduce((s, r) => s + Number(r.amountBase), 0)) : undefined} />
        <Metric label="مانده اقساط" value={toIrt(remainingTotal) ?? formatMoney(remainingTotal)} hint={fx.rate ? formatMoney(remainingTotal) : undefined} />
        <Metric label="پرداخت‌شده" value={faCount(paid.length)} tone="up" hint={`از ${faCount(rows.length)} قسط`} />
      </section>

      <Section title="زمان‌بندی اقساط">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="installments"
              title="هیچ قسطی برنامه‌ریزی نشده است"
              body="با تعریف بدهی و برنامه بازپرداخت، زمان‌بندی اقساط اینجا نمایش داده می‌شود."
              action={
                <Link href="/debts" className="btn btn-primary">
                  رفتن به بدهی‌ها
                </Link>
              }
            />
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>وضعیت</th>
                  <th>بدهی</th>
                  <th className="hidden sm:table-cell">قسط</th>
                  <th>سررسید</th>
                  <th className="td-num">مبلغ</th>
                  <th className="text-left">اقدام</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = r.status === "pending" && r.dueDate < today;
                  const soon = !late && r.status === "pending" && daysUntil(r.dueDate) <= 14;
                  const d = daysUntil(r.dueDate);
                  return (
                    <tr key={r.id} className={r.status === "paid" ? "opacity-50" : ""}>
                      <td>
                        {r.status === "paid" ? (
                          <span className="badge badge-pos">پرداخت‌شده</span>
                        ) : late ? (
                          <span className="badge badge-neg">معوق</span>
                        ) : soon ? (
                          <span className="badge badge-warn">نزدیک</span>
                        ) : (
                          <span className="badge badge-neutral">در انتظار</span>
                        )}
                      </td>
                      <td>
                        <span className="block text-[12.5px] font-medium">{r.title}</span>
                        <span className="muted text-[10px]">{r.creditor}</span>
                      </td>
                      <td className="num hidden sm:table-cell" dir="ltr">
                        #{r.seq}
                      </td>
                      <td>
                        <span className="num block text-[12px]">{formatDualDate(r.dueDate)}</span>
                        <span className="muted num text-[9.5px]">
                          {r.status === "paid" && r.paidAt
                            ? `پرداخت در ${formatDualDate(r.paidAt)}`
                            : d < 0
                              ? `${faCount(Math.abs(d))} روز گذشته`
                              : d === 0
                                ? "امروز"
                                : `${faCount(d)} روز دیگر`}
                        </span>
                      </td>
                      <td className="td-num font-bold" dir="rtl">
                        <div>{r.amountToman != null ? formatMoney(r.amountToman, "IRT") : toIrt(r.amountBase) ?? formatMoney(r.amountBase)}</div>
                        <div className="muted num text-[9.5px]">≈ {formatMoney(r.amountBase)}</div>
                      </td>
                      <td className="text-left">
                        {r.status === "pending" && (
                          <span className="flex justify-end gap-1">
                            <Link
                              href={`/new?type=debt_repayment&installmentId=${r.id}&entryDate=${r.dueDate}&title=${encodeURIComponent(`قسط ${r.seq} — ${r.title}`)}`}
                              className="btn btn-ghost !min-h-8 !px-2.5 !py-1 text-[11px]"
                            >
                              باز کردن در فرم
                            </Link>
                            <RowAction kind="pay-installment" id={r.id} cashAccountId={cashAccount[0]?.id} label="پرداخت سریع" primary />
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
