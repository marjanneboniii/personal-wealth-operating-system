"use client";

import { useState } from "react";
import {
  jalaliToIso,
  parseJalaliString,
  formatJalaliIso,
  toFaDigits,
  toLatinDigits,
} from "@/lib/format";
import { DualDatePreview } from "./SmartPreview";

type Props = {
  name: string; // gregorian ISO field name submitted to server
  defaultValue?: string; // ISO YYYY-MM-DD
  value?: string;
  onChange?: (iso: string) => void;
  label?: string;
  required?: boolean;
  /**
   * تاریخ فقط شمسی تایپ و نمایش داده می‌شود؛ معادل میلادی (ISO) محاسبه شده و
   * در فیلد مخفی برای سرور ارسال می‌شود، اما هیچ‌جای UI نشان داده نمی‌شود.
   * با `jalaliOnly={false}` انتخاب‌گر میلادی و پیش‌نمایش دوگانه برمی‌گردند.
   */
  jalaliOnly?: boolean;
};

const VALID_JALALI = /^\d{4}[/\-]\d{1,2}[/\-]\d{1,2}$/;

export default function DualDateInput({
  name,
  defaultValue,
  value,
  onChange,
  label = "تاریخ",
  required,
  jalaliOnly = true,
}: Props) {
  const [isoInternal, setIsoInternal] = useState<string>(value ?? defaultValue ?? "");
  const [jalali, setJalali] = useState<string>(
    (value ?? defaultValue) ? formatJalaliIso((value ?? defaultValue) as string, "en") : "",
  );

  const iso = value !== undefined ? value : isoInternal;

  // Sync from parent changes during render (no cascading effect render)
  const [prevV, setPrevV] = useState<string | undefined>(value !== undefined ? value : defaultValue);
  const v = value !== undefined ? value : defaultValue;
  if (v !== prevV) {
    setPrevV(v);
    if (v) {
      if (value === undefined) setIsoInternal(v);
      setJalali(formatJalaliIso(v, "en"));
    }
  }

  const setIso = (v: string) => {
    if (value === undefined) setIsoInternal(v);
    onChange?.(v);
  };

  const onIsoChange = (v: string) => {
    setIso(v);
    if (v) setJalali(formatJalaliIso(v, "en"));
    else setJalali("");
  };

  const onJalaliChange = (raw: string) => {
    // Persian digits are accepted on input and normalised for parsing.
    const v = toLatinDigits(raw);
    setJalali(v);
    const parsed = parseJalaliString(v);
    if (parsed) {
      setIso(jalaliToIso(parsed.y, parsed.m, parsed.d));
    } else if (!v.trim()) {
      setIso("");
    }
  };

  const clean = jalali.trim().replace(/-/g, "/");
  const valid = VALID_JALALI.test(clean) && parseJalaliString(clean) !== null;

  return (
    <div className="space-y-2">
      <label className="label">{label}</label>

      {jalaliOnly ? (
        <div>
          <div className="muted text-[10px] mb-1">شمسی — YYYY/MM/DD</div>
          <input
            value={jalali}
            onChange={(e) => onJalaliChange(e.target.value)}
            placeholder="۱۴۰۴/۰۶/۱۴"
            className="field num"
            dir="rtl"
            inputMode="numeric"
            required={required}
          />
          {jalali.trim() && !valid && (
            <div className="mt-1 text-[10px]" style={{ color: "var(--warning)" }}>
              تاریخ شمسی نامعتبر است — نمونه: ۱۴۰۴/۰۶/۱۴
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="muted text-[10px] mb-1">میلادی (LTR)</div>
            <input
              type="date"
              value={iso}
              onChange={(e) => onIsoChange(e.target.value)}
              className="field num"
              dir="ltr"
              required={required}
            />
          </div>
          <div>
            <div className="muted text-[10px] mb-1">شمسی (RTL) — YYYY/MM/DD</div>
            <input
              value={jalali}
              onChange={(e) => onJalaliChange(e.target.value)}
              placeholder="۱۴۰۳/۰۲/۱۵"
              className="field num"
              dir="rtl"
            />
          </div>
        </div>
      )}

      {/* hidden field submitted to server — always the Gregorian ISO value */}
      <input type="hidden" name={name} value={iso} required={required} />

      {jalaliOnly ? (
        valid ? (
          <div className="muted text-[10.5px]">
            <span className="num" dir="rtl" style={{ color: "var(--text-2)" }}>
              {toFaDigits(formatJalaliIso(iso, "en"))}
            </span>
          </div>
        ) : null
      ) : (
        <DualDatePreview iso={iso} />
      )}
    </div>
  );
}
