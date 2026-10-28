import { JALALI_MONTHS, formatGregorianIso, jalaliWeekdayName, toFaDigits, toJalali } from "@/lib/format";
import { iranHoliday } from "@/lib/iranHolidays";

/**
 * «برگ تقویم» — one Jalali date as a desk-calendar leaf: month and year on the
 * ink strip, the day large, the weekday under it. جمعه and the fixed official
 * holidays turn the strip and the day red and name their occasion, so a due
 * date on a closed bank day is visible at a glance. Colours are the app's own
 * tokens only, so the leaf follows the light and dark themes.
 */
export default function DateTile({
  iso,
  size = "md",
  gregorian = false,
  className = "",
}: {
  iso: string;
  size?: "sm" | "md" | "lg";
  gregorian?: boolean;
  className?: string;
}) {
  const { y, m, d } = toJalali(iso);
  const holiday = iranHoliday(iso);
  const occasion = holiday && holiday.name !== "جمعه" ? holiday.name : null;
  return (
    <time
      dateTime={iso.slice(0, 10)}
      className={`date-tile${className ? ` ${className}` : ""}`}
      data-size={size}
      data-holiday={holiday ? "true" : undefined}
      title={occasion ?? undefined}
    >
      <span className="date-tile-head">
        {JALALI_MONTHS[m - 1]}
        {size !== "sm" && <span className="num"> {toFaDigits(String(y))}</span>}
      </span>
      <span className="date-tile-day num">{toFaDigits(String(d))}</span>
      <span className="date-tile-wd">{jalaliWeekdayName(iso)}</span>
      {size !== "sm" && occasion && <span className="date-tile-occasion">{occasion}</span>}
      {size !== "sm" && gregorian && <span className="date-tile-greg num">{formatGregorianIso(iso)}</span>}
    </time>
  );
}
