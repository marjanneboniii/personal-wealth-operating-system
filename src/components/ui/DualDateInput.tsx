"use client";

import JalaliDatePicker from "./JalaliDatePicker";

type Props = {
  /** Form field name — submits the Gregorian ISO value to the server. */
  name: string;
  defaultValue?: string; // ISO YYYY-MM-DD
  value?: string;
  onChange?: (iso: string) => void;
  label?: string;
  required?: boolean;
  /**
   * Echo the auto-computed Gregorian equivalent under the Jalali picker.
   * Default true; the debt screens (اقساط / تعهدات / سررسید) pass false.
   */
  showGregorian?: boolean;
};

/**
 * ورودی تاریخ فرم‌ها — «دوگانه» فقط به معنای نمایش/ذخیره است:
 * کاربر تاریخ را فقط با انتخاب‌گر شمسی (روز / ماه / سال) انتخاب می‌کند و هرگز
 * تاریخ میلادی تایپ یا انتخاب نمی‌کند. معادل میلادی (ISO) خودکار محاسبه شده و
 * در فیلد مخفی به سرور می‌رود، همان‌طور که همه server actionها انتظار دارند؛
 * بیرون از دامنه بدهی همان معادل به‌صورت خودکار زیر ویجت نمایش داده می‌شود
 * (`showGregorian={false}` آن را خاموش می‌کند).
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
  return (
    <div className="space-y-2">
      <label className="label">{label}</label>
      <JalaliDatePicker
        name={name}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        required={required}
        showGregorian={showGregorian}
        ariaLabel={label}
      />
    </div>
  );
}
