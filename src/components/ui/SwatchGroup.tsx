"use client";

import { useId, useState, type CSSProperties, type ReactNode } from "react";

export interface SwatchOption {
  value: string;
  label: ReactNode;
  /** رنگ نمونه؛ مقدار CSS مانند hex، rgb یا نام توکن */
  color: string;
  disabled?: boolean;
}

export interface SwatchGroupProps {
  options: SwatchOption[];
  /** مقدارهای انتخاب‌شده */
  value?: string[];
  defaultValue?: string[];
  onChange?: (value: string[]) => void;
  /** تک‌انتخابی (پیش‌فرض false) */
  single?: boolean;
  /** عنوان گروه */
  label?: ReactNode;
  /** اندازه نمونه‌ها @default "md" */
  size?: "sm" | "md" | "lg";
  name?: string;
  className?: string;
}

/**
 * SwatchGroup — انتخابگر نمونه‌های رنگ بر پایه الگوی کاشی ۲.۰
 * پیاده‌سازی‌شده روی رادیو و چک‌باکس بومی برای دسترسی‌پذیری کامل کیبورد و صفحه‌خوان.
 */
export default function SwatchGroup({
  options,
  value,
  defaultValue,
  onChange,
  single = false,
  label,
  size = "md",
  name,
  className = "",
}: SwatchGroupProps) {
  const id = useId();
  const [inner, setInner] = useState<string[]>(defaultValue ?? []);
  const selected = value ?? inner;

  const toggle = (v: string) => {
    const next = single
      ? selected[0] === v
        ? []
        : [v]
      : selected.includes(v)
      ? selected.filter((x) => x !== v)
      : [...selected, v];
    if (value === undefined) setInner(next);
    onChange?.(next);
  };

  const sizeClasses = {
    sm: "w-6 h-6",
    md: "w-8 h-8",
    lg: "w-10 h-10",
  }[size];

  return (
    <fieldset className={`swatch-group space-y-2 ${className}`}>
      {label && <legend className="text-xs font-semibold text-[var(--text-2)]">{label}</legend>}
      <div className="flex flex-wrap items-center gap-2.5" role={single ? "radiogroup" : undefined}>
        {options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <label
              key={o.value}
              className={`group relative flex cursor-pointer items-center justify-center rounded-full transition-transform active:scale-95 ${
                o.disabled ? "cursor-not-allowed opacity-40" : ""
              }`}
              title={typeof o.label === "string" ? o.label : undefined}
            >
              <input
                type={single ? "radio" : "checkbox"}
                className="sr-only"
                name={name ?? (single ? id : undefined)}
                value={o.value}
                checked={on}
                disabled={o.disabled}
                onChange={() => toggle(o.value)}
                onClick={(e) => {
                  if (single && on) {
                    e.preventDefault();
                    toggle(o.value);
                  }
                }}
              />
              <span
                className={`relative flex items-center justify-center rounded-full border border-[var(--border-strong)] transition-all ${sizeClasses} ${
                  on ? "ring-2 ring-[var(--action)] ring-offset-2 ring-offset-[var(--bg)]" : "hover:scale-105"
                }`}
                style={{ backgroundColor: o.color }}
                aria-hidden="true"
              >
                {/* تیک فنری در مرکز نمونه */}
                <svg
                  className={`transition-transform duration-200 ${
                    on ? "scale-100 opacity-100" : "scale-0 opacity-0"
                  }`}
                  style={{
                    transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)",
                  }}
                  viewBox="0 0 20 20"
                  width="14"
                  height="14"
                  fill="none"
                  stroke={isLightColor(o.color) ? "#0d1726" : "#ffffff"}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m4.5 10.5 3.5 3.5 7.5-7.5" />
                </svg>
              </span>
              <span className="sr-only">{o.label}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** تشخیص سرانگشتی تیره یا روشن بودن رنگ برای کنتراست آیکون تیک */
function isLightColor(color: string): boolean {
  if (color.startsWith("#") && color.length === 7) {
    const r = parseInt(color.slice(1, 3), 16);
    const g = parseInt(color.slice(3, 5), 16);
    const b = parseInt(color.slice(5, 7), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 155;
  }
  return false;
}
