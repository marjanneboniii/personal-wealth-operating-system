import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import { Card, Money, PageHeader, Progress, Stat } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import { formatMoney, getDualDate } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { D } from "@/domain/decimal";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DebtsPage() {
  await seedIfEmpty();
  const [debts, cashAccounts, fxSnap] = await Promise.all([
    listDebts(),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, symbol: assets.symbol })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .where(sql`${accounts.type} = 'asset' and ${accounts.assetId} is not null`)
      .orderBy(asc(accounts.code)),
    getLatestUsdIrtRate(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const rate = fxSnap.rate;
  const totalOutstanding = debts.reduce((s, d) => s + Number(d.outstandingBase), 0);
  const overdue = debts.flatMap((d) => d.installments.filter((i) => i.status === "pending" && i.dueDate < today));
  const next30 = debts.flatMap((d) =>
    d.installments.filter((i) => i.status === "pending" && i.dueDate >= today).slice(0, 1),
  );

  const toIrt = (usd: string) => (rate ? D(usd).mul(rate).toFixed(0) : usd);
  const toUsd = (irt: string) => (rate ? D(irt).div(rate).toFixed(2) : "—");

  return (
    <div className="space-y-4">
      <PageHeader
        title="بدهی‌ها و اقساط — لایه برنامه‌ریزی"
        subtitle="تا قبل از تبدیل به تراکنش واقعی، بدهی‌ها و اقساط فقط تعهد برنامه‌ریزی هستند؛ هیچ Journal Entry ایجاد نمی‌کنند. معادل دلاری با آخرین نرخ به‌صورت لحظه‌ای محاسبه می‌شود."
      />

      <div className="soft rounded-2xl p-3 text-[11px] flex flex-wrap items-center justify-between gap-2">
        <span>نرخ دلار مرجع: <strong dir="ltr" className="num">{formatMoney(rate, "IRT")}</strong> ≈ $1</span>
        <span className="muted">تاریخ نرخ: <span dir="ltr" className="num">{fxSnap.effectiveDate}</span> · منبع: {fxSnap.source} · تا قبل از «تأیید نهایی»، هیچ سندی در دفترکل ایجاد نمی‌شود</span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="مانده کل بدهی" value={formatMoney(totalOutstanding)} tone="down" />
        <Stat label="اقساط معوق" value={String(overdue.length)} tone={overdue.length ? "down" : "up"} />
        <Stat label="قسط بعدی" value={formatMoney(next30.reduce((s, i) => s + Number(i.amountBase), 0))} />
        <Stat label="تعداد بدهی فعال" value={String(debts.filter((d) => d.status === "active").length)} />
      </div>

      {debts.map((d) => {
        const progress = d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0;
        const dualStart = getDualDate(d.startDate);
        return (
          <Card
            key={d.id}
            title={`${d.title} — ${d.creditor}`}
            action={<span className="chip">{d.status === "settled" ? "تسویه شده" : "فعال"}</span>}
          >
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="muted text-[10px]">اصل بدهی (IRT مرجع)</div>
                <div className="num font-bold" dir="rtl">{formatMoney(toIrt(d.principalBase), "IRT")}</div>
                <div className="num text-[10px]" dir="ltr" style={{ color: "var(--accent)" }}>{formatMoney(d.principalBase, "USD")} <span className="chip text-[10px]">ذخیره USD</span></div>
              </div>
              <div>
                <div className="muted text-[10px]">مانده قابل پرداخت</div>
                <div className="num font-bold" dir="rtl" style={{ color: "var(--danger)" }}>{formatMoney(toIrt(d.outstandingBase), "IRT")}</div>
                <div className="num text-[10px]" dir="ltr">{formatMoney(d.outstandingBase, "USD")}</div>
              </div>
              <div>
                <div className="muted text-[10px]">نرخ سود</div>
                <span className="num" dir="ltr">{Number(d.interestRate)}%</span>
                <div className="muted text-[10px]">شروع شمسی: {dualStart.jalali}</div>
                <div className="muted text-[10px]">میلادی: <span dir="ltr" className="num">{dualStart.gregorian}</span></div>
              </div>
              <div>
                <div className="muted text-[10px]">اقساط پرداختی</div>
                <span className="num" dir="ltr">{d.paidCount}/{d.totalCount}</span>
                <div className="mt-1">
                  <Link href={`/new?type=expense&debtId=${d.id}&title=${encodeURIComponent(d.title)}`} className="btn btn-ghost !py-1 !px-2 text-[10px]">بارگذاری در فرم تراکنش</Link>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <Progress value={progress} />
            </div>

            <div className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold">اقساط — نمایش دوگانه تاریخ و مبلغ</span>
                <span className="chip text-[10px]">تا قبل از پرداخت، هیچ سندی ایجاد نشده</span>
              </div>
              <div className="max-h-96 overflow-y-auto rounded-2xl border" style={{ borderColor: "var(--line)" }}>
                <table className="w-full text-right text-[11px]">
                  <thead className="muted sticky top-0" style={{ background: "var(--bg-elev)" }}>
                    <tr>
                      <th className="py-2 px-2 font-normal">#</th>
                      <th className="py-2 px-2 font-normal">سررسید (شمسی / میلادی)</th>
                      <th className="py-2 px-2 font-normal">مبلغ (IRT / USD)</th>
                      <th className="py-2 px-2 font-normal">وضعیت</th>
                      <th className="py-2 px-2 font-normal">عملیات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.installments.map((i) => {
                      const late = i.status === "pending" && i.dueDate < today;
                      const dual = getDualDate(i.dueDate);
                      const irt = toIrt(i.amountBase);
                      return (
                        <tr key={i.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                          <td className="num py-2 px-2" dir="ltr">{i.seq}</td>
                          <td className="py-2 px-2">
                            <div dir="rtl" className="font-bold">{dual.jalali}</div>
                            <div dir="ltr" className="num text-[10px] muted">{dual.gregorian}</div>
                          </td>
                          <td className="py-2 px-2">
                            <div className="num font-bold" dir="rtl">{formatMoney(irt, "IRT")}</div>
                            <div className="num text-[10px]" dir="ltr" style={{ color: "var(--accent)" }}>{formatMoney(i.amountBase, "USD")}</div>
                          </td>
                          <td className="py-2 px-2">
                            <span
                              className="chip"
                              style={
                                i.status === "paid"
                                  ? { color: "var(--accent)" }
                                  : late
                                    ? { color: "var(--danger)" }
                                    : undefined
                              }
                            >
                              {i.status === "paid" ? "پرداخت‌شده" : late ? "معوق" : "در انتظار"}
                            </span>
                          </td>
                          <td className="py-2 px-2">
                            <div className="flex flex-wrap gap-1">
                              {i.status === "pending" && (
                                <>
                                  <Link
                                    href={`/new?type=expense&installmentId=${i.id}&irtAmount=${irt}&entryDate=${i.dueDate}&title=${encodeURIComponent(`قسط ${i.seq} — ${d.title}`)}`}
                                    className="btn btn-primary !py-1 !px-2 text-[10px]"
                                  >
                                    تکمیل خودکار
                                  </Link>
                                  <RowAction
                                    kind="pay-installment"
                                    id={i.id}
                                    cashAccountId={cashAccounts[0]?.id}
                                    label="پرداخت سریع"
                                  />
                                </>
                              )}
                              <Link href={`/ledger`} className="btn btn-ghost !py-1 !px-2 text-[10px]">دفترکل</Link>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="soft rounded-xl p-3 mt-3 text-[11px] leading-6">
              <strong>راهنما:</strong> برای پرداخت هر قسط، «تکمیل خودکار» را بزنید تا فرم استاندارد ثبت تراکنش با اطلاعات مرجع مقداردهی شود. پیش‌نمایش کامل (مبلغ تومان، معادل دلاری، نرخ، تاریخ‌های دوگانه، وضعیت پس از پرداخت) نمایش داده می‌شود و تنها پس از «تأیید نهایی ثبت تراکنش» سند حسابداری از همان مسیر استاندارد ایجاد و نرخ Freeze می‌شود. سپس وضعیت قسط/بدهی به‌صورت خودکار و در یک تراکنش یکپارچه به‌روزرسانی می‌شود (جلوگیری از ثبت تکراری، کنترل مانده، Rollback در صورت خطا).
            </div>
          </Card>
        );
      })}
    </div>
  );
}
