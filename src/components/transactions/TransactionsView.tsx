"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import { markManyReviewedAction, markReviewedAction } from "@/app/actions";
import { humanizeEntry, typeBadgeTone } from "@/lib/tx";
import type { TxRow } from "@/features/ledger/queries";
import { formatJalaliIso, formatMoney, formatQty, formatShortDate } from "@/lib/format";

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
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState(filters.q);
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toIrt = (usd: string | number) => (rate ? formatMoney(Math.round(Number(usd) * Number(rate)), "IRT") : null);

  // URL state — filters survive refresh, share and browser back
  const apply = (patch: Partial<Filters>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries({ ...filters, ...patch })) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`/transactions?${next.toString()}`, { scroll: false });
  };

  // Sync the local query box when the URL filter changes (back/forward, clear-all)
  const [lastQ, setLastQ] = useState(filters.q);
  if (filters.q !== lastQ) {
    setLastQ(filters.q);
    setQuery(filters.q);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const onQuery = (v: string) => {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => apply({ q: v }), 350);
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
        const irt = toIrt(h.amount)?.replace(/[,٬]/g, "") ?? "";
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
      {/* ─────────── Filter bar ─────────── */}
      <div className="card sticky top-[52px] z-20 flex flex-wrap items-center gap-2 p-2 lg:top-0" style={{ touchAction: "manipulation" }}>
        <div className="relative min-w-[180px] flex-1">
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-40">
            <Icon name="search" size={15} />
          </span>
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            placeholder="جستجوی شرح یا مرجع…"
            aria-label="جستجوی تراکنش‌ها"
            className="field !min-h-9 !py-1.5 pr-9 text-[13px]"
            style={{ touchAction: "manipulation" }}
          />
          <kbd className="kbd absolute left-2.5 top-1/2 hidden -translate-y-1/2 lg:inline-flex">/</kbd>
        </div>

        <div className="seg order-3 w-full overflow-x-auto sm:order-none sm:w-auto" style={{ touchAction: "pan-x" }}>
          {TYPE_OPTIONS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => apply({ type: t.key })}
              className={filters.type === t.key ? "seg-on" : ""}
              aria-pressed={filters.type === t.key}
              style={{ touchAction: "manipulation" }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={filters.range}
          onChange={(e) => apply({ range: e.target.value })}
          className="field !min-h-9 !w-auto !py-1.5 text-[12.5px]"
          aria-label="بازه زمانی"
          style={{ touchAction: "manipulation" }}
        >
          {RANGE_OPTIONS.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </select>

        <select
          value={filters.accountId}
          onChange={(e) => apply({ accountId: e.target.value })}
          className="field !min-h-9 !w-auto max-w-[150px] !py-1.5 text-[12.5px]"
          aria-label="فیلتر حساب"
          style={{ touchAction: "manipulation" }}
        >
          <option value="">همه حساب‌ها</option>
          {accountGroups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.options.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        {categoryGroups.length > 0 && (
          <select
            value={filters.categoryId}
            onChange={(e) => apply({ categoryId: e.target.value })}
            className="field !min-h-9 !w-auto max-w-[170px] !py-1.5 text-[12.5px]"
            aria-label="فیلتر دسته هزینه"
            style={{ touchAction: "manipulation" }}
          >
            <option value="">همه دسته‌های هزینه</option>
            {categoryGroups.map((g) => (
              <optgroup key={g.id} label={g.name}>
                <option value={g.id}>{g.name} (همه)</option>
                {g.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={() => apply({ sort: filters.sort === "old" ? "new" : "old" })}
          className={`chip ${filters.sort === "old" ? "chip-on" : ""}`}
          aria-pressed={filters.sort === "old"}
          title="ترتیب زمانی"
          style={{ touchAction: "manipulation" }}
        >
          <Icon name="calendar" size={12} />
          {filters.sort === "old" ? "قدیمی‌ترین" : "جدیدترین"}
        </button>

        <button
          type="button"
          onClick={() => apply({ sort: filters.sort === "amount" ? "new" : "amount" })}
          className={`chip ${filters.sort === "amount" ? "chip-on" : ""}`}
          aria-pressed={filters.sort === "amount"}
          title="مرتب‌سازی بر اساس مبلغ"
          style={{ touchAction: "manipulation" }}
        >
          <Icon name="filter" size={12} />
          بیشترین مبلغ
        </button>

        <button
          type="button"
          onClick={() => apply({ review: filters.review === "unreviewed" ? "" : "unreviewed" })}
          className={`chip ${filters.review === "unreviewed" ? "chip-on" : ""}`}
          aria-pressed={filters.review === "unreviewed"}
          style={{ touchAction: "manipulation" }}
        >
          <Icon name="check" size={12} />
          بررسی‌نشده
        </button>

        {isFiltered && (
          <button
            type="button"
            className="btn btn-ghost !min-h-8 !px-2 !py-1 text-[11.5px]"
            onClick={() => router.replace("/transactions")}
            style={{ touchAction: "manipulation" }}
          >
            <Icon name="x" size={13} />
            پاک کردن فیلترها
          </button>
        )}
      </div>

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
                    className="hidden h-4 w-4 shrink-0 cursor-pointer accent-[#4c4edb] sm:block"
                    style={{ touchAction: "manipulation" }}
                  />

                  {/* Main row button — isolated, no nested clickable inside */}
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : e.id)}
                    aria-expanded={open}
                    className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] py-0.5 text-right"
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
                          <span className="badge shrink-0" style={{ background: "var(--surface-2)" }}>
                            {e.categoryParentName ? `${e.categoryParentName} › ` : ""}
                            {e.categoryName}
                            {e.categoryNonCash ? " · غیرنقدی" : ""}
                          </span>
                        )}
                        {h.from && h.to && (
                          <span className="hidden truncate sm:inline">
                            &nbsp;· {h.from} ← {h.to}
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="shrink-0 text-left">
                      <span
                        className="num block text-[13.5px] font-bold"
                        dir="ltr"
                        style={{ color: h.sign > 0 ? "var(--positive)" : h.sign < 0 ? "var(--negative)" : "var(--text)" }}
                      >
                        {h.sign > 0 ? "+" : h.sign < 0 ? "−" : ""}
                        {formatMoney(h.amount)}
                      </span>
                      {rate && <span className="muted num block text-[9.5px]">≈ {toIrt(h.amount)}</span>}
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
                        <p className="muted mb-2 text-[11px] font-semibold">اثر مالی این تراکنش (سوابق مالی)</p>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>حساب</th>
                              <th className="td-num">مقدار</th>
                              <th className="td-num">ارزش پایه</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.lines.map((l, i) => (
                              <tr key={i}>
                                <td>
                                  <span className="text-[12.5px] font-medium">{l.account}</span>
                                  <span className={`badge badge-neutral mr-2 ${Number(l.baseValue) >= 0 ? "badge-pos" : "badge-neg"}`}>
                                    {Number(l.baseValue) >= 0 ? "بدهکار" : "بستانکار"}
                                  </span>
                                  {l.quantity && Math.abs(Number(l.quantity)) > 0 && (
                                    <span className="muted num mr-1 text-[10px]" dir="ltr">
                                      {formatQty(l.quantity, l.decimals)} {l.symbol}
                                    </span>
                                  )}
                                </td>
                                <td className="td-num" dir="ltr">
                                  {l.symbol && l.symbol !== "USD" && l.symbol !== "IRT" ? `${formatQty(l.quantity, l.decimals, "en")} ${l.symbol}` : "—"}
                                </td>
                                <td className="td-num font-semibold" dir="ltr" style={{ color: Number(l.baseValue) >= 0 ? "var(--positive)" : "var(--negative)" }}>
                                  {Number(l.baseValue) >= 0 ? "+" : "−"}
                                  {formatMoney(Math.abs(Number(l.baseValue)))}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {e.fx && (
                          <p className="muted mt-3 text-[10.5px] leading-5">
                            مبلغ تاریخی منجمد: <b className="num">{formatMoney(e.fx.irtAmount, "IRT")}</b> ≈{" "}
                            <b className="num" dir="ltr">
                              {formatMoney(e.fx.usdAmount)}
                            </b>{" "}
                            · نرخ زمان ثبت: <span className="num" dir="ltr">{formatMoney(e.fx.fxRate, "IRT")}</span>
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
                              <dt className="muted">تاریخ</dt>
                              <dd className="num text-left">
                                {formatJalaliIso(e.entryDate)} <span className="muted text-[10px]">({e.entryDate})</span>
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="muted">نوع</dt>
                              <dd>
                                <span className={`badge badge-${typeBadgeTone(e.type)}`}>{h.typeLabel}</span>
                              </dd>
                            </div>
                            <div className="flex justify-between gap-2">
                              <dt className="muted">منبع</dt>
                              <dd>{SOURCE_LABEL[e.source] ?? e.source}</dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt className="muted">وضعیت بازبینی</dt>
                              <dd>
                                {e.reviewed ? <span className="badge badge-pos">تأیید شده</span> : <span className="badge badge-warn">بررسی‌نشده</span>}
                              </dd>
                            </div>
                            <div className="flex items-center justify-between gap-2">
                              <dt className="muted">شناسه سند</dt>
                              <dd className="num text-[10px]" dir="ltr">
                                #{e.id.slice(0, 8)}
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
                            <Icon name="check" size={14} />
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
        {rows.length} رکورد · ترتیب: {filters.sort === "old" ? "قدیمی‌ترین" : filters.sort === "amount" ? "بیشترین مبلغ" : "جدیدترین"} · کلید <kbd className="kbd">/</kbd> برای جستجو · جزئیات حسابداری کامل در{" "}
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
          <span className="text-[12.5px] font-semibold">{selectedRows.length} مورد انتخاب شده</span>
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
