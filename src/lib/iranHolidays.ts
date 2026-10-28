import { jalaliWeekdayName, toJalali } from "@/lib/format";

/**
 * Iran's FIXED official holidays — solar dates that never move. Lunar
 * holidays (عید فطر، تاسوعا، عاشورا…) shift every year with moon sighting and
 * are announced by the official calendar, so they are deliberately left out:
 * a guessed date would mark the wrong day as «بانک تعطیل است».
 * Key: "month-day" in the Jalali calendar.
 */
const FIXED: Record<string, string> = {
  "1-1": "عید نوروز",
  "1-2": "عید نوروز",
  "1-3": "عید نوروز",
  "1-4": "عید نوروز",
  "1-12": "روز جمهوری اسلامی",
  "1-13": "روز طبیعت",
  "3-14": "رحلت امام خمینی",
  "3-15": "قیام ۱۵ خرداد",
  "11-22": "پیروزی انقلاب اسلامی",
  "12-29": "ملی شدن صنعت نفت",
};

export type IranHoliday = { name: string; friday: boolean };

/** The official occasion of a Gregorian ISO date, or «جمعه», or null on a working day. */
export function iranHoliday(iso: string): IranHoliday | null {
  if (!iso) return null;
  const { m, d } = toJalali(iso);
  const occasion = FIXED[`${m}-${d}`];
  const friday = jalaliWeekdayName(iso) === "جمعه";
  if (occasion) return { name: occasion, friday };
  return friday ? { name: "جمعه", friday: true } : null;
}
