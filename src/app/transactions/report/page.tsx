import Link from "next/link";
import type { CSSProperties } from "react";
import { ensureAuth } from "@/lib/authGuard";
import { getTransactions } from "@/features/ledger/queries";
import {
  buildMonthlyReport,
  parseReportMonth,
  reportMonthKey,
  reportMonthRange,
  shiftReportMonth,
  type CategoryShare,
  type ReportMonth,
  type ReportRow,
} from "@/features/ledger/monthlyReport";
import BrandMark from "@/components/layout/BrandMark";
import Icon from "@/components/ui/Icon";
import FormattedMoney from "@/components/ui/FormattedMoney";
import ReportPrint from "@/components/transactions/ReportPrint";
import { D } from "@/domain/decimal";
import { JALALI_MONTHS, faCount, formatJalaliIso, formatMoney, formatPct, toFaDigits, toJalali, todayIso } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** getTransactions caps a page at 500 — far above a household month; hitting it is said out loud. */
const ROW_CAP = 500;
/** Sub-categories shown under each expense group. */
const LEAVES_PER_GROUP = 3;

function monthOf(sp: Record<string, string | string[] | undefined>): ReportMonth {
  const parsed = parseReportMonth(typeof sp.month === "string" ? sp.month : null);
  if (parsed) return parsed;
  const { y, m } = toJalali(todayIso());
  return { y, m };
}

const monthName = ({ y, m }: ReportMonth) => toFaDigits(`${JALALI_MONTHS[m - 1]} ${y}`);

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }) {
  // The title is the PDF's file name in «Save as PDF».
  return { title: `گزارش ماهانه ${monthName(monthOf(await searchParams))}` };
}

const toman = (value: string) => <FormattedMoney value={formatMoney(value, "IRT")} />;

function Shares({ items, leaves }: { items: CategoryShare[]; leaves: boolean }) {
  return (
    <ol className="mrep-shares">
      {items.map((g) => (
        <li key={g.name}>
          <div className="mrep-share">
            <span className="mrep-share-name">{g.name}</span>
            <span className="mrep-share-pct num">{formatPct(g.share * 100, 0)}</span>
            <span className="mrep-share-amount money-nowrap">{toman(g.toman)}</span>
            <span className="mrep-bar" aria-hidden="true">
              <span style={{ inlineSize: `${Math.max(g.share * 100, 1)}%` }} />
            </span>
          </div>
          {leaves && g.leaves.length > 1 && (
            <p className="mrep-leaves">
              {g.leaves.slice(0, LEAVES_PER_GROUP).map((l, i) => (
                <span key={l.name}>
                  {i > 0 && "، "}
                  {l.name} <span className="money-nowrap">{toman(l.toman)}</span>
                </span>
              ))}
              {g.leaves.length > LEAVES_PER_GROUP && ` و ${faCount(g.leaves.length - LEAVES_PER_GROUP)} مورد دیگر`}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

function Amount({ row }: { row: ReportRow }) {
  if (!row.toman) return <span className="mrep-muted">—</span>;
  const sign = row.sign > 0 ? "+" : row.sign < 0 ? "−" : "";
  return (
    <span className="money-nowrap" data-sign={row.sign}>
      {row.approx && "≈ "}
      {sign && <span className="mrep-sign">{sign}</span>}
      {toman(row.toman)}
    </span>
  );
}

/**
 * «گزارش ماهانه» — one Jalali month of transactions as an A4 sheet: the
 * month's income, spending and what was left, where the money went by group,
 * the daily rhythm of spending, the largest costs, and every transaction.
 * «دانلود PDF» prints the sheet alone; on screen it is the same sheet.
 */
export default async function MonthlyReportPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await ensureAuth();
  const userId = (user as { id?: string } | null)?.id ?? undefined;
  const month = monthOf(await searchParams);
  const { from, to, days } = reportMonthRange(month);
  const current = toJalali(todayIso());
  const atLatest = month.y * 12 + month.m >= current.y * 12 + current.m;

  const [txs, fx] = await Promise.all([
    getTransactions({ from, to, sort: "old", limit: ROW_CAP, userId }),
    getLatestUsdIrtRate(),
  ]);
  const rate = fx.rate && D(fx.rate).gt(0) ? String(fx.rate) : null;
  const r = buildMonthlyReport(txs, month, rate);

  const prev = shiftReportMonth(month, -1);
  const next = shiftReportMonth(month, 1);
  const peak = r.dailyExpense.reduce((max, v) => (D(v).gt(max) ? v : max), "0");
  const activeDays = r.dailyExpense.filter((v) => D(v).gt(0)).length;
  const avgDaily = D(r.expense).div(days).toFixed(0);
  const netTone = D(r.net).isNegative() ? "neg" : "pos";

  return (
    <div className="mrep-page">
      <div className="mrep-toolbar no-print">
        <Link href="/transactions" className="btn btn-ghost">
          <Icon name="chevronRight" size={16} />
          تراکنش‌ها
        </Link>
        <nav className="mrep-months" aria-label="انتخاب ماه">
          <Link href={`/transactions/report?month=${reportMonthKey(prev)}`} className="icon-btn" aria-label={`ماه قبل، ${monthName(prev)}`}>
            <Icon name="chevronRight" size={18} />
          </Link>
          <b>{monthName(month)}</b>
          {atLatest ? (
            <span className="icon-btn" aria-hidden="true" data-disabled>
              <Icon name="chevronLeft" size={18} />
            </span>
          ) : (
            <Link href={`/transactions/report?month=${reportMonthKey(next)}`} className="icon-btn" aria-label={`ماه بعد، ${monthName(next)}`}>
              <Icon name="chevronLeft" size={18} />
            </Link>
          )}
        </nav>
        <ReportPrint targetId="mrep-sheet" fileName={`گزارش ماهانه ${monthName(month)}`} />
      </div>

      <article id="mrep-sheet" className="mrep" aria-labelledby="mrep-title">
        <header className="mrep-head">
          <div className="mrep-brand">
            <BrandMark size={34} framed />
            <span>توازن</span>
          </div>
          <div className="mrep-heading">
            <p className="mrep-kicker">گزارش ماهانهٔ تراکنش‌ها</p>
            <h1 id="mrep-title">{monthName(month)}</h1>
            <p className="mrep-muted">
              از <bdi className="num">{formatJalaliIso(from)}</bdi> تا <bdi className="num">{formatJalaliIso(to)}</bdi>
            </p>
          </div>
          <p className="mrep-muted mrep-printed">
            تهیه‌شده در <bdi className="num">{formatJalaliIso(todayIso())}</bdi>
          </p>
        </header>

        <section className="mrep-kpis" aria-label="خلاصهٔ ماه">
          <div className="mrep-kpi" data-tone="pos">
            <span>درآمد</span>
            <b className="mrep-kpi-val">{toman(r.income)}</b>
            <small>{faCount(r.incomeCount)} تراکنش</small>
          </div>
          <div className="mrep-kpi" data-tone="neg">
            <span>هزینه</span>
            <b className="mrep-kpi-val">{toman(r.expense)}</b>
            <small>{faCount(r.expenseCount)} تراکنش</small>
          </div>
          <div className="mrep-kpi" data-tone={netTone}>
            <span>مانده (درآمد منهای هزینه)</span>
            <b className="mrep-kpi-val">
              {D(r.net).isNegative() && <span className="mrep-sign">−</span>}
              {toman(D(r.net).abs().toFixed(0))}
            </b>
            <small>{D(r.net).isNegative() ? "بیش از درآمد خرج شده" : "پس‌انداز این ماه"}</small>
          </div>
          <div className="mrep-kpi">
            <span>نرخ پس‌انداز</span>
            <b className="num">{r.savingsRate == null ? "—" : formatPct(r.savingsRate * 100, 0)}</b>
            <small>میانگین خرج روزانه {toman(avgDaily)}</small>
          </div>
        </section>

        {(D(r.debtPaid).gt(0) || D(r.nonCash).gt(0)) && (
          <p className="mrep-aside">
            {D(r.debtPaid).gt(0) && (
              <span>
                بازپرداخت بدهی و اقساط: <span className="money-nowrap">{toman(r.debtPaid)}</span> (خروج پول، ولی جزو هزینه نیست)
              </span>
            )}
            {D(r.nonCash).gt(0) && (
              <span>
                استهلاک و ذخیرهٔ غیرنقدی: <span className="money-nowrap">{toman(r.nonCash)}</span> (پولی از حساب خارج نشده)
              </span>
            )}
          </p>
        )}

        {r.rows.length === 0 ? (
          <p className="mrep-empty">در {monthName(month)} تراکنشی ثبت نشده است.</p>
        ) : (
          <>
            {r.expenseByGroup.length > 0 && (
              <section className="mrep-section">
                <h2>هزینه‌ها به تفکیک گروه</h2>
                <Shares items={r.expenseByGroup} leaves />
              </section>
            )}

            {D(r.expense).gt(0) && (
              <section className="mrep-section mrep-keep">
                <h2>روند هزینهٔ روزانه</h2>
                <p className="mrep-muted">
                  در {faCount(activeDays)} روز از {faCount(days)} روز خرج داشته‌اید؛ بیشترین خرج یک روز {toman(peak)}.
                </p>
                <div className="mrep-days" role="img" aria-label="نمودار خرج روزانه">
                  {r.dailyExpense.map((v, i) => (
                    <span key={i} className="mrep-day" style={{ "--h": D(peak).gt(0) ? Number(D(v).div(peak).toFixed(3)) : 0 } as CSSProperties}>
                      <i />
                      <small className="num">{(i + 1) % 5 === 0 || i === 0 ? toFaDigits(String(i + 1)) : ""}</small>
                    </span>
                  ))}
                </div>
              </section>
            )}

            <div className="mrep-cols">
              {r.incomeByCategory.length > 0 && (
                <section className="mrep-section mrep-keep">
                  <h2>منابع درآمد</h2>
                  <Shares items={r.incomeByCategory} leaves={false} />
                </section>
              )}
              {r.topExpenses.length > 0 && (
                <section className="mrep-section mrep-keep">
                  <h2>بزرگ‌ترین هزینه‌ها</h2>
                  <ol className="mrep-top">
                    {r.topExpenses.map((row) => (
                      <li key={row.id}>
                        <span className="mrep-top-text">
                          <b>{row.description}</b>
                          <small>
                            <bdi className="num">{formatJalaliIso(row.entryDate)}</bdi>
                            {row.category && `، ${row.category}`}
                          </small>
                        </span>
                        <span className="money-nowrap">{toman(row.toman!)}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>

            <section className="mrep-section">
              <h2>همهٔ تراکنش‌ها ({faCount(r.rows.length)})</h2>
              <table className="mrep-table">
                <thead>
                  <tr>
                    <th scope="col">تاریخ</th>
                    <th scope="col">شرح</th>
                    <th scope="col">دسته / مسیر</th>
                    <th scope="col" className="mrep-amount">
                      مبلغ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {r.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="num">{toFaDigits(`${row.day} ${JALALI_MONTHS[month.m - 1]}`)}</td>
                      <td>
                        {row.description}
                        <small className="mrep-type" data-type={row.type}>
                          {row.nonCash ? "غیرنقدی" : row.typeLabel}
                        </small>
                      </td>
                      <td className="mrep-muted">{row.category ?? row.flow ?? "—"}</td>
                      <td className="mrep-amount">
                        <Amount row={row} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}

        <footer className="mrep-foot">
          <p>
            مبلغ‌ها به تومان و همان رقمی است که هنگام ثبت ذخیره شده؛ تغییر نرخ دلار آن‌ها را عوض نمی‌کند.
            {r.approxCount > 0 && ` ${faCount(r.approxCount)} مبلغ که رقم تومانی ذخیره‌شده نداشت با نرخ امروز تخمین زده شده و با «≈» مشخص است.`}
            {r.missingCount > 0 && ` ${faCount(r.missingCount)} تراکنش به‌خاطر نبودِ نرخ در جمع‌ها حساب نشده است.`}
          </p>
          <p>انتقال بین حساب‌ها و خرید و فروش دارایی در فهرست آمده‌اند ولی جزو درآمد یا هزینه نیستند.</p>
          {txs.length >= ROW_CAP && <p>فقط {faCount(ROW_CAP)} تراکنش اول این ماه در گزارش آمده است.</p>}
        </footer>
      </article>
    </div>
  );
}
