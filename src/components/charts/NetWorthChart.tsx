"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import type { SeriesPoint } from "./Charts";

/**
 * NetWorthChart — the hero visual of /net-worth.
 * Range is owned by the URL (server), the chart only renders + inspects.
 * Always shows start/end values — usable without hover.
 */
export default function NetWorthChart({
  data,
  height = 220,
}: {
  data: SeriesPoint[];
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const points = useMemo(() => data.filter((p) => Number.isFinite(p.value)), [data]);

  if (points.length < 2) {
    return (
      <div className="muted flex h-40 flex-col items-center justify-center gap-1 text-center text-xs">
        <p>برای نمایش روند، حداقل دو نقطه داده لازم است.</p>
        <p className="text-[11px]">با «ثبت اسنپ‌شات» روزانه، تاریخچه ارزش خالص شما ساخته می‌شود.</p>
      </div>
    );
  }

  const w = 700;
  const h = height;
  const padX = 4;
  const padTop = 12;
  const padBottom = 22;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => padX + (i * (w - padX * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (h - padTop - padBottom);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${h - padBottom} L${x(0)},${h - padBottom} Z`;
  const active = hover ?? points.length - 1;

  const firstLabel = points[0].date;
  const lastLabel = points[points.length - 1].date;

  return (
    <div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`روند ارزش خالص از ${formatMoney(points[0].value)} در ${formatDate(firstLabel)} تا ${formatMoney(points[points.length - 1].value)}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = (e.clientX - rect.left) / rect.width;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          const rect = e.currentTarget.getBoundingClientRect();
          const rel = (t.clientX - rect.left) / rect.width;
          setHover(Math.max(0, Math.min(points.length - 1, Math.round(rel * (points.length - 1)))));
        }}
      >
        <defs>
          <linearGradient id="nwArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <g key={t}>
            <line
              x1={padX}
              x2={w - padX}
              y1={padTop + (h - padTop - padBottom) * t}
              y2={padTop + (h - padTop - padBottom) * t}
              stroke="var(--border)"
              strokeDasharray="2 4"
              strokeWidth="1"
            />
            <text
              x={w - padX - 2}
              y={padTop + (h - padTop - padBottom) * t - 4}
              textAnchor="end"
              fontSize="9"
              fill="var(--text-3)"
            >
              {formatMoney(max - span * t)}
            </text>
          </g>
        ))}
        <path d={area} fill="url(#nwArea)" />
        <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <line x1={x(active)} y1={padTop} x2={x(active)} y2={h - padBottom} stroke="var(--border-strong)" strokeWidth="1" />
        )}
        <circle cx={x(active)} cy={y(points[active].value)} r="4.5" fill="var(--brand)" stroke="var(--surface)" strokeWidth="2" />
        {/* Hover readout — visible value even without a legend */}
        {hover != null && (
          <g>
            <rect
              x={Math.min(Math.max(x(active) - 70, padX), w - 150)}
              y={Math.max(y(points[active].value) - 44, 2)}
              width="146"
              height="34"
              rx="8"
              fill="var(--surface-elev)"
              stroke="var(--border-strong)"
            />
            <text x={Math.min(Math.max(x(active), padX + 70), w - 78)} y={Math.max(y(points[active].value) - 28, 16)} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">
              {formatMoney(points[active].value)}
            </text>
            <text x={Math.min(Math.max(x(active), padX + 70), w - 78)} y={Math.max(y(points[active].value) - 14, 30)} textAnchor="middle" fontSize="9" fill="var(--text-3)">
              {formatDate(points[active].date, "en")}
            </text>
          </g>
        )}
        <text x={padX + 2} y={h - 6} fontSize="9" fill="var(--text-3)">
          {formatDate(firstLabel, "en")}
        </text>
        <text x={w - padX - 2} y={h - 6} textAnchor="end" fontSize="9" fill="var(--text-3)">
          {formatDate(lastLabel, "en")}
        </text>
      </svg>
    </div>
  );
}
