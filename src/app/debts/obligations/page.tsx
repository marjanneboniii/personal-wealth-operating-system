import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { getAccountBalances } from "@/features/ledger/queries";
import { listSavingsAccounts } from "@/features/planning/savingsAccounts";
import { seedIfEmpty } from "@/db/seed";
import {
  listBudgets,
  listEvents,
  listPlanned,
  upcomingInstallments,
} from "@/features/planning/service";
import { eventBudgetLinks } from "@/features/planning/planItems";
import { pendingChequesByEvent } from "@/features/cheques/service";
import { EmptyState, Section } from "@/components/ui/Card";
import DateTile from "@/components/ui/DateTile";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import { DEBT_TABS } from "@/components/ui/ModuleTabs";
import ModuleHeader from "@/components/money/ModuleHeader";
import { AddCommitmentButton } from "@/components/planning/AddPlanningSheet";
import {
  formatDaysUntil,
  formatJalaliIso,
  todayIso,
  faCount,
  formatTomanPrimary,
  sumToman,
  daysUntilIso,
} from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export const metadata = { title: "تعهدات آینده" };

function daysUntil(iso: string) {
  return daysUntilIso(iso);
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
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? null;
  await seedIfEmpty();

  const [
    events,
    planned,
    budgetRows,
    links,
    eventCheques,
    insts,
    fx,
    accountRows,
    balanceRows,
  ] = await Promise.all([
    listEvents(),
    listPlanned().catch(() => []),
    listBudgets().catch(() => []),
    eventBudgetLinks(userId),
    pendingChequesByEvent(userId),
    upcomingInstallments(100),
    getLatestUsdIrtRate(),
    // The account picker is optional in the add sheet — never fail the page for it.
    listSavingsAccounts(userId).catch(() => []),
    getAccountBalances(userId ?? undefined).catch(() => []),
  ]);
  const addProps = {
    accounts: accountRows,
    balances: Object.fromEntries(
      balanceRows.map((b) => [b.accountId, b.quantity]),
    ),
    today: todayIso(),
    rate: fx.rate,
    rateDate: fx.effectiveDate,
    rateSource: fx.source,
  };

  const today = todayIso();
  const spentByBudget = new Map(budgetRows.map((b) => [b.id, b.spentToman]));
  const eventLeft = (id: string, amount: string) => {
    const link = links.get(id);
    // Cheques toward it are listed with the cheques; they come off here too.
    const left =
      Number(amount) -
      Number(link ? (spentByBudget.get(link.budgetId) ?? 0) : 0) -
      Number(eventCheques.get(id) ?? 0);
    return String(Math.max(0, left));
  };

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
      amountToman:
        i.dueToman ?? (i.amountToman != null ? String(i.amountToman) : "0"),
      kind: "قسط",
      detail: i.creditor,
    })),
    // Rent, tuition, a monthly transfer — every planned payment still to come.
    ...planned
      .filter((p) => p.status === "pending" && p.direction === "outflow")
      .map((p) => ({
        id: `pln-${p.id}`,
        title: p.title,
        date: p.plannedDate,
        amountToman: String(p.amountBase),
        kind: RECURRENCE_LABEL[p.recurrence] ?? "پرداخت",
        detail: p.note ?? null,
      })),
    ...events
      .filter((e) => e.status === "planned")
      .map((e) => ({
        id: `evt-${e.id}`,
        title: e.name,
        date: e.eventDate,
        // What is left of its budget — the spent part already left the accounts.
        amountToman: eventLeft(e.id, e.budgetToman ?? String(e.budgetBase)),
        kind: "رویداد",
        detail: e.note ?? null,
      })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const overdue = rows.filter((r) => r.date < today);
  const next30 = rows.filter((r) => r.date >= today && daysUntil(r.date) <= 30);
  const next90 = rows.filter((r) => r.date >= today && daysUntil(r.date) <= 90);
  const totalDisp = formatTomanPrimary(
    sumToman(rows.filter((r) => r.date >= today).map((r) => r.amountToman)),
    fx.rate,
  );
  const n30Disp = formatTomanPrimary(
    sumToman(next30.map((r) => r.amountToman)),
    fx.rate,
  );
  const n90Disp = formatTomanPrimary(
    sumToman(next90.map((r) => r.amountToman)),
    fx.rate,
  );

  return (
    <div className="mny-page">
      <ModuleHeader
        title="تعهدات آینده"
        tabs={DEBT_TABS}
        active="/debts/obligations"
        label="بخش‌های تعهدات"
        actions={<AddCommitmentButton {...addProps} />}
      />

      {rows.length > 0 && (
        <section
          className="mny-stats"
          style={{ ["--mny-cols" as string]: 5 }}
          aria-label="خلاصهٔ تعهدات آینده"
        >
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
          <StatCard
            icon="clock"
            label="۳۰ روز آینده"
            period={next30.length ? n30Disp.primary : "موردی نیست"}
            value={faCount(next30.length)}
          />
          <StatCard
            icon="calendar"
            label="۹۰ روز آینده"
            period={next90.length ? n90Disp.primary : "موردی نیست"}
            value={faCount(next90.length)}
          />
        </section>
      )}

      <Section title="زمان‌بندی تعهدات">
        {rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="calendar"
              title="تعهد آینده‌ای ثبت نشده است"
              body="اجاره، شهریه یا هر پرداخت برنامه‌ریزی‌شده و رویدادهای آینده را از «ثبت تعهد» اضافه کنید. اقساط بدهی‌ها خودکار از «ثبت بدهی یا طلب» می‌آیند."
              action={
                <span className="flex flex-wrap justify-center gap-2">
                  <AddCommitmentButton {...addProps} variant="soft" />
                  <Link href="/debts#new" className="btn btn-ghost">
                    ثبت بدهی یا طلب
                  </Link>
                </span>
              }
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
                  <DateTile iso={r.date} size="sm" className="shrink-0" />
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
                      {/* The leaf has no year; the full Jalali date keeps a due date next year unambiguous. */}
                      <span className="num">{formatJalaliIso(r.date)}</span>
                      <span aria-hidden="true"> · </span>
                      <span
                        className="whitespace-nowrap"
                        style={{
                          color: late
                            ? "var(--negative)"
                            : soon
                              ? "var(--warning)"
                              : "var(--text-3)",
                        }}
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
