import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listEvents, listObligations, upcomingInstallments } from "@/features/planning/service";
import { Alert, EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import { formatDualDate, formatMoney, todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "تعهدات آینده" };

function daysUntil(iso: string) {
  return Math.ceil((new Date(iso + "T00:00:00Z").getTime() - Date.now()) / 86_400_000);
}

const RECURRENCE_LABEL: Record<string, string> = {
  monthly: "ماهانه",
  yearly: "سالانه",
  none: "یک‌بار",
};

/**
 * بدهی → تعهدات آینده
 *
 * PLANNED ≠ ACTUAL (§19). Everything on this page is a *future, scheduled*
 * commitment: pending installments, pending obligations and planned events.
 * None of it is a posted financial event, none of it is counted as a cash
 * outflow, and rendering this page creates no journal entry or posting.
 *
 * All rows are read through the existing planning services — no new query
 * model, no second obligation state.
 */
export default async function ObligationsPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [obligations, events, insts] = await Promise.all([
    listObligations(),
    listEvents(),
    upcomingInstallments(100),
  ]);

  const today = todayIso();

  type Row = {
    id: string;
    title: string;
    date: string;
    amount: string;
    kind: "installment" | "obligation" | "event";
    badge: string;
    detail: string | null;
  };

  const rows: Row[] = [
    ...insts.map((i) => ({
      id: `inst-${i.id}`,
      title: `قسط ${i.seq} — ${i.debtTitle}`,
      date: i.dueDate,
      amount: String(i.amountBase),
      kind: "installment" as const,
      badge: "قسط",
      detail: i.creditor,
    })),
    ...obligations
      .filter((o) => o.status === "pending")
      .map((o) => ({
        id: `obl-${o.id}`,
        title: o.title,
        date: o.dueDate,
        amount: String(o.amountBase),
        kind: "obligation" as const,
        badge: RECURRENCE_LABEL[o.recurrence] ?? "تعهد",
        detail: o.note ?? null,
      })),
    ...events
      .filter((e) => e.status === "planned")
      .map((e) => ({
        id: `evt-${e.id}`,
        title: e.name,
        date: e.eventDate,
        amount: String(e.budgetBase),
        kind: "event" as const,
        badge: "رویداد",
        detail: e.note ?? null,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const overdue = rows.filter((r) => r.date < today);
  const next30 = rows.filter((r) => r.date >= today && daysUntil(r.date) <= 30);
  const next90 = rows.filter((r) => r.date >= today && daysUntil(r.date) <= 90);
  const totalCommitted = rows.filter((r) => r.date >= today).reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="تعهدات آینده"
        subtitle="پرداخت‌های دانسته‌ای که هنوز رخ نداده‌اند — اقساط سررسیدنشده، تعهدات و رویدادهای برنامه‌ریزی‌شده."
        action={
          <Link href="/debts" className="btn btn-soft">
            <Icon name="debts" size={16} />
            بدهی‌ها
          </Link>
        }
      />

      <Alert tone="info" title="این‌ها هنوز تراکنش واقعی نیستند">
        تعهد آینده با تراکنش ثبت‌شده یکی نیست. تا زمانی که پرداخت واقعی انجام نشود، هیچ سندی در سوابق مالی ایجاد
        نمی‌شود و ارزش خالص شما تغییری نمی‌کند.
      </Alert>

      <section className="rise grid grid-cols-2 gap-y-5 border-b pb-6 sm:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="سررسید گذشته" value={String(overdue.length)} tone={overdue.length ? "down" : "up"} />
        <Metric
          label="۳۰ روز آینده"
          value={String(next30.length)}
          hint={next30.length ? formatMoney(next30.reduce((s, r) => s + Number(r.amount), 0)) : undefined}
        />
        <Metric
          label="۹۰ روز آینده"
          value={String(next90.length)}
          hint={next90.length ? formatMoney(next90.reduce((s, r) => s + Number(r.amount), 0)) : undefined}
        />
        <Metric label="مجموع تعهدات پیش‌رو" value={formatMoney(totalCommitted)} />
      </section>

      <Section title="زمان‌بندی تعهدات" hint="از نزدیک‌ترین سررسید به دورترین">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="calendar"
              title="تعهد آینده‌ای ثبت نشده است"
              body="اقساط سررسیدنشده، تعهدات دوره‌ای و رویدادهای برنامه‌ریزی‌شده اینجا کنار هم دیده می‌شوند."
              action={
                <Link href="/goals" className="btn btn-primary">
                  ثبت تعهد یا رویداد
                </Link>
              }
            />
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>نوع</th>
                  <th>عنوان</th>
                  <th>سررسید</th>
                  <th className="td-num">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const late = r.date < today;
                  const soon = !late && daysUntil(r.date) <= 14;
                  const d = daysUntil(r.date);
                  return (
                    <tr key={r.id}>
                      <td>
                        <span className={late ? "badge badge-neg" : soon ? "badge badge-warn" : "badge badge-neutral"}>{r.badge}</span>
                      </td>
                      <td>
                        <span className="block text-[12.5px] font-medium">{r.title}</span>
                        {r.detail && <span className="muted text-[10px]">{r.detail}</span>}
                      </td>
                      <td>
                        <span className="num block text-[12px]">{formatDualDate(r.date)}</span>
                        <span className="muted num text-[9.5px]">
                          {d < 0 ? `${Math.abs(d)} روز گذشته` : d === 0 ? "امروز" : `${d} روز دیگر`}
                        </span>
                      </td>
                      <td className="td-num font-bold" dir="ltr">
                        {formatMoney(r.amount)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <p className="muted flex items-center gap-1.5 text-[11px]">
        <Icon name="info" size={13} />
        برای پرداخت واقعی یک قسط، از «اقساط» یا فرم ثبت تراکنش استفاده کنید تا اثر مالی آن به‌درستی در سوابق مالی ثبت شود.
      </p>
    </div>
  );
}
