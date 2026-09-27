"use client";

/**
 * سوابق پیش از توازن — the timeline of money movements from before the app.
 *
 * Read like a story, newest first: a boundary marks «آغاز توازن», and below it
 * each Jalali month holds its records on a coloured rail. The colour IS the
 * kind (expense rose, income green, transfer cyan…), so a year scans at a
 * glance; a tap opens the details and the edit / delete actions.
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

export const KIND_META: Record<HistoryKind, { label: string; icon: IconName; sign: -1 | 0 | 1; hint: string }> = {
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

const jMonth = (iso: string) => {
  const j = toJalali(iso);
  return `${JALALI_MONTHS[j.m - 1]} ${toFaDigits(String(j.y))}`;
};
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
  /** The day the user's life in توازن began — the timeline's boundary. */
  start: string | null;
  /** Where a new record's date starts: the day before «آغاز توازن». */
  defaultDate: string;
  /** The first date NOT allowed here — «آغاز توازن» or today, whichever is earlier. */
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
    if (!window.confirm(`«${r.title}» از تاریخچه حذف شود؟`)) return;
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

  // Newest first, grouped by Jalali month, all below the «آغاز توازن» line —
  // the server refuses any record dated on or after it.
  const months = useMemo(() => {
    const out: { key: string; label: string; items: HistoryRow[] }[] = [];
    for (const r of shown) {
      const label = jMonth(r.occurredOn);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(r);
      else out.push({ key: r.occurredOn.slice(0, 7), label, items: [r] });
    }
    return out;
  }, [shown]);

  // The mix bar: one segment per kind, width by count.
  const mix = KINDS.filter((k) => counts.get(k)).map((k) => ({ k, n: counts.get(k)! }));

  // Only the past before توازن: today, the future and anything from the start
  // day on go through «ثبت تراکنش» (the server enforces the same line).
  const tooLate = !!draft.occurredOn && draft.occurredOn >= latestAllowed;
  const ready = draft.title.trim().length > 0 && Number(draft.amount) > 0 && !!draft.occurredOn && !tooLate;

  const renderMonth = (m: (typeof months)[number]) => (
    <section key={m.key} className="hist-month" aria-label={m.label}>
      <h3 className="hist-month-title">
        {m.label}
        <span className="num">{faCount(m.items.length)}</span>
      </h3>
      <ol className="hist-rail">
        {m.items.map((r) => {
          const meta = KIND_META[r.kind];
          return (
            <li key={r.id} className="hist-item" data-kind={r.kind}>
              <details className="hist-row">
                <summary className="hist-line">
                  <span className="hist-disc" aria-hidden="true">
                    <Icon name={meta.icon} size={15} />
                  </span>
                  <span className="hist-main">
                    <span className="hist-title">{r.title}</span>
                    <span className="hist-meta">
                      <span className="num">{jDay(r.occurredOn)}</span> {m.label.split(" ")[0]}
                      {r.counterparty ? ` · ${r.counterparty}` : ""}
                      {r.accountLabel ? ` · ${r.accountLabel}` : ""}
                    </span>
                  </span>
                  <span className="hist-side">
                    <span className="hist-amount num money-nowrap" data-sign={meta.sign} dir="rtl">
                      {meta.sign > 0 ? "+" : meta.sign < 0 ? "−" : ""}
                      {amountText(r.amount, r.unit)}
                    </span>
                    <span className="hist-chip">{meta.label}</span>
                  </span>
                </summary>
                <div className="hist-more">
                  <dl className="hist-facts">
                    <div>
                      <dt>تاریخ</dt>
                      <dd className="num">{formatJalaliIso(r.occurredOn)}</dd>
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
                      فقط در تاریخچه — روی موجودی اثری ندارد
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
        })}
      </ol>
    </section>
  );

  return (
    <div className="space-y-5">
      {/* Hero: what this place is, and the story in three figures. */}
      <section className="hist-hero">
        <div className="hist-hero-head">
          <span className="hist-hero-icon" aria-hidden="true">
            <Icon name="clock" size={18} />
          </span>
          <div className="min-w-0">
            <h2 className="hist-hero-title">داستان مالی شما پیش از توازن</h2>
            <p className="hist-hero-sub">
              تراکنش‌هایی که قبل از آغاز توازن انجام داده‌اید، فقط برای یادآوری. روی موجودی، دارایی، بدهی و گزارش‌ها هیچ اثری ندارند؛
            تراکنش‌های فعلی و آینده از «ثبت تراکنش» وارد می‌شوند.
            </p>
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
                <dt>ورودی (تومان)</dt>
                <dd className="num money-nowrap">{formatNumber(summary.inToman, { decimals: 0 })}</dd>
              </div>
              <div data-sign="-1">
                <dt>خروجی (تومان)</dt>
                <dd className="num money-nowrap">{formatNumber(summary.outToman, { decimals: 0 })}</dd>
              </div>
            </dl>
            {summary.first && summary.last && (
              <p className="hist-span">
                از <span className="num">{jMonth(summary.first)}</span> تا <span className="num">{jMonth(summary.last)}</span>
              </p>
            )}
            <div className="hist-mix" role="img" aria-label="ترکیب سوابق بر اساس نوع">
              {mix.map(({ k, n }) => (
                <span key={k} data-kind={k} style={{ flexGrow: n }} title={`${KIND_META[k].label}: ${faCount(n)}`} />
              ))}
            </div>
          </>
        )}
      </section>

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
        <div className="space-y-3">
          <div className="hist-toolbar">
            <label className="hist-search">
              <Icon name="search" size={15} />
              <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجو در عنوان، طرف حساب یا یادداشت" aria-label="جستجو در سوابق" />
            </label>
            <button type="button" className="btn btn-primary" onClick={openNew}>
              <Icon name="plus" size={16} />
              افزودن سابقه
            </button>
          </div>
          <div className="hist-filters" role="group" aria-label="نوع سابقه">
            <button type="button" className="hist-filter" data-on={!filter || undefined} aria-pressed={!filter} onClick={() => setFilter("")}>
              همه <span className="num">{faCount(rows.length)}</span>
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
                {KIND_META[k].label} <span className="num">{faCount(counts.get(k)!)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="hist-empty">
          <div className="hist-empty-art" aria-hidden="true">
            {(["income", "expense", "buy", "transfer"] as HistoryKind[]).map((k) => (
              <span key={k} className="hist-disc" data-kind={k}>
                <Icon name={KIND_META[k].icon} size={15} />
              </span>
            ))}
          </div>
          <h3>هنوز سابقه‌ای ثبت نکرده‌اید</h3>
          <p>
            خرید خانه، وامی که گرفتید، طلایی که فروختید یا هر تراکنش مهم پیش از توازن را اینجا ثبت کنید تا داستان مالی‌تان کامل
            شود — بدون اینکه موجودی حساب‌ها تغییر کند.
          </p>
          <button type="button" className="btn btn-primary" onClick={openNew}>
            <Icon name="plus" size={16} />
            ثبت اولین سابقه
          </button>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted py-8 text-center text-[length:var(--fs-sm)]">سابقه‌ای با این فیلتر پیدا نشد.</p>
      ) : (
        <div className="hist-timeline">
          {start && (
            <div className="hist-boundary">
              <span className="hist-boundary-pill">
                <Icon name="sparkle" size={14} />
                آغاز توازن · <span className="num">{formatJalaliIso(start)}</span>
              </span>
              <Link href="/transactions" className="hist-boundary-link">
                تراکنش‌های توازن
                <Icon name="chevronLeft" size={14} />
              </Link>
            </div>
          )}
          {months.map(renderMonth)}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={draft.id ? "ویرایش سابقه" : "افزودن سابقه پیش از توازن"}>
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
                این تاریخ از آغاز توازن به بعد است. تراکنش‌های فعلی و آینده را از{" "}
                <Link href="/new" className="underline">
                  ثبت تراکنش
                </Link>{" "}
                وارد کنید تا در موجودی حساب‌ها اثر بگذارند.
              </p>
            ) : (
              <p className="muted mt-1 text-[length:var(--fs-xs)]">
                فقط تاریخ‌های پیش از <span className="num">{formatJalaliIso(latestAllowed)}</span>
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
            این سابقه فقط در تاریخچه دیده می‌شود؛ موجودی حساب‌ها، دارایی، بدهی و گزارش‌ها تغییری نمی‌کنند.
          </p>

          {state && !state.ok && <p className="neg text-[length:var(--fs-xs)]">{state.message}</p>}
          {state?.ok && !draft.id && open && <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--positive)" }}>{state.message} مورد بعدی را وارد کنید.</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost flex-1">
              بستن
            </button>
            <button type="submit" disabled={pending || !ready} className="btn btn-primary flex-1 disabled:opacity-40">
              {pending ? "در حال ثبت…" : draft.id ? "ذخیره تغییرات" : "ثبت در تاریخچه"}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  );
}
