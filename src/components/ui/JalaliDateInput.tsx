"use client";

import { useState } from "react";
import { formatGregorianIso, formatJalaliIso } from "@/lib/format";
import AppDoranDatePicker from "./DoranDatePicker";

type Props = {
  /** base field name — submits {name} (Gregorian ISO) + {name}Persian (display) */
  name: string;
  label?: string;
  /** ISO YYYY-MM-DD (controlled) */
  value?: string;
  onChange?: (iso: string) => void;
  required?: boolean;
  hint?: string;
  /** Echo the auto-computed Gregorian equivalent. Default true. */
  showGregorian?: boolean;
};

/**
 * ورودی تاریخ شمسی — کاربر تاریخ را با «تقویم فارسی دوران» (Doran) انتخاب
 * می‌کند و هیچ تاریخی را دستی تایپ نمی‌کند. معادل میلادی (ISO) همان‌جا محاسبه
 * می‌شود و در فیلد مخفی برای سرور ارسال می‌گردد؛ یک کپی نمایشی شمسی هم زیر
 * `${name}Persian` ثبت می‌شود (ماژول املاک آن را نگه می‌دارد).
 */
export default function JalaliDateInput({
  name,
  label = "تاریخ (شمسی)",
  value,
  onChange,
  required,
  hint,
  showGregorian = true,
}: Props) {
  const [iso, setIsoState] = useState(value ?? "");

  // Follow a controlled parent when the value changes from the outside —
  // during render, so there is no extra commit and no cascading effect.
  const [prevV, setPrevV] = useState<string | undefined>(value);
  if (value !== prevV) {
    setPrevV(value);
    setIsoState(value ?? "");
  }

  const setIso = (next: string) => {
    setIsoState(next);
    onChange?.(next);
  };

  const persian = iso ? formatJalaliIso(iso, "en") : "";

  return (
    <div className="min-w-0">
      <label className="label">
        {label}
        {required && <span style={{ color: "var(--negative)" }}> *</span>}
      </label>
      <AppDoranDatePicker
        name={name}
        value={iso}
        onChange={setIso}
        required={required}
        placeholder="انتخاب از تقویم…"
      />
      {showGregorian && iso && (
        <div className="muted mt-1 text-[10px] leading-4">
          میلادی (خودکار):{" "}
          <b className="num ltr-isolate" dir="ltr" style={{ color: "var(--text-2)" }}>
            {formatGregorianIso(iso)}
          </b>
        </div>
      )}
      {hint && <div className="muted mt-1 text-[10px] leading-4">{hint}</div>}
      {/* The server keeps receiving the Gregorian ISO (inside the picker) plus
          the Jalali display copy the real-estate module persists. */}
      <input type="hidden" name={`${name}Persian`} value={persian} />
    </div>
  );
}
