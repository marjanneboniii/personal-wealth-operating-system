import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listEvents, listObligations, upcomingInstallments } from "@/features/planning/service";
import { EmptyState, Section } from "@/components/ui/Card";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import { DEBT_TABS } from "@/components/ui/ModuleTabs";
import ModuleHeader from "@/components/money/ModuleHeader";
import Icon from "@/components/ui/Icon";
import { formatDaysUntil, formatJalaliIso, todayIso, faCount, formatTomanPrimary, sumToman } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

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
 * PLANNED ≠ ACTUAL. Future commitments only. Contractual Toman is authoritative;
 * USD is a live display equivalent and never rewrites the Toman figure.
 */
export default async function ObligationsPage() {
  await ensureAuth();
  await seedIfEmpty();

  const [obligations, events, insts, fx] = await Promise.all([
    listObligations(),
    listEvents(),
    upcomingInstallments(100),
    getLatestUsdIrtRate(),
  ]);

  const today = todayIso();

  type Row = {
    id: string;
    title: string;
    date: string;
    /** Contractual Toman — never recomputed from USD. */
    amountToman: string;
    kind: string;
    detail: string | null;
  };

  const rows: Row[] = [
    ...insts.map((i) => ({
      id: `inst-${i.id}`,
      title: `قسط ${i.seq} — ${i.debtTitle}`,
      date: i.dueDate,
      amountToman: i.amountToman != null ? String(i.amountToman) : "0",
      kind: "قسط",
      detail: i.creditor,
    })),
    ...obligations
      .filter((o) => o.status === "pending")
      .map((o) => ({
        id: `obl-${o.id}`,
        title: o.title,
        date: o.dueDate,
        amountToman: o.amountToman ?? String(o.amountBase),
        kind: RECURRENCE_LABEL[o.recurrence] ?? "تعهد",
        detail: o.note ?? null,
      })),
    ...events
      .filter((e) => e.status === "planned")
      .map((e) => ({
        id: `evt-${e.id}`,
        title: e.name,
        date: e.eventDate,
        amountToman: e.budgetToman ?? String(e.budgetBase),
        kind: "رویداد",
        detail: e.note ?? null,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const overdue = rows.filter((r) => r.date < today);
  const next30 = rows.filter((r) => r.date >= today && daysUntil(r.date) <= 30);
  const next90 = rows.filter((r) => r.date >= today && daysUntil(r.date) <= 90);
  const totalDisp = formatTomanPrimary(sumToman(rows.filter((r) => r.date >= today).map((r) => r.amountToman)), fx.rate);
  const n30Disp = formatTomanPrimary(sumToman(next30.map((r) => r.amountToman)), fx.rate);
  const n90Disp = formatTomanPrimary(sumToman(next90.map((r) => r.amountToman)), fx.rate);

  return (
    <div className="mny-page">
      <ModuleHeader title="تعهدات آینده" tabs={DEBT_TABS} active="/debts/obligations" label="بخش‌های تعهدات" actions={<Link href="/goals" className="btn btn-primary">
              <Icon name="plus" size={16} />
              افزودن رویداد آینده
            </Link>} />

      {rows.length > 0 && (
        <section className="mny-stats" style={{ ["--mny-cols" as string]: 5 }} aria-label="خلاصهٔ تعهدات آینده">
          <StatCard
            tone="ink"
            className="mny-stat-lead"
            icon="calendar"
            label="مجموع پیش‌رو"
            period={`${faCount(rows.length - overdue.length)} قسط، تعهد و رویداد`}
            value={<FormattedMoney value={totalDisp.primary} />}
            hint={totalDisp.usdHint ? `≈ ${totalDisp.usdHint}` : undefined}
          />
          <StatCard
            tone={overdue.length ? "negative" : "plain"}
            icon="alert"
            label="سررسید گذشته"
            period={overdue.length ? "هنوز تسویه نشده" : "موردی نیست"}
            value={faCount(overdue.length)}
          />
          <StatCard icon="clock" label="۳۰ روز آینده" period={next30.length ? n30Disp.primary : "موردی نیست"} value={faCount(next30.length)} />
          <StatCard icon="calendar" label="۹۰ روز آینده" period={next90.length ? n90Disp.primary : "موردی نیست"} value={faCount(next90.length)} />
        </section>
      )}

      <Section title="زمان‌بندی تعهدات">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="calendar"
              title="تعهد آینده‌ای ثبت نشده است"
              body="اقساط بدهی‌ها از «ثبت بدهی یا طلب» و رویدادهای آینده از دکمهٔ بالا اینجا می‌آیند."
            />
          </div>
        ) : (
          <ul className="obl-list" aria-label="زمان‌بندی تعهدات">
            {rows.map((r) => {
              const d = daysUntil(r.date);
              const late = r.date < today;
              const soon = !late && d <= 14;
              const disp = formatTomanPrimary(r.amountToman, fx.rate);
              return (
                <li key={r.id} className="obl-row">
                  <span className="obl-dot" data-tone={late ? "late" : soon ? "soon" : undefined} aria-hidden="true" />
                  <div className="obl-main">
                    <span className="obl-title">{r.title}</span>
                    <span className="obl-meta">
                      {r.kind}
                      {r.detail ? ` · ${r.detail}` : ""}
                    </span>
                  </div>
                  <div className="obl-side">
                    <span className="num money-nowrap obl-amount" dir="rtl">
                      {disp.primary}
                    </span>
                    <span className="obl-when">
                      <span className="num">{formatJalaliIso(r.date)}</span>
                      <span aria-hidden="true"> · </span>
                      <span
                        className="whitespace-nowrap"
                        style={{ color: late ? "var(--negative)" : soon ? "var(--warning)" : "var(--text-3)" }}
                      >
                        {formatDaysUntil(d)}
                      </span>
                    </span>
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
