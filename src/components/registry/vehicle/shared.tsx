"use client";

import type { ReactNode } from "react";
import { D } from "@/domain/decimal";
import { formatDate, formatMoney, formatNumber, formatPct, toFaDigits } from "@/lib/format";
import type { RegistryResult } from "@/app/actions/registry";

/* ─────────────────────────── money display — compact & nowrap ─────────────────────────── */

export function Toman({ value, className = "" }: { value: string | number | null | undefined; className?: string }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  return (
    <span className={`num money-nowrap text-[12px] sm:text-[13px] ${className}`} dir="rtl">
      {formatMoney(value, "IRT")}
    </span>
  );
}

export function Usd({ value, className = "" }: { value: string | number | null | undefined; className?: string }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  return (
    <span className={`num rtl-isolate money-nowrap text-[12px] sm:text-[13px] ${className}`} dir="rtl">
      {formatMoney(value, "USD")}
    </span>
  );
}

function toneOf(value: string | number | null | undefined) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n === 0) return { color: "var(--text-3)", sign: "" };
  return n > 0
    ? { color: "var(--positive)", sign: "+" }
    : { color: "var(--negative)", sign: "−" };
}

/** Signed Toman delta — colour is never the only signal (sign + arrow). */
export function DeltaToman({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  const { color, sign } = toneOf(value);
  return (
    <span className="num money-nowrap text-[12px] sm:text-[13px]" style={{ color }} dir="rtl">
      {sign}
      {formatMoney(D(value).abs().toString(), "IRT")}
    </span>
  );
}

export function DeltaUsd({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  const { color, sign } = toneOf(value);
  return (
    <span className="num rtl-isolate money-nowrap text-[12px] sm:text-[13px]" style={{ color }} dir="rtl">
      {sign}
      {formatMoney(D(value).abs().toString(), "USD")}
    </span>
  );
}

export function DeltaPct({ value }: { value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return <span className="muted">—</span>;
  const { color, sign } = toneOf(value);
  return (
    <span className="num money-nowrap text-[12px] sm:text-[13px]" style={{ color }} dir="rtl">
      {sign}
      {formatPct(D(value).abs().toString(), 2)}
    </span>
  );
}

export function JDate({ iso, fallback = "—" }: { iso: string | null | undefined; fallback?: string }) {
  if (!iso) return <span className="muted">{fallback}</span>;
  return <span className="num text-[11px] sm:text-[12px]">{formatDate(iso)}</span>;
}

export function faNum(value: string | number | null | undefined, decimals = 0): string {
  if (value === null || value === undefined || value === "") return "—";
  return toFaDigits(formatNumber(value, { decimals }));
}

/* ─────────────────────────── layout atoms — compact ─────────────────────────── */

export function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "up" | "down" | "neutral";
}) {
  const color = tone === "up" ? "var(--positive)" : tone === "down" ? "var(--negative)" : undefined;
  return (
    <div className="min-w-0 overflow-hidden">
      <div className="muted text-[10px] font-medium truncate sm:text-[10.5px]">{label}</div>
      <div className="mt-1 text-[12px] font-bold tracking-tight money-nowrap sm:text-[13px]" style={color ? { color } : undefined} dir="rtl">
        {value}
      </div>
      {sub && <div className="muted mt-0.5 text-[10px] leading-4 line-clamp-2 sm:text-[10.5px] sm:leading-5">{sub}</div>}
    </div>
  );
}

export function Result({ state }: { state: RegistryResult | null }) {
  if (!state) return null;
  return (
    <p
      className="rounded-[var(--r-md)] p-2.5 text-[11px] leading-5 sm:p-3 sm:text-xs sm:leading-6"
      role="status"
      style={{
        background: state.ok ? "var(--positive-soft)" : "var(--negative-soft)",
        color: state.ok ? "var(--positive)" : "var(--negative)",
      }}
    >
      {state.message}
    </p>
  );
}

export function Hint({ children, tone = "info" }: { children: ReactNode; tone?: "info" | "warn" }) {
  const color = tone === "warn" ? "var(--warning)" : "var(--info)";
  const bg = tone === "warn" ? "var(--warning-soft)" : "var(--info-soft)";
  return (
    <p className="rounded-[var(--r-md)] p-2 text-[10.5px] leading-5 sm:p-2.5 sm:text-[11px]" style={{ background: bg, color }}>
      {children}
    </p>
  );
}

export function Labeled({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <label className="label text-[11px] sm:text-[12px]">
        {label}
        {required && <span style={{ color: "var(--negative)" }}> *</span>}
      </label>
      {children}
      {hint && <div className="muted mt-1 text-[10px] leading-4">{hint}</div>}
    </div>
  );
}

export function StatusChip({ status }: { status: "active" | "sold" }) {
  const active = status === "active";
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[9px] font-medium sm:text-[10px]"
      style={{
        background: active ? "var(--positive-soft)" : "var(--sunken)",
        color: active ? "var(--positive)" : "var(--text-2)",
      }}
    >
      {active ? "فعال" : "فروخته‌شده"}
    </span>
  );
}

/** سال ساخت: عدد شمسی یا میلادی، بدون تبدیل داده. */
export function yearLabel(year: number | null | undefined): string {
  if (!year) return "—";
  return year < 1700 ? `${toFaDigits(String(year))} شمسی` : `${year} میلادی`;
}
