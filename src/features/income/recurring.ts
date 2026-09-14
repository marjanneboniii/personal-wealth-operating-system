/**
 * Monthly recurrence in the calendar people are paid in: the Jalali month.
 * A salary on «۲۵ هر ماه» stays on the 25th; a day beyond the month's length
 * (۳۱ in a 30-day month) lands on its last day. PURE.
 */
import { jalaliToIso, toJalali } from "@/lib/format";

const jalaliMonthDays = (month: number) => (month <= 6 ? 31 : month <= 11 ? 30 : 29);

export function clampDayOfMonth(day: number): number {
  return Math.min(31, Math.max(1, Math.trunc(Number.isFinite(day) ? day : 1)));
}

/** The next monthly occurrence after `isoDate`, on `dayOfMonth` (Jalali). */
export function nextMonthlyDate(isoDate: string, dayOfMonth: number): string {
  const { y, m } = toJalali(isoDate);
  const nextYear = m === 12 ? y + 1 : y;
  const nextMonth = m === 12 ? 1 : m + 1;
  return jalaliToIso(nextYear, nextMonth, Math.min(clampDayOfMonth(dayOfMonth), jalaliMonthDays(nextMonth)));
}

/** Jalali day of month of an ISO date. */
export function jalaliDayOf(isoDate: string): number {
  return toJalali(isoDate).d;
}
