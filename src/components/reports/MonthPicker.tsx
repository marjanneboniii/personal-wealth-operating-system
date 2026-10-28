import Link from "next/link";
import { JALALI_MONTHS, toFaDigits } from "@/lib/format";

/**
 * «انتخاب ماه» (Kashi «MonthPicker») — a year header with previous / next and
 * a 3×4 grid of the Jalali months. Plain links, so it works before any script
 * loads; the chosen month is `aria-current`, months after this one are not
 * links at all.
 */
export default function MonthPicker({
  year,
  selected,
  current,
  href,
}: {
  year: number;
  /** The month shown, «1405-08»-style key parts. */
  selected: { y: number; m: number };
  /** Today's Jalali month — the last one that can be picked. */
  current: { y: number; m: number };
  href: (y: number, m: number) => string;
}) {
  const after = (y: number, m: number) => y > current.y || (y === current.y && m > current.m);
  return (
    <nav className="month-picker" aria-label="انتخاب ماه گزارش">
      <div className="month-picker-head">
        <Link href={href(year - 1, 12)} className="month-picker-nav" aria-label="سال قبل">
          ›
        </Link>
        <b className="num">{toFaDigits(String(year))}</b>
        {year < current.y ? (
          <Link href={href(year + 1, 1)} className="month-picker-nav" aria-label="سال بعد">
            ‹
          </Link>
        ) : (
          <span className="month-picker-nav" aria-hidden="true" />
        )}
      </div>
      <div className="month-picker-grid">
        {JALALI_MONTHS.map((name, i) => {
          const m = i + 1;
          const isSel = selected.y === year && selected.m === m;
          const isNow = current.y === year && current.m === m;
          if (after(year, m)) {
            return (
              <span key={name} className="month-picker-cell" aria-disabled="true">
                {name}
              </span>
            );
          }
          return (
            <Link
              key={name}
              href={href(year, m)}
              className="month-picker-cell"
              aria-current={isSel ? "page" : undefined}
              data-now={isNow || undefined}
              aria-label={`${name} ${toFaDigits(String(year))}`}
            >
              {name}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
