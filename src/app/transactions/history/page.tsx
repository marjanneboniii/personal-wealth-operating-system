import { ensureAuth } from "@/lib/authGuard";
import { EmptyState, PageHeader } from "@/components/ui/Card";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";
import TxScopeSwitch from "@/components/transactions/TxScopeSwitch";
import HistoryView from "@/components/transactions/HistoryView";
import { getTavazonStart, listHistoryRecords, summarizeHistory } from "@/features/history/service";
import { todayIso } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata = { title: "پیش از توازن" };

const dayBefore = (iso: string) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/**
 * تراکنش‌ها ← پیش از توازن. Money movements from before the user started the
 * app, kept as a story. Nothing on this page reads or writes the ledger; the
 * present and the future go through «ثبت تراکنش».
 */
export default async function TransactionsHistoryPage() {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id;

  if (!userId) {
    return (
      <div className="space-y-5">
        <PageHeader title="پیش از توازن" />
        <div className="card">
          <EmptyState icon="lock" title="برای دیدن سوابق وارد شوید" body="سوابق هر کاربر جداگانه نگه‌داری می‌شود." />
        </div>
      </div>
    );
  }

  const [rows, start] = await Promise.all([listHistoryRecords(userId), getTavazonStart(userId)]);
  const today = todayIso();
  // The first date NOT allowed here: «آغاز توازن», never later than today.
  const latestAllowed = start && start < today ? start : today;

  return (
    <div className="mx-auto w-full max-w-3xl min-w-0 space-y-5">
      <div>
        <PageHeader title="تراکنش‌ها" />
        <ModuleTabs tabs={MONEY_TABS} active="/transactions" label="بخش‌های پول" />
      </div>
      <TxScopeSwitch active="history" historyCount={rows.length} />
      <HistoryView
        rows={rows}
        summary={summarizeHistory(rows)}
        start={start}
        latestAllowed={latestAllowed}
        defaultDate={dayBefore(latestAllowed)}
      />
    </div>
  );
}
