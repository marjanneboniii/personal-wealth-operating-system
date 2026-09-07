"use client";

import { useState } from "react";
import { jalaliToIso, parseJalaliString, formatJalaliIso } from "@/lib/format";
import { DualDatePreview } from "./SmartPreview";
import AppDoranDatePicker from "./DoranDatePicker";

type Props = {
  name: string; // gregorian ISO field name submitted to server
  defaultValue?: string; // ISO YYYY-MM-DD
  value?: string;
  onChange?: (iso: string) => void;
  label?: string;
  required?: boolean;
};

export default function DualDateInput({ name, defaultValue, value, onChange, label = "تاریخ", required }: Props) {
  const [isoInternal, setIsoInternal] = useState<string>(value ?? defaultValue ?? "");
  const [jalali, setJalali] = useState<string>((value ?? defaultValue) ? formatJalaliIso((value ?? defaultValue) as string, "en") : "");

  const iso = value !== undefined ? value : isoInternal;

  // Sync from parent changes during render
  const [prevV, setPrevV] = useState<string | undefined>(value !== undefined ? value : defaultValue);
  const v = value !== undefined ? value : defaultValue;
  if (v !== prevV) {
    setPrevV(v);
    if (v) {
      if (value === undefined) setIsoInternal(v);
      setJalali(formatJalaliIso(v, "en"));
    }
  }

  const setIso = (newIso: string) => {
    if (value === undefined) setIsoInternal(newIso);
    onChange?.(newIso);
  };

  const handleDoranChange = (newIso: string) => {
    setIso(newIso);
    if (newIso) setJalali(formatJalaliIso(newIso, "en"));
    else setJalali("");
  };

  const onIsoChange = (v: string) => {
    setIso(v);
    if (v) setJalali(formatJalaliIso(v, "en"));
    else setJalali("");
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="label mb-0">{label}</label>
        <span className="text-[10px] text-[var(--sky-600)] font-semibold">تقویم جلالی دوران</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-start">
        {/* Doran Persian Calendar Date Picker */}
        <div>
          <div className="muted text-[10px] mb-1">انتخابگر تقویم شمسی (دوران)</div>
          <AppDoranDatePicker
            value={iso}
            onChange={handleDoranChange}
            required={required}
            placeholder="انتخاب از تقویم…"
          />
        </div>

        {/* Gregorian ISO field */}
        <div>
          <div className="muted text-[10px] mb-1">معادل میلادی (LTR)</div>
          <input
            type="date"
            value={iso}
            onChange={(e) => onIsoChange(e.target.value)}
            className="field num"
            dir="ltr"
            required={required}
          />
        </div>
      </div>

      {/* hidden field submitted to server */}
      <input type="hidden" name={name} value={iso} required={required} />
      <DualDatePreview iso={iso} />
    </div>
  );
}
