import type { ReactNode } from "react";
import { formatMoney, formatPercent } from "@/lib/format";

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
    <section className={`card rise p-4 sm:p-5 ${className}`}>
      {(title || action) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

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
  const color = tone === "up" ? "var(--accent)" : tone === "down" ? "var(--danger)" : "var(--fg)";
  return (
    <div className="card p-4">
      <div className="muted text-[11px]">{label}</div>
      <div className="num mt-1 text-lg font-bold sm:text-xl" style={{ color }} dir="ltr">
        {value}
      </div>
      {hint && <div className="muted mt-1 text-[11px]">{hint}</div>}
    </div>
  );
}

export function Money({ value, currency = "USD", tone }: { value: string | number; currency?: string; tone?: boolean }) {
  const n = Number(value);
  const color = tone ? (n > 0 ? "var(--accent)" : n < 0 ? "var(--danger)" : "var(--fg)") : undefined;
  return (
    <span className="num" dir="ltr" style={color ? { color } : undefined}>
      {formatMoney(value, currency)}
    </span>
  );
}

export function Pct({ value }: { value: string | number }) {
  const n = Number(value);
  return (
    <span className="num" dir="ltr" style={{ color: n >= 0 ? "var(--accent)" : "var(--danger)" }}>
      {formatPercent(value)}
    </span>
  );
}

export function Progress({ value, color = "var(--accent)" }: { value: number; color?: string }) {
  return (
    <div className="soft h-2 w-full overflow-hidden rounded-full">
      <div
        className="h-full rounded-full transition-all"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }}
      />
    </div>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="muted py-8 text-center text-xs">{text}</p>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3 pt-2">
      <div>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="muted mt-1 text-xs">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
