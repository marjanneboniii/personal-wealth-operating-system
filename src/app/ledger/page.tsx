import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getLedger } from "@/features/ledger/queries";
import { Card, Money, PageHeader } from "@/components/ui/Card";
import RowAction from "@/components/RowAction";
import { ACCOUNT_TYPE_LABELS, ENTRY_TYPE_LABELS, type AccountType, type EntryType } from "@/domain/accounting";
import { D } from "@/domain/decimal";
import { formatQty, getDualDate, formatMoney } from "@/lib/format";
import { db } from "@/db";
import { entryFxSnapshots, installments, debts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

export default async function LedgerPage() {
  await seedIfEmpty();
  const [entries, balances, fxCurrent] = await Promise.all([getLedger(80), getAccountBalances(), getLatestUsdIrtRate()]);

  // Fetch FX snapshots for these entries — historical immutability display
  const entryIds = entries.map((e) => e.id);
  const fxRows = entryIds.length
    ? await db.select().from(entryFxSnapshots).where(inArray(entryFxSnapshots.entryId, entryIds))
    : [];
  const fxByEntry = new Map(fxRows.map((r) => [r.entryId, r]));

  // Fetch installment linkage for reference display
  const linkedInsts = entryIds.length
    ? await db
        .select({ entryId: installments.paidEntryId, seq: installments.seq, title: debts.title, creditor: debts.creditor })
        .from(installments)
        .innerJoin(debts, eq(debts.id, installments.debtId))
        .where(inArray(installments.paidEntryId, entryIds))
    : [];
  const instByEntry = new Map(linkedInsts.filter((r) => r.entryId).map((r) => [r.entryId!, r]));

  return (
    <div className="space-y-4">
      <PageHeader
        title="دفترکل (General Ledger)"
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
                    <td className="py-2.5"><Money value={b.baseValue} tone /><div className="num text-[10px]" dir="rtl">{formatMoney(D(b.baseValue).mul(fxCurrent.rate).toFixed(0), "IRT")}</div></td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="اسناد روزنامه — نمایش دوگانه تاریخ و مبلغ (فقط نمایشی)">
        <ul className="space-y-3">
          {entries.map((e) => {
            const fx = fxByEntry.get(e.id);
            const linked = instByEntry.get(e.id);
            const dual = getDualDate(e.entryDate);
            return (
              <li key={e.id} className="soft rounded-2xl p-3 border" style={{ borderColor: fx ? "var(--line)" : "transparent" }}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium">
                      {e.description}
                      {e.status === "void" && <span className="chip mr-2" style={{ color: "var(--danger)" }}>ابطال‌شده</span>}
                      {linked && <span className="chip mr-2" style={{ color: "var(--accent)" }}>مرتبط با قسط {linked.seq} — {linked.title}</span>}
                    </div>
                    <div className="muted mt-1 text-[11px] flex flex-wrap gap-2">
                      <span className="chip">{ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type}</span>
                      <span>شمسی: <strong dir="rtl">{dual.jalali}</strong></span>
                      <span>میلادی: <strong dir="auto" className="num">{dual.gregorian}</strong></span>
                      <span>· منبع: {e.source === "plan" ? "اجرای برنامه" : e.source === "import" ? "درون‌ریزی" : "دستی"}</span>
                    </div>
                    {fx ? (
                      <div className="muted mt-1 text-[10px] leading-5">
                        <span>مبلغ تاریخی: <strong dir="rtl" className="num" style={{ color: "var(--fg)" }}>{formatMoney(fx.irtAmount, "IRT")}</strong></span>
                        <span className="mx-1">≈</span>
                        <span dir="ltr" className="num" style={{ color: "var(--accent)" }}>{formatMoney(fx.usdAmount, "USD")}</span>
                        <span className="mx-1">· نرخ دلار زمان ثبت (Freeze): <strong dir="ltr" className="num">{formatMoney(fx.fxRate, "IRT")}</strong> ≈ $1</span>
                        <span>· تاریخ نرخ: <span dir="auto" className="num">{fx.rateDate}</span> · منبع: {fx.rateSource}</span>
                      </div>
                    ) : (
                      <div className="muted text-[10px]">بدون اسنپ‌شات FX (سند قدیمی یا بدون مبلغ IRT) — مبلغ پایه: <span dir="ltr" className="num">{e.lines[0] ? formatMoney(e.lines[0].baseValue, "USD") : "—"}</span></div>
                    )}
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
                {linked && (
                  <div className="muted mt-2 text-[10px]">
                    از طریق بدهی/قسط «{linked.title} — {linked.creditor}» ایجاد شده · قابل مشاهده از هر دو سمت (بدهی → سند، سند → بدهی)
                  </div>
                )}
                <div className="muted mt-1 text-[10px]">این اطلاعات فقط نمایشی هستند و از داده‌های ثبت‌شده موجود خوانده می‌شوند؛ هیچ منطق حسابی تغییر نکرده است.</div>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
