/**
 * Monthly recurrence in the calendar people are paid in: the Jalali month.
 * A salary on «۲۵ هر ماه» stays on the 25th; a day beyond the month's length
 * (۳۱ in a 30-day month) lands on its last day. PURE.
 */
import { jalaliMonthLength, jalaliToIso, toJalali } from "@/lib/format";

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

/**
 * `months` Jalali months after `iso`, on the Jalali day `day` (default: its
 * own), clamped to the target month's real length — leap Esfand included.
 * Used for premiums every 1, 3 or 12 months and a car's yearly inspection.
 */
export function addJalaliMonths(iso: string, months: number, day?: number): string {
  const { y, m, d } = toJalali(iso);
  const index = y * 12 + (m - 1) + months;
  const ny = Math.floor(index / 12);
  const nm = (index % 12) + 1;
  return jalaliToIso(ny, nm, Math.min(day ?? d, jalaliMonthLength(ny, nm)));
}
