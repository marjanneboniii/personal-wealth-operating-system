"use client";

import JalaliDatePicker from "./JalaliDatePicker";

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

/**
 * ورودی تاریخ شمسی — کاربر روز، ماه و سال را از فهرست انتخاب می‌کند و هیچ
 * تاریخی را دستی تایپ نمی‌کند. معادل میلادی (ISO) همان‌جا محاسبه می‌شود و در
 * فیلد مخفی برای سرور ارسال می‌گردد؛ یک کپی نمایشی شمسی هم زیر
 * `${name}Persian` ثبت می‌شود (ماژول املاک آن را نگه می‌دارد).
 * هیچ تاریخ میلادی‌ای در UI نشان داده نمی‌شود.
 */
export default function JalaliDateInput({
  name,
  label = "تاریخ (شمسی)",
  value,
  onChange,
  required,
  hint,
}: Props) {
  return (
    <div className="min-w-0">
      <label className="label">
        {label}
        {required && <span style={{ color: "var(--negative)" }}> *</span>}
      </label>
      <JalaliDatePicker
        name={name}
        submitPersian
        value={value}
        onChange={onChange}
        required={required}
        ariaLabel={label}
      />
      {hint && <div className="muted mt-1 text-[10px] leading-4">{hint}</div>}
    </div>
  );
}
