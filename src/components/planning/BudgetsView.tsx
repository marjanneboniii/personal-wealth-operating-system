"use client";

/**
 * بودجه‌ها — the board. Two kinds of budget, drawn differently:
 *
 *   رویدادها و پروژه‌ها   a tag budget (عقد، عروسی، تعویض ماشین…) as a coloured
 *                         card: ring, countdown and its lines (ریز اقلام)
 *   بودجه‌های ماهانه      a ceiling on one expense category, as a compact row
 *
 * PRESENTATION ONLY — every figure comes from `listBudgets`; the writes go
 * through the budget actions.
 */
import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  addBudgetItemAction,
  deleteBudgetAction,
  deleteBudgetItemAction,
  updateBudgetItemAction,
  type ActionResult,
} from "@/app/actions";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { budgetTemplate } from "@/features/planning/budgetTemplates";
import type { listBudgets } from "@/features/planning/service";
import { faCount, formatJalaliIso, formatMoney } from "@/lib/format";

type Budget = Awaited<ReturnType<typeof listBudgets>>[number];
type Line = Budget["items"][number];

const DAY = 86_400_000;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
const toman = (v: string | number) => formatMoney(String(v), "IRT");
const pct = (n: number) => `${Math.round(n).toLocaleString("fa-IR")}٪`;

function statusOf(usage: number, over: boolean) {
  if (over || usage >= 100) return { color: "var(--negative)", label: "خارج از سقف", tone: "neg" as const };
  if (usage >= 80) return { color: "var(--warning)", label: "نزدیک به سقف", tone: "warn" as const };
  return { color: "var(--positive)", label: "در چارچوب", tone: "pos" as const };
}

/** A progress ring; the figure sits in the middle. */
function Ring({ value, color, size = 76, stroke = 8, children }: { value: number; color: string; size?: number; stroke?: number; children?: React.ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <span className="bgt-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--bgt-track)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${(v / 100) * c} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="bgt-ring-label">{children}</span>
    </span>
  );
}

function Countdown({ start, end, today }: { start: string; end: string; today: string }) {
  if (today > end) return <span className="bgt-pill">پایان یافته</span>;
  if (today < start) return <span className="bgt-pill">{faCount(daysBetween(today, start))} روز تا شروع</span>;
  const left = daysBetween(today, end);
  return <span className="bgt-pill">{left === 0 ? "امروز" : `${faCount(left)} روز مانده`}</span>;
}

/* ───────────── line editor (add / edit / delete) ───────────── */

type Editing = { budget: Budget; line: Line | null } | null;

function LineSheet({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const router = useRouter();
  const [title, setTitle] = useState(editing?.line?.title ?? "");
  const [amount, setAmount] = useState(editing?.line && editing.line.amountToman !== "0" ? editing.line.amountToman : "");
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!editing) return null;
  const { budget, line } = editing;

  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) {
        onClose();
        router.refresh();
      }
    });

  return (
    <Sheet open onClose={onClose} title={line ? `ویرایش «${line.title}»` : `قلم تازه — ${budget.name}`}>
      <div className="space-y-4 p-4">
        <label className="block">
          <span className="label">عنوان قلم</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={60} placeholder="مثلاً حلقه" />
        </label>
        <label className="block">
          <span className="label">سقف این قلم</span>
          <AmountInput value={amount} onValueChange={setAmount} className="field num" unit="toman" placeholder="اختیاری" aria-label="سقف این قلم" />
        </label>
        {line && (
          <p className="muted text-[length:var(--fs-xs)] leading-5">
            برچسب این قلم <b>#{line.tag}</b> است و با تغییر عنوان عوض نمی‌شود.
          </p>
        )}
        {result && !result.ok && <p className="neg text-[length:var(--fs-xs)]">{result.message}</p>}
        <div className="flex gap-2">
          {line && (
            <button type="button" className="btn btn-ghost" style={{ color: "var(--negative)" }} disabled={pending} onClick={() => run(() => deleteBudgetItemAction(line.id))}>
              <Icon name="trash" size={15} />
              حذف
            </button>
          )}
          <button
            type="button"
            className="btn btn-primary flex-1 disabled:opacity-40"
            disabled={pending || !title.trim()}
            onClick={() =>
              run(() =>
                line
                  ? updateBudgetItemAction(line.id, { title, amountToman: amount || "0" })
                  : addBudgetItemAction(budget.id, { title, amountToman: amount || "0" }),
              )
            }
          >
            {pending ? "در حال ثبت…" : line ? "ذخیره" : "افزودن قلم"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

function DeleteSheet({ budget, onClose }: { budget: Budget | null; onClose: () => void }) {
  const router = useRouter();
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();
  if (!budget) return null;
  return (
    <Sheet open onClose={onClose} title="حذف بودجه">
      <div className="space-y-4 p-4">
        <p className="text-[length:var(--fs-sm)] leading-6">
          بودجه «{budget.name}» {budget.items.length ? `و ${faCount(budget.items.length)} قلم آن ` : ""}حذف شود؟ هزینه‌های ثبت‌شده و برچسب‌هایشان دست‌نخورده می‌مانند.
        </p>
        {result && !result.ok && <p className="neg text-[length:var(--fs-xs)]">{result.message}</p>}
        <div className="flex gap-2">
          <button type="button" className="btn btn-ghost flex-1" onClick={onClose}>
            انصراف
          </button>
          <button
            type="button"
            className="btn btn-primary flex-1"
            style={{ background: "var(--negative)", borderColor: "var(--negative)" }}
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await deleteBudgetAction(budget.id);
                setResult(res);
                if (res.ok) {
                  onClose();
                  router.refresh();
                }
              })
            }
          >
            {pending ? "در حال حذف…" : "حذف بودجه"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ───────────── cards ───────────── */

/**
 * «ثبت هزینه» for a budget or one of its lines: tag and title filled in, and
 * the amount still left under the ceiling as a starting point. The user types
 * what was actually paid when it differs (a car change planned at 300M that
 * cost 400M); the card then shows the gap.
 */
const expenseHref = (tag: string, title: string, capToman: string, spentToman: string) => {
  const left = Number(capToman) - Number(spentToman);
  const params: Record<string, string> = { type: "expense", tags: tag, title };
  if (Number(capToman) > 0 && left > 0) params.irtAmount = String(Math.round(left));
  return `/new?${new URLSearchParams(params).toString()}`;
};

function ProjectCard({ b, today, onEdit, onDelete }: { b: Budget; today: string; onEdit: (e: Editing) => void; onDelete: (b: Budget) => void }) {
  const t = budgetTemplate(b.template) ?? budgetTemplate("custom")!;
  const status = statusOf(b.usage, b.over);
  const planned = b.items.reduce((s, i) => s + Number(i.amountToman), 0);
  const unplanned = Number(b.amountToman) - planned;
  const left = Number(b.remainingToman);

  return (
    <article className="bgt-project" style={{ "--tone": t.tone } as CSSProperties}>
      <header className="bgt-project-head">
        <span className="bgt-project-icon" aria-hidden="true">
          <Icon name={t.icon} size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="bgt-project-name">{b.name}</h3>
          <div className="bgt-project-meta">
            <Link href={`/transactions?${new URLSearchParams({ tag: b.tag!, range: "all" }).toString()}`} className="bgt-tag">
              #{b.tag}
            </Link>
            <Countdown start={b.periodStart} end={b.periodEnd} today={today} />
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label={`حذف بودجه ${b.name}`} onClick={() => onDelete(b)}>
          <Icon name="trash" size={15} />
        </button>
      </header>

      <div className="bgt-project-body">
        <Ring value={b.usage} color={status.color === "var(--positive)" ? t.tone : status.color}>
          <b className="num">{pct(b.usage)}</b>
          <small>مصرف</small>
        </Ring>
        <dl className="bgt-figures">
          <div>
            <dt>خرج شده</dt>
            <dd className="num" dir="rtl">{toman(b.spentToman)}</dd>
          </div>
          <div>
            <dt>سقف</dt>
            <dd className="num" dir="rtl">{toman(b.amountToman)}</dd>
          </div>
          <div>
            <dt>{left < 0 ? "بیش از سقف" : "مانده"}</dt>
            <dd className="num" dir="rtl" style={{ color: left < 0 ? "var(--negative)" : "var(--positive)" }}>
              {toman(Math.abs(left))}
            </dd>
          </div>
        </dl>
      </div>

      {b.items.length > 0 && (
        <ul className="bgt-lines">
          {b.items.map((i) => {
            const s = statusOf(i.usage, i.over);
            const capped = i.amountToman !== "0";
            return (
              <li key={i.id} className="bgt-line">
                <button type="button" className="bgt-line-main" onClick={() => onEdit({ budget: b, line: i })} aria-label={`ویرایش ${i.title}`}>
                  <span className="bgt-line-top">
                    <span className="bgt-line-title">{i.title}</span>
                    <span className="num bgt-line-amount" dir="rtl">
                      {toman(i.spentToman)}
                      {capped && <span className="muted"> از {toman(i.amountToman)}</span>}
                    </span>
                  </span>
                  {capped && i.over && (
                    <span className="bgt-line-over num" dir="rtl">
                      {toman(Number(i.spentToman) - Number(i.amountToman))} بیشتر از برآورد
                    </span>
                  )}
                  <span className="bgt-bar" aria-hidden="true">
                    <i style={{ width: `${capped ? Math.min(100, i.usage) : Number(i.spentToman) > 0 ? 100 : 0}%`, background: capped && s.tone !== "pos" ? s.color : "var(--tone)" }} />
                  </span>
                </button>
                <Link href={expenseHref(i.tag, i.title, i.amountToman, i.spentToman)} className="bgt-line-add" aria-label={`ثبت هزینه برای ${i.title}`}>
                  <Icon name="plus" size={14} strokeWidth={2.4} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {b.items.length > 0 && unplanned !== 0 && (
        <p className="bgt-unplanned">
          {unplanned > 0 ? `${toman(unplanned)} برای اقلام پیش‌بینی‌نشده` : `مجموع اقلام ${toman(-unplanned)} بیشتر از سقف کل است`}
        </p>
      )}

      <footer className="bgt-project-foot">
        <button type="button" className="bgt-foot-btn" onClick={() => onEdit({ budget: b, line: null })}>
          <Icon name="plus" size={14} strokeWidth={2.2} />
          {b.items.length ? "قلم تازه" : "افزودن ریز اقلام"}
        </button>
        <Link href={expenseHref(b.tag!, b.name, b.amountToman, b.spentToman)} className="bgt-foot-btn bgt-foot-primary">
          <Icon name="receipt" size={14} />
          ثبت هزینه
        </Link>
      </footer>
    </article>
  );
}

function CategoryRow({ b, onDelete }: { b: Budget; onDelete: (b: Budget) => void }) {
  const status = statusOf(b.usage, b.over);
  const left = Number(b.remainingToman);
  return (
    <li className="bgt-cat" style={{ "--tone": status.color } as CSSProperties}>
      <Ring value={b.usage} color={status.color} size={52} stroke={6}>
        <b className="num bgt-ring-small">{pct(b.usage)}</b>
      </Ring>
      <div className="min-w-0 flex-1">
        <div className="bgt-cat-top">
          <b className="truncate">{b.name}</b>
          {status.tone !== "pos" && <span className={`badge ${status.tone === "neg" ? "badge-neg" : "badge-warn"}`}>{status.label}</span>}
        </div>
        <div className="num bgt-cat-amount" dir="rtl">
          {toman(b.spentToman)} <span className="muted">از {toman(b.amountToman)}</span>
        </div>
        <div className="bgt-cat-foot">
          <span className="num">
            {formatJalaliIso(b.periodStart)} ← {formatJalaliIso(b.periodEnd)}
          </span>
          <span className="num" dir="rtl" style={{ color: left < 0 ? "var(--negative)" : "var(--positive)" }}>
            {left < 0 ? `${toman(-left)} بیشتر از سقف` : `${toman(left)} مانده`}
          </span>
        </div>
      </div>
      <button type="button" className="icon-btn" aria-label={`حذف بودجه ${b.name}`} onClick={() => onDelete(b)}>
        <Icon name="trash" size={15} />
      </button>
    </li>
  );
}

/* ───────────── board ───────────── */

export default function BudgetsView({ budgets, today }: { budgets: Budget[]; today: string }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Budget | null>(null);
  const projects = budgets.filter((b) => b.tag);
  const categories = budgets.filter((b) => !b.tag);

  const limit = budgets.reduce((s, b) => s + Number(b.amountToman), 0);
  const spent = budgets.reduce((s, b) => s + Number(b.spentToman), 0);
  const usage = limit > 0 ? (spent / limit) * 100 : 0;
  const overCount = budgets.filter((b) => b.over).length;
  const status = statusOf(usage, spent > limit);

  return (
    <>
      <section className="bgt-hero">
        <Ring value={usage} color="var(--bgt-hero-accent)" size={96} stroke={10}>
          <b className="num">{pct(usage)}</b>
          <small>مصرف کل</small>
        </Ring>
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <p className="bgt-hero-label">خرج شده از مجموع سقف‌ها</p>
            <p className="num bgt-hero-figure" dir="rtl">
              {toman(spent)} <span>از {toman(limit)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <span className="bgt-hero-chip">{faCount(budgets.length)} بودجه فعال</span>
            {projects.length > 0 && <span className="bgt-hero-chip">{faCount(projects.length)} رویداد و پروژه</span>}
            <span className="bgt-hero-chip" data-tone={overCount ? "neg" : status.tone}>
              {overCount ? `${faCount(overCount)} خارج از سقف` : "همه در چارچوب"}
            </span>
          </div>
        </div>
      </section>

      {projects.length > 0 && (
        <section className="space-y-3">
          <h2 className="bgt-section-title">
            <Icon name="sparkle" size={15} />
            رویدادها و پروژه‌ها
          </h2>
          <div className="bgt-project-grid">
            {projects.map((b) => (
              <ProjectCard key={b.id} b={b} today={today} onEdit={setEditing} onDelete={setDeleting} />
            ))}
          </div>
        </section>
      )}

      {categories.length > 0 && (
        <section className="space-y-3">
          <h2 className="bgt-section-title">
            <Icon name="budgets" size={15} />
            بودجه‌های ماهانه
          </h2>
          <ul className="card bgt-cat-list">
            {categories.map((b) => (
              <CategoryRow key={b.id} b={b} onDelete={setDeleting} />
            ))}
          </ul>
        </section>
      )}

      {editing && <LineSheet key={`${editing.budget.id}-${editing.line?.id ?? "new"}`} editing={editing} onClose={() => setEditing(null)} />}
      {deleting && <DeleteSheet budget={deleting} onClose={() => setDeleting(null)} />}
    </>
  );
}
