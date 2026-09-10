"use client";

import { useMemo, useState } from "react";
import {
  JALALI_MONTHS,
  clampJalaliDay,
  currentJalaliYear,
  formatGregorianIso,
  formatJalaliIso,
  jalaliMonthLength,
  jalaliToIso,
  jalaliWeekdayName,
  toFaDigits,
  toJalali,
  todayIso,
} from "@/lib/format";

/**
 * انتخاب‌گر تاریخ شمسی — روز / ماه / سال، بدون تایپ دستی.
 *
 * The ONLY date-entry widget in the app. The user picks three values from
 * native <select> lists (Persian digits, Persian month names); the Gregorian
 * ISO equivalent is computed with `jalaliToIso` and leaves the component
 * through `onChange` and/or a hidden form field. No date string is ever typed,
 * and the user can never PICK a Gregorian date — outside the debt domain the
 * widget only echoes the ISO equivalent the app derived on its own.
 *
 * Contract with the server is unchanged: forms still receive the Gregorian
 * `YYYY-MM-DD` value under `name`, plus — when `submitPersian` is set — the
 * display copy under `${name}Persian` (e.g. "1404/05/20") that the real-estate
 * module persists next to the ISO date.
 */

export type JalaliDatePickerProps = {
  /** Gregorian ISO (YYYY-MM-DD) — controlled value. */
  value?: string;
  /** Gregorian ISO (YYYY-MM-DD) — uncontrolled initial value. */
  defaultValue?: string;
  /** Fired with the Gregorian ISO once year + month + day are all chosen. */
  onChange?: (iso: string) => void;
  /** When set, a hidden input with this name submits the ISO value. */
  name?: string;
  /** Also submit `${name}Persian` ("1404/05/20") for the audit/display copy. */
  submitPersian?: boolean;
  required?: boolean;
  disabled?: boolean;
  /** Inclusive Jalali year window. Defaults to a wide window around today. */
  yearFrom?: number;
  yearTo?: number;
  /** Show the «امروز» shortcut. Default true. */
  showToday?: boolean;
  /**
   * Echo the Gregorian equivalent the app computed for the chosen Jalali day.
   *
   * Default TRUE: the user only ever PICKS a Jalali date, but outside the debt
   * domain the app shows the ISO equivalent it derived automatically. The debt
   * screens (اقساط، تعهدات، سررسیدها) pass `showGregorian={false}` — there the
   * Jalali date is the whole story.
   */
  showGregorian?: boolean;
  id?: string;
  /** Accessible name of the whole control (also used by the group role). */
  ariaLabel?: string;
  className?: string;
};

type Parts = { y: number | null; m: number | null; d: number | null };

function partsFromIso(iso: string | undefined | null): Parts {
  if (!iso) return { y: null, m: null, d: null };
  const j = toJalali(iso);
  return { y: j.y, m: j.m, d: j.d };
}

export default function JalaliDatePicker({
  value,
  defaultValue,
  onChange,
  name,
  submitPersian,
  required,
  disabled,
  yearFrom,
  yearTo,
  showToday = true,
  showGregorian = true,
  id,
  ariaLabel,
  className,
}: JalaliDatePickerProps) {
  // The three selects are the single source of truth; the Gregorian ISO is
  // always derived from them, so a controlled and an uncontrolled use of this
  // widget behave identically.
  const [parts, setParts] = useState<Parts>(() => partsFromIso(value ?? defaultValue));

  // Follow the parent when the controlled value changes from the OUTSIDE
  // (e.g. TransactionForm auto-filling an instalment's due date) — done during
  // render so there is no extra commit and no cascading effect.
  //
  // Echoes of our own `onChange` are ignored on purpose: while the user is
  // mid-selection (only «سال» picked) the ISO is still empty, and letting the
  // parent's "" flow back would wipe the partial choice.
  const [prevValue, setPrevValue] = useState<string | undefined>(value);
  const [lastEmitted, setLastEmitted] = useState<string>("");
  if (value !== prevValue) {
    setPrevValue(value);
    if ((value ?? "") !== lastEmitted) setParts(partsFromIso(value ?? defaultValue));
  }

  // What the form submits: a complete selection, otherwise nothing.
  const complete = Boolean(parts.y && parts.m && parts.d);
  const iso = complete ? jalaliToIso(parts.y as number, parts.m as number, parts.d as number) : "";

  const emit = (next: Parts) => {
    setParts(next);
    const done = Boolean(next.y && next.m && next.d);
    const nextIso = done ? jalaliToIso(next.y as number, next.m as number, next.d as number) : "";
    setLastEmitted(nextIso);
    onChange?.(nextIso);
  };

  const onYear = (raw: string) => {
    const y = raw ? Number(raw) : null;
    // Re-clamp the day: ۳۰ اسفند of a leap year is not valid in a common one.
    emit({ ...parts, y, d: clampJalaliDay(y, parts.m, parts.d) });
  };

  const onMonth = (raw: string) => {
    const m = raw ? Number(raw) : null;
    // Re-clamp the day: ۳۱ مرداد cannot survive a switch to شهریور.
    emit({ ...parts, m, d: clampJalaliDay(parts.y, m, parts.d) });
  };

  const onDay = (raw: string) => emit({ ...parts, d: raw ? Number(raw) : null });

  const todayParts = useMemo(() => partsFromIso(todayIso()), []);
  const selectedYear = parts.y ?? todayParts.y ?? currentJalaliYear();

  const years = useMemo(() => {
    const nowY = todayParts.y ?? currentJalaliYear();
    const lo = Math.min(yearFrom ?? nowY - 70, selectedYear);
    const hi = Math.max(yearTo ?? nowY + 25, selectedYear);
    const list: number[] = [];
    for (let y = hi; y >= lo; y--) list.push(y);
    return list;
  }, [yearFrom, yearTo, selectedYear, todayParts.y]);

  const dayCount = parts.y && parts.m ? jalaliMonthLength(parts.y, parts.m) : 31;
  const weekday = complete ? jalaliWeekdayName(iso) : "";

  const selectProps = {
    className: "field num jalali-picker-select",
    disabled,
  };

  return (
    <div className={className ? `jalali-date-picker ${className}` : "jalali-date-picker"} dir="rtl">
      <div
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,0.72fr)] gap-1.5"
        role="group"
        aria-label={ariaLabel ?? "تاریخ شمسی"}
      >
        {/* DOM order = visual right-to-left order: سال / ماه / روز (۱۴۰۴/۰۶/۱۴) */}
        <select
          {...selectProps}
          id={id}
          aria-label={(ariaLabel ? `${ariaLabel} — ` : "") + "سال"}
          value={parts.y ?? ""}
          onChange={(e) => onYear(e.target.value)}
          required={required}
        >
          <option value="">سال</option>
          {years.map((y) => (
            <option key={y} value={y}>
              {toFaDigits(String(y))}
            </option>
          ))}
        </select>

        <select
          {...selectProps}
          aria-label={(ariaLabel ? `${ariaLabel} — ` : "") + "ماه"}
          value={parts.m ?? ""}
          onChange={(e) => onMonth(e.target.value)}
          required={required}
        >
          <option value="">ماه</option>
          {JALALI_MONTHS.map((label, i) => (
            <option key={label} value={i + 1}>
              {label}
            </option>
          ))}
        </select>

        <select
          {...selectProps}
          aria-label={(ariaLabel ? `${ariaLabel} — ` : "") + "روز"}
          value={parts.d ?? ""}
          onChange={(e) => onDay(e.target.value)}
          required={required}
        >
          <option value="">روز</option>
          {Array.from({ length: dayCount }, (_, i) => i + 1).map((d) => (
            <option key={d} value={d}>
              {toFaDigits(String(d))}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-1 space-y-0.5">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <span className="muted text-[length:var(--fs-xs)] leading-4">
            {complete ? (
              <>
                <span className="num" dir="rtl" style={{ color: "var(--text-2)" }}>
                  {toFaDigits(formatJalaliIso(iso, "en"))}
                </span>
                {weekday && <> — {weekday}</>}
              </>
            ) : (
              "روز، ماه و سال را انتخاب کنید"
            )}
          </span>
          {showToday && !disabled && (
            <button
              type="button"
              className="btn btn-ghost !min-h-7 !px-2 !py-0.5 text-[length:var(--fs-xs)]"
              onClick={() => emit(partsFromIso(todayIso()))}
            >
              امروز
            </button>
          )}
        </div>
        {showGregorian && complete && (
          <div className="muted text-[length:var(--fs-xs)] leading-4">
            میلادی (خودکار):{" "}
            <b className="num ltr-isolate" dir="ltr" style={{ color: "var(--text-2)" }}>
              {formatGregorianIso(iso)}
            </b>
          </div>
        )}
      </div>

      {/* The server keeps receiving the Gregorian ISO value it always received. */}
      {name && <input type="hidden" name={name} value={iso} required={required} />}
      {name && submitPersian && (
        <input
          type="hidden"
          name={`${name}Persian`}
          value={complete ? formatJalaliIso(iso, "en") : ""}
        />
      )}
    </div>
  );
}
