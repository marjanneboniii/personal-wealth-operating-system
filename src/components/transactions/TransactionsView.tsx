"use client";
import { csvTextCell } from "@/lib/csv";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Icon from "@/components/ui/Icon";
import RowAction from "@/components/RowAction";
import AdvancedFilter from "@/components/ui/AdvancedFilter";
import FlowIcon from "@/components/transactions/FlowIcon";
import SwipeRow from "@/components/money/SwipeRow";
import { markManyReviewedAction, markReviewedAction, setEntryTagsAction, tagEntriesAction } from "@/app/actions";
import { saveTemplateAction } from "@/app/actions/templates";
import TagInput from "@/components/transactions/TagInput";
import type { TagCount, TagSummary } from "@/features/tags/service";
import { humanizeEntry, moneyFlowLabel, txAmountLabel, plainAccountName } from "@/lib/tx";
import type { TxRow } from "@/features/ledger/queries";
import type { EntryFxSnapshot } from "@/features/ledger/fxSnapshots";
import {
  currencyLabel,
  faCount,
  formatJalaliIso,
  formatMoney,
  formatQty,
  formatMoneyWithSign,
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

type Filters = { q: string; type: string; accountId: string; categoryId: string; tag: string; review: string; range: string; sort: string };

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

/** Types «تکرار» and «میان‌بر» are offered for — the everyday shapes a copy gets right. */
const REPEATABLE: ReadonlySet<string> = new Set(["expense", "income", "transfer"]);

/** «۱۲ شهریور», plus the year only when it is not the current one. Jalali only. */
function dayLabel(iso: string) {
  const { y } = toJalali(iso);
  return y === CURRENT_JALALI_YEAR ? formatShortDate(iso) : `${formatShortDate(iso)} ${toFaDigits(String(y))}`;
}


type Run = { kind: "run"; key: string; title: string; rows: ClientTxRow[] };
type ListItem = { kind: "row"; row: ClientTxRow } | Run;

/**
 * Folds one day's installment payments of the same loan into one row. Paying
 * six months of «وام مسکن» at once used to fill the whole first screen with
 * six identical lines; now it is «۶ قسط — وام مسکن», opened on demand.
 * Order is kept: the run sits where its first payment was.
 */
function foldRuns(dayKey: string, rows: ClientTxRow[]): ListItem[] {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.linkedInstallment) counts.set(r.linkedInstallment.title, (counts.get(r.linkedInstallment.title) ?? 0) + 1);
  const out: ListItem[] = [];
  const runs = new Map<string, Run>();
  for (const r of rows) {
    const title = r.linkedInstallment?.title;
    if (!title || (counts.get(title) ?? 0) < 2) {
      out.push({ kind: "row", row: r });
      continue;
    }
    const run = runs.get(title);
    if (run) run.rows.push(r);
    else {
      const fresh: Run = { kind: "run", key: `${dayKey}:${title}`, title, rows: [r] };
      runs.set(title, fresh);
      out.push(fresh);
    }
  }
  return out;
}

export default function TransactionsView({
  rows,
  accountGroups,
  categoryGroups = [],
  rate,
  tags = [],
  tagSummary = null,
  filters,
  truncated = false,
}: {
  rows: ClientTxRow[];
  accountGroups: { label: string; options: { id: string; name: string }[] }[];
  categoryGroups?: { id: string; name: string; children: { id: string; name: string }[] }[];
  rate: string;
  /** The user's hashtags, most used first. */
  tags?: TagCount[];
  /** All-time totals of the filtered tag. */
  tagSummary?: TagSummary | null;
  filters: Filters;
  /** The query hit its row limit — older matches exist but are not listed. */
  truncated?: boolean;
}) {
  const router = useRouter();
  const sp = useSearchParams();
  // Historical FX freeze lines are ledger-grade detail → PRO-only (Directive §2).
  const pro = useProMode();
  const [expanded, setExpanded] = useState<string | null>(null);
  // Installment runs folded into one row («۶ قسط وام مسکن»), opened by key.
  const [openRuns, setOpenRuns] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const [tagEdit, setTagEdit] = useState<{ id: string; text: string } | null>(null);
  // «میان‌بر»: the entry's shape saved as a home-screen shortcut.
  const [shortcut, setShortcut] = useState<{ id: string; label: string; keepAmount: boolean; message?: string; ok?: boolean } | null>(null);
  const [bulkTag, setBulkTag] = useState<string | null>(null);
  const [tagMsg, setTagMsg] = useState<string | null>(null);
  const tagNames = useMemo(() => tags.map((t) => t.tag), [tags]);

  const saveTags = (id: string, text: string) =>
    startTransition(async () => {
      const res = await setEntryTagsAction(id, text);
      setTagMsg(res.ok ? null : res.message);
      if (res.ok) setTagEdit(null);
    });
  const saveBulkTag = (text: string) =>
    startTransition(async () => {
      const res = await tagEntriesAction([...selected], text);
      setTagMsg(res.message);
      if (res.ok) {
        setBulkTag(null);
        setSelected(new Set());
      }
    });

  // URL state — filters survive refresh, share and browser back
  const apply = (patch: Partial<Filters>) => {
    const next = new URLSearchParams(sp.toString());
    const merged = { ...filters, ...patch };
    const urlKey: Record<keyof Filters, string> = {
      q: "q",
      type: "type",
      accountId: "account",
      categoryId: "category",
      tag: "tag",
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
  // Net Toman of the selection (Palletline's summary bar): in minus out, from
  // each entry's own frozen Toman. Shown only when every selected entry has
  // one — a partial sum would be a wrong number, not a smaller one.
  const selectedNet = useMemo(() => {
    let sum = D(0);
    for (const r of selectedRows) {
      const h = humanizeEntry(r);
      const t = h.nativeIrt ?? r.fx?.irtAmount ?? null;
      if (t == null) return null;
      sum = h.sign < 0 ? sum.sub(D(t)) : h.sign > 0 ? sum.add(D(t)) : sum;
    }
    return sum;
  }, [selectedRows]);
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
    const head = "date,description,type,from,to,amount_usd,amount_irt,tags\n";
    const body = selectedRows
      .map((r) => {
        const h = humanizeEntry(r);
        // Authoritative Toman first (native leg), then the commit-time
        // snapshot; never a current-rate re-derivation.
        const irt = (h.nativeIrt ?? r.fx?.irtAmount ?? "").replace(/[,٬]/g, "");
        return [
          r.entryDate,
          csvTextCell(r.description),
          h.typeLabel,
          csvTextCell(h.from ?? ""),
          csvTextCell(h.to ?? ""),
          h.amount,
          `"${irt}"`,
          csvTextCell(r.tags.map((t) => `#${t}`).join(" ")),
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

  const isFiltered = filters.q || filters.type || filters.accountId || filters.categoryId || filters.tag || filters.review || filters.range !== "m3";

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
    const tagLine = e.tags.length ? e.tags.map((t) => `#${t}`).join(" ") : null;

    const amount = txAmountLabel(h, e.fx?.irtAmount, rate);

    return (
      <li key={e.id} className={isVoid ? "opacity-55" : ""}>
        <SwipeRow
          actions={
            <>
              <button
                type="button"
                className="mny-swipe-btn"
                data-tone={e.reviewed ? "neutral" : "positive"}
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    await markReviewedAction(e.id, !e.reviewed);
                  })
                }
              >
                <Icon name={e.reviewed ? "undo" : "check"} size={16} />
                {e.reviewed ? "بررسی‌نشده" : "تأیید"}
              </button>
              {!isVoid && REPEATABLE.has(e.type) && (
                <a href={`/new?repeat=${e.id}`} className="mny-swipe-btn" data-tone="neutral">
                  <Icon name="refresh" size={16} />
                  تکرار
                </a>
              )}
            </>
          }
        >
          <div className="tx-item mny-tx" data-type={e.type} data-open={open || undefined}>
            <input
              type="checkbox"
              checked={selected.has(e.id)}
              onChange={() => toggleSelect(e.id)}
              aria-label={`انتخاب «${e.description}»`}
              className="mny-tx-check"
            />
            <button
              type="button"
              onClick={() => setExpanded(open ? null : e.id)}
              aria-expanded={open}
              className="tx-item-main mny-tx-main"
            >
              <FlowIcon sign={h.sign} type={e.type} />
              <span className="mny-tx-id">
                <span className="mny-tx-title">
                  <span className={`mny-tx-text${isVoid ? " line-through" : ""}`}>{e.description}</span>
                  {!e.reviewed && (
                    <span className="tx-unreviewed-dot" title="بررسی‌نشده">
                      <span className="sr-only">بررسی‌نشده</span>
                    </span>
                  )}
                  {isVoid && <span className="badge badge-neg shrink-0">ابطال‌شده</span>}
                </span>
                <span className="mny-tx-meta">
                  <span className="mny-tx-kind">{h.typeLabel}</span>
                  {!byDay && <span>{formatShortDate(e.entryDate)}</span>}
                  {category && <span>{category}</span>}
                  {tradeQty && <span className="num">{tradeQty}</span>}
                  {tagLine && <span className="mny-tx-tags">{tagLine}</span>}
                </span>
              </span>
              {/* Its own column on a wide screen; on a phone the flow is in the
                  row's detail, so each row stays two lines. */}
              {flow && <span className="mny-tx-flow">{flow}</span>}
              <span className="mny-tx-amount num money-nowrap" dir="rtl" data-sign={h.sign}>
                {amount}
              </span>
            </button>
          </div>
        </SwipeRow>

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

            {tagEdit?.id === e.id ? (
              <form
                className="mt-3 space-y-2"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  saveTags(e.id, tagEdit.text);
                }}
              >
                <label className="label" htmlFor={`tags-${e.id}`}>برچسب‌ها</label>
                <TagInput id={`tags-${e.id}`} value={tagEdit.text} onChange={(text) => setTagEdit({ id: e.id, text })} suggestions={tagNames} autoFocus />
                <div className="flex gap-2">
                  <button type="submit" disabled={pending} className="btn btn-primary !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
                    ذخیره برچسب‌ها
                  </button>
                  <button type="button" className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]" onClick={() => setTagEdit(null)}>
                    انصراف
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {e.tags.map((t) => (
                  <button key={t} type="button" className="tag-chip" onClick={() => apply({ tag: t })} title={`همه تراکنش‌های #${t}`}>
                    #{t}
                  </button>
                ))}
                <button
                  type="button"
                  className="btn btn-ghost !min-h-8 !px-2.5 !py-1 text-[length:var(--fs-xs)]"
                  onClick={() => {
                    setTagMsg(null);
                    setTagEdit({ id: e.id, text: e.tags.map((t) => `#${t}`).join(" ") });
                  }}
                >
                  <Icon name="plus" size={13} />
                  {e.tags.length ? "ویرایش برچسب" : "افزودن برچسب"}
                </button>
              </div>
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
              {!isVoid && REPEATABLE.has(e.type) && (
                <a href={`/new?repeat=${e.id}`} className="btn btn-soft !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
                  <Icon name="refresh" size={14} />
                  تکرار
                </a>
              )}
              {!isVoid && REPEATABLE.has(e.type) && (
                <button
                  type="button"
                  className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
                  aria-expanded={shortcut?.id === e.id}
                  onClick={() => setShortcut(shortcut?.id === e.id ? null : { id: e.id, label: e.description.slice(0, 40), keepAmount: true })}
                >
                  <Icon name="plus" size={14} />
                  میان‌بر
                </button>
              )}
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
            {shortcut?.id === e.id && (
              <form
                className="mt-3 grid gap-2 rounded-[var(--r-md)] p-3"
                style={{ background: "var(--sunken)" }}
                onSubmit={(ev) => {
                  ev.preventDefault();
                  const s = shortcut;
                  startTransition(async () => {
                    const res = await saveTemplateAction(s.id, s.label, s.keepAmount);
                    setShortcut(res.ok ? null : { ...s, message: res.message, ok: false });
                    if (res.ok) router.refresh();
                  });
                }}
              >
                <label className="label" htmlFor={`shortcut-${e.id}`}>
                  نام میان‌بر در صفحه‌ی اصلی
                </label>
                <input
                  id={`shortcut-${e.id}`}
                  className="field"
                  maxLength={40}
                  value={shortcut.label}
                  onChange={(ev) => setShortcut({ ...shortcut, label: ev.target.value })}
                />
                <label className="flex items-center gap-2 text-[length:var(--fs-xs)]">
                  <input type="checkbox" checked={shortcut.keepAmount} onChange={(ev) => setShortcut({ ...shortcut, keepAmount: ev.target.checked })} />
                  مبلغ ثابت است (برای قبض با مبلغ متغیر، تیک را بردارید)
                </label>
                {shortcut.message && (
                  <p className="text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
                    {shortcut.message}
                  </p>
                )}
                <button type="submit" className="btn btn-primary !min-h-9 text-[length:var(--fs-xs)]" disabled={pending || !shortcut.label.trim()}>
                  ذخیره‌ی میان‌بر
                </button>
              </form>
            )}
          </div>
        )}
      </li>
    );
  };


  const renderRun = (run: Run) => {
    const open = openRuns.has(run.key);
    const first = humanizeEntry(run.rows[0]);
    // The run total is shown only when every payment carries its own frozen
    // Toman — a partial sum would understate what left the account.
    const tomans = run.rows.map((r) => humanizeEntry(r).nativeIrt ?? r.fx?.irtAmount ?? null);
    const total = tomans.every((t): t is string => t != null)
      ? formatMoneyWithSign(first.sign < 0 ? "−" : first.sign > 0 ? "+" : "", tomans.reduce((sum, t) => sum.add(D(t)), D(0)).toFixed(0), "IRT")
      : null;
    const seqs = run.rows.map((r) => r.linkedInstallment?.seq ?? 0).filter(Boolean).sort((a, b) => a - b);
    const unreviewed = run.rows.some((r) => !r.reviewed);
    return (
      <li key={run.key} className="mny-run" data-open={open || undefined}>
        <div className="tx-item mny-tx" data-type={run.rows[0].type}>
          <span className="mny-tx-check" aria-hidden="true" />
          <button
            type="button"
            className="tx-item-main mny-tx-main"
            aria-expanded={open}
            onClick={() =>
              setOpenRuns((prev) => {
                const next = new Set(prev);
                if (next.has(run.key)) next.delete(run.key);
                else next.add(run.key);
                return next;
              })
            }
          >
            <FlowIcon sign={first.sign} type={run.rows[0].type} />
            <span className="mny-tx-id">
              <span className="mny-tx-title">
                <span className="mny-tx-text">{run.title}</span>
                {unreviewed && (
                  <span className="tx-unreviewed-dot" title="بررسی‌نشده">
                    <span className="sr-only">بررسی‌نشده</span>
                  </span>
                )}
              </span>
              <span className="mny-tx-meta">
                <span className="mny-tx-kind">{faCount(run.rows.length)} قسط</span>
                {seqs.length > 1 && (
                  <span>
                    {faCount(seqs[0])} تا {faCount(seqs[seqs.length - 1])}
                  </span>
                )}
              </span>
            </span>
            {first.from && <span className="mny-tx-flow">{moneyFlowLabel(first.from, first.to)}</span>}
            <span className="mny-tx-amount num money-nowrap" dir="rtl" data-sign={first.sign}>
              {total}
            </span>
            <span className="mny-run-chev" aria-hidden="true">
              <Icon name="chevronDown" size={15} />
            </span>
          </button>
        </div>
        {open && <ul className="mny-run-rows">{run.rows.map(renderRow)}</ul>}
      </li>
    );
  };

  return (
    <div className="transactions-content space-y-3">
      <section className="mny-tx-toolbar" aria-label="جستجو و بررسی تراکنش‌ها">
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
            groups: accountGroups.map((g) => ({ label: g.label, options: g.options.map((a) => ({ value: a.id, label: plainAccountName(a.name) })) })),
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
          ...(tags.length > 0 || filters.tag
            ? [
                {
                  key: "tag",
                  label: "برچسب",
                  value: filters.tag,
                  placeholder: "همه برچسب‌ها",
                  options: (tags.some((t) => t.tag === filters.tag) || !filters.tag ? tags : [{ tag: filters.tag, entries: 0 }, ...tags]).map((t) => ({
                    value: t.tag,
                    label: `#${t.tag}`,
                  })),
                  maxWidthClass: "max-w-[160px]",
                  onChange: (v: string) => apply({ tag: v }),
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
        {/* One row of quick filters; it scrolls sideways on a phone instead of
            wrapping into a second line. */}
        <div className="tx-type-strip mny-chips" aria-label="فیلتر سریع نوع تراکنش">
          {[{ key: "", label: "همه" }, { key: "expense", label: "هزینه" }, { key: "income", label: "درآمد" }, { key: "debt_repayment", label: "پرداخت بدهی" }, { key: "fx", label: "تبدیل ارز" }].map((type) => (
            <button key={type.key} type="button" data-type={type.key} aria-pressed={filters.type === type.key} onClick={() => apply({ type: type.key })}>
              {type.label}
            </button>
          ))}
          <button
            type="button"
            data-type="review"
            aria-pressed={filters.review === "unreviewed"}
            onClick={() => apply({ review: filters.review === "unreviewed" ? "" : "unreviewed" })}
          >
            بررسی‌نشده <span className="num mny-chip-count">{faCount(unreviewedCount)}</span>
          </button>
        </div>
        <p className="mny-tx-count">{faCount(rows.length)} مورد در فهرست فعلی</p>
      </section>

      {tagSummary && tagSummary.entries > 0 && (
        <section className="card space-y-2 p-4" aria-label={`جمع برچسب #${tagSummary.tag}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-[length:var(--fs-sm)] font-bold">
              <span className="tag-chip">#{tagSummary.tag}</span>
            </h2>
            <span className="muted num text-[length:var(--fs-xs)]">
              {faCount(tagSummary.entries)} تراکنش
              {tagSummary.firstDate && tagSummary.lastDate
                ? ` · ${formatJalaliIso(tagSummary.firstDate)}${tagSummary.lastDate !== tagSummary.firstDate ? ` تا ${formatJalaliIso(tagSummary.lastDate)}` : ""}`
                : ""}
            </span>
          </div>
          <dl className="tx-detail-grid">
            <div>
              <dt>کل هزینه</dt>
              <dd className="num" dir="rtl">
                {tagSummary.expenseEntries > 0 ? formatMoney(D(tagSummary.expenseToman).toFixed(0), "IRT") : "—"}
              </dd>
            </div>
            <div>
              <dt>معادل دلاری هزینه</dt>
              <dd className="num" dir="rtl">
                {tagSummary.expenseEntries > 0 ? formatMoney(tagSummary.expenseUsd) : "—"}
              </dd>
            </div>
            {tagSummary.incomeEntries > 0 && (
              <div>
                <dt>کل درآمد</dt>
                <dd className="num" dir="rtl">
                  {formatMoney(D(tagSummary.incomeToman).toFixed(0), "IRT")}
                </dd>
              </div>
            )}
          </dl>
          <p className="muted text-[length:var(--fs-xs)] leading-5">
            جمع کل دوره است و به بازه‌ی فهرست بستگی ندارد. تومان با نرخ روز ثبت هر تراکنش است، نه نرخ امروز.
            {tagSummary.expenseEntriesWithSnap < tagSummary.expenseEntries
              ? ` برای ${faCount(tagSummary.expenseEntries - tagSummary.expenseEntriesWithSnap)} هزینه مبلغ تومانی ثبت نشده و در جمع تومانی نیامده است.`
              : ""}
          </p>
        </section>
      )}

      {tagMsg && (
        <p className="text-[length:var(--fs-xs)]" role="status">
          {tagMsg}
        </p>
      )}

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
          {truncated && <p className="tx-toolbar" style={{ color: "var(--warning)" }}>فقط موارد اخیر نمایش داده شده — بازه را کوتاه‌تر کنید</p>}
          <div className="card tx-list">
            {groups.map((g) => (
              <section key={g.key} aria-label={g.label ?? undefined}>
                {g.label && <h3 className="tx-day">{g.label}</h3>}
                <ul>{foldRuns(g.key, g.rows).map((item) => (item.kind === "row" ? renderRow(item.row) : renderRun(item)))}</ul>
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
          {bulkTag !== null ? (
            <form
              className="flex flex-1 items-center gap-1.5"
              onSubmit={(ev) => {
                ev.preventDefault();
                saveBulkTag(bulkTag);
              }}
            >
              <input
                className="field !min-h-9 flex-1 !py-1 text-[length:var(--fs-xs)]"
                value={bulkTag}
                onChange={(ev) => setBulkTag(ev.target.value)}
                placeholder="#سفر"
                aria-label={`برچسب برای ${faCount(selectedRows.length)} تراکنش`}
                list="tx-tag-options"
                autoFocus
              />
              <datalist id="tx-tag-options">
                {tagNames.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
              <button type="submit" disabled={pending || !bulkTag.trim()} className="btn btn-primary !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]">
                افزودن
              </button>
              <button type="button" className="icon-btn !min-h-9 !min-w-9" onClick={() => setBulkTag(null)} aria-label="انصراف از برچسب">
                <Icon name="x" size={15} />
              </button>
            </form>
          ) : (
          <>
          <span className="mny-bulk-summary">
            <b>{faCount(selectedRows.length)} مورد انتخاب شده</b>
            {selectedNet && !selectedNet.isZero() && (
              <span className="num money-nowrap" dir="rtl" data-sign={selectedNet.isNegative() ? -1 : 1}>
                {formatMoneyWithSign(selectedNet.isNegative() ? "−" : "+", selectedNet.abs().toFixed(0), "IRT")}
              </span>
            )}
          </span>
          <div className="flex items-center gap-1.5">
            <button type="button" className="btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]" onClick={() => { setTagMsg(null); setBulkTag(""); }}>
              #
              برچسب
            </button>
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
          </>
          )}
        </div>
      )}
    </div>
  );
}
