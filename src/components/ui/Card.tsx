import type { ReactNode } from "react";
import Link from "next/link";
import Icon from "@/components/ui/Icon";
import { formatMoney, formatPercent } from "@/lib/format";

/* ───────────────────────────── Card ─────────────────────────────
   Use sparingly: only for a true semantic group or interactive
   boundary. Prefer sections, dividers and typographic hierarchy.
   ─────────────────────────────────────────────────────────────── */
export function Card({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold tracking-tight">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/* ─────────────── Section — the default content unit ─────────────
   A question-driven block: bold title (the QUESTION it answers),
   quiet action link, optional hint. No box — hierarchy by type.
   ─────────────────────────────────────────────────────────────── */
export function Section({
  title,
  hint,
  action,
  children,
  className = "",
  id,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** anchor target, so sidebar sub-items can deep-link to a section */
  id?: string;
}) {
  return (
    <section id={id} className={`scroll-mt-24 ${className}`}>
      {(title || hint || action) && (
        <header className="mb-3 flex items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>}
            {hint && <p className="muted mt-0.5 text-[11.5px]">{hint}</p>}
          </div>
          {action && <div className="shrink-0 pb-0.5">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function SectionLink({ href, label = "مشاهده همه" }: { href: string; label?: string }) {
  return (
    <Link
      href={href}
      aria-label={`مشاهده همه ${label}`}
      className="inline-flex items-center gap-1 text-[12px] font-medium transition-colors"
      style={{ color: "var(--brand)" }}
    >
      {label}
      <Icon name="chevronLeft" size={14} />
    </Link>
  );
}

/* ─────────────────────── Financial numbers ────────────────────── */

export function Money({
  value,
  currency = "USD",
  tone,
  arrow,
  size = "base",
}: {
  value: string | number;
  currency?: string;
  tone?: boolean;
  arrow?: boolean;
  size?: "sm" | "base" | "lg" | "xl";
}) {
  const n = Number(value);
  const color = tone ? (n > 0 ? "var(--positive)" : n < 0 ? "var(--negative)" : "var(--text)") : undefined;
  const cls =
    size === "xl"
      ? "display-num text-3xl sm:text-4xl font-bold"
      : size === "lg"
        ? "num text-xl font-bold"
        : size === "sm"
          ? "num text-[13px]"
          : "num font-semibold";
  return (
    <span className={`inline-flex items-center gap-1 rtl-isolate ${cls}`} dir="rtl" style={color ? { color } : undefined}>
      {arrow && n !== 0 && (
        <Icon name={n > 0 ? "trend-up" : "trend-down"} size={size === "xl" ? 20 : 14} strokeWidth={2.2} />
      )}
      {formatMoney(value, currency)}
    </span>
  );
}

/** Signed delta with arrow + percent — colour is never the only signal. */
export function Delta({
  value,
  pct,
  currency = "USD",
  className = "",
  suffix,
}: {
  value: string | number;
  pct?: string | number | null;
  currency?: string;
  className?: string;
  suffix?: string;
}) {
  const n = Number(value);
  const up = n > 0;
  const zero = n === 0;
  const color = zero ? "var(--text-3)" : up ? "var(--positive)" : "var(--negative)";
  const arrow = zero ? null : up ? "↑" : "↓";
  const abs = formatMoney(Math.abs(n), currency);
  return (
    <span className={`inline-flex flex-wrap items-baseline gap-x-2 ${className}`} style={{ color }}>
      <span className="num font-semibold rtl-isolate" dir="rtl">
        {arrow} {zero ? formatMoney(0, currency) : `${up ? "+" : "−"}${abs.replace(/^−|-/, "")}`}
      </span>
      {pct != null && Number.isFinite(Number(pct)) && (
        <span className="num text-[12px] opacity-80 rtl-isolate" dir="rtl">
          ({up ? "+" : "−"}
          {formatPercent(Math.abs(Number(pct))).replace("+", "")})
        </span>
      )}
      {suffix && <span className="muted text-[11px]">{suffix}</span>}
    </span>
  );
}

export function Pct({ value }: { value: string | number }) {
  const n = Number(value);
  return (
    <span className="num rtl-isolate" dir="rtl" style={{ color: n >= 0 ? "var(--positive)" : "var(--negative)" }}>
      {formatPercent(value)}
    </span>
  );
}

/* ─────────────────────────── Stat tile ────────────────────────── */

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "up" | "down";
}) {
  const color =
    tone === "up" ? "var(--positive)" : tone === "down" ? "var(--negative)" : "var(--text)";
  return (
    <div className="card p-4">
      <div className="muted text-[11px] font-medium">{label}</div>
      <div className="num mt-1.5 text-lg font-bold tracking-tight sm:text-xl" style={{ color }} dir="rtl">
        {value}
      </div>
      {hint && <div className="muted mt-1 text-[11px] leading-5">{hint}</div>}
    </div>
  );
}

/** Borderless metric — label above, value below. For dense KPI rows. */
export function Metric({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "neutral" | "up" | "down";
}) {
  const color =
    tone === "up" ? "var(--positive)" : tone === "down" ? "var(--negative)" : "var(--text)";
  return (
    <div className="min-w-0">
      <div className="muted text-[11px] font-medium">{label}</div>
      <div className="num mt-1 text-lg font-bold tracking-tight sm:text-xl" style={{ color }} dir="rtl">
        {value}
      </div>
      {hint && <div className="muted mt-0.5 text-[11px] leading-5">{hint}</div>}
    </div>
  );
}

export function Progress({ value, color = "var(--brand)", "aria-label": ariaLabel = "پیشرفت" }: { value: number; color?: string; "aria-label"?: string }) {
  return (
    <div className="meter" role="progressbar" aria-label={ariaLabel} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  );
}

/* ─────────────────────── Empty & headers ──────────────────────── */

export function Empty({ text }: { text: string }) {
  return <p className="muted py-8 text-center text-xs">{text}</p>;
}

/** Rich empty state — what is missing, why it matters, what to do. */
export function EmptyState({
  icon = "info",
  title,
  body,
  action,
}: {
  icon?: Parameters<typeof Icon>[0]["name"];
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span
        className="mb-1 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
      >
        <Icon name={icon} size={20} />
      </span>
      <div className="text-[13.5px] font-semibold">{title}</div>
      {body && <p className="muted max-w-sm text-[12px] leading-5">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 pt-1">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight sm:text-[22px]">{title}</h1>
        {subtitle && <p className="muted mt-1 max-w-2xl text-[12.5px] leading-6">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/* ────────────────────────── Skeletons ─────────────────────────── */

export function Skeleton({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skeleton ${className}`} style={style} aria-hidden="true" />;
}

/* ──────────────────────────── Alert ───────────────────────────── */

export function Alert({
  tone = "info",
  icon,
  title,
  children,
  action,
}: {
  tone?: "info" | "warn" | "neg" | "pos" | "brand";
  icon?: Parameters<typeof Icon>[0]["name"];
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const map = {
    info: { c: "var(--info)", bg: "var(--info-soft)", i: "info" },
    warn: { c: "var(--warning)", bg: "var(--warning-soft)", i: "alert" },
    neg: { c: "var(--negative)", bg: "var(--negative-soft)", i: "alert" },
    pos: { c: "var(--positive)", bg: "var(--positive-soft)", i: "check-circle" },
    brand: { c: "var(--brand)", bg: "var(--brand-soft)", i: "info" },
  }[tone];
  return (
    <div
      className="flex items-start gap-3 rounded-[var(--r-lg)] border p-4"
      style={{ borderColor: `color-mix(in oklab, ${map.c} 25%, transparent)`, background: map.bg }}
      role={tone === "neg" || tone === "warn" ? "alert" : "status"}
      aria-live={tone === "neg" || tone === "warn" ? "assertive" : "polite"}
    >
      <span className="mt-0.5 shrink-0" style={{ color: map.c }}>
        <Icon name={icon ?? (map.i as Parameters<typeof Icon>[0]["name"])} size={18} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="text-[13px] font-semibold" style={{ color: map.c }}>{title}</div>}
        {children && <div className="sub mt-0.5 text-[12px] leading-5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
