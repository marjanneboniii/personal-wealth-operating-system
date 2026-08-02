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

export function AreaChart({ data, height = 170 }: { data: SeriesPoint[]; height?: number }) {
  const [range, setRange] = useState("1y");
  const [hover, setHover] = useState<number | null>(null);

  const points = useMemo(() => {
    const months = RANGES.find((r) => r.key === range)?.months ?? 12;
    return data.slice(Math.max(0, data.length - months));
  }, [data, range]);

  if (!points.length) return <p className="muted py-10 text-center text-xs">داده‌ای برای نمایش نیست</p>;

  const w = 600;
  const h = height;
  const pad = 8;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => pad + (1 - (v - min) / span) * (h - pad * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${h - pad} L${x(0)},${h - pad} Z`;
  const active = hover ?? points.length - 1;
  const first = points[0].value;
  const last = points[points.length - 1].value;
  const changePct = first ? ((last - first) / Math.abs(first)) * 100 : 0;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="num text-lg font-bold" dir="ltr">
            {formatMoney(points[active].value)}
          </div>
          <div className="muted text-[11px]">
            {formatShortDate(points[active].date)} ·{" "}
            <span style={{ color: changePct >= 0 ? "var(--accent)" : "var(--danger)" }}>
              {changePct >= 0 ? "▲" : "▼"} {Math.abs(changePct).toFixed(1)}٪
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className="chip"
              style={range === r.key ? { background: "var(--accent-soft)", color: "var(--accent)" } : undefined}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = 1 - (e.clientX - rect.left) / rect.width;
          const idx = Math.round((1 - rel) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, idx)));
        }}
      >
        <defs>
          <linearGradient id="pwosArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={area} fill="url(#pwosArea)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />
        <line x1={x(active)} y1={pad} x2={x(active)} y2={h - pad} stroke="var(--line)" strokeWidth="1" />
        <circle cx={x(active)} cy={y(points[active].value)} r="4.5" fill="var(--accent)" stroke="var(--bg-elev)" strokeWidth="2" />
      </svg>
    </div>
  );
}

export function Donut({
  data,
  size = 168,
}: {
  data: { label: string; value: number; color: string }[];
  size?: number;
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) return <p className="muted py-8 text-center text-xs">دارایی‌ای ثبت نشده است</p>;
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          {data.map((d) => {
            const len = (d.value / total) * c;
            const el = (
              <circle
                key={d.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth="16"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += len;
            return el;
          })}
        </g>
      </svg>
      <ul className="w-full space-y-2">
        {data.map((d) => (
          <li key={d.label} className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-2">
              <i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: d.color }} />
              {d.label}
            </span>
            <span className="num muted" dir="ltr">
              {((d.value / total) * 100).toFixed(1)}٪ · {formatMoney(d.value)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BarsChart({
  data,
  height = 150,
}: {
  data: { label: string; positive: number; negative: number }[];
  height?: number;
}) {
  if (!data.length) return <p className="muted py-8 text-center text-xs">داده‌ای نیست</p>;
  const max = Math.max(...data.map((d) => Math.max(d.positive, d.negative)), 1);
  return (
    <div className="flex items-end gap-2 overflow-x-auto pb-1" style={{ height: height + 28 }}>
      {data.map((d) => (
        <div key={d.label} className="flex min-w-10 flex-1 flex-col items-center gap-1">
          <div className="flex h-full w-full items-end justify-center gap-1" style={{ height }}>
            <div
              className="w-1/2 rounded-t-lg"
              style={{ height: `${(d.positive / max) * 100}%`, background: "var(--accent)", minHeight: 2 }}
              title={`ورودی: ${d.positive}`}
            />
            <div
              className="w-1/2 rounded-t-lg"
              style={{ height: `${(d.negative / max) * 100}%`, background: "var(--danger)", opacity: 0.75, minHeight: 2 }}
              title={`خروجی: ${d.negative}`}
            />
          </div>
          <span className="muted text-[10px] whitespace-nowrap">{d.label}</span>
        </div>
      ))}
    </div>
  );
}
