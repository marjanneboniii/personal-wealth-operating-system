"use client";

import { useSyncExternalStore } from "react";
import { readPrivacy, readThemeMode, setPrivacy, setThemeMode, subscribeDisplay, type ThemeMode } from "@/lib/displayPrefs";

const MODES: [ThemeMode, string][] = [
  ["light", "روشن"],
  ["dark", "تاریک"],
  ["system", "مثل دستگاه"],
];

/** «نمایش» — theme (with «مثل دستگاه») and privacy mode, both kept on this device only. */
export default function DisplaySettings() {
  const mode = useSyncExternalStore(subscribeDisplay, readThemeMode, () => "system" as ThemeMode);
  const privacy = useSyncExternalStore(subscribeDisplay, readPrivacy, () => false);
  return (
    <div className="card expense-card grid gap-4">
      <div className="grid gap-2">
        <b className="text-[length:var(--fs-sm)]">پوسته</b>
        <div className="expense-seg" role="group" aria-label="پوسته">
          {MODES.map(([key, text]) => (
            <button key={key} type="button" data-on={mode === key || undefined} aria-pressed={mode === key} onClick={() => setThemeMode(key)}>
              {text}
            </button>
          ))}
        </div>
        <span className="expense-sub">«مثل دستگاه» با تغییر حالت شب و روز گوشی یا رایانه خودش عوض می‌شود.</span>
      </div>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} />
        <span>
          <b className="block text-[length:var(--fs-sm)]">پنهان کردن مبالغ</b>
          <span className="expense-sub block">همه‌ی اعداد روی همین دستگاه محو می‌شوند؛ برای باز کردن برنامه جلوی دیگران. با آیکون چشم در نوار بالا هم روشن و خاموش می‌شود.</span>
        </span>
      </label>
    </div>
  );
}
