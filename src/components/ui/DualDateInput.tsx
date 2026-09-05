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
};

/**
 * ورودی تاریخ فرم‌ها — «دوگانه» فقط به معنای نمایش/ذخیره است:
 * کاربر تاریخ را با انتخاب‌گر شمسی (روز / ماه / سال) انتخاب می‌کند و هیچ تاریخ
 * لاتینی تایپ یا نمایش داده نمی‌شود؛ معادل میلادی (ISO) محاسبه شده و در فیلد
 * مخفی به سرور می‌رود، همان‌طور که همه server actionها انتظار دارند.
 */
export default function DualDateInput({
  name,
  defaultValue,
  value,
  onChange,
  label = "تاریخ",
  required,
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
        ariaLabel={label}
      />
    </div>
  );
}
