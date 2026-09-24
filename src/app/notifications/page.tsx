import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { getReminders, INSTALLMENT_HORIZON_DAYS, type Reminder } from "@/features/notifications/service";
import { EmptyState, PageHeader, Section } from "@/components/ui/Card";
import Icon, { type IconName } from "@/components/ui/Icon";
import MarkRemindersSeen from "@/components/notifications/MarkRemindersSeen";
import { faCount, formatDaysUntil, formatJalaliIso, formatMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "یادآورها" };

const KIND: Record<Reminder["kind"], { icon: IconName; c: string; bg: string }> = {
  installment: { icon: "installments", c: "var(--negative)", bg: "var(--negative-soft)" },
  receivable: { icon: "arrow-down", c: "var(--positive)", bg: "var(--positive-soft)" },
  cheque: { icon: "note", c: "var(--warning)", bg: "var(--warning-soft)" },
  bounced: { icon: "alert", c: "var(--negative)", bg: "var(--negative-soft)" },
  deposit: { icon: "coins", c: "var(--info)", bg: "var(--info-soft)" },
  reconcile: { icon: "scale", c: "var(--warning)", bg: "var(--warning-soft)" },
  insurance: { icon: "shield", c: "var(--info)", bg: "var(--info-soft)" },
  vehicle: { icon: "car", c: "var(--warning)", bg: "var(--warning-soft)" },
  income: { icon: "arrow-up", c: "var(--positive)", bg: "var(--positive-soft)" },
  review: { icon: "check", c: "var(--info)", bg: "var(--info-soft)" },
};

function ReminderList({ items }: { items: Reminder[] }) {
  return (
    <ul className="card plan-list">
      {items.map((r) => {
        const k = KIND[r.kind];
        const when = r.date != null && r.days != null ? `${formatDaysUntil(r.days)} · ${formatJalaliIso(r.date)}` : null;
        return (
          <li key={r.key} className="plan-queue-row">
            <span className="plan-icon" style={{ background: k.bg, color: k.c }} aria-hidden="true">
              <Icon name={k.icon} size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="flex items-center gap-1.5 text-[length:var(--fs-sm)]">
                <span className="truncate">{r.title}</span>
                {!r.read && (
                  <span className="tx-unreviewed-dot" title="تازه">
                    <span className="sr-only">تازه</span>
                  </span>
                )}
              </b>
              {when && (
                <span className="expense-sub block" style={r.days != null && r.days < 0 ? { color: "var(--negative)" } : undefined}>
                  {when}
                </span>
              )}
            </span>
            {(r.amountToman || r.amountLabel) && (
              <span className="num plan-amount money-nowrap shrink-0" dir="rtl">
                {r.amountToman ? formatMoney(r.amountToman, "IRT") : r.amountLabel}
              </span>
            )}
            <Link href={r.href} className="btn btn-ghost !min-h-9 shrink-0 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
              {r.action}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function NotificationsPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? undefined;
  const reminders = await getReminders(userId);

  const overdue = reminders.filter((r) => r.days != null && r.days < 0);
  const upcoming = reminders.filter((r) => r.days != null && r.days >= 0);
  const other = reminders.filter((r) => r.days == null);
  const unreadKeys = reminders.filter((r) => !r.read).map((r) => r.key);

  return (
    <div className="space-y-5">
      <PageHeader
        title="یادآورها"
        subtitle={`اقساط و چک‌های سررسیدگذشته و ${faCount(INSTALLMENT_HORIZON_DAYS)} روز آینده، چک‌های برگشتی، سپرده‌های نزدیک سررسید، حساب‌هایی که با موجودی بانک یکی نیستند، حق بیمه‌ها و بیمه‌نامه‌های رو به پایان، معاینه فنی و عوارض خودرو، طلب‌هایی که باید دریافت کنید، درآمدهای ماهانه و تراکنش‌های بررسی‌نشده. هر یادآور با انجام کارش خودبه‌خود حذف می‌شود.`}
      />
      {userId && <MarkRemindersSeen keys={unreadKeys} />}

      {reminders.length === 0 ? (
        <div className="card">
          <EmptyState icon="check-circle" title="یادآوری ندارید" body="قسط نزدیک، طلب سررسیدشده یا تراکنش بررسی‌نشده‌ای وجود ندارد." />
        </div>
      ) : (
        <>
          {overdue.length > 0 && (
            <Section title="سررسید گذشته" hint={`${faCount(overdue.length)} مورد`}>
              <ReminderList items={overdue} />
            </Section>
          )}
          {upcoming.length > 0 && (
            <Section title="پیش رو" hint={`${faCount(upcoming.length)} مورد`}>
              <ReminderList items={upcoming} />
            </Section>
          )}
          {other.length > 0 && (
            <Section title="نیاز به بررسی">
              <ReminderList items={other} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
