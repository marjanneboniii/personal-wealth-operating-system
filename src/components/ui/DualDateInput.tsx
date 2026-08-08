"use client";

import { useState } from "react";
import { jalaliToIso, parseJalaliString, formatJalaliIso, toFaDigits } from "@/lib/format";
import { DualDatePreview } from "./SmartPreview";

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

  const onJalaliChange = (v: string) => {
    setJalali(v);
    const parsed = parseJalaliString(v);
    if (parsed) {
      const newIso = jalaliToIso(parsed.y, parsed.m, parsed.d);
      setIso(newIso);
    } else if (!v) {
      setIso("");
    }
  };

  return (
    <div className="space-y-2">
      <label className="label">{label}</label>
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
      {/* hidden field submitted to server */}
      <input type="hidden" name={name} value={iso} required={required} />
      <DualDatePreview iso={iso} />
    </div>
  );
}
