"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatShortDate } from "@/lib/format";

export type SeriesPoint = { date: string; value: number };

const RANGES = [
  { key: "3m", label: "۳ ماه", months: 3 },
  { key: "6m", label: "۶ ماه", months: 6 },
  { key: "1y", label: "۱ سال", months: 12 },
  { key: "all", label: "همه", months: 999 },
];

/**
 * AreaChart — "چگونه تغییر کرده است؟"
 * Readable without hover (current value always shown), grid for scale,
 * keyboard-friendly range control, brand colour (not green/red).
 */
export function AreaChart({ data, height = 170 }: { data: SeriesPoint[]; height?: number }) {
  const [range, setRange] = useState("1y");
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months ?? 12;
    return data.slice(Math.max(0, data.length - months));
  }, [data, range]);

  if (!points.length)
    return <p className="muted py-10 text-center text-xs">داده‌ای برای نمایش نیست — با گذر زمان و ثبت اسنپ‌شات، این نمودار شکل می‌گیرد.</p>;

  const w = 600;
  const h = height;
  const padX = 6;
  const padTop = 10;
  const padBottom = 8;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => padX + (i * (w - padX * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (h - padTop - padBottom);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${h - padBottom} L${x(0)},${h - padBottom} Z`;
  const active = hover ?? points.length - 1;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const changePct = first ? ((last - first) / Math.abs(first)) * 100 : 0;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div aria-live="polite">
          <div className="num text-lg font-bold tracking-tight" dir="ltr">
            {formatMoney(points[active].value)}
          </div>
          <div className="muted text-[11px]">
            {formatShortDate(points[active].date)} ·{" "}
            <span style={{ color: changePct >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {changePct >= 0 ? "↑" : "↓"} <span dir="ltr">{Math.abs(changePct).toFixed(1)}٪</span> در این بازه
            </span>
          </div>
        </div>
        <div className="seg" role="group" aria-label="بازه زمانی">
          {RANGES.map((r) => (
            <button key={r.key} onClick={() => setRange(r.key)} className={range === r.key ? "seg-on" : ""} aria-pressed={range === r.key}>
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`نمودار تغییرات — از ${formatMoney(first)} به ${formatMoney(last)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - rect.left) / rect.width;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
        }}
      >
        <defs>
          <linearGradient id="pwosArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} x1={padX} x2={w - padX} y1={padTop + (h - padTop - padBottom) * t} y2={padTop + (h - padTop - padBottom) * t} stroke="var(--border)" strokeDasharray="2 4" strokeWidth="1" />
        ))}
        <path d={area} fill="url(#pwosArea)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <line x1={x(active)} y1={padTop} x2={x(active)} y2={h - padBottom} stroke="var(--border-strong)" strokeWidth="1" />
        )}
        <circle
          cx={x(active)}
          cy={y(points[active].value)}
          r={hover != null ? 4.5 : 3.5}
          fill="var(--brand)"
          stroke="var(--surface)"
          strokeWidth="2"
        />
      </svg>
    </div>
  );
}

/** Donut — "ثروت کجاست؟" with a live centre total and accessible legend table. */
export function Donut({
  data,
  size = 172,
  centerLabel,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
  centerLabel?: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 16;
  const c = 2 * Math.PI * r;

  // Segments with cumulative offsets — pure computation, no mutation anywhere
  const segments = useMemo(() => {
    const lens = data.map((d) => (total ? (d.value / total) * c : 0));
    return data.map((d, i) => ({
      d,
      len: lens[i],
      offset: lens.slice(0, i).reduce((s, v) => s + v, 0),
    }));
  }, [data, total, c]);

  if (!total) return null;
  const shown = active != null ? data[active] : null;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <div className="relative shrink-0">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="نمودار ترکیب">
          <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
            {segments.map(({ d, len, offset }, i) => (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={active === i ? 20 : 15}
                strokeDasharray={`${Math.max(0, len - (len > 2 ? 1.5 : 0))} ${c - len + (len > 2 ? 1.5 : 0)}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
                opacity={active == null || active === i ? 1 : 0.35}
                style={{ transition: "stroke-width .15s ease, opacity .15s ease", cursor: "pointer" }}
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive(null)}
              />
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="muted text-[10px]">{shown ? shown.label : (centerLabel ?? "مجموع")}</div>
          <div className="num text-[15px] font-bold" dir="ltr">
            {formatMoney(shown ? shown.value : total)}
          </div>
          <div className="muted num text-[10px]" dir="ltr">
            {shown ? `${((shown.value / total) * 100).toFixed(1)}٪` : `${data.length} بخش`}
          </div>
        </div>
      </div>
      <ul className="w-full space-y-1">
        {data.map((d, i) => (
          <li key={d.label}>
            <button
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="flex w-full items-center justify-between gap-2 rounded-[9px] px-2 py-1.5 text-xs transition-colors"
              style={{ background: active === i ? "var(--hover)" : "transparent" }}
            >
              <span className="flex items-center gap-2">
                <i className="inline-block h-2.5 w-2.5 rounded-[4px]" style={{ background: d.color }} />
                {d.label}
              </span>
              <span className="num muted" dir="ltr">
                {((d.value / total) * 100).toFixed(1)}٪ · {formatMoney(d.value)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** BarsChart — income vs spending; values visible without hover. */
export function BarsChart({
  data,
  height = 150,
}: {
  data: { label: string; positive: number; negative: number }[];
  height?: number;
}) {
  const [active, setActive] = useState<number | null>(null);
  if (!data.length) return <p className="muted py-8 text-center text-xs">داده‌ای نیست</p>;
  const max = Math.max(...data.map((d) => Math.max(d.positive, d.negative)), 1);
  const cur = active != null ? data[active] : null;
  return (
    <div>
      <div className="mb-2 flex h-5 items-center gap-4 text-[10.5px]" aria-live="polite">
        <span className="flex items-center gap-1.5" style={{ color: "var(--positive)" }}>
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--positive)" }} />
          ورودی {cur && <b className="num" dir="ltr">{formatMoney(cur.positive)}</b>}
        </span>
        <span className="flex items-center gap-1.5" style={{ color: "var(--negative)" }}>
          <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "var(--negative)" }} />
          خروجی {cur && <b className="num" dir="ltr">{formatMoney(cur.negative)}</b>}
        </span>
        {cur && (
          <span className="muted">
            {cur.label} — خالص:{" "}
            <b className="num" dir="ltr" style={{ color: cur.positive - cur.negative >= 0 ? "var(--positive)" : "var(--negative)" }}>
              {formatMoney(cur.positive - cur.negative)}
            </b>
          </span>
        )}
      </div>
      <div className="flex items-end gap-1.5 overflow-x-auto pb-1" style={{ height: height + 26 }} dir="ltr">
        {data.map((d, i) => (
          <button
            key={d.label}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
            className="flex min-w-9 flex-1 cursor-pointer flex-col items-center justify-end gap-1 rounded-md"
            style={{ height }}
            aria-label={`${d.label}: ورودی ${formatMoney(d.positive)}، خروجی ${formatMoney(d.negative)}`}
          >
            <div className="flex h-full w-full items-end justify-center gap-1">
              <div
                className="w-[42%] max-w-4 rounded-t-[4px]"
                style={{
                  height: `${(d.positive / max) * 100}%`,
                  background: "var(--positive)",
                  opacity: active == null || active === i ? 1 : 0.45,
                  minHeight: 2,
                  transition: "opacity .15s ease",
                }}
              />
              <div
                className="w-[42%] max-w-4 rounded-t-[4px]"
                style={{
                  height: `${(d.negative / max) * 100}%`,
                  background: "var(--negative)",
                  opacity: active == null || active === i ? 0.8 : 0.35,
                  minHeight: 2,
                  transition: "opacity .15s ease",
                }}
              />
            </div>
            <span className="muted whitespace-nowrap text-[10px]" dir="rtl">
              {d.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
