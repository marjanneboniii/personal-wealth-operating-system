import { ensureAuth } from "@/lib/authGuard";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import TxScopeSwitch from "@/components/transactions/TxScopeSwitch";
import HistoryView from "@/components/transactions/HistoryView";
import {
  getTavazonStart,
  isHistoryTableMissing,
  listHistoryRecords,
  summarizeHistory,
} from "@/features/history/service";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "سوابق گذشته" };

const dayBefore = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function Frame({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mx-auto w-full max-w-5xl min-w-0 space-y-5">
      <div>
        <PageHeader title="تراکنش‌ها" />
        <ModuleTabs tabs={MONEY_TABS} active="/transactions" label="بخش‌های پول" />
      </div>
      <TxScopeSwitch active="history" historyCount={count} />
      {children}
    </div>
  );
}

/**
 * تراکنش‌ها ← سوابق گذشته. Money movements from before the user's first
 * recorded transaction, kept as a story. Nothing on this page reads or writes
 * the ledger; the present and the future go through «ثبت تراکنش».
 */
export default async function TransactionsHistoryPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;

  if (!userId) {
    return (
      <Frame>
        <div className="card">
          <EmptyState icon="lock" title="برای دیدن سوابق وارد شوید" body="سوابق هر کاربر جداگانه نگه‌داری می‌شود." />
        </div>
      </Frame>
    );
  }

  let rows;
  try {
    rows = await listHistoryRecords(userId);
  } catch (e) {
    // A deploy that has not run `npm run db:migrate` yet has no table: say so,
    // instead of the generic error page.
    if (!isHistoryTableMissing(e)) throw e;
    return (
      <Frame>
        <div className="card">
          <EmptyState
            icon="clock"
            title="سوابق گذشته هنوز فعال نشده است"
            body="پایگاه داده باید به‌روزرسانی شود (npm run db:migrate). داده‌های مالی شما امن‌اند و تغییری نکرده‌اند."
          />
        </div>
      </Frame>
    );
  }
  const start = await getTavazonStart(userId);
  const today = todayIso();
  // The first date NOT allowed here: the first transaction, never later than today.
  const latestAllowed = start && start < today ? start : today;

  return (
    <Frame count={rows.length}>
      <HistoryView
        rows={rows}
        summary={summarizeHistory(rows)}
        start={start}
        latestAllowed={latestAllowed}
        defaultDate={dayBefore(latestAllowed)}
      />
    </Frame>
  );
}
