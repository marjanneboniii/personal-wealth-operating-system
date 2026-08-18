"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatJalaliIso, formatPct, faCount } from "@/lib/format";

export type DebtOption = {
  id: string;
  title: string;
  creditor: string;
  principalBase: string;
  outstandingBase: string;
  interestRate: string;
  status: string;
  /** liability account of the debt — null for planning-only debts */
  accountId: string | null;
  installments: Array<{
    id: string;
    seq: number;
    dueDate: string;
    amountBase: string;
    status: string;
  }>;
};

type Props = {
  debts: DebtOption[];
  onSelectDebt?: (debt: DebtOption) => void;
  onSelectInstallment?: (debt: DebtOption, inst: DebtOption["installments"][number]) => void;
  rate: string | null;
};

/** Hoisted to module scope — evaluated once at load, keeps render pure. */
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const WEEK_LATER_ISO = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

export default function DebtInstallmentExplorer({ debts, onSelectDebt, onSelectInstallment, rate }: Props) {
  const [query, setQuery] = useState("");
  const [filterType, setFilterType] = useState<"all" | "debt" | "installment">("all");
  const [filterStatus, setFilterStatus] = useState<"all" | "active" | "overdue" | "upcoming">("all");
  const [sortBy, setSortBy] = useState<"dueDate" | "amount" | "creditor">("dueDate");

  const today = TODAY_ISO;

  const installmentRows = useMemo(() => {
    const rows: Array<{ debt: DebtOption; inst: DebtOption["installments"][number]; overdue: boolean; upcoming: boolean }> = [];
    for (const d of debts) {
      for (const inst of d.installments) {
        const overdue = inst.status === "pending" && inst.dueDate < today;
        const upcoming = inst.status === "pending" && inst.dueDate >= today && inst.dueDate <= WEEK_LATER_ISO;
        rows.push({ debt: d, inst, overdue, upcoming });
      }
    }
    return rows;
  }, [debts, today]);

  const filteredDebts = useMemo(() => {
    let list = [...debts];
    if (query) {
      const q = query.toLowerCase();
      list = list.filter((d) => `${d.title} ${d.creditor}`.toLowerCase().includes(q));
    }
    if (filterStatus === "active") list = list.filter((d) => d.status === "active");
    // sort
    if (sortBy === "amount") list.sort((a, b) => Number(b.outstandingBase) - Number(a.outstandingBase));
    if (sortBy === "creditor") list.sort((a, b) => a.creditor.localeCompare(b.creditor));
    return list;
  }, [debts, query, filterStatus, sortBy]);

  const filteredInstallments = useMemo(() => {
    let list = [...installmentRows];
    if (query) {
      const q = query.toLowerCase();
      list = list.filter(({ debt, inst }) => `${debt.title} ${debt.creditor} قسط ${inst.seq}`.toLowerCase().includes(q));
    }
    if (filterStatus === "overdue") list = list.filter((r) => r.overdue);
    if (filterStatus === "upcoming") list = list.filter((r) => r.upcoming);
    if (filterStatus === "active") list = list.filter((r) => r.inst.status === "pending");
    if (sortBy === "dueDate") list.sort((a, b) => a.inst.dueDate.localeCompare(b.inst.dueDate));
    if (sortBy === "amount") list.sort((a, b) => Number(b.inst.amountBase) - Number(a.inst.amountBase));
    return list;
  }, [installmentRows, query, filterStatus, sortBy]);

  return (
    <div className="card p-4 space-y-3 border" style={{ borderColor: "var(--border)" }}>
      <div className="text-xs font-bold">انتخاب بدهی یا قسط برای تکمیل خودکار هزینه</div>
      <div className="muted text-[11px]">Explorer — بدون ایجاد فرم جدید، همان TransactionForm را مقداردهی می‌کند.</div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
        <input
          placeholder="جستجوی سریع بدهی/قسط…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field sm:col-span-2"
        />
        <select value={filterType} onChange={(e) => setFilterType(e.target.value as any)} className="field">
          <option value="all">همه (بدهی + قسط)</option>
          <option value="debt">فقط بدهی</option>
          <option value="installment">فقط قسط</option>
        </select>
        <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)} className="field">
          <option value="all">همه وضعیت‌ها</option>
          <option value="active">فقط فعال/در انتظار</option>
          <option value="overdue">معوق</option>
          <option value="upcoming">نزدیک به سررسید (۷ روز)</option>
        </select>
      </div>
      <div className="flex gap-2">
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)} className="field !w-auto text-xs">
          <option value="dueDate">مرتب‌سازی: سررسید</option>
          <option value="amount">مرتب‌سازی: مبلغ</option>
          <option value="creditor">مرتب‌سازی: بستانکار</option>
        </select>
        <span className="chip text-[10px]">{faCount(filteredDebts.length)} بدهی · {faCount(filteredInstallments.length)} قسط</span>
      </div>

      <div className="max-h-96 overflow-y-auto space-y-3">
        {(filterType === "all" || filterType === "debt") && (
          <div>
            <div className="muted text-[10px] mb-1">بدهی‌های فعال</div>
            <ul className="space-y-2">
              {filteredDebts.map((d) => (
                <li key={d.id} className="soft rounded-[var(--r-md)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-xs">
                    <div className="font-bold">{d.title} — {d.creditor}</div>
                    <div className="muted text-[10px]">مانده: <span dir="rtl" className="num">{formatMoney(d.outstandingBase, "USD")}</span> · {d.status === "settled" ? "تسویه شده" : "فعال"} · سود {formatPct(d.interestRate, 1)} · {d.installments.filter(i=>i.status==="pending").length} قسط مانده</div>
                    <div className="muted text-[10px]">مبلغ هر قسط نمونه: {d.installments[0] ? formatMoney(d.installments[0].amountBase, "USD") : "—"} · تاریخ شروع میلادی <span dir="ltr" className="num">{d.installments[0]?.dueDate ?? "—"}</span> / شمسی {d.installments[0] ? formatJalaliIso(d.installments[0].dueDate) : "—"}</div>
                  </div>
                  <button type="button" onClick={() => onSelectDebt?.(d)} className="btn btn-primary !py-1.5 !px-3 text-xs">انتخاب بدهی</button>
                </li>
              ))}
              {!filteredDebts.length && <li className="muted text-xs text-center py-4">بدهی یافت نشد</li>}
            </ul>
          </div>
        )}

        {(filterType === "all" || filterType === "installment") && (
          <div>
            <div className="muted text-[10px] mb-1">اقساط (سررسیدشده / نزدیک)</div>
            <ul className="space-y-2">
              {filteredInstallments.slice(0, 30).map(({ debt, inst, overdue, upcoming }) => (
                <li key={inst.id} className="soft rounded-[var(--r-md)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={overdue ? { border: "1px solid var(--negative)" } : upcoming ? { border: "1px solid var(--warning)" } : undefined}>
                  <div className="text-xs">
                    <div className="font-bold">{debt.title} — قسط {toFaDigits(String(inst.seq))} <span className="chip mr-1" style={overdue ? { color:"var(--negative)" } : upcoming ? { color:"var(--warning)" } : undefined}>{overdue ? "معوق" : upcoming ? "نزدیک به سررسید" : inst.status==="paid" ? "پرداخت شده" : "در انتظار"}</span></div>
                    <div className="muted text-[10px]">مبلغ: <span dir="rtl" className="num">{formatMoney(inst.amountBase, "USD")}</span> · سررسید میلادی <span dir="ltr" className="num">{inst.dueDate}</span> / شمسی <span dir="rtl">{formatJalaliIso(inst.dueDate)}</span> · مانده قابل پرداخت {formatMoney(debt.outstandingBase, "USD")}</div>
                    <div className="muted text-[10px]">{debt.creditor} · اولویت بستانکار — {debt.title}</div>
                  </div>
                  <button
                    type="button"
                    disabled={inst.status==="paid"}
                    onClick={() => onSelectInstallment?.(debt, inst)}
                    className="btn btn-primary !py-1.5 !px-3 text-xs disabled:opacity-40"
                  >
                    {inst.status==="paid" ? "تسویه شده" : "انتخاب قسط"}
                  </button>
                </li>
              ))}
              {!filteredInstallments.length && <li className="muted text-xs text-center py-4">قسطی یافت نشد</li>}
            </ul>
          </div>
        )}
      </div>
      <div className="muted text-[10px] leading-5">
        پس از انتخاب، فرم هزینه به‌صورت خودکار مقداردهی می‌شود (Auto Populate) — عنوان، مبلغ به تومان، معادل دلاری، نرخ، حساب پیشنهادی، تاریخ‌های دوگانه و شناسه مرجع. تا قبل از «تأیید نهایی» هیچ سندی ایجاد نمی‌شود.
      </div>
    </div>
  );
}

function toFaDigits(s: string) {
  const fa = ["۰","۱","۲","۳","۴","۵","۶","۷","۸","۹"];
  return s.replace(/[0-9]/g, d => fa[Number(d)]);
}
