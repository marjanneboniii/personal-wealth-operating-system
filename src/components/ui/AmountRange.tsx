"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { formatNumber, toFaDigits, toLatinDigits } from "@/lib/format";

export interface AmountRangeProps {
  /** کمترین و بیشترین مبلغ ممکن */
  min: number;
  max: number;
  /** [از، تا] به صورت کنترل‌شده */
  value?: [number, number];
  defaultValue?: [number, number];
  onChange?: (value: [number, number]) => void;
  /** گام اسلایدر و گرد کردن @default 10000 */
  step?: number;
  /** عنوان بالای فیلتر */
  label?: ReactNode;
  /** واحد پولی @default "تومان" */
  unit?: string;
  disabled?: boolean;
  className?: string;
  labels?: { from?: string; to?: string };
}

/**
 * AmountRange — فیلتر بازه مبالغ مالی بر اساس الگوی PriceRange کاشی ۲.۰
 * هماهنگ‌کننده دو فیلد ورودی «از» و «تا» با اسلایدر دو سر لمسی.
 */
export default function AmountRange({
  min,
  max,
  value,
  defaultValue,
  onChange,
  step = 10000,
  label,
  unit = "تومان",
  disabled = false,
  className = "",
  labels = {},
}: AmountRangeProps) {
  const id = useId();
  const [inner, setInner] = useState<[number, number]>(defaultValue ?? [min, max]);
  const [lo, hi] = value ?? inner;
  const { from = "از", to = "تا" } = labels;

  const fmt = (n: number) => formatNumber(n, { decimals: 0, digits: "fa", isolate: false });

  const setRange = (next: [number, number]) => {
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  // نگهداری مقدار متنی فیلدها جدا از عدد برای جلوگیری از پرش caret هنگام تایپ
  const [prevLo, setPrevLo] = useState(lo);
  const [prevHi, setPrevHi] = useState(hi);
  const [text, setText] = useState<[string, string]>([fmt(lo), fmt(hi)]);

  if (prevLo !== lo || prevHi !== hi) {
    setPrevLo(lo);
    setPrevHi(hi);
    setText([fmt(lo), fmt(hi)]);
  }

  const parseNumber = (s: string) => {
    const latin = toLatinDigits(s).replace(/[^\d]/g, "");
    return Number(latin || "0");
  };

  const commit = (which: 0 | 1) => {
    let n = Math.round(parseNumber(text[which]) / step) * step;
    n = Math.min(max, Math.max(min, n));
    const next: [number, number] = which === 0 ? [Math.min(n, hi), hi] : [lo, Math.max(n, lo)];
    setRange(next);
    setText([fmt(next[0]), fmt(next[1])]);
  };

  const handleLiveText = (which: 0 | 1, raw: string) => {
    const rawDigits = toLatinDigits(raw).replace(/[^\d]/g, "");
    const formatted = rawDigits ? fmt(Number(rawDigits)) : "";
    setText((prev) => (which === 0 ? [formatted, prev[1]] : [prev[0], formatted]));
  };

  // درصد برای موقعیت دستگیره‌های اسلایدر
  const minPercent = max > min ? Math.max(0, Math.min(100, ((lo - min) / (max - min)) * 100)) : 0;
  const maxPercent = max > min ? Math.max(0, Math.min(100, ((hi - min) / (max - min)) * 100)) : 100;

  return (
    <div
      className={`amount-range space-y-2.5 rounded-[var(--r-md)] border border-[var(--border)] bg-[var(--surface)] p-3 text-sm ${className}`}
      role="group"
      aria-labelledby={label ? `${id}-label` : undefined}
    >
      {label && (
        <div className="flex items-center justify-between text-xs font-semibold text-[var(--text-2)]" id={`${id}-label`}>
          <span>{label}</span>
          <span className="num text-[var(--text-3)]" dir="rtl">
            {fmt(lo)} {toFaDigits("—")} {fmt(hi)} {unit}
          </span>
        </div>
      )}

      {/* فیلدهای «از» و «تا» */}
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--sunken)] px-2.5 py-1.5 transition-colors focus-within:border-[var(--action)] focus-within:ring-2 focus-within:ring-[var(--action-soft)]">
          <span className="text-xs text-[var(--text-3)] select-none">{from}</span>
          <input
            type="text"
            inputMode="numeric"
            value={text[0]}
            disabled={disabled}
            onChange={(e) => handleLiveText(0, e.target.value)}
            onBlur={() => commit(0)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(0);
              }
            }}
            className="w-full bg-transparent text-left font-semibold text-[var(--text)] outline-none"
            dir="ltr"
            aria-label={`${from} مبلغ`}
          />
          <span className="text-[11px] text-[var(--text-3)] select-none">{unit}</span>
        </label>

        <label className="flex items-center gap-1.5 rounded-[var(--r-sm)] border border-[var(--border-strong)] bg-[var(--sunken)] px-2.5 py-1.5 transition-colors focus-within:border-[var(--action)] focus-within:ring-2 focus-within:ring-[var(--action-soft)]">
          <span className="text-xs text-[var(--text-3)] select-none">{to}</span>
          <input
            type="text"
            inputMode="numeric"
            value={text[1]}
            disabled={disabled}
            onChange={(e) => handleLiveText(1, e.target.value)}
            onBlur={() => commit(1)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit(1);
              }
            }}
            className="w-full bg-transparent text-left font-semibold text-[var(--text)] outline-none"
            dir="ltr"
            aria-label={`${to} مبلغ`}
          />
          <span className="text-[11px] text-[var(--text-3)] select-none">{unit}</span>
        </label>
      </div>

      {/* اسلایدر دو سر لمسی */}
      <div className="relative pt-2 pb-1" dir="ltr">
        <div className="relative h-1.5 w-full rounded-full bg-[var(--border-strong)]">
          {/* نوار رنگی بین دو دستگیره */}
          <div
            className="absolute h-full rounded-full bg-[var(--action)] transition-all"
            style={{
              left: `${minPercent}%`,
              width: `${Math.max(0, maxPercent - minPercent)}%`,
            }}
          />
        </div>

        {/* ورودی Range دستگیره چپ (کمترین) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={lo}
          disabled={disabled}
          onChange={(e) => {
            const val = Math.min(Number(e.target.value), hi);
            setRange([val, hi]);
          }}
          className="range-thumb-slider pointer-events-none absolute inset-x-0 top-1.5 h-1.5 w-full appearance-none bg-transparent"
        />

        {/* ورودی Range دستگیره راست (بیشترین) */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={hi}
          disabled={disabled}
          onChange={(e) => {
            const val = Math.max(Number(e.target.value), lo);
            setRange([lo, val]);
          }}
          className="range-thumb-slider pointer-events-none absolute inset-x-0 top-1.5 h-1.5 w-full appearance-none bg-transparent"
        />
      </div>
    </div>
  );
}
