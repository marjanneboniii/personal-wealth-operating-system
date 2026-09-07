"use client";

import { useState } from "react";
import { DualDatePreview } from "./SmartPreview";
import AppDoranDatePicker from "./DoranDatePicker";

type Props = {
  /** Form field name — submits the Gregorian ISO value to the server. */
  name: string;
  defaultValue?: string; // ISO YYYY-MM-DD
  value?: string;
  onChange?: (iso: string) => void;
  label?: string;
  required?: boolean;
  /**
   * Echo the auto-computed Gregorian equivalent under the Doran calendar.
   * Default true; the debt screens (اقساط / تعهدات / سررسید) pass false and
   * stay Jalali-only.
   */
  showGregorian?: boolean;
};

/**
 * ورودی تاریخ فرم‌ها بر پایه «تقویم فارسی دوران» (Doran):
 * کاربر تاریخ را با انتخاب‌گر شمسی دوران برمی‌دارد و معادل میلادی (ISO)
 * به‌صورت خودکار محاسبه می‌شود و در فیلد مخفی به سرور می‌رود، همان‌طور که
 * همه server actionها انتظار دارند؛ بیرون از دامنه بدهی همان معادلِ
 * محاسبه‌شده کنار تقویم نمایش داده می‌شود (`showGregorian={false}` آن را
 * خاموش می‌کند).
 */
export default function DualDateInput({
  name,
  defaultValue,
  value,
  onChange,
  label = "تاریخ",
  required,
  showGregorian = true,
}: Props) {
  const [isoInternal, setIsoInternal] = useState<string>(value ?? defaultValue ?? "");
  const iso = value !== undefined ? value : isoInternal;

  // Follow the parent when the value changes from the outside (e.g. a form
  // auto-filling an instalment's due date) — during render, so there is no
  // extra commit and no cascading effect.
  const [prevV, setPrevV] = useState<string | undefined>(value !== undefined ? value : defaultValue);
  const v = value !== undefined ? value : defaultValue;
  if (v !== prevV) {
    setPrevV(v);
    if (v && value === undefined) setIsoInternal(v);
  }

  const setIso = (newIso: string) => {
    if (value === undefined) setIsoInternal(newIso);
    onChange?.(newIso);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="label mb-0">{label}</label>
        <span className="text-[10px] text-[var(--sky-600)] font-semibold">تقویم جلالی دوران</span>
      </div>

      <div className={`grid grid-cols-1 ${showGregorian ? "sm:grid-cols-2" : ""} gap-2.5 items-start`}>
        {/* Doran Persian calendar picker */}
        <div>
          <div className="muted text-[10px] mb-1">انتخابگر تقویم شمسی (دوران)</div>
          <AppDoranDatePicker
            value={iso}
            onChange={setIso}
            required={required}
            placeholder="انتخاب از تقویم…"
          />
        </div>

        {/* Auto-computed Gregorian equivalent (hidden in the debt domain) */}
        {showGregorian && (
          <div>
            <div className="muted text-[10px] mb-1">معادل میلادی (LTR)</div>
            <input
              type="date"
              value={iso}
              onChange={(e) => setIso(e.target.value)}
              className="field num"
              dir="ltr"
              required={required}
            />
          </div>
        )}
      </div>

      {/* hidden field submitted to server */}
      <input type="hidden" name={name} value={iso} required={required} />
      {showGregorian && <DualDatePreview iso={iso} />}
    </div>
  );
}
