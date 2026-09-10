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
    <section className={`card p-3.5 sm:p-4 ${className}`}>
      {(title || action) && (
        <header className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h2 className="text-[17px] font-semibold tracking-tight sm:text-[18px]">{title}</h2>}
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
        <header className="mb-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold tracking-tight sm:text-[18px]">{title}</h2>}
            {hint && <p className="muted mt-1 text-[length:var(--fs-xs)] leading-5">{hint}</p>}
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
      className="section-link inline-flex min-h-11 items-center gap-1 text-[length:var(--fs-sm)] font-medium"
      style={{ color: "var(--brand)" }}
    >
      {label}
      <Icon name="chevronLeft" size={14} />
    </Link>
  );
}

/* ─────────────────────── Financial numbers — PWA compact ────────────────────── */

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
  // Six-step scale from the design tokens. A financial value never renders
  // below --fs-sm (14px): shrinking money to fit is not a layout solution.
  const cls =
    size === "xl"
      ? "money-hero text-[length:var(--fs-hero)] font-bold leading-[1.1] tracking-tight money-nowrap"
      : size === "lg"
        ? "money-hero-sm text-[length:var(--fs-lg)] font-bold leading-[1.25] money-nowrap"
        : size === "sm"
          ? "num text-[length:var(--fs-sm)] font-medium money-nowrap"
          : "num text-[length:var(--fs-md)] font-semibold money-nowrap";
  return (
    <span className={`money-inline rtl-isolate ${cls}`} dir="rtl" style={color ? { color } : undefined}>
      {arrow && n !== 0 && (
        <Icon name={n > 0 ? "trend-up" : "trend-down"} size={size === "xl" ? 15 : 12} strokeWidth={2.2} />
      )}
      <span className="money-nowrap">{formatMoney(value, currency)}</span>
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
    <span className={`inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 ${className} money-nowrap`} style={{ color }}>
      <span className="num text-[length:var(--fs-sm)] font-semibold rtl-isolate money-nowrap" dir="rtl">
        {arrow} {zero ? formatMoney(0, currency) : `${up ? "+" : "−"}${abs.replace(/^−|-/, "")}`}
      </span>
      {pct != null && Number.isFinite(Number(pct)) && (
        <span className="num text-[length:var(--fs-xs)] opacity-80 rtl-isolate money-nowrap" dir="rtl">
          ({up ? "+" : "−"}
          {formatPercent(Math.abs(Number(pct))).replace("+", "")})
        </span>
      )}
      {suffix && <span className="muted text-[length:var(--fs-xs)]">{suffix}</span>}
    </span>
  );
}

export function Pct({ value }: { value: string | number }) {
  const n = Number(value);
  return (
    <span className="num rtl-isolate money-nowrap text-[length:var(--fs-sm)]" dir="rtl" style={{ color: n > 0 ? "var(--positive)" : n < 0 ? "var(--negative)" : "var(--text-2)" }}>
      {formatPercent(value)}
    </span>
  );
}

/* ─────────────────────────── Stat tile — compact ────────────────────────── */

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
    <div className="stat-tile card p-3 sm:p-3.5 min-w-0 overflow-hidden">
      <div className="muted text-[length:var(--fs-xs)] font-medium truncate">{label}</div>
      <div className="stat-value mt-1.5 text-[length:var(--fs-lg)] font-bold tracking-tight money-nowrap" style={{ color }} dir="rtl">
        {value}
      </div>
      {hint && <div className="muted mt-1.5 text-[length:var(--fs-xs)] leading-5 line-clamp-2">{hint}</div>}
    </div>
  );
}

/** Borderless metric — label above, value below. For dense KPI rows. Compact for PWA. */
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
    <div className="stat-tile min-w-0 overflow-hidden">
      <div className="muted text-[length:var(--fs-xs)] font-medium truncate">{label}</div>
      <div className="metric-value mt-1.5 text-[length:var(--fs-md)] font-bold tracking-tight money-nowrap" style={{ color }} dir="rtl">
        {value}
      </div>
      {hint && <div className="muted mt-1 text-[length:var(--fs-xs)] leading-5 line-clamp-2">{hint}</div>}
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
  return <p className="muted py-8 text-center text-[length:var(--fs-sm)]">{text}</p>;
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
    <div className="flex flex-col items-center gap-2 px-4 py-8 text-center sm:px-6 sm:py-10">
      <span
        className="mb-1 flex h-10 w-10 items-center justify-center rounded-full sm:h-11 sm:w-11"
        style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
      >
        <Icon name={icon} size={18} />
      </span>
      <div className="text-[length:var(--fs-md)] font-semibold">{title}</div>
      {body && <p className="muted max-w-sm text-[length:var(--fs-sm)] leading-6">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ───────────────────── ActionItem — «نیاز به توجه» ─────────────────────
   One thing the user should decide about, stated in plain Persian, with the
   amount/date that makes it decidable and exactly one action. Deliberately a
   quiet row, not a wall of alert cards: attention should feel calm.
   ─────────────────────────────────────────────────────────────────────── */
export function ActionItem({
  icon = "info",
  tone = "info",
  text,
  detail,
  href,
  action,
}: {
  icon?: Parameters<typeof Icon>[0]["name"];
  tone?: "info" | "warn" | "neg" | "pos";
  text: string;
  detail?: string;
  href: string;
  action: string;
}) {
  const color = {
    info: "var(--info)",
    warn: "var(--warning)",
    neg: "var(--negative)",
    pos: "var(--positive)",
  }[tone];
  const bg = {
    info: "var(--info-soft)",
    warn: "var(--warning-soft)",
    neg: "var(--negative-soft)",
    pos: "var(--positive-soft)",
  }[tone];

  return (
    <li className="action-item">
      <span className="action-item-icon" style={{ background: bg, color }} aria-hidden="true">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[length:var(--fs-sm)] font-semibold leading-6">{text}</p>
        {detail && <p className="muted mt-0.5 text-[length:var(--fs-xs)] leading-5">{detail}</p>}
      </div>
      <Link href={href} className="btn btn-soft shrink-0 !px-3.5 text-[length:var(--fs-xs)]">
        {action}
      </Link>
    </li>
  );
}

/** The reassuring counterpart: nothing needs the user right now. */
export function AllClear({ text = "همه‌چیز مرتب است" }: { text?: string }) {
  return (
    <div className="all-clear">
      <span className="action-item-icon" style={{ background: "var(--positive-soft)", color: "var(--positive)" }} aria-hidden="true">
        <Icon name="check" size={17} />
      </span>
      <p className="text-[length:var(--fs-sm)] font-medium">{text}</p>
    </div>
  );
}

/* ─────────── StateBlock — one shape for loading / empty / error ───────────
   Every state answers the same three questions: what is missing, why it
   matters, what to do next. Raw technical errors never reach the user.
   ─────────────────────────────────────────────────────────────────────── */
export function StateBlock({
  kind = "empty",
  icon,
  title,
  body,
  action,
}: {
  kind?: "empty" | "error";
  icon?: Parameters<typeof Icon>[0]["name"];
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const tone = kind === "error" ? "var(--negative)" : "var(--brand)";
  const bg = kind === "error" ? "var(--negative-soft)" : "var(--brand-soft)";
  return (
    <div
      className="flex flex-col items-center gap-2 px-4 py-10 text-center sm:px-6"
      role={kind === "error" ? "alert" : undefined}
    >
      <span
        className="mb-1 flex h-11 w-11 items-center justify-center rounded-full"
        style={{ background: bg, color: tone }}
      >
        <Icon name={icon ?? (kind === "error" ? "alert" : "info")} size={19} />
      </span>
      <div className="text-[length:var(--fs-md)] font-semibold">{title}</div>
      {body && <p className="muted max-w-sm text-[length:var(--fs-sm)] leading-6">{body}</p>}
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
    <div className="mb-4 flex flex-wrap items-end justify-between gap-2.5 pt-1 sm:mb-5 sm:gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight sm:text-[24px]">{title}</h1>
        {subtitle && <p className="muted mt-1.5 max-w-2xl text-[length:var(--fs-sm)] leading-6">{subtitle}</p>}
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
      className="flex items-start gap-2.5 rounded-[var(--r-lg)] border p-3 sm:gap-3 sm:p-4"
      style={{ borderColor: `color-mix(in oklab, ${map.c} 25%, transparent)`, background: map.bg }}
      role={tone === "neg" || tone === "warn" ? "alert" : "status"}
      aria-live={tone === "neg" || tone === "warn" ? "assertive" : "polite"}
    >
      <span className="mt-0.5 shrink-0" style={{ color: map.c }}>
        <Icon name={icon ?? (map.i as Parameters<typeof Icon>[0]["name"])} size={16} />
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="text-[length:var(--fs-sm)] font-semibold" style={{ color: map.c }}>{title}</div>}
        {children && <div className="sub mt-1 text-[length:var(--fs-xs)] leading-5">{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
