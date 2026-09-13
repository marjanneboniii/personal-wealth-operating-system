import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import { listEvents, listObligations, upcomingInstallments } from "@/features/planning/service";
import { EmptyState, Metric, PageHeader, Section } from "@/components/ui/Card";
import ModuleTabs, { DEBT_TABS } from "@/components/ui/ModuleTabs";
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
    <div className="space-y-7">
      <div>
        <PageHeader title="تعهدات آینده" />
        <ModuleTabs tabs={DEBT_TABS} active="/debts/obligations" label="بخش‌های تعهدات" />
      </div>

      <section className="metric-strip">
        <Metric label="سررسید گذشته" value={faCount(overdue.length)} tone={overdue.length ? "down" : "neutral"} />
        <Metric label="۳۰ روز آینده" value={faCount(next30.length)} hint={next30.length ? n30Disp.primary : undefined} />
        <Metric label="۹۰ روز آینده" value={faCount(next90.length)} hint={next90.length ? n90Disp.primary : undefined} />
        <Metric
          label="مجموع پیش‌رو"
          value={totalDisp.primary}
          hint={totalDisp.usdHint ? `≈ ${totalDisp.usdHint}` : undefined}
        />
      </section>

      <Section title="زمان‌بندی تعهدات">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="calendar"
              title="تعهد آینده‌ای ثبت نشده است"
              action={
                <Link href="/goals" className="btn btn-soft">
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
                  <th scope="col">عنوان</th>
                  <th scope="col">سررسید</th>
                  <th scope="col" className="td-num">مبلغ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const d = daysUntil(r.date);
                  const late = r.date < today;
                  const soon = !late && d <= 14;
                  const disp = formatTomanPrimary(r.amountToman, fx.rate);
                  return (
                    <tr key={r.id}>
                      <td style={{ minWidth: "10rem" }}>
                        <span className="block text-[length:var(--fs-sm)] font-medium">{r.title}</span>
                        <span className="muted block text-[length:var(--fs-xs)]">
                          {r.kind}
                          {r.detail ? ` · ${r.detail}` : ""}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <span className="num block text-[length:var(--fs-xs)]">{formatJalaliIso(r.date)}</span>
                        <span
                          className="num text-[length:var(--fs-xs)]"
                          style={{ color: late ? "var(--negative)" : soon ? "var(--warning)" : "var(--text-3)" }}
                        >
                          {formatDaysUntil(d)}
                        </span>
                      </td>
                      <td className="td-num" dir="rtl">
                        <div className="font-semibold">{disp.primary}</div>
                        {disp.usdHint && <div className="muted num text-[length:var(--fs-xs)]">≈ {disp.usdHint}</div>}
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
