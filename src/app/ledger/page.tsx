import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getLedger } from "@/features/ledger/queries";
import { Card, Money, PageHeader } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import { ACCOUNT_TYPE_LABELS, ENTRY_TYPE_LABELS, type AccountType, type EntryType } from "@/domain/accounting";
import { D } from "@/domain/decimal";
import { formatDate, formatQty } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  await seedIfEmpty();
  const [entries, balances] = await Promise.all([getLedger(80), getAccountBalances()]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="دفترکل"
        subtitle="دفترکل تغییرناپذیر است؛ اصلاح فقط با ثبت سند معکوس انجام می‌شود."
        action={<RowAction kind="integrity" label="بررسی یکپارچگی" />}
      />

      <Card title="تراز آزمایشی (Trial Balance)">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="muted">
              <tr className="border-b" style={{ borderColor: "var(--line)" }}>
                <th className="py-2 font-normal">کد</th>
                <th className="py-2 font-normal">حساب</th>
                <th className="py-2 font-normal">نوع</th>
                <th className="py-2 font-normal">مقدار</th>
                <th className="py-2 font-normal">ارزش پایه</th>
              </tr>
            </thead>
            <tbody>
              {balances
                .filter((b) => !D(b.baseValue).isZero())
                .map((b) => (
                  <tr key={b.accountId} className="border-b last:border-0" style={{ borderColor: "var(--line)" }}>
                    <td className="num py-2.5 opacity-60" dir="ltr">{b.code}</td>
                    <td className="py-2.5">{b.name}</td>
                    <td className="py-2.5"><span className="chip">{ACCOUNT_TYPE_LABELS[b.type as AccountType]}</span></td>
                    <td className="num py-2.5" dir="ltr">{formatQty(b.quantity, b.assetDecimals)} {b.symbol ?? ""}</td>
                    <td className="num py-2.5" dir="ltr"><Money value={b.baseValue} tone /></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="اسناد روزنامه">
        <ul className="space-y-3">
          {entries.map((e) => (
            <li key={e.id} className="soft rounded-2xl p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium">
                    {e.description}
                    {e.status === "void" && <span className="chip mr-2" style={{ color: "var(--danger)" }}>ابطال‌شده</span>}
                  </div>
                  <div className="muted mt-1 text-[10px]">
                    <span className="chip ml-2">{ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type}</span>
                    {formatDate(e.entryDate)} · منبع: {e.source === "plan" ? "اجرای برنامه" : e.source === "import" ? "درون‌ریزی" : "دستی"}
                  </div>
                </div>
                {e.status === "posted" && (
                  <RowAction
                    kind="reverse"
                    id={e.id}
                    label="ابطال با سند معکوس"
                    confirmText="سند معکوس ثبت شود؟ سند اصلی حذف نمی‌شود."
                  />
                )}
              </div>
              <table className="mt-2 w-full text-right text-[11px]">
                <tbody>
                  {e.lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="py-1">{l.account}</td>
                      <td className="muted py-1 text-[10px]">{ACCOUNT_TYPE_LABELS[l.accountType as AccountType]}</td>
                      <td className="num py-1" dir="ltr">{formatQty(l.quantity, l.decimals)} {l.symbol}</td>
                      <td className="num py-1 text-left" dir="ltr"><Money value={l.baseValue} tone /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
