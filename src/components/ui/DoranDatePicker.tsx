"use client";

import React, { useState } from "react";
import { DoranDatePicker } from "@doranjs/react";
import { DoranDate } from "@doranjs/core";

type Props = {
  name?: string;
  value?: string; // Gregorian ISO "YYYY-MM-DD"
  defaultValue?: string; // Gregorian ISO "YYYY-MM-DD"
  onChange?: (iso: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
};

export default function AppDoranDatePicker({
  name,
  value,
  defaultValue,
  onChange,
  label,
  placeholder = "انتخاب تاریخ شمسی…",
  required = false,
  disabled = false,
  className = "",
}: Props) {
  // Store uncontrolled ISO date
  const [internalIso, setInternalIso] = useState<string>(defaultValue ?? "");
  const isoValue = value !== undefined ? value : internalIso;

  const handleDateChange = (_val: any, gregorian: Date | null) => {
    if (gregorian && !isNaN(gregorian.getTime())) {
      const year = gregorian.getFullYear();
      const month = String(gregorian.getMonth() + 1).padStart(2, "0");
      const day = String(gregorian.getDate()).padStart(2, "0");
      const iso = `${year}-${month}-${day}`;
      if (value === undefined) setInternalIso(iso);
      onChange?.(iso);
    } else {
      if (value === undefined) setInternalIso("");
      onChange?.("");
    }
  };

  // Convert current ISO to Date object for Doran
  const parsedDate = isoValue ? new Date(`${isoValue}T12:00:00Z`) : null;
  const doranDate = parsedDate && !isNaN(parsedDate.getTime()) ? DoranDate.fromGregorian(parsedDate) : null;

  return (
    <div className={`space-y-1.5 ${className}`}>
      {label && (
        <label className="block text-[0.78rem] font-medium text-[var(--slate-700)] dark:text-[var(--slate-300)]">
          {label}
        </label>
      )}
      <div className="relative">
        <DoranDatePicker
          value={doranDate}
          valueFormat="YYYY-MM-DD"
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          onChange={handleDateChange}
          className="w-full"
          classNames={{
            root: "w-full",
            trigger: "w-full !min-h-[42px] !border-[var(--line)] !bg-[var(--surface)] text-[var(--ink)] dark:text-[var(--text)] rounded-[var(--r-md)] transition-colors focus-within:!border-[var(--sky-500)] focus-within:!ring-2 focus-within:!ring-[var(--sky-500)]/20",
            input: "text-sm text-[var(--ink)] dark:text-[var(--text)] placeholder:text-[var(--slate-400)]",
            popover: "z-[9999] rounded-[var(--r-lg)] border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] dark:text-[var(--text)] shadow-xl",
          }}
        />
        {/* Hidden field for standard HTML form submission if name is provided */}
        {name && <input type="hidden" name={name} value={isoValue} />}
      </div>
    </div>
  );
}
