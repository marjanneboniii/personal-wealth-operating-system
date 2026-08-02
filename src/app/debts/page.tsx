import { asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets } from "@/db/schema";
import { seedIfEmpty } from "@/db/seed";
import { listDebts } from "@/features/planning/service";
import { Card, Money, PageHeader, Progress, Stat } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import { formatMoney, formatShortDate, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DebtsPage() {
  await seedIfEmpty();
  const [debts, cashAccounts] = await Promise.all([
    listDebts(),
    db
      .select({ id: accounts.id, code: accounts.code, name: accounts.name, symbol: assets.symbol })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .where(sql`${accounts.type} = 'asset' and ${accounts.assetId} is not null`)
      .orderBy(asc(accounts.code)),
  ]);

  const defaultCash = cashAccounts[0]?.id;
  const today = todayIso();
  const totalOutstanding = debts.reduce((s, d) => s + Number(d.outstandingBase), 0);
  const overdue = debts.flatMap((d) => d.installments.filter((i) => i.status === "pending" && i.dueDate < today));
  const next30 = debts.flatMap((d) =>
    d.installments.filter((i) => i.status === "pending" && i.dueDate >= today).slice(0, 1),
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title="بدهی‌ها و اقساط"
        subtitle="پرداخت هر قسط یک سند دوطرفه می‌سازد و مانده بدهی را از دفترکل کم می‌کند."
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="مانده کل بدهی" value={formatMoney(totalOutstanding)} tone="down" />
        <Stat label="اقساط معوق" value={String(overdue.length)} tone={overdue.length ? "down" : "up"} />
        <Stat label="قسط بعدی" value={formatMoney(next30.reduce((s, i) => s + Number(i.amountBase), 0))} />
        <Stat label="تعداد بدهی فعال" value={String(debts.filter((d) => d.status === "active").length)} />
      </div>

      {debts.map((d) => {
        const progress = d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0;
        return (
          <Card
            key={d.id}
            title={`${d.title} — ${d.creditor}`}
            action={<span className="chip">{d.status === "settled" ? "تسویه شده" : "فعال"}</span>}
          >
            <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
              <div>
                <div className="muted text-[10px]">اصل بدهی</div>
                <Money value={d.principalBase} />
              </div>
              <div>
                <div className="muted text-[10px]">مانده</div>
                <span style={{ color: "var(--danger)" }}><Money value={d.outstandingBase} /></span>
              </div>
              <div>
                <div className="muted text-[10px]">نرخ سود</div>
                <span className="num" dir="ltr">{Number(d.interestRate)}%</span>
              </div>
              <div>
                <div className="muted text-[10px]">اقساط پرداختی</div>
                <span className="num" dir="ltr">{d.paidCount}/{d.totalCount}</span>
              </div>
            </div>
            <div className="mt-3">
              <Progress value={progress} />
            </div>

            <div className="mt-4 max-h-72 overflow-y-auto">
              <table className="w-full text-right text-[11px]">
                <thead className="muted sticky top-0" style={{ background: "var(--bg-elev)" }}>
                  <tr>
                    <th className="py-1 font-normal">#</th>
                    <th className="py-1 font-normal">سررسید</th>
                    <th className="py-1 font-normal">مبلغ</th>
                    <th className="py-1 font-normal">وضعیت</th>
                    <th className="py-1 font-normal"></th>
                  </tr>
                </thead>
                <tbody>
                  {d.installments.map((i) => {
                    const late = i.status === "pending" && i.dueDate < today;
                    return (
                      <tr key={i.id} className="border-t" style={{ borderColor: "var(--line)" }}>
                        <td className="num py-2" dir="ltr">{i.seq}</td>
                        <td className="py-2">{formatShortDate(i.dueDate)}</td>
                        <td className="num py-2" dir="ltr">{formatMoney(i.amountBase)}</td>
                        <td className="py-2">
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
                        <td className="py-2 text-left">
                          {i.status === "pending" && (
                            <RowAction
                              kind="pay-installment"
                              id={i.id}
                              cashAccountId={defaultCash}
                              label="پرداخت"
                              primary={late}
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="muted mt-2 text-[10px]">
              پرداخت از حساب پیش‌فرض «{cashAccounts[0]?.name}» ثبت می‌شود.
            </p>
          </Card>
        );
      })}
    </div>
  );
}
