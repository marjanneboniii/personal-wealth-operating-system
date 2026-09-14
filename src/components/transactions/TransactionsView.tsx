"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import AdvancedFilter from "@/components/ui/AdvancedFilter";
import FlowIcon from "@/components/transactions/FlowIcon";
import { markManyReviewedAction, markReviewedAction } from "@/app/actions";
import { humanizeEntry, moneyFlowLabel, txAmountLabel } from "@/lib/tx";
import type { TxRow } from "@/features/ledger/queries";
import type { EntryFxSnapshot } from "@/features/ledger/fxSnapshots";
import {
  currencyLabel,
  faCount,
  formatJalaliIso,
  formatMoney,
  formatQty,
  formatShortDate,
  toFaDigits,
  toJalali,
  todayIso,
} from "@/lib/format";
import { D } from "@/domain/decimal";
import { useProMode } from "@/components/layout/ProModeProvider";

export type ClientTxRow = TxRow & {
  fx: EntryFxSnapshot | null;
  linkedInstallment: { title: string; seq: number } | null;
};

type Filters = { q: string; type: string; accountId: string; categoryId: string; review: string; range: string; sort: string };

const TYPE_OPTIONS = [
  { key: "expense", label: "هزینه" },
  { key: "income", label: "درآمد" },
  { key: "transfer", label: "انتقال" },
  { key: "debt_repayment", label: "بازپرداخت بدهی" },
  { key: "buy", label: "خرید" },
  { key: "sell", label: "فروش" },
  { key: "fx", label: "تبدیل / سواپ" },
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

const SORT_OPTIONS = [
  { key: "new", label: "جدیدترین" },
  { key: "old", label: "قدیمی‌ترین" },
  { key: "amount", label: "بیشترین مبلغ" },
];

const SOURCE_LABEL: Record<string, string> = { manual: "دستی", plan: "اجرا شده از برنامه", import: "درون‌ریزی" };

const CURRENT_JALALI_YEAR = toJalali(todayIso()).y;

/** «۱۲ شهریور», plus the year only when it is not the current one. Jalali only. */
function dayLabel(iso: string) {
  const { y } = toJalali(iso);
  return y === CURRENT_JALALI_YEAR ? formatShortDate(iso) : `${formatShortDate(iso)} ${toFaDigits(String(y))}`;
}

export default function TransactionsView({
  rows,
  accountGroups,
  categoryGroups = [],
  rate,
  filters,
  truncated = false,
}: {
  rows: ClientTxRow[];
  accountGroups: { label: string; options: { id: string; name: string }[] }[];
  categoryGroups?: { id: string; name: string; children: { id: string; name: string }[] }[];
  rate: string;
  filters: Filters;
  /** The query hit its row limit — older matches exist but are not listed. */
  truncated?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // Historical FX freeze lines are ledger-grade detail → PRO-only (Directive §2).
  const pro = useProMode();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);

  // URL state — filters survive refresh, share and browser back
  const apply = (patch: Partial<Filters>) => {
    const next = new URLSearchParams(sp.toString());
    const merged = { ...filters, ...patch };
    const urlKey: Record<keyof Filters, string> = {
      q: "q",
      type: "type",
      accountId: "account",
      categoryId: "category",
      review: "review",
      range: "range",
      sort: "sort",
    };
    for (const [k, v] of Object.entries(merged) as [keyof Filters, string][]) {
      if (v) next.set(urlKey[k], v);
      else next.delete(urlKey[k]);
    }
    router.replace(`/transactions?${next.toString()}`, { scroll: false });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const unreviewedCount = useMemo(() => rows.filter((r) => !r.reviewed).length, [rows]);

  // Day headers only make sense for a date order; «بیشترین مبلغ» is one list.
  const byDay = filters.sort !== "amount";
  const groups = useMemo(() => {
    if (!byDay) return [{ key: "all", label: null as string | null, rows }];
    const out: { key: string; label: string | null; rows: ClientTxRow[] }[] = [];
    for (const r of rows) {
      const last = out[out.length - 1];
      if (last && last.key === r.entryDate) last.rows.push(r);
      else out.push({ key: r.entryDate, label: dayLabel(r.entryDate), rows: [r] });
    }
    return out;
  }, [rows, byDay]);

  const exportCsv = () => {
    const head = "date,description,type,from,to,amount_usd,amount_irt\n";
    const body = selectedRows
      .map((r) => {
        const h = humanizeEntry(r);
        // Authoritative Toman first (native leg), then the commit-time
        // snapshot; never a current-rate re-derivation.
        const irt = (h.nativeIrt ?? r.fx?.irtAmount ?? "").replace(/[,٬]/g, "");
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
    const blob = new Blob(["﻿" + head + body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions.csv";
    a.click();
    // Revoking in the same tick cancels the download in Safari and Firefox.
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const isFiltered = filters.q || filters.type || filters.accountId || filters.categoryId || filters.review || filters.range !== "m3";

  const renderRow = (e: ClientTxRow) => {
    const h = humanizeEntry(e);
    const open = expanded === e.id;
    const isVoid = e.status === "void";
    const flow = moneyFlowLabel(h.from, h.to);
    const category = e.categoryName ? `${e.categoryParentName ? `${e.categoryParentName} › ` : ""}${e.categoryName}` : null;
    // A buy / sell / swap is recorded with its frozen quantity and unit prices.
    const trade = e.fx?.trade ?? null;
    // A property or vehicle sale is one whole asset: its label («ملک ۱») is the quantity.
    const tradeQty = trade
      ? trade.priceMode === "registry"
        ? trade.tradeSymbol
        : `${formatQty(trade.tradeQuantity, 8)} ${currencyLabel(trade.tradeSymbol)}`
      : null;
    const meta = [h.typeLabel, tradeQty, category, flow].filter(Boolean).join(" · ");
    const amount = txAmountLabel(h, e.fx?.irtAmount, rate);

    return (
      <li key={e.id} className={isVoid ? "opacity-55" : ""}>
        <div className="tx-item">
          <input
            type="checkbox"
            checked={selected.has(e.id)}
            onChange={() => toggleSelect(e.id)}
            aria-label={`انتخاب «${e.description}»`}
            className="hidden h-4 w-4 shrink-0 cursor-pointer sm:block"
            style={{ accentColor: "var(--action)" }}
          />
          <button
            type="button"
            onClick={() => setExpanded(open ? null : e.id)}
            aria-expanded={open}
            className="tx-item-main"
          >
            <FlowIcon sign={h.sign} />
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-2">
                <span className={`min-w-0 truncate text-[length:var(--fs-sm)] font-medium ${isVoid ? "line-through" : ""}`}>
                  {e.description}
                </span>
                {!e.reviewed && (
                  <span className="tx-unreviewed-dot" title="بررسی‌نشده">
                    <span className="sr-only">بررسی‌نشده</span>
                  </span>
                )}
                {isVoid && <span className="badge badge-neg shrink-0">ابطال‌شده</span>}
              </span>
              <span className="muted block truncate text-[length:var(--fs-xs)]">
                {byDay ? meta : `${formatShortDate(e.entryDate)} · ${meta}`}
              </span>
            </span>
            <span
              className="num shrink-0 text-[length:var(--fs-sm)] font-semibold money-nowrap"
              dir="rtl"
              style={h.sign > 0 ? { color: "var(--positive)" } : undefined}
            >
              {amount}
            </span>
            <span className={`muted shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
              <Icon name="chevronDown" size={15} />
            </span>
          </button>
        </div>

        {open && (
          <div className="tx-detail fade-in">
            <dl className="tx-detail-grid">
              <div>
                <dt>تاریخ</dt>
                <dd className="num">{formatJalaliIso(e.entryDate)}</dd>
              </div>
              <div>
                <dt>نوع</dt>
                <dd>{h.typeLabel}</dd>
              </div>
              {flow && (
                <div>
                  <dt>جریان</dt>
                  <dd>{flow}</dd>
                </div>
              )}
              {category && (
                <div>
                  <dt>دسته</dt>
                  <dd>
                    {category}
                    {e.categoryNonCash ? " · غیرنقدی" : ""}
                  </dd>
                </div>
              )}
              {trade ? (
                <>
                  <div>
                    <dt>{trade.priceMode === "registry" ? "دارایی فروخته‌شده" : "مقدار"}</dt>
                    <dd className="num" dir="rtl">
                      {tradeQty}
                    </dd>
                  </div>
                  {trade.settleSymbol && trade.settleQuantity && (
                    <div>
                      <dt>تسویه با</dt>
                      <dd className="num" dir="rtl">
                        {trade.settleSymbol === "IRT"
                          ? formatMoney(D(trade.settleQuantity).toFixed(0), "IRT")
                          : `${formatQty(trade.settleQuantity, 6)} ${currencyLabel(trade.settleSymbol)}`}
                      </dd>
                    </div>
                  )}
                  {trade.unitPriceIrt && (
                    <div>
                      <dt>قیمت هر واحد (تومان)</dt>
                      <dd className="num" dir="rtl">
                        {formatMoney(D(trade.unitPriceIrt).toFixed(0), "IRT")}
                      </dd>
                    </div>
                  )}
                  {trade.unitPriceUsdt && (
                    <div>
                      <dt>قیمت هر واحد (تتر)</dt>
                      <dd className="num" dir="rtl">
                        {formatQty(trade.unitPriceUsdt, 6)} تتر
                      </dd>
                    </div>
                  )}
                  {trade.usdtRateIrt && (
                    <div>
                      <dt>نرخ تتر زمان ثبت</dt>
                      <dd className="num" dir="rtl">
                        {formatMoney(D(trade.usdtRateIrt).toFixed(0), "IRT")}
                      </dd>
                    </div>
                  )}
                  {trade.priceMode && trade.priceMode !== "registry" && (
                    <div>
                      <dt>نوع قیمت</dt>
                      <dd>{trade.priceMode === "limit" ? "لیمیت (دلخواه)" : "بازار"}</dd>
                    </div>
                  )}
                </>
              ) : (
                h.qtyLabel && (
                  <div>
                    <dt>مقدار</dt>
                    <dd className="num" dir="rtl">
                      {h.qtyLabel}
                    </dd>
                  </div>
                )
              )}
              <div>
                <dt>معادل دلاری</dt>
                <dd className="num" dir="rtl">
                  {formatMoney(h.amount)}
                </dd>
              </div>
              <div>
                <dt>منبع</dt>
                <dd>{SOURCE_LABEL[e.source] ?? e.source}</dd>
              </div>
              {e.fx && pro && (
                <div>
                  <dt>نرخ زمان ثبت</dt>
                  <dd className="num" dir="rtl">
                    {formatMoney(e.fx.fxRate, "IRT")}
                  </dd>
                </div>
              )}
            </dl>

            {e.linkedInstallment && (
              <p className="mt-3 text-[length:var(--fs-xs)]" style={{ color: "var(--positive)" }}>
                پرداخت قسط {faCount(e.linkedInstallment.seq)} «{e.linkedInstallment.title}»
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await markReviewedAction(e.id, !e.reviewed);
                  })
                }
                className={`btn ${e.reviewed ? "btn-soft" : "btn-primary"} !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]`}
              >
                <Icon name={e.reviewed ? "undo" : "check"} size={14} />
                {e.reviewed ? "برگشت به بررسی‌نشده" : "تأیید"}
              </button>
              {!isVoid && (
                <RowAction
                  kind="reverse"
                  id={e.id}
                  label="ابطال با سند معکوس"
                  confirmText="برای اصلاح، یک سند معکوس در سوابق مالی ثبت می‌شود. سند اصلی حذف نمی‌شود. ادامه می‌دهید؟"
                />
              )}
              {pro && (
                <a href="/financial-records" className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
                  سوابق مالی
                </a>
              )}
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className="space-y-3">
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
          {
            key: "sort",
            label: "ترتیب",
            value: filters.sort === "new" ? "" : filters.sort,
            placeholder: "جدیدترین",
            options: SORT_OPTIONS.filter((s) => s.key !== "new").map((s) => ({ value: s.key, label: s.label })),
            onChange: (v: string) => apply({ sort: v }),
          },
        ]}
        chips={[
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

      {rows.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
          <span className="flow-icon" aria-hidden="true">
            <Icon name="search" size={17} />
          </span>
          <p className="text-[length:var(--fs-sm)] font-semibold">
            {isFiltered ? "تراکنشی با این فیلترها پیدا نشد" : "هنوز تراکنشی ثبت نشده است"}
          </p>
          {isFiltered && (
            <button type="button" className="btn btn-soft mt-1" onClick={() => router.replace("/transactions")}>
              حذف فیلترها
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="tx-toolbar">
            <span className="num">
              {faCount(rows.length)} تراکنش
              {unreviewedCount > 0 ? ` · ${faCount(unreviewedCount)} بررسی‌نشده` : ""}
            </span>
            {truncated && <span style={{ color: "var(--warning)" }}>فقط موارد اخیر نمایش داده شده — بازه را کوتاه‌تر کنید</span>}
          </div>
          <div className="card tx-list">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label ?? undefined}>
                {g.label && <h3 className="tx-day">{g.label}</h3>}
                <ul>{g.rows.map(renderRow)}</ul>
              </section>
            ))}
          </div>
        </>
      )}

      {selectedRows.length > 0 && (
        <div
          className="bulk-action-bar pop-in fixed inset-x-3 bottom-[76px] z-50 mx-auto flex max-w-lg items-center justify-between gap-2 rounded-[var(--r-lg)] border px-4 py-2.5 lg:bottom-6"
          style={{ background: "var(--surface-elev)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-lg)" }}
          role="region"
          aria-label="اقدامات گروهی"
        >
          <span className="text-[length:var(--fs-xs)] font-semibold">{faCount(selectedRows.length)} مورد انتخاب شده</span>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn btn-primary !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]" onClick={exportCsv}>
              <Icon name="download" size={14} />
              خروجی CSV
            </button>
            <button
              type="button"
              className="btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  await markManyReviewedAction([...selected]);
                  setSelected(new Set());
                })
              }
            >
              <Icon name="check" size={14} />
              تأیید همه
            </button>
            <button type="button" className="icon-btn !min-h-9 !min-w-9" onClick={() => setSelected(new Set())} aria-label="لغو انتخاب">
              <Icon name="x" size={15} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
