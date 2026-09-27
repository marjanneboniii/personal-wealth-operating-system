"use client";

/**
 * سوابق گذشته — the timeline of money movements from before the user's first
 * recorded transaction.
 *
 * Read like a story, newest first: the «شروع ثبت‌ها» line on top, then each
 * Jalali year and month with its records on a coloured rail. The colour IS
 * the kind (expense rose, income green, transfer cyan…), so a year scans at a
 * glance; a tap opens the details and the edit / delete actions.
 *
 * Web: a sticky side panel (summary, kinds, add) beside the timeline.
 * PWA / phone: a compact summary, a swipeable kind strip, and a floating add
 * button above the bottom bar.
 *
 * PRESENTATION ONLY for money: nothing here is valued, converted or summed
 * across units. Toman totals are Toman records only.
 */
import { useActionState, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { deleteHistoryRecordAction, saveHistoryRecordAction } from "@/app/actions/history";
import type { ActionResult } from "@/app/actions";
import type { HistoryKind, HistoryRow, HistorySummary, HistoryUnit } from "@/features/history/service";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon, { type IconName } from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { JALALI_MONTHS, faCount, formatJalaliIso, formatNumber, formatQty, toFaDigits, toJalali } from "@/lib/format";

const KIND_META: Record<HistoryKind, { label: string; icon: IconName; sign: -1 | 0 | 1; hint: string }> = {
  expense: { label: "هزینه", icon: "arrow-down", sign: -1, hint: "خرید روزمره، اجاره، قبض" },
  income: { label: "درآمد", icon: "arrow-up", sign: 1, hint: "حقوق، پاداش، سود" },
  transfer: { label: "انتقال", icon: "swap", sign: 0, hint: "جابه‌جایی بین حساب‌های خودم" },
  buy: { label: "خرید دارایی", icon: "bag", sign: -1, hint: "طلا، ارز، سهام، ملک، خودرو" },
  sell: { label: "فروش دارایی", icon: "coins", sign: 1, hint: "فروش طلا، ارز، سهام…" },
  borrow: { label: "وام و قرض", icon: "card", sign: 1, hint: "وام گرفتم یا قرض کردم" },
  repay: { label: "بازپرداخت", icon: "receipt", sign: -1, hint: "قسط یا تسویه بدهی" },
  other: { label: "سایر", icon: "note", sign: 0, hint: "هر رویداد مالی دیگر" },
};
const KINDS = Object.keys(KIND_META) as HistoryKind[];

const UNIT_LABEL: Record<HistoryUnit, string> = {
  IRT: "تومان",
  USD: "دلار",
  USDT: "تتر",
  EUR: "یورو",
  GOLD: "گرم طلا",
  COIN: "سکه",
};
const UNITS = Object.keys(UNIT_LABEL) as HistoryUnit[];

function amountText(amount: string, unit: HistoryUnit) {
  const n = unit === "IRT" ? formatNumber(amount, { decimals: 0 }) : formatQty(amount, 3);
  return `${n} ${UNIT_LABEL[unit]}`;
}

/** Compact Toman for the summary tiles: ۱٫۲ میلیارد / ۳۴۰ میلیون. */
function compactToman(v: string) {
  const n = Number(v);
  if (n >= 1e9) return `${toFaDigits((n / 1e9).toFixed(n >= 1e10 ? 0 : 1)).replace(".", "٫")} میلیارد`;
  if (n >= 1e6) return `${toFaDigits((n / 1e6).toFixed(n >= 1e7 ? 0 : 1)).replace(".", "٫")} میلیون`;
  return formatNumber(v, { decimals: 0 });
}

const jYear = (iso: string) => toJalali(iso).y;
const jMonthName = (iso: string) => JALALI_MONTHS[toJalali(iso).m - 1];
const jMonth = (iso: string) => `${jMonthName(iso)} ${toFaDigits(String(jYear(iso)))}`;
const jDay = (iso: string) => toFaDigits(String(toJalali(iso).d));

type Draft = {
  id: string;
  kind: HistoryKind;
  title: string;
  amount: string;
  unit: HistoryUnit;
  occurredOn: string;
  counterparty: string;
  accountLabel: string;
  note: string;
};

function blank(date: string, keep?: Partial<Draft>): Draft {
  return {
    id: "",
    kind: keep?.kind ?? "expense",
    title: "",
    amount: "",
    unit: keep?.unit ?? "IRT",
    occurredOn: keep?.occurredOn ?? date,
    counterparty: "",
    accountLabel: keep?.accountLabel ?? "",
    note: "",
  };
}

export default function HistoryView({
  rows,
  summary,
  start,
  defaultDate,
  latestAllowed,
}: {
  rows: HistoryRow[];
  summary: HistorySummary;
  /** The date of the user's first recorded transaction — the timeline's top line. */
  start: string | null;
  /** Where a new record's date starts: the day before `latestAllowed`. */
  defaultDate: string;
  /** The first date NOT allowed here — the first transaction or today, whichever is earlier. */
  latestAllowed: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<HistoryKind | "">("");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => blank(defaultDate));
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(saveHistoryRecordAction, null);
  const [deleting, startDelete] = useTransition();
  const [flash, setFlash] = useState<ActionResult | null>(null);

  // A saved NEW record clears the sheet for the next one (the past is usually
  // entered in a run); the kind, unit, date and account stay. An edit closes.
  const [handled, setHandled] = useState(state);
  if (state !== handled) {
    setHandled(state);
    if (state?.ok) {
      if (draft.id) setOpen(false);
      setDraft((d) => blank(defaultDate, d));
      setFlash(state);
      router.refresh();
    }
  }

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const openNew = () => {
    setDraft((d) => blank(defaultDate, d.id ? undefined : d));
    setHandled(state);
    setOpen(true);
  };
  const openEdit = (r: HistoryRow) => {
    setDraft({
      id: r.id,
      kind: r.kind,
      title: r.title,
      amount: r.amount,
      unit: r.unit,
      occurredOn: r.occurredOn,
      counterparty: r.counterparty ?? "",
      accountLabel: r.accountLabel ?? "",
      note: r.note ?? "",
    });
    setHandled(state);
    setOpen(true);
  };
  const remove = (r: HistoryRow) => {
    if (!window.confirm(`«${r.title}» از سوابق حذف شود؟`)) return;
    startDelete(async () => {
      const res = await deleteHistoryRecordAction(r.id);
      setFlash(res);
      if (res.ok) router.refresh();
    });
  };

  const counts = useMemo(() => {
    const c = new Map<HistoryKind, number>();
    for (const r of rows) c.set(r.kind, (c.get(r.kind) ?? 0) + 1);
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (!filter || r.kind === filter) &&
        (!needle || [r.title, r.counterparty, r.accountLabel, r.note].some((t) => (t ?? "").toLowerCase().includes(needle))),
    );
  }, [rows, filter, q]);

  // Newest first: year → month → records.
  const years = useMemo(() => {
    const out: { year: number; months: { key: string; name: string; items: HistoryRow[] }[] }[] = [];
    for (const r of shown) {
      const y = jYear(r.occurredOn);
      const key = jMonth(r.occurredOn);
      let yr = out[out.length - 1];
      if (!yr || yr.year !== y) out.push((yr = { year: y, months: [] }));
      const m = yr.months[yr.months.length - 1];
      if (m && m.key === key) m.items.push(r);
      else yr.months.push({ key, name: jMonthName(r.occurredOn), items: [r] });
    }
    return out;
  }, [shown]);

  const mix = KINDS.filter((k) => counts.get(k)).map((k) => ({ k, n: counts.get(k)! }));
  const tooLate = !!draft.occurredOn && draft.occurredOn >= latestAllowed;
  const ready = draft.title.trim().length > 0 && Number(draft.amount) > 0 && !!draft.occurredOn && !tooLate;

  const filterButtons = (
    <>
      <button type="button" className="hist-filter" data-on={!filter || undefined} aria-pressed={!filter} onClick={() => setFilter("")}>
        <span className="hist-filter-label">همه</span>
        <span className="num">{faCount(rows.length)}</span>
      </button>
      {KINDS.filter((k) => counts.get(k)).map((k) => (
        <button
          key={k}
          type="button"
          className="hist-filter"
          data-kind={k}
          data-on={filter === k || undefined}
          aria-pressed={filter === k}
          onClick={() => setFilter(filter === k ? "" : k)}
        >
          <span className="hist-filter-dot" aria-hidden="true" />
          <span className="hist-filter-label">{KIND_META[k].label}</span>
          <span className="num">{faCount(counts.get(k)!)}</span>
        </button>
      ))}
    </>
  );

  const renderItem = (r: HistoryRow, monthName: string) => {
    const meta = KIND_META[r.kind];
    return (
      <li key={r.id} className="hist-item" data-kind={r.kind}>
        <details className="hist-row">
          <summary className="hist-line">
            <span className="hist-date" aria-hidden="true">
              <span className="hist-date-day num">{jDay(r.occurredOn)}</span>
              <span className="hist-date-mon">{monthName}</span>
            </span>
            <span className="hist-disc" aria-hidden="true">
              <Icon name={meta.icon} size={15} />
            </span>
            <span className="hist-main">
              <span className="hist-title">{r.title}</span>
              <span className="hist-meta">
                <span className="hist-chip">{meta.label}</span>
                {r.counterparty || r.accountLabel ? (
                  <span className="hist-meta-text">{[r.counterparty, r.accountLabel].filter(Boolean).join(" · ")}</span>
                ) : null}
              </span>
            </span>
            <span className="hist-amount num money-nowrap" data-sign={meta.sign} dir="rtl">
              {meta.sign > 0 ? "+" : meta.sign < 0 ? "−" : ""}
              {amountText(r.amount, r.unit)}
            </span>
          </summary>
          <div className="hist-more">
            <dl className="hist-facts">
              <div>
                <dt>تاریخ</dt>
                <dd className="num">{formatJalaliIso(r.occurredOn)}</dd>
              </div>
              <div>
                <dt>نوع</dt>
                <dd>{meta.label}</dd>
              </div>
              {r.counterparty && (
                <div>
                  <dt>طرف حساب</dt>
                  <dd>{r.counterparty}</dd>
                </div>
              )}
              {r.accountLabel && (
                <div>
                  <dt>حساب</dt>
                  <dd>{r.accountLabel}</dd>
                </div>
              )}
              {r.note && (
                <div className="hist-note">
                  <dt>یادداشت</dt>
                  <dd>{r.note}</dd>
                </div>
              )}
            </dl>
            <div className="hist-actions">
              <span className="hist-ledger-free">
                <Icon name="eye" size={13} />
                فقط برای یادآوری — روی موجودی اثری ندارد
              </span>
              <span className="flex gap-2">
                <button type="button" className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]" onClick={() => openEdit(r)}>
                  ویرایش
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                  style={{ color: "var(--negative)" }}
                  disabled={deleting}
                  onClick={() => remove(r)}
                >
                  حذف
                </button>
              </span>
            </div>
          </div>
        </details>
      </li>
    );
  };

  return (
    <div className="hist-layout">
      {/* ── Side panel (web) / top summary (PWA) ─────────────────────── */}
      <aside className="hist-aside">
        <section className="hist-hero">
          <div className="hist-hero-head">
            <span className="hist-hero-icon" aria-hidden="true">
              <Icon name="clock" size={18} />
            </span>
            <div className="min-w-0">
              <h2 className="hist-hero-title">سوابق گذشته</h2>
              <p className="hist-hero-sub">تراکنش‌های مهم گذشته، فقط برای یادآوری — بدون اثر روی موجودی، دارایی، بدهی و گزارش‌ها.</p>
            </div>
          </div>
          {summary.count > 0 && (
            <>
              <dl className="hist-stats">
                <div>
                  <dt>سابقه</dt>
                  <dd className="num">{faCount(summary.count)}</dd>
                </div>
                <div data-sign="1">
                  <dt>ورودی</dt>
                  <dd className="num" title={`${formatNumber(summary.inToman, { decimals: 0 })} تومان`}>
                    {compactToman(summary.inToman)}
                  </dd>
                </div>
                <div data-sign="-1">
                  <dt>خروجی</dt>
                  <dd className="num" title={`${formatNumber(summary.outToman, { decimals: 0 })} تومان`}>
                    {compactToman(summary.outToman)}
                  </dd>
                </div>
              </dl>
              <div className="hist-mix" role="img" aria-label="ترکیب سوابق بر اساس نوع">
                {mix.map(({ k, n }) => (
                  <span key={k} data-kind={k} style={{ flexGrow: n }} title={`${KIND_META[k].label}: ${faCount(n)}`} />
                ))}
              </div>
              {summary.first && summary.last && (
                <p className="hist-span">
                  <Icon name="calendar" size={13} />
                  از <span className="num">{jMonth(summary.first)}</span> تا <span className="num">{jMonth(summary.last)}</span>
                  <span className="muted"> · مبالغ به تومان</span>
                </p>
              )}
            </>
          )}
          <button type="button" className="btn btn-primary hist-add-wide" onClick={openNew}>
            <Icon name="plus" size={16} />
            افزودن سابقه
          </button>
        </section>

        {rows.length > 0 && (
          <div className="hist-filters" role="group" aria-label="نوع سابقه">
            {filterButtons}
          </div>
        )}
      </aside>

      {/* ── Timeline ─────────────────────────────────────────────────── */}
      <div className="hist-body">
        {flash && (
          <p
            className="badge"
            role="status"
            style={
              flash.ok
                ? { background: "var(--positive-soft)", color: "var(--positive)" }
                : { background: "var(--negative-soft)", color: "var(--negative)" }
            }
          >
            {flash.message}
          </p>
        )}

        {rows.length > 0 && (
          <label className="hist-search">
            <Icon name="search" size={15} />
            <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در عنوان، طرف حساب یا یادداشت" aria-label="جستجو در سوابق" />
          </label>
        )}

        {rows.length === 0 ? (
          <div className="hist-empty">
            <div className="hist-empty-art" aria-hidden="true">
              {(["income", "expense", "buy", "borrow", "transfer"] as HistoryKind[]).map((k) => (
                <span key={k} className="hist-disc" data-kind={k}>
                  <Icon name={KIND_META[k].icon} size={15} />
                </span>
              ))}
            </div>
            <h3>داستان مالی‌تان را کامل کنید</h3>
            <p>خرید خانه، وامی که گرفتید، طلایی که فروختید یا هر تراکنش مهمی که قبل از اولین ثبت‌تان انجام شده را اینجا نگه دارید. موجودی حساب‌ها تغییری نمی‌کند.</p>
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={16} />
              ثبت اولین سابقه
            </button>
          </div>
        ) : (
          <div className="hist-timeline">
            {start && (
              <div className="hist-boundary">
                <span className="hist-boundary-pill">
                  <Icon name="sparkle" size={14} />
                  شروع ثبت‌ها · <span className="num">{formatJalaliIso(start)}</span>
                </span>
                <Link href="/transactions" className="hist-boundary-link">
                  تراکنش‌ها
                  <Icon name="chevronLeft" size={14} />
                </Link>
              </div>
            )}
            {shown.length === 0 ? (
              <p className="muted py-8 text-center text-[length:var(--fs-sm)]">سابقه‌ای با این فیلتر پیدا نشد.</p>
            ) : (
              years.map((y) => (
                <section key={y.year} className="hist-year" aria-label={`سال ${toFaDigits(String(y.year))}`}>
                  <h3 className="hist-year-title">
                    <span className="num">{toFaDigits(String(y.year))}</span>
                  </h3>
                  {y.months.map((m) => (
                    <div key={m.key} className="hist-month">
                      <h4 className="hist-month-title">
                        {m.name}
                        <span className="num">{faCount(m.items.length)}</span>
                      </h4>
                      <ol className="hist-rail">{m.items.map((r) => renderItem(r, m.name))}</ol>
                    </div>
                  ))}
                </section>
              ))
            )}
          </div>
        )}
      </div>

      {/* PWA / phone: the add action floats above the bottom bar. */}
      <button type="button" className="hist-fab" onClick={openNew} aria-label="افزودن سابقه">
        <Icon name="plus" size={22} />
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={draft.id ? "ویرایش سابقه" : "افزودن سابقه گذشته"}>
        <form action={action} className="space-y-4" dir="rtl">
          <input type="hidden" name="id" value={draft.id} />
          <input type="hidden" name="kind" value={draft.kind} />
          <input type="hidden" name="unit" value={draft.unit} />

          <div className="hist-kinds" role="radiogroup" aria-label="نوع سابقه">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={draft.kind === k}
                className="hist-kind"
                data-kind={k}
                data-on={draft.kind === k || undefined}
                onClick={() => set("kind", k)}
              >
                <span className="hist-disc" aria-hidden="true">
                  <Icon name={KIND_META[k].icon} size={15} />
                </span>
                {KIND_META[k].label}
              </button>
            ))}
          </div>
          <p className="muted -mt-2 text-[length:var(--fs-xs)]">{KIND_META[draft.kind].hint}</p>

          <div>
            <label className="label" htmlFor="hist-title">
              عنوان
            </label>
            <input
              id="hist-title"
              name="title"
              className="field"
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="مثلاً خرید پراید، وام ازدواج، فروش سکه"
              maxLength={120}
              required
            />
          </div>

          <div>
            <label className="label" htmlFor="hist-amount">
              مبلغ
            </label>
            <AmountInput
              id="hist-amount"
              name="amount"
              value={draft.amount}
              onValueChange={(v) => set("amount", v)}
              placeholder="۰"
              className="field num !text-lg !font-bold"
              unit={draft.unit === "IRT" ? "toman" : draft.unit === "USD" ? "usd" : draft.unit === "EUR" ? "eur" : draft.unit === "USDT" ? "usdt" : UNIT_LABEL[draft.unit]}
              maxDecimals={draft.unit === "IRT" ? 0 : 3}
            />
            <div className="hist-units" role="radiogroup" aria-label="واحد مبلغ">
              {UNITS.map((u) => (
                <button key={u} type="button" role="radio" aria-checked={draft.unit === u} data-on={draft.unit === u || undefined} onClick={() => set("unit", u)}>
                  {UNIT_LABEL[u]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <DualDateInput name="occurredOn" value={draft.occurredOn} onChange={(v) => set("occurredOn", v)} label="تاریخ" required showGregorian={false} />
            {tooLate ? (
              <p className="mt-1 text-[length:var(--fs-xs)] leading-5" style={{ color: "var(--warning)" }}>
                این تاریخ جزو دوره‌ی ثبت تراکنش‌هاست. تراکنش‌های فعلی و آینده را از{" "}
                <Link href="/new" className="underline">
                  ثبت تراکنش
                </Link>{" "}
                وارد کنید تا در موجودی حساب‌ها اثر بگذارند.
              </p>
            ) : (
              <p className="muted mt-1 text-[length:var(--fs-xs)]">
                فقط تاریخ‌های قبل از <span className="num">{formatJalaliIso(latestAllowed)}</span>
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="hist-cp">
                طرف حساب <span className="muted">(اختیاری)</span>
              </label>
              <input id="hist-cp" name="counterparty" className="field" value={draft.counterparty} onChange={(e) => set("counterparty", e.target.value)} placeholder="مثلاً فروشنده، بانک، دوست" maxLength={120} />
            </div>
            <div>
              <label className="label" htmlFor="hist-acct">
                از / به حساب <span className="muted">(اختیاری)</span>
              </label>
              <input id="hist-acct" name="accountLabel" className="field" value={draft.accountLabel} onChange={(e) => set("accountLabel", e.target.value)} placeholder="مثلاً بانک ملت، نقد" maxLength={120} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="hist-note">
              یادداشت <span className="muted">(اختیاری)</span>
            </label>
            <textarea id="hist-note" name="note" className="field min-h-[4.5rem]" value={draft.note} onChange={(e) => set("note", e.target.value)} maxLength={500} />
          </div>

          <p className="hist-sheet-note">
            <Icon name="info" size={14} />
            این سابقه فقط برای یادآوری است؛ موجودی حساب‌ها، دارایی، بدهی و گزارش‌ها تغییری نمی‌کنند.
          </p>

          {state && !state.ok && <p className="neg text-[length:var(--fs-xs)]">{state.message}</p>}
          {state?.ok && !draft.id && open && (
            <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--positive)" }}>
              {state.message} مورد بعدی را وارد کنید.
            </p>
          )}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost flex-1">
              بستن
            </button>
            <button type="submit" disabled={pending || !ready} className="btn btn-primary flex-1 disabled:opacity-40">
              {pending ? "در حال ثبت…" : draft.id ? "ذخیره تغییرات" : "ثبت سابقه"}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
