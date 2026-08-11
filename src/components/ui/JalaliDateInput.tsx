"use client";

import { useState } from "react";
import {
  formatGregorianIso,
  formatJalaliIso,
  jalaliToIso,
  parseJalaliString,
  toFaDigits,
  toLatinDigits,
} from "@/lib/format";

type Props = {
  /** base field name — submits {name} (Gregorian ISO) + {name}Persian (display) */
  name: string;
  label?: string;
  /** ISO YYYY-MM-DD (controlled) */
  value?: string;
  onChange?: (iso: string) => void;
  required?: boolean;
  hint?: string;
};

const VALID_JALALI = /^\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}$/;

/**
 * ورودی تاریخ شمسی — فقط شمسی تایپ می‌شود؛
 * سیستم معادل میلادی (Gregorian) را همان‌جا محاسبه و نمایش می‌دهد و مقدار ISO
 * را در فیلد مخفی برای سرور ارسال می‌کند. ورود دستی میلادی ممکن نیست.
 */
export default function JalaliDateInput({ name, label = "تاریخ (شمسی)", value, onChange, required, hint }: Props) {
  const [jalali, setJalali] = useState(value ? formatJalaliIso(value, "en") : "");
  const [iso, setIso] = useState(value ?? "");

  const onInput = (raw: string) => {
    const v = toLatinDigits(raw);
    setJalali(v);
    const parsed = parseJalaliString(v);
    if (parsed) {
      const nextIso = jalaliToIso(parsed.y, parsed.m, parsed.d);
      setIso(nextIso);
      onChange?.(nextIso);
    } else if (!v.trim()) {
      setIso("");
      onChange?.("");
    }
  };

  const clean = jalali.trim().replace(/-/g, "/");
  const valid = VALID_JALALI.test(clean) && parseJalaliString(clean) !== null;

  return (
    <div className="min-w-0">
      <label className="label">
        {label}
        {required && <span style={{ color: "var(--negative)" }}> *</span>}
      </label>
      <input
        className="field num"
        dir="rtl"
        inputMode="numeric"
        value={jalali}
        onChange={(e) => onInput(e.target.value)}
        placeholder="۱۴۰۴/۰۵/۲۰"
        required={required}
      />
      <div className="muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] leading-4">
        <span>
          میلادی (خودکار):{" "}
          <b className="num ltr-isolate" dir="ltr" style={{ color: valid ? "var(--text-2)" : "var(--warning)" }}>
            {valid ? formatGregorianIso(iso) : "—"}
          </b>
        </span>
        {valid && (
          <span className="num" style={{ color: "var(--text-3)" }}>
            {toFaDigits(formatJalaliIso(iso, "en"))}
          </span>
        )}
      </div>
      {hint && <div className="muted mt-1 text-[10px] leading-4">{hint}</div>}
      <input type="hidden" name={name} value={iso} />
      <input type="hidden" name={`${name}Persian`} value={valid ? clean : ""} />
    </div>
  );
}
