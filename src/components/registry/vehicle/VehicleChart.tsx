"use client";

import { useMemo, useState } from "react";
import { formatMoney, formatPct, formatShortDate, formatDate, trendColor, trendArrow } from "@/lib/format";
import type { SnapshotPoint } from "@/features/rwa/vehicle/analytics";

type Currency = "toman" | "usd";

/**
 * نمودار تاریخی خودرو — فقط از Snapshotهای واقعی رسم می‌شود.
 * ارزش دلاری هر نقطه، همان مقدار ذخیره‌شده در همان Snapshot است؛
 * هرگز با نرخ دلار امروز بازمحاسبه نمی‌شود.
 */
export default function VehicleChart({
  points,
  purchasePoint,
  height = 190,
}: {
  points: SnapshotPoint[];
  purchasePoint?: SnapshotPoint | null;
  height?: number;
}) {
  const [currency, setCurrency] = useState<Currency>("toman");
  const [hover, setHover] = useState<number | null>(null);
  const [showPurchase, setShowPurchase] = useState(true);

  const series = useMemo(() => {
    const merged = showPurchase && purchasePoint ? [purchasePoint, ...points] : points;
    return [...merged]
      .filter((p, i, arr) => arr.findIndex((x) => x.date === p.date) === i)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [points, purchasePoint, showPurchase]);

  const values = series.map((p) => Number(currency === "toman" ? p.valueToman : p.valueUsd));

  if (series.length === 0) {
    return (
      <p className="muted py-8 text-center text-[11.5px]">
        هنوز ارزش‌گذاری ثبت نشده است — نمودار تاریخی فقط بر پایه Snapshotهای واقعی رسم می‌شود.
      </p>
    );
  }

  const w = 640;
  const h = height;
  const padX = 10;
  const padTop = 14;
  const padBottom = 22;

  const times = series.map((p) => Date.parse(`${p.date}T00:00:00Z`));
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = tMax - tMin || 1;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || Math.abs(max) || 1;

  const x = (i: number) =>
    series.length === 1 ? w / 2 : padX + ((times[i] - tMin) / tSpan) * (w - padX * 2);
  const y = (v: number) => padTop + (1 - (v - min) / span) * (h - padTop - padBottom);

  const line = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(values[i]).toFixed(1)}`)
    .join(" ");
  const area =
    series.length > 1
      ? `${line} L${x(series.length - 1).toFixed(1)},${h - padBottom} L${x(0).toFixed(1)},${h - padBottom} Z`
      : "";

  const active = hover ?? series.length - 1;
  const activePoint = series[active];
  const first = values[0];
  const last = values[values.length - 1];
  const changePct = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const fmt = (v: number) => (currency === "toman" ? formatMoney(v, "IRT") : formatMoney(v, "USD"));

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div aria-live="polite">
          <div className="num text-[17px] font-bold tracking-tight" dir={currency === "toman" ? "rtl" : "ltr"}>
            {fmt(values[active])}
          </div>
          <div className="muted text-[11px]">
            {formatDate(activePoint.date)}
            {series.length > 1 && (
              <>
                {" · "}
                <span style={{ color: trendColor(changePct) }}>
                  {trendArrow(changePct)}{" "}
                  <span dir="rtl">{formatPct(Math.abs(changePct), 2)}</span> در کل بازه نمودار
                </span>
              </>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {purchasePoint && (
            <button
              type="button"
              className="chip text-[11px]"
              aria-pressed={showPurchase}
              onClick={() => setShowPurchase((s) => !s)}
              style={showPurchase ? { background: "var(--brand-soft)", color: "var(--brand)" } : undefined}
            >
              نقطه خرید
            </button>
          )}
          <div className="seg" role="group" aria-label="واحد نمودار">
            <button
              type="button"
              onClick={() => setCurrency("toman")}
              className={currency === "toman" ? "seg-on" : ""}
              aria-pressed={currency === "toman"}
            >
              تومان
            </button>
            <button
              type="button"
              onClick={() => setCurrency("usd")}
              className={currency === "usd" ? "seg-on" : ""}
              aria-pressed={currency === "usd"}
            >
              دلار
            </button>
          </div>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`نمودار تاریخی ارزش خودرو بر حسب ${currency === "toman" ? "تومان" : "دلار"}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * w;
          let best = 0;
          let bestD = Infinity;
          series.forEach((_, i) => {
            const d = Math.abs(x(i) - px);
            if (d < bestD) {
              bestD = d;
              best = i;
            }
          });
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id="vehGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <line
            key={g}
            x1={padX}
            x2={w - padX}
            y1={padTop + g * (h - padTop - padBottom)}
            y2={padTop + g * (h - padTop - padBottom)}
            stroke="var(--border)"
            strokeWidth="1"
          />
        ))}

        {area && <path d={area} fill="url(#vehGrad)" />}
        {series.length > 1 && <path d={line} fill="none" stroke="var(--brand)" strokeWidth="2.2" strokeLinejoin="round" />}

        {series.map((p, i) => (
          <circle
            key={p.date}
            cx={x(i)}
            cy={y(values[i])}
            r={i === active ? 4.5 : 3}
            fill={purchasePoint && p.date === purchasePoint.date ? "var(--warning)" : "var(--brand)"}
            stroke="var(--surface)"
            strokeWidth="1.5"
          />
        ))}

        <line
          x1={x(active)}
          x2={x(active)}
          y1={padTop}
          y2={h - padBottom}
          stroke="var(--border-strong)"
          strokeDasharray="3 3"
        />

        {series.map((p, i) =>
          i === 0 || i === series.length - 1 || i === active ? (
            <text
              key={`t-${p.date}`}
              x={x(i)}
              y={h - 6}
              textAnchor="middle"
              fontSize="10"
              fill="var(--text-3)"
            >
              {formatShortDate(p.date)}
            </text>
          ) : null,
        )}
      </svg>

      <p className="muted mt-1 text-[10px] leading-4">
        محور افقی: تاریخ Snapshot · محور عمودی: ارزش ثبت‌شده. مقدار دلاری هر نقطه با نرخ دلارِ همان Snapshot ذخیره شده و با
        تغییر نرخ امروز تغییر نمی‌کند.
      </p>
    </div>
  );
}
