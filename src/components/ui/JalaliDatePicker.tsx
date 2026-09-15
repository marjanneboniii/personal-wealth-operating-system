"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Icon from "@/components/ui/Icon";
import {
  JALALI_MONTHS,
  formatDate,
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
 * تقویم شمسی — the ONLY date-entry widget in the app.
 *
 * A field shows the chosen day («۱۵ آذر ۱۴۰۱ · سه‌شنبه»); tapping it opens a
 * month calendar — a bottom sheet on phones and in the PWA, a centred dialog on
 * wider screens. The month and the year in its header are buttons of their
 * own, so a date years back is three taps away (سال → ماه → روز), not dozens
 * of month steps. Weeks start on شنبه and جمعه is marked as the holiday.
 *
 * Nothing is typed and no Gregorian date is ever picked: the Gregorian ISO is
 * derived with `jalaliToIso` and, outside the debt domain, echoed under the
 * field (`showGregorian`).
 *
 * Contract with the server is unchanged: forms receive the Gregorian
 * `YYYY-MM-DD` value under `name`, plus — when `submitPersian` is set — the
 * display copy under `${name}Persian` (e.g. "1404/05/20").
 *
 * The calendar is portalled to <body>: inside a Sheet, a `position: fixed`
 * panel would be trapped by the sheet's transform. Escape and Tab are handled
 * here and stopped, so an enclosing Sheet neither closes nor steals focus.
 */

export type JalaliDatePickerProps = {
  /** Gregorian ISO (YYYY-MM-DD) — controlled value. */
  value?: string;
  /** Gregorian ISO (YYYY-MM-DD) — uncontrolled initial value. */
  defaultValue?: string;
  /** Fired with the Gregorian ISO of the chosen day. */
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
   * Default TRUE; the debt screens (اقساط، تعهدات، سررسیدها) pass false.
   */
  showGregorian?: boolean;
  id?: string;
  /** Accessible name of the control (also the calendar's caption). */
  ariaLabel?: string;
  className?: string;
};

type View = "days" | "months" | "years";
type YearMonth = { y: number; m: number };

const WEEKDAY_INITIALS = ["ش", "ی", "د", "س", "چ", "پ", "ج"] as const;
const WEEKDAY_NAMES = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"] as const;
const YEARS_PER_PAGE = 12;
const GRID_CELLS = 42; // six weeks — the sheet keeps one height from month to month

function cleanIso(value?: string | null): string {
  const iso = (value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : "";
}

/** Column of a Gregorian ISO date in a Saturday-first week (شنبه = 0 … جمعه = 6). */
export function saturdayColumn(iso: string): number {
  return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;
}

/** Six weeks of one Jalali month: leading blanks (null), the days, trailing blanks. */
export function jalaliMonthCells(y: number, m: number): (number | null)[] {
  const lead = saturdayColumn(jalaliToIso(y, m, 1));
  const days = Array.from({ length: jalaliMonthLength(y, m) }, (_, i) => i + 1);
  const cells: (number | null)[] = [...Array.from({ length: lead }, () => null), ...days];
  while (cells.length < GRID_CELLS) cells.push(null);
  return cells;
}

function shiftMonth({ y, m }: YearMonth, delta: number): YearMonth {
  const index = y * 12 + (m - 1) + delta;
  return { y: Math.floor(index / 12), m: (index % 12) + 1 };
}

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const fa = (n: number) => toFaDigits(String(n));

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
  const [iso, setIso] = useState(() => cleanIso(value ?? defaultValue));

  // Follow the parent when the controlled value changes from the OUTSIDE
  // (e.g. TransactionForm auto-filling an instalment's due date) — done during
  // render so there is no extra commit and no cascading effect.
  const [prevValue, setPrevValue] = useState<string | undefined>(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setIso(cleanIso(value ?? defaultValue));
  }

  const today = useMemo(() => todayIso(), []);
  const todayJ = useMemo(() => toJalali(today), [today]);
  const selectedJ = iso ? toJalali(iso) : null;

  const lo = Math.min(yearFrom ?? todayJ.y - 70, selectedJ?.y ?? Infinity);
  const hi = Math.max(yearTo ?? todayJ.y + 25, selectedJ?.y ?? -Infinity);
  const inRange = (y: number) => y >= lo && y <= hi;
  const pageOf = (y: number) => y - ((y - lo) % YEARS_PER_PAGE);

  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  const [cursor, setCursor] = useState<YearMonth>({ y: todayJ.y, m: todayJ.m });
  const [focusDay, setFocusDay] = useState(1);
  const [yearPage, setYearPage] = useState(lo);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const validityRef = useRef<HTMLInputElement>(null);
  // Focus follows the calendar only after a keyboard move or a view change —
  // a click on «ماه بعد» keeps focus on that button so it can be pressed again.
  const moveFocus = useRef(false);

  const caption = ariaLabel ?? "تاریخ";

  const openCalendar = () => {
    if (disabled) return;
    const start = selectedJ ?? todayJ;
    const y = Math.min(hi, Math.max(lo, start.y));
    setCursor({ y, m: start.m });
    setFocusDay(y === start.y ? start.d : 1);
    setYearPage(pageOf(y));
    setView("days");
    moveFocus.current = true;
    setOpen(true);
  };

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const commit = (next: string) => {
    setIso(next);
    onChange?.(next);
    close();
  };

  const showView = (next: View) => {
    if (next === "years") setYearPage(pageOf(cursor.y));
    moveFocus.current = true;
    setView(next);
  };

  const goToMonth = (next: YearMonth) => {
    if (!inRange(next.y)) return;
    setCursor(next);
    setFocusDay((d) => Math.min(d, jalaliMonthLength(next.y, next.m)));
  };

  const moveDay = (delta: number) => {
    const j = toJalali(addDays(jalaliToIso(cursor.y, cursor.m, focusDay), delta));
    if (!inRange(j.y)) return;
    moveFocus.current = true;
    setCursor({ y: j.y, m: j.m });
    setFocusDay(j.d);
  };

  const step = (direction: -1 | 1) => {
    if (view === "days") goToMonth(shiftMonth(cursor, direction));
    else if (view === "months") goToMonth({ y: cursor.y + direction, m: cursor.m });
    else setYearPage((p) => p + direction * YEARS_PER_PAGE);
  };
  const canStep = (direction: -1 | 1) =>
    view === "days"
      ? inRange(shiftMonth(cursor, direction).y)
      : view === "months"
        ? inRange(cursor.y + direction)
        : direction < 0
          ? yearPage > lo
          : yearPage + YEARS_PER_PAGE <= hi;

  useEffect(() => {
    validityRef.current?.setCustomValidity(iso ? "" : "لطفاً تاریخ را انتخاب کنید.");
  }, [iso, required]);

  useEffect(() => {
    if (!open) return;
    const body = document.body.style;
    const previous = body.overflow;
    body.overflow = "hidden";
    return () => {
      body.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !moveFocus.current) return;
    moveFocus.current = false;
    const panel = panelRef.current;
    (panel?.querySelector<HTMLElement>('[data-active="true"]') ?? panel)?.focus({ preventScroll: true });
  }, [open, view, cursor, focusDay]);

  const onPanelKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" || e.key === "Tab") {
      // The app root listens on `document` too (Sheet's Escape + focus trap):
      // this calendar is the top-most dialog, so the key ends here.
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      const items = [...(panelRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])].filter(
        (el) => el.tabIndex >= 0,
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (view !== "days" || !(e.target as HTMLElement).dataset.day) return;
    // RTL: the next day sits to the LEFT.
    const moves: Record<string, number> = { ArrowLeft: 1, ArrowRight: -1, ArrowDown: 7, ArrowUp: -7 };
    if (e.key in moves) {
      e.preventDefault();
      moveDay(moves[e.key]);
    } else if (e.key === "PageUp" || e.key === "PageDown") {
      e.preventDefault();
      moveFocus.current = true;
      goToMonth(shiftMonth(cursor, e.key === "PageUp" ? -1 : 1));
    }
  };

  const weekday = iso ? jalaliWeekdayName(iso) : "";

  const calendar = open ? (
    <div className="jdp-overlay" dir="rtl">
      <div className="jdp-scrim" aria-hidden="true" onClick={close} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={caption}
        tabIndex={-1}
        className="jdp-panel sheet-in"
        onKeyDown={onPanelKeyDown}
      >
        <div className="jdp-grabber" aria-hidden="true" />
        <div className="jdp-caption">
          <span className="muted">{caption}</span>
          {iso && <b className="num">{formatDate(iso)}</b>}
        </div>

        <div className="jdp-head">
          <div className="jdp-titles">
            {view === "years" ? (
              <span className="jdp-title num" aria-live="polite">
                {fa(yearPage)} – {fa(Math.min(hi, yearPage + YEARS_PER_PAGE - 1))}
              </span>
            ) : (
              <>
                {view === "days" && (
                  <button
                    type="button"
                    className="jdp-title"
                    aria-label={`ماه: ${JALALI_MONTHS[cursor.m - 1]} — انتخاب ماه`}
                    onClick={() => showView("months")}
                  >
                    {JALALI_MONTHS[cursor.m - 1]}
                    <Icon name="chevronDown" size={14} />
                  </button>
                )}
                <button
                  type="button"
                  className="jdp-title num"
                  aria-label={`سال: ${fa(cursor.y)} — انتخاب سال`}
                  onClick={() => showView("years")}
                >
                  {fa(cursor.y)}
                  <Icon name="chevronDown" size={14} />
                </button>
              </>
            )}
          </div>
          <div className="jdp-nav">
            <button
              type="button"
              className="jdp-navbtn"
              onClick={() => step(-1)}
              disabled={!canStep(-1)}
              aria-label={view === "days" ? "ماه قبل" : view === "months" ? "سال قبل" : "سال‌های قبل"}
            >
              <Icon name="chevronRight" size={18} />
            </button>
            <button
              type="button"
              className="jdp-navbtn"
              onClick={() => step(1)}
              disabled={!canStep(1)}
              aria-label={view === "days" ? "ماه بعد" : view === "months" ? "سال بعد" : "سال‌های بعد"}
            >
              <Icon name="chevronLeft" size={18} />
            </button>
          </div>
        </div>

        {view === "days" && (
          <div className="jdp-days" role="group" aria-label={`${JALALI_MONTHS[cursor.m - 1]} ${fa(cursor.y)}`}>
            {WEEKDAY_INITIALS.map((w, col) => (
              <span key={w} className={`jdp-wd${col === 6 ? " is-holiday" : ""}`} aria-hidden="true">
                {w}
              </span>
            ))}
            {jalaliMonthCells(cursor.y, cursor.m).map((day, i) => {
              if (day === null) return <span key={`blank-${i}`} aria-hidden="true" />;
              const cellIso = jalaliToIso(cursor.y, cursor.m, day);
              const col = i % 7;
              const active = day === focusDay;
              return (
                <button
                  key={day}
                  type="button"
                  data-day={day}
                  data-active={active ? "true" : undefined}
                  tabIndex={active ? 0 : -1}
                  className={`jdp-day${cellIso === today ? " is-today" : ""}${col === 6 ? " is-holiday" : ""}`}
                  aria-pressed={cellIso === iso}
                  aria-current={cellIso === today ? "date" : undefined}
                  aria-label={`${formatDate(cellIso)}، ${WEEKDAY_NAMES[col]}`}
                  onClick={() => commit(cellIso)}
                >
                  {fa(day)}
                </button>
              );
            })}
          </div>
        )}

        {view === "months" && (
          <div className="jdp-cells" role="group" aria-label={`ماه‌های سال ${fa(cursor.y)}`}>
            {JALALI_MONTHS.map((label, i) => {
              const m = i + 1;
              return (
                <button
                  key={label}
                  type="button"
                  data-active={m === cursor.m ? "true" : undefined}
                  className={`jdp-cell${todayJ.y === cursor.y && todayJ.m === m ? " is-current" : ""}`}
                  aria-pressed={selectedJ?.y === cursor.y && selectedJ.m === m}
                  onClick={() => {
                    goToMonth({ y: cursor.y, m });
                    showView("days");
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}

        {view === "years" && (
          <div className="jdp-cells" role="group" aria-label="انتخاب سال">
            {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearPage + i)
              .filter(inRange)
              .map((y) => (
                <button
                  key={y}
                  type="button"
                  data-active={y === cursor.y ? "true" : undefined}
                  className={`jdp-cell num${y === todayJ.y ? " is-current" : ""}`}
                  aria-pressed={selectedJ?.y === y}
                  onClick={() => {
                    goToMonth({ y, m: cursor.m });
                    showView("months");
                  }}
                >
                  {fa(y)}
                </button>
              ))}
          </div>
        )}

        <div className="jdp-foot">
          {showToday && inRange(todayJ.y) && (
            <button type="button" className="btn btn-soft" onClick={() => commit(today)}>
              امروز
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={close}>
            بستن
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className={className ? `jalali-date-picker ${className}` : "jalali-date-picker"} dir="rtl">
      <div className="jdp-anchor">
        <button
          ref={triggerRef}
          type="button"
          id={id}
          className="field jdp-trigger"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`${caption}: ${iso ? `${formatDate(iso)}، ${weekday}` : "انتخاب نشده"}`}
          onClick={openCalendar}
        >
          <Icon name="calendar" size={16} />
          <span className="jdp-trigger-text">
            {iso ? (
              <>
                <b className="num">{formatDate(iso)}</b>
                {weekday && <span className="jdp-trigger-sub">{weekday}</span>}
              </>
            ) : (
              <span className="jdp-placeholder">انتخاب تاریخ</span>
            )}
          </span>
          <Icon name="chevronDown" size={14} />
        </button>
        {/* Hidden inputs are never validated by the browser, so a required
            picker keeps an invisible stand-in that blocks an empty submit. */}
        {required && !disabled && (
          <input
            ref={validityRef}
            className="jdp-validity"
            tabIndex={-1}
            aria-hidden="true"
            value={iso}
            onChange={() => undefined}
          />
        )}
      </div>

      {showGregorian && iso && (
        <div className="muted mt-1 text-[length:var(--fs-xs)] leading-4">
          میلادی (خودکار):{" "}
          <b className="num ltr-isolate" dir="ltr" style={{ color: "var(--text-2)" }}>
            {formatGregorianIso(iso)}
          </b>
        </div>
      )}

      {/* The server keeps receiving the Gregorian ISO value it always received. */}
      {name && <input type="hidden" name={name} value={iso} />}
      {name && submitPersian && <input type="hidden" name={`${name}Persian`} value={iso ? formatJalaliIso(iso, "en") : ""} />}

      {calendar && createPortal(calendar, document.body)}
    </div>
  );
}
