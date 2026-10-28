import Link from "next/link";
import { JALALI_MONTHS, formatMoney, jalaliToIso, jalaliWeekdayName, toFaDigits, toJalali } from "@/lib/format";

/**
 * «نقشهٔ هزینهٔ روزانه» — one Jalali year of spending, a cell per day (Kashi
 * «ActivityHeatmap»). Weeks run شنبه → جمعه, columns flow right to left with
 * the page. Four shades of the app's own «هزینه» colour; the steps are the
 * quartiles of the days that had spending, so one rent payment does not wash
 * every other day out to the palest shade.
 *
 * Screen readers get the year total as the grid's name and a table of the
 * month totals instead of 365 cells.
 */
const WEEKDAY_SHORT = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** شنبه = 0 … جمعه = 6 */
const satIndex = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 1) % 7;

export default function SpendHeatmap({
  year,
  days,
  today,
  hrefForYear,
}: {
  year: number;
  /** ISO day → Toman spent that day */
  days: Map<string, number>;
  today: string;
  hrefForYear: (y: number) => string;
}) {
  const start = jalaliToIso(year, 1, 1);
  const end = jalaliToIso(year + 1, 1, 1);
  const values = [...days.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))] ?? 0;
  const [q1, q2, q3] = [q(0.25), q(0.5), q(0.75)];
  const level = (v: number) => (v <= 0 ? 0 : v <= q1 ? 1 : v <= q2 ? 2 : v <= q3 ? 3 : 4);

  const cells: { iso: string | null; month?: number }[] = [];
  for (let i = 0; i < satIndex(start); i++) cells.push({ iso: null });
  for (let iso = start; iso < end; iso = addDays(iso, 1)) cells.push({ iso });
  const weeks = Math.ceil(cells.length / 7);

  // A month label sits over the week column its first day falls in.
  const monthCols: { col: number; m: number }[] = [];
  cells.forEach((c, i) => {
    if (c.iso && toJalali(c.iso).d === 1) monthCols.push({ col: Math.floor(i / 7), m: toJalali(c.iso).m });
  });

  const monthTotals = Array.from({ length: 12 }, () => 0);
  let total = 0;
  let peak: { iso: string; v: number } | null = null;
  for (const [iso, v] of days) {
    if (iso < start || iso >= end) continue;
    monthTotals[toJalali(iso).m - 1] += v;
    total += v;
    if (!peak || v > peak.v) peak = { iso, v };
  }
  const label = `هزینهٔ روزانهٔ سال ${toFaDigits(String(year))}: جمعاً ${formatMoney(Math.round(total), "IRT")}`;
  const thisYear = toJalali(today).y;

  return (
    <div id="heatmap" className="card heatmap scroll-mt-20">
      <div className="heatmap-head">
        <nav className="heatmap-years" aria-label="سال">
          <Link href={hrefForYear(year - 1)} className="btn btn-ghost !min-h-9 !px-3" aria-label="سال قبل">
            ‹ {toFaDigits(String(year - 1))}
          </Link>
          <b className="num">{toFaDigits(String(year))}</b>
          {year < thisYear ? (
            <Link href={hrefForYear(year + 1)} className="btn btn-ghost !min-h-9 !px-3" aria-label="سال بعد">
              {toFaDigits(String(year + 1))} ›
            </Link>
          ) : (
            <span className="heatmap-year-spacer" aria-hidden="true" />
          )}
        </nav>
        <span className="heatmap-total">
          جمع سال <b className="num money-nowrap" dir="rtl">{formatMoney(Math.round(total), "IRT")}</b>
          {peak && (
            <span className="heatmap-peak">
              پرخرج‌ترین روز {jalaliWeekdayName(peak.iso)} {toFaDigits(String(toJalali(peak.iso).d))} {JALALI_MONTHS[toJalali(peak.iso).m - 1]}
            </span>
          )}
        </span>
      </div>

      <div className="heatmap-scroll">
        <div className="heatmap-grid" role="img" aria-label={label} style={{ ["--weeks" as string]: weeks }}>
          <div className="heatmap-months" aria-hidden="true">
            {monthCols.map(({ col, m }) => (
              <span key={m} style={{ gridColumn: col + 1 }}>
                {JALALI_MONTHS[m - 1]}
              </span>
            ))}
          </div>
          <div className="heatmap-wd" aria-hidden="true">
            {WEEKDAY_SHORT.map((w, i) => (
              <span key={w}>{i % 2 === 0 ? w : ""}</span>
            ))}
          </div>
          <div className="heatmap-cells" aria-hidden="true">
            {cells.map((c, i) => {
              if (!c.iso) return <span key={`b${i}`} className="heatmap-cell" data-l="none" />;
              const v = days.get(c.iso) ?? 0;
              const future = c.iso > today;
              const { d, m } = toJalali(c.iso);
              return (
                <span
                  key={c.iso}
                  className="heatmap-cell"
                  data-l={future ? "future" : level(v)}
                  title={`${jalaliWeekdayName(c.iso)} ${toFaDigits(String(d))} ${JALALI_MONTHS[m - 1]}: ${v > 0 ? formatMoney(Math.round(v), "IRT") : "بدون هزینه"}`}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="heatmap-legend" aria-hidden="true">
        کمتر
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="heatmap-cell" data-l={l} />
        ))}
        بیشتر
      </div>

      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {monthTotals.map((v, i) => (
            <tr key={i}>
              <th scope="row">{JALALI_MONTHS[i]}</th>
              <td>{formatMoney(Math.round(v), "IRT")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
