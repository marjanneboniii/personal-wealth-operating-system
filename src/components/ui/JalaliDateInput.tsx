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
  /** Echo the auto-computed Gregorian equivalent. Default true. */
  showGregorian?: boolean;
};

/**
 * ورودی تاریخ شمسی — کاربر روز، ماه و سال را از فهرست انتخاب می‌کند و هیچ
 * تاریخی را دستی تایپ نمی‌کند. معادل میلادی (ISO) همان‌جا محاسبه می‌شود و در
 * فیلد مخفی برای سرور ارسال می‌گردد؛ یک کپی نمایشی شمسی هم زیر
 * `${name}Persian` ثبت می‌شود (ماژول املاک آن را نگه می‌دارد).
 * کاربر هرگز تاریخ میلادی انتخاب نمی‌کند؛ اپ معادل میلادی همان روز را خودش
 * محاسبه کرده و (به‌صورت پیش‌فرض) زیر ویجت نشان می‌دهد.
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
        showGregorian={showGregorian}
        ariaLabel={label}
      />
      {hint && <div className="muted mt-1 text-[10px] leading-4">{hint}</div>}
    </div>
  );
}
