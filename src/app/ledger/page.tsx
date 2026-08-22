import type { CSSProperties } from "react";
import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { seedIfEmpty } from "@/db/seed";
import { getAccountBalances, getLedger, getLedgerById } from "@/features/ledger/queries";
import { PageHeader, Section } from "@/components/ui/Card";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import { ACCOUNT_TYPE_LABELS, ENTRY_TYPE_LABELS, type AccountType, type EntryType } from "@/domain/accounting";
import { D } from "@/domain/decimal";
import { currencyLabel, faCount, formatDualDate, formatJalaliIso, formatMoney, formatQty, toFaDigits } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { eq, inArray } from "drizzle-orm";
import { assets, debts, entryFxSnapshots, installments, realEstateProperties } from "@/db/schema";

export const dynamic = "force-dynamic";

function shortId(id: string) {
  return "#" + id.replace(/-/g, "").slice(0, 6).toUpperCase();
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function LedgerPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? undefined;
  await seedIfEmpty();
  const sp = await searchParams;
  // Asset ↔ ledger navigation: ?entry=ID opens that specific entry on top.
  const focusEntryId = typeof sp.entry === "string" && sp.entry ? sp.entry : null;
  const [baseEntries, focused, balances, fx, integrity] = await Promise.all([
    getLedger(60, userId),
    focusEntryId ? getLedgerById(focusEntryId, userId) : Promise.resolve(null),
    getAccountBalances(userId),
    getLatestUsdIrtRate(),
    // Tenant-scoped integrity only — never blend other users' journals.
    db.execute(sql`
      select count(*)::text as bad,
             (select count(*) from journal_entries je2 where ${userId ? sql`je2.user_id = ${userId}` : sql`1=1`})::text as total
      from (
        select je.id from journal_entries je
        join postings p on p.entry_id = je.id
        where ${userId ? sql`je.user_id = ${userId}` : sql`1=1`}
        group by je.id having abs(sum(p.base_value)) > 0.000000001
      ) x
    `),
  ]);

  const bad = Number((integrity.rows[0] as { bad?: string } | undefined)?.bad ?? 0);
  const totalEntries = Number((integrity.rows[0] as { total?: string } | undefined)?.total ?? 0);

  // The requested entry (if any) goes first and is auto-opened.
  const entries = focused && !baseEntries.some((e) => e.id === focused.id) ? [focused, ...baseEntries] : baseEntries;
  const entryIds = entries.map((e) => e.id);
  // Asset ↔ ledger navigation back-link: which real-estate property owns this entry?
  const focusedProperty = focusEntryId
    ? await db
        .select({ id: realEstateProperties.id, name: assets.name, symbol: assets.symbol })
        .from(realEstateProperties)
        .innerJoin(assets, eq(assets.id, realEstateProperties.assetId))
        .where(eq(realEstateProperties.ledgerEntryId, focusEntryId))
        .limit(1)
    : [];
  const [fxRows, linkedInsts] = entryIds.length
    ? await Promise.all([
        db.select().from(entryFxSnapshots).where(inArray(entryFxSnapshots.entryId, entryIds)),
        db
          .select({ entryId: installments.paidEntryId, seq: installments.seq, title: debts.title, creditor: debts.creditor })
          .from(installments)
          .innerJoin(debts, eq(debts.id, installments.debtId))
          .where(inArray(installments.paidEntryId, entryIds)),
      ])
    : [[], []];
  const fxByEntry = new Map(fxRows.map((r) => [r.entryId, r]));
  const instByEntry = new Map(linkedInsts.filter((r) => r.entryId).map((r) => [r.entryId!, r]));

  const activeBalances = balances.filter((b) => !D(b.baseValue).isZero());
  const totalDebit = activeBalances.filter((b) => D(b.baseValue).gt(0)).reduce((s, b) => s + Number(b.baseValue), 0);
  const totalCredit = activeBalances.filter((b) => D(b.baseValue).lt(0)).reduce((s, b) => s + Math.abs(Number(b.baseValue)), 0);

  return (
    <div className="space-y-8">
      {/* UI term: «سوابق مالی» — technical term (Ledger / Journal / Posting)
          stays intact in routes, services and the accounting columns below. */}
      <PageHeader
        title="سوابق مالی"
        subtitle="اثر مالی هر تراکنش، دقیقاً همان‌طور که در حسابداری دوطرفه ثبت شده است. این صفحه فقط خواندنی است — اصلاح فقط از مسیر تراکنش و سند معکوس انجام می‌شود."
        action={
          <Link href="/audit" className="btn btn-soft">
            <Icon name="audit" size={16} />
            گزارش حسابرسی کامل
          </Link>
        }
      />

      {/* Register certification strip */}
      <div
        className="rise flex flex-wrap items-center gap-x-5 gap-y-2 border-y py-3 text-[12px]"
        style={{ borderColor: "var(--border)" }}
        role="status"
      >
        <span className="flex items-center gap-2 font-semibold" style={{ color: bad ? "var(--negative)" : "var(--positive)" }}>
          <Icon name={bad ? "xcircle" : "check-circle"} size={16} />
          {bad ? `${faCount(bad)} سند نامتوازن` : "دفترکل تراز است"}
        </span>
        <span className="muted num">{faCount(totalEntries)} سند ثبت‌شده</span>
      </div>

      {/* ── Trial balance ── */}
      <Section title="تراز آزمایشی">
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="w-14">کد</th>
                <th>حساب</th>
                <th>نوع</th>
                <th className="td-num">مقدار</th>
                <th className="td-num">بدهکار</th>
                <th className="td-num">بستانکار</th>
              </tr>
            </thead>
            <tbody>
              {activeBalances.map((b) => {
                const v = Number(b.baseValue);
                return (
                  <tr key={b.accountId}>
                    <td className="num muted" dir="rtl">
                      {toFaDigits(b.code)}
                    </td>
                    <td className="font-medium">
                      {b.name}
                      {b.walletName && <span className="muted mr-1.5 text-[10px]">· {b.walletName}</span>}
                    </td>
                    <td>
                      <span className="badge badge-neutral">{ACCOUNT_TYPE_LABELS[b.type as AccountType]}</span>
                    </td>
                    <td className="td-num" dir="rtl">
                      {formatQty(b.quantity, b.assetDecimals)} {currencyLabel(b.symbol)}
                    </td>
                    <td className="td-num font-semibold" dir="rtl">
                      {v > 0 ? formatMoney(v) : "—"}
                    </td>
                    <td className="td-num font-semibold" dir="rtl">
                      {v < 0 ? formatMoney(Math.abs(v)) : "—"}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: "var(--sunken)" }}>
                <td colSpan={4} className="text-[12px] font-bold">
                  جمع تراز آزمایشی
                </td>
                <td className="td-num text-[12px] font-bold" dir="rtl">
                  {formatMoney(totalDebit)}
                </td>
                <td className="td-num text-[12px] font-bold" dir="rtl">
                  {formatMoney(totalCredit)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      {/* ── Journal register ── */}
      <Section title="اسناد روزنامه" hint="۶۰ سند اخیر — برای باز شدن هر سند روی آن بزنید">
        <div className="space-y-1.5">
          {entries.map((e) => {
            const fxr = fxByEntry.get(e.id);
            const linked = instByEntry.get(e.id);
            const isVoid = e.status === "void";
            const isFocused = focusEntryId === e.id;
            const sumIn = e.lines.filter((l) => Number(l.baseValue) > 0).reduce((s, l) => s + Number(l.baseValue), 0);
            return (
              <details
                key={e.id}
                id={e.id}
                className={`card group overflow-hidden ${isFocused ? "ring-1" : ""}`}
                style={isFocused ? ({ boxShadow: "0 0 0 2px var(--brand)", borderColor: "var(--brand)" } as CSSProperties) : undefined}
                open={isFocused}
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 px-3.5 py-2.5 marker:hidden [&::-webkit-details-marker]:hidden">
                  <span className="num muted hidden w-16 shrink-0 text-[10px] sm:block" dir="ltr">
                    {shortId(e.id)}
                  </span>
                  <span className="muted hidden w-[86px] shrink-0 flex-col leading-tight sm:flex">
                    <span className="num text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
                      {formatJalaliIso(e.entryDate)}
                    </span>
                    <span className="num text-[9px]" dir="ltr">{e.entryDate}</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-[12.5px] font-medium ${isVoid ? "line-through" : ""}`}>
                      {e.description}
                    </span>
                    <span className="muted mt-0.5 flex items-center gap-1.5 text-[10px] sm:hidden">
                      {formatDualDate(e.entryDate)} · {shortId(e.id)}
                    </span>
                  </span>
                  <span className="badge badge-neutral hidden shrink-0 sm:inline-flex">{ENTRY_TYPE_LABELS[e.type as EntryType] ?? e.type}</span>
                  {isVoid && <span className="badge badge-neg shrink-0">ابطال‌شده</span>}
                  <span className="num w-24 shrink-0 text-left text-[12.5px] font-bold" dir="rtl">
                    {formatMoney(sumIn)}
                  </span>
                  <span className="muted shrink-0 transition-transform group-open:rotate-180">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </summary>

                <div className="border-t px-3.5 py-3 sm:px-4" style={{ borderColor: "var(--border)", background: "var(--sunken)" }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>حساب</th>
                        <th className="td-num">مقدار</th>
                        <th className="td-num">بدهکار</th>
                        <th className="td-num">بستانکار</th>
                        <th>یادداشت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.lines.map((l, i) => {
                        const v = Number(l.baseValue);
                        return (
                          <tr key={i}>
                            <td className="pr-3 font-medium">{l.account}</td>
                            <td className="td-num" dir="rtl">
                              {formatQty(l.quantity, l.decimals)} {currencyLabel(l.symbol)}
                            </td>
                            <td className="td-num font-semibold" dir="rtl">
                              {v > 0 ? formatMoney(v) : ""}
                            </td>
                            <td className="td-num font-semibold" dir="rtl">
                              {v < 0 ? formatMoney(Math.abs(v)) : ""}
                            </td>
                            <td className="muted text-[10.5px]">{l.memo ?? ""}</td>
                          </tr>
                        );
                      })}
                      <tr style={{ background: "var(--surface)" }}>
                        <td colSpan={2} className="muted text-[10.5px]">
                          جمع سند (باید صفر باشد)
                        </td>
                        <td className="td-num text-[11px] font-bold" dir="rtl">
                          {formatMoney(e.lines.filter((l) => Number(l.baseValue) > 0).reduce((s, l) => s + Number(l.baseValue), 0))}
                        </td>
                        <td className="td-num text-[11px] font-bold" dir="rtl">
                          {formatMoney(Math.abs(e.lines.filter((l) => Number(l.baseValue) < 0).reduce((s, l) => s + Number(l.baseValue), 0)))}
                        </td>
                        <td className="text-[10.5px]" style={{ color: "var(--positive)" }}>
                          <Icon name="check" size={13} />
                        </td>
                      </tr>
                    </tbody>
                  </table>

                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10.5px]">
                    <span className="muted">
                      منبع: {e.source === "plan" ? "اجرای برنامه" : e.source === "import" ? "درون‌ریزی" : "دستی"}
                    </span>
                    {fxr && (
                      <span className="muted">
                        فریز تاریخی: <b className="num">{formatMoney(fxr.irtAmount, "IRT")}</b> ≈{" "}
                        <b className="num" dir="rtl">
                          {formatMoney(fxr.usdAmount)}
                        </b>{" "}
                        · نرخ <span className="num" dir="rtl">{formatMoney(fxr.fxRate, "IRT")}</span> ({fxr.rateSource}، {fxr.rateDate})
                      </span>
                    )}
                    {linked && (
                      <span style={{ color: "var(--positive)" }}>
                        مرتبط با قسط {linked.seq} «{linked.title}» — {linked.creditor}
                      </span>
                    )}
                    {focusedProperty.length > 0 && (
                      <span>
                        <Link href="/asset-registry" className="font-medium underline" style={{ color: "var(--brand)" }}>
                          ← سند تملک ملک «{focusedProperty[0].name}» ({focusedProperty[0].symbol})
                        </Link>
                      </span>
                    )}
                    {!isVoid && (
                      <span className="mr-auto">
                        <RowAction
                          kind="reverse"
                          id={e.id}
                          label="ابطال با سند معکوس"
                          confirmText="سند معکوس ثبت شود؟ سند اصلی در تاریخچه باقی می‌ماند و به «ابطال‌شده» می‌رود."
                        />
                      </span>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
