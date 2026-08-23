"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import AdvancedFilter from "@/components/ui/AdvancedFilter";
import { markManyReviewedAction, markReviewedAction } from "@/app/actions";
import { humanizeEntry, moneyFlowLabel, typeBadgeTone } from "@/lib/tx";
import type { TxRow } from "@/features/ledger/queries";
import { faCount, formatJalaliIso, formatMoney, formatShortDate } from "@/lib/format";
import { useProMode } from "@/components/layout/ProModeProvider";
import { D } from "@/domain/decimal";

export type ClientTxRow = TxRow & {
  fx: { irtAmount: string; usdAmount: string; fxRate: string; rateSource: string; rateDate: string } | null;
  linkedInstallment: { title: string; seq: number } | null;
};

type Filters = { q: string; type: string; accountId: string; categoryId: string; review: string; range: string; sort: string };

const TYPE_OPTIONS = [
  { key: "", label: "همه" },
  { key: "expense", label: "هزینه" },
  { key: "income", label: "درآمد" },
  { key: "transfer", label: "انتقال" },
  { key: "debt_repayment", label: "بازپرداخت بدهی" },
  { key: "buy", label: "خرید" },
  { key: "sell", label: "فروش" },
  { key: "installment", label: "قسط" },
  { key: "adjustment", label: "اصلاحی" },
];

const RANGE_OPTIONS = [
  { key: "m1", label: "۱ ماه" },
  { key: "m3", label: "۳ ماه" },
  { key: "m6", label: "۶ ماه" },
  { key: "ytd", label: "امسال" },
  { key: "all", label: "همه" },
];

const SOURCE_LABEL: Record<string, string> = { manual: "دستی", plan: "اجرا شده از برنامه", import: "درون‌ریزی" };

export default function TransactionsView({
  rows,
  accountGroups,
  categoryGroups = [],
  rate,
  filters,
}: {
  rows: ClientTxRow[];
  accountGroups: { label: string; options: { id: string; name: string }[] }[];
  categoryGroups?: { id: string; name: string; children: { id: string; name: string }[] }[];
  rate: string;
  filters: Filters;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // Historical FX freeze lines are ledger-grade detail → PRO-only (Directive §2).
  const pro = useProMode();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // ONE-WAY DYNAMIC EQUIVALENT (Directive §1): the primary Toman figure comes
  // from the frozen entry snapshot or the exact IRT leg — never re-derived.
  // Only when neither exists is it computed live, from the FULL-PRECISION
  // base amount (never a 2-dp display string) and marked with «≈».
  const amountLabel = (e: ClientTxRow, h: ReturnType<typeof humanizeEntry>) => {
    const sign = h.sign > 0 ? "+" : h.sign < 0 ? "−" : "";
    const irt = e.fx?.irtAmount
      ? formatMoney(D(e.fx.irtAmount).toFixed(0), "IRT")
      : h.nativeIrt
        ? formatMoney(h.nativeIrt, "IRT")
        : rate && D(rate).gt(0)
          ? formatMoney(D(h.amountExact).mul(rate).toFixed(0), "IRT")
          : null;
    const dynamic = !e.fx?.irtAmount && !h.nativeIrt && !!irt;
    return `${dynamic ? "≈ " : ""}${sign}${irt ?? formatMoney(h.amount)}`;
  };

  // URL state — filters survive refresh, share and browser back
  const apply = (patch: Partial<Filters>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries({ ...filters, ...patch })) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/transactions?${next.toString()}`, { scroll: false });
  };

  const toggleSelect = (id: string, e?: React.MouseEvent | React.ChangeEvent) => {
    e?.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);

  const exportCsv = () => {
    const head = "date,description,type,from,to,amount_usd,amount_irt\n";
    const body = selectedRows
      .map((r) => {
        const h = humanizeEntry(r);
        const irt = (r.fx?.irtAmount ?? h.nativeIrt ?? "").replace(/[,٬]/g, "");
        return [
          r.entryDate,
          `"${r.description.replace(/"/g, '""')}"`,
          h.typeLabel,
          `"${h.from ?? ""}"`,
          `"${h.to ?? ""}"`,
          h.amount,
          `"${irt}"`,
        ].join(",");
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + head + body], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const isFiltered = filters.q || filters.type || filters.accountId || filters.categoryId || filters.review || filters.range !== "m3";

  return (
    <div className="space-y-3">
      {/* ─────────── Filter bar — unified AdvancedFilter component ─────────── */}
      <AdvancedFilter
        searchRef={searchRef}
        search={{
          value: filters.q,
          placeholder: "جستجوی شرح یا مرجع…",
          ariaLabel: "جستجوی تراکنش‌ها",
          onChange: (v) => apply({ q: v }),
        }}
        selects={[
          {
            key: "type",
            label: "نوع",
            value: filters.type,
            placeholder: "همه انواع",
            options: TYPE_OPTIONS.map((t) => ({ value: t.key, label: t.label })),
            onChange: (v: string) => apply({ type: v }),
          },
          {
            key: "range",
            label: "بازه",
            value: filters.range,
            placeholder: "۳ ماه",
            options: RANGE_OPTIONS.map((r) => ({ value: r.key, label: r.label })),
            onChange: (v: string) => apply({ range: v }),
          },
          {
            key: "account",
            label: "حساب",
            value: filters.accountId,
            placeholder: "همه حساب‌ها",
            groups: accountGroups.map((g) => ({ label: g.label, options: g.options.map((a) => ({ value: a.id, label: a.name })) })),
            maxWidthClass: "max-w-[160px]",
            onChange: (v: string) => apply({ accountId: v }),
          },
          ...(categoryGroups.length > 0
            ? [
                {
                  key: "category",
                  label: "دسته",
                  value: filters.categoryId,
                  placeholder: "همه دسته‌ها",
                  groups: categoryGroups.map((g) => ({
                    label: g.name,
                    options: [{ value: g.id, label: `${g.name} (همه)` }, ...g.children.map((c) => ({ value: c.id, label: c.name }))],
                  })),
                  maxWidthClass: "max-w-[170px]",
                  onChange: (v: string) => apply({ categoryId: v }),
                },
              ]
            : []),
        ]}
        chips={[
          {
            key: "sort",
            label: "جدیدترین",
            activeLabel: filters.sort === "old" ? "قدیمی‌ترین" : "جدیدترین",
            active: filters.sort === "old",
            onClick: () => apply({ sort: filters.sort === "old" ? "new" : "old" }),
          },
          {
            key: "review",
            label: "بررسی‌نشده",
            active: filters.review === "unreviewed",
            onClick: () => apply({ review: filters.review === "unreviewed" ? "" : "unreviewed" }),
          },
        ]}
        isFiltered={!!isFiltered}
        onClear={() => router.replace("/transactions")}
      />

      {/* ─────────── List ─────────── */}
      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "var(--brand-soft)", color: "var(--brand)" }}>
            <Icon name="search" size={19} />
          </span>
          <p className="text-[13.5px] font-semibold">تراکنشی مطابق این فیلترها پیدا نشد</p>
          <p className="muted max-w-sm text-[12px] leading-5">
            {isFiltered ? "فیلترها را تغییر دهید یا بازه زمانی بزرگ‌تری انتخاب کنید." : "با ثبت تراکنش، تاریخچه مالی شما اینجا نمایش داده می‌شود."}
          </p>
          {isFiltered ? (
            <button type="button" className="btn btn-soft mt-1" onClick={() => router.replace("/transactions")} style={{ touchAction: "manipulation" }}>
              حذف فیلترها
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="card divide-y overflow-hidden" style={{ borderColor: "var(--border)" }}>
          {rows.map((e) => {
            const h = humanizeEntry(e);
            const open = expanded === e.id;
            const isVoid = e.status === "void";
            return (
              <li key={e.id} className={isVoid ? "opacity-55" : ""} style={{ touchAction: "manipulation" }}>
                <div className="flex items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
                  {/* Select (bulk actions) — stopPropagation so row button does not toggle */}
                  <input
                    type="checkbox"
                    checked={selected.has(e.id)}
                    onChange={(ev) => toggleSelect(e.id, ev)}
                    onClick={(ev) => ev.stopPropagation()}
                    aria-label={`انتخاب «${e.description}»`}
                    className="hidden h-4 w-4 shrink-0 cursor-pointer sm:block"
                    style={{ accentColor: "var(--brand)", touchAction: "manipulation" }}
                  />

                  {/* Main row button — isolated, no nested clickable inside */}
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : e.id)}
                    aria-expanded={open}
                    className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-[10px] py-0.5 text-right"
                    style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as any}
                  >
                    <span className="muted hidden w-[74px] shrink-0 flex-col leading-tight sm:flex" dir="rtl">
                      <span className="num text-[11px] font-medium" style={{ color: "var(--text-2)" }}>
                        {formatShortDate(e.entryDate)}
                      </span>
                      <span className="num text-[9.5px]">{e.entryDate}</span>
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-[13px] font-medium ${isVoid ? "line-through" : ""}`}>{e.description}</span>
                        {!e.reviewed && <span className="badge badge-warn shrink-0">بررسی‌نشده</span>}
                        {isVoid && <span className="badge badge-neg shrink-0">ابطال‌شده</span>}
                      </span>
                      <span className="muted mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10.5px]">
                        <span className="sm:hidden">{formatShortDate(e.entryDate)} · </span>
                        <span>{h.typeLabel}</span>
                        {e.categoryName && (
                          <span className="badge shrink-0" style={{ background: "var(--sunken)" }}>
                            {e.categoryParentName ? `${e.categoryParentName} › ` : ""}
                            {e.categoryName}
                            {e.categoryNonCash ? " · غیرنقدی" : ""}
                          </span>
                        )}
                        {moneyFlowLabel(h.from, h.to) && (
                          <span className="hidden truncate sm:inline">
                            · {moneyFlowLabel(h.from, h.to)}
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-left min-w-0 max-w-[44%] sm:max-w-none">
                      <span
                        className="num block text-[12px] font-bold money-nowrap leading-[1.3] sm:text-[13px]"
                        dir="rtl"
                        style={{ color: h.sign > 0 ? "var(--positive)" : h.sign < 0 ? "var(--negative)" : "var(--text)" }}
                      >
                        {amountLabel(e, h)}
                      </span>
                      {rate && <span className="muted num block text-[9px] money-nowrap sm:text-[10px]" style={{ color: "var(--text-2)" }}>≈ {formatMoney(h.amount)}</span>}
                    </span>

                    <span className={`muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
                      <Icon name="chevronDown" size={15} />
                    </span>
                  </button>
                </div>

                {/* ─────────── Detail panel ─────────── */}
                {open && (
                  <div
                    className="fade-in border-t px-4 py-4 sm:px-12"
                    style={{ borderColor: "var(--border)", background: "var(--sunken)", touchAction: "pan-y" }}
                    onClick={(ev) => ev.stopPropagation()}
                  >
                    <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                      {/* Postings — the accounting truth of this transaction */}
                      <div>
                        <p className="mb-2 text-[12px] font-semibold" style={{ color: "var(--text-2)" }}>جریان پول</p>
                        <div className="card p-3" style={{ background: "var(--surface)" }}>
                          <p className="text-[13.5px] font-medium">
                            {moneyFlowLabel(h.from, h.to) ?? "جابه‌جایی داخلی"}
                          </p>
                          {e.categoryName && (
                            <p className="muted mt-1 text-[12px]">
                              دسته: {e.categoryParentName ? `${e.categoryParentName} › ` : ""}{e.categoryName}
                            </p>
                          )}
                          <p className="num mt-2 text-[13px] font-bold money-nowrap sm:text-[14px]" dir="rtl">
                            {amountLabel(e, h)}
                          </p>
                        </div>
                        {e.fx && pro && (
                          <p className="muted mt-3 text-[10.5px] leading-5">
                            مبلغ تاریخی منجمد: <b className="num">{formatMoney(e.fx.irtAmount, "IRT")}</b> ≈{" "}
                            <b className="num" dir="rtl">
                              {formatMoney(e.fx.usdAmount)}
                            </b>{" "}
                            · نرخ زمان ثبت: <span className="num" dir="rtl">{formatMoney(e.fx.fxRate, "IRT")}</span>
                            <span className="mx-1">·</span>منبع: {e.fx.rateSource}
                          </p>
                        )}
                        {e.linkedInstallment && (
                          <p className="mt-2 text-[11px]" style={{ color: "var(--positive)" }}>
                            این تراکنش پرداخت قسط {e.linkedInstallment.seq} «{e.linkedInstallment.title}» است.
                          </p>
                        )}
                      </div>

                      {/* Meta + actions — isolated buttons with stopPropagation */}
                      <div className="space-y-3">
                        <div>
                          <p className="muted mb-1.5 text-[11px] font-semibold">جزئیات</p>
                          <dl className="space-y-1.5 text-[12px]">
                            <div className="flex justify-between gap-2">
                              <dt className="text-[12px] font-medium" style={{ color: "var(--text-2)" }}>تاریخ</dt>
                              <dd className="num text-left">
                                {formatJalaliIso(e.entryDate)} <span className="muted text-[10px]" dir="ltr">({e.entryDate})</span>
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-[12px] font-medium" style={{ color: "var(--text-2)" }}>نوع</dt>
                              <dd>
                                <span className={`badge badge-${typeBadgeTone(e.type)}`}>{h.typeLabel}</span>
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="text-[12px] font-medium" style={{ color: "var(--text-2)" }}>منبع</dt>
                              <dd>{SOURCE_LABEL[e.source] ?? e.source}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt className="text-[12px] font-medium" style={{ color: "var(--text-2)" }}>وضعیت بازبینی</dt>
                              <dd>
                                {e.reviewed ? <span className="badge badge-pos">تأیید شده</span> : <span className="badge badge-warn">بررسی‌نشده</span>}
                              </dd>
                            </div>

                          </dl>
                        </div>

                        <div className="flex flex-col gap-1.5" onClick={(ev) => ev.stopPropagation()}>
                          <button
                            type="button"
                            disabled={pending}
                            onClick={(ev) => {
                              ev.stopPropagation();
                              startTransition(async () => {
                                await markReviewedAction(e.id, !e.reviewed);
                              });
                            }}
                            className={`btn ${e.reviewed ? "btn-soft" : "btn-primary"} !min-h-9 !py-1.5 text-[12px]`}
                            style={{ touchAction: "manipulation" }}
                          >
                            <Icon name={e.reviewed ? "undo" : "check"} size={14} />
                            {e.reviewed ? "برگشت به «بررسی‌نشده»" : "تأیید این رکورد"}
                          </button>
                          {!isVoid && (
                            <div onClick={(ev) => ev.stopPropagation()}>
                              <RowAction
                                kind="reverse"
                                id={e.id}
                                label="ابطال با سند معکوس"
                                confirmText="برای اصلاح، یک سند معکوس در سوابق مالی ثبت می‌شود. سند اصلی حذف نمی‌شود. ادامه می‌دهید؟"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="muted px-1 text-[10.5px]">
        {faCount(rows.length)} رکورد · ترتیب: {filters.sort === "old" ? "قدیمی‌ترین" : filters.sort === "amount" ? "بیشترین مبلغ" : "جدیدترین"} · کلید <kbd className="kbd">/</kbd> برای جستجو · جزئیات حسابداری کامل در{" "}
        <a href="/financial-records" className="underline underline-offset-2" style={{ color: "var(--brand)" }}>
          سوابق مالی
        </a>
      </p>

      {/* ─────────── Bulk action bar ─────────── */}
      {selectedRows.length > 0 && (
        <div
          className="pop-in fixed inset-x-3 bottom-[76px] z-50 mx-auto flex max-w-lg items-center justify-between gap-2 rounded-[var(--r-lg)] border px-4 py-2.5 lg:bottom-6"
          style={{ background: "var(--surface-elev)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-lg)", touchAction: "manipulation" }}
          role="region"
          aria-label="اقدامات گروهی"
        >
          <span className="text-[12.5px] font-semibold">{faCount(selectedRows.length)} مورد انتخاب شده</span>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn btn-primary !min-h-9 !px-3 !py-1.5 text-[12px]" onClick={exportCsv} style={{ touchAction: "manipulation" }}>
              <Icon name="download" size={14} />
              خروجی CSV
            </button>
            <button
              type="button"
              className="btn !min-h-9 !px-3 !py-1.5 text-[12px]"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markManyReviewedAction([...selected]);
                  setSelected(new Set());
                })
              }
              style={{ touchAction: "manipulation" }}
            >
              <Icon name="check" size={14} />
              تأیید همه
            </button>
            <button
              type="button"
              className="icon-btn !min-h-9 !min-w-9"
              onClick={() => setSelected(new Set())}
              aria-label="لغو انتخاب"
              style={{ touchAction: "manipulation" }}
            >
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
