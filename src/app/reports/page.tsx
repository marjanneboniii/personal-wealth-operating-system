import Link from "next/link";
import { ensureAuth } from "@/lib/authGuard";
import { seedIfEmpty } from "@/db/seed";
import {
  getCashflow,
  getDailyOutflow,
  getExpenseIncomeTotals,
  getRealizedPnl,
} from "@/features/ledger/queries";
import { getFlowByCategory, type CategoryFlowRow } from "@/features/categories/service";
import MonthPicker from "@/components/reports/MonthPicker";
import SpendHeatmap from "@/components/reports/SpendHeatmap";
import { listDebts, projectCashflow } from "@/features/planning/service";
import { isReceivable } from "@/features/planning/obligations";
import { PageHeader, Progress, Section, SectionLink } from "@/components/ui/Card";
import StatCard from "@/components/money/StatCard";
import FormattedMoney from "@/components/ui/FormattedMoney";
import { BarsChart } from "@/components/charts/Charts";
import RowAction from "@/components/RowAction";
import PdfButton from "@/components/reports/PdfButton";
import Icon from "@/components/ui/Icon";
import { D, Decimal } from "@/domain/decimal";
import { currencyLabel, faCount, formatJalaliIso, formatMoney, formatNumber, formatPct, formatSignedMoney, formatSignedMoneyFromUsd, jalaliMonthKey, jalaliMonthLabel, jalaliToIso, toFaDigits, toIrtMoney, toJalali, todayIso, toneColor, trendTone, JALALI_MONTHS } from "@/lib/format";
import { getLatestUsdIrtRate } from "@/lib/fx";
import { getCurrentNetWorth } from "@/features/portfolio/service";

export const dynamic = "force-dynamic";

export const metadata = { title: "گزارش‌های مالی" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** «1405-08» → { y: 1405, m: 8 }, or null. */
function parseMonthKey(raw: string | string[] | undefined): { y: number; m: number } | null {
  const match = typeof raw === "string" ? /^(\d{4})-(\d{1,2})$/.exec(raw) : null;
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  return y >= 1300 && y <= 1500 && m >= 1 && m <= 12 ? { y, m } : null;
}

export default async function ReportsPage({ searchParams }: { searchParams?: SearchParams } = {}) {
  await ensureAuth();
  await seedIfEmpty();
  const sp = (await searchParams) ?? {};
  const today = todayIso();
  const nowJ = toJalali(today);
  // The month on show: ?ماه from the picker, never after this month.
  const picked = parseMonthKey(sp.month);
  const month = picked && (picked.y < nowJ.y || (picked.y === nowJ.y && picked.m <= nowJ.m)) ? picked : { y: nowJ.y, m: nowJ.m };
  const monthFrom = jalaliToIso(month.y, month.m, 1);
  const monthTo = month.m === 12 ? jalaliToIso(month.y + 1, 1, 1) : jalaliToIso(month.y, month.m + 1, 1);
  const heatYearRaw = Number(typeof sp.hy === "string" ? sp.hy : NaN);
  const heatYear = Number.isInteger(heatYearRaw) && heatYearRaw >= 1390 && heatYearRaw <= nowJ.y ? heatYearRaw : nowJ.y;

  const [nw, flow, pnl, totals, debts, projection, fx, monthCats, monthIncome, daily] = await Promise.all([
    getCurrentNetWorth(),
    getCashflow(12),
    getRealizedPnl(),
    getExpenseIncomeTotals(),
    listDebts(),
    projectCashflow(12),
    getLatestUsdIrtRate(),
    getFlowByCategory(0, undefined, "expense", { from: monthFrom, to: monthTo }),
    getFlowByCategory(0, undefined, "income", { from: monthFrom, to: monthTo }),
    getDailyOutflow(jalaliToIso(heatYear, 1, 1), jalaliToIso(heatYear + 1, 1, 1)),
  ]);

  const rate = fx.rate;
  const toIrt = (usd: string | number) => toIrtMoney(usd, rate);

  // «بدهی و بازپرداخت» is about what the user OWES. Receivables come back from
  // the same service (one obligation model, two directions) and are filtered
  // out here rather than netted — netting would report neither correctly.
  const payableDebts = debts.filter((d) => !isReceivable(d.direction));

  /* EXPENSE / INCOME KPIs — from ENTRIES, not from account balances (audit
     F-1, 2026-09-07). A repayment of a debt that has no ledger liability
     account is booked onto the expense-typed «پرداخت اقساط» bucket, so summing
     expense balances turned every installment paid into household consumption
     and deflated «نرخ پس‌انداز». `getExpenseIncomeTotals` applies the same
     `debt_repayment` exclusion the cash-flow page already uses, so the two
     reports finally share ONE definition of "expense". */
  const totalIncome = D(totals.income);
  const totalExpense = D(totals.expense);
  // SSOT: portfolio valuation already excludes orphaned/deleted RWA assets
  // and never treats a missing price as zero (which would fake a full write-off).
  const unrealized = D(nw.valuation.totalUnrealizedPnl);
  const unrealizedToman = nw.valuation.totalUnrealizedPnlToman;
  const savingsRate = totalIncome.isZero() ? "0" : totalIncome.sub(totalExpense).div(totalIncome).mul(100).toFixed(1);

  // Expense Toman is authoritative from the immutable entry FX snapshot.
  // Never convert the historical USD book total with today's rate: doing so
  // changes a recorded expense when the dollar rate rises. The frozen sum is
  // valid only when EVERY outflow entry of the window carries its commit-time
  // snapshot (full coverage); a partial cover would understate the total, so
  // legacy rows without a snapshot retain the dynamic current-rate fallback.
  const outflowCovered = flow.length > 0 && flow.every((f) => f.outflowEntries === f.outflowEntriesSnap);
  const frozenExpenseToman = outflowCovered
    ? Decimal.sum(flow.map((f) => f.outflowToman ?? "0"))
    : null;
  const expenseToman = frozenExpenseToman
    ? frozenExpenseToman.toString()
    : rate
      ? D(totalExpense).mul(rate).toString()
      : totalExpense.toString();

  // Toman per month: the frozen entry figure when every entry of the month has
  // its snapshot, else the dollar book at today's rate (legacy rows only).
  const tomanOf = (frozen: boolean, toman: string | null | undefined, usd: string) =>
    frozen && toman != null && D(toman).gt(0) ? D(toman) : rate ? D(usd).mul(rate) : D(usd);
  const monthly = flow.map((f) => {
    const inT = tomanOf(f.inflowEntries === f.inflowEntriesSnap, f.inflowToman, f.inflow);
    const outT = tomanOf(f.outflowEntries === f.outflowEntriesSnap, f.outflowToman, f.outflow);
    return {
      month: f.month,
      label: jalaliMonthLabel(jalaliMonthKey(f.month)),
      inT,
      outT,
      netT: inT.sub(outT),
    };
  });
  const incomeToman = rate ? totalIncome.mul(rate) : totalIncome;
  const savedToman = incomeToman.sub(expenseToman);
  const avgExpenseToman = monthly.length ? D(expenseToman).div(monthly.length) : D("0");
  const toman = (v: Decimal | string | number) => formatMoney(D(v).toFixed(0), "IRT");
  // A small dollar line under the headline totals only — never in the month
  // rows or the forward table, where a second figure per cell is clutter.
  const usd = (v: Decimal | string | number) => (rate ? `≈ ${formatMoney(D(v).toString())}` : undefined);

  // One Jalali month, picked above the breakdown. Toman is the commit-time
  // freeze when every entry of a category carries it, else today's rate.
  const catToman = (r: CategoryFlowRow) =>
    r.entries === r.entriesWithSnap && D(r.totalToman).gt(0) ? D(r.totalToman) : rate ? D(r.total).mul(rate) : D(r.total);
  const monthGroups = [...monthCats.reduce((acc, r) => {
    const key = r.parentName ?? r.name;
    acc.set(key, (acc.get(key) ?? D(0)).add(catToman(r)));
    return acc;
  }, new Map<string, Decimal>())].sort((a, b) => b[1].cmp(a[1]));
  const monthExpense = monthGroups.reduce((sum, [, v]) => sum.add(v), D(0));
  const monthIncomeToman = monthIncome.reduce((sum, r) => sum.add(catToman(r)), D(0));
  const monthName = `${JALALI_MONTHS[month.m - 1]} ${toFaDigits(String(month.y))}`;
  const monthHref = (y: number, m: number) => `/reports?month=${y}-${String(m).padStart(2, "0")}#month-report`;

  const dailyToman = new Map(
    daily.map((d) => [d.date, Number(d.outflowToman ?? (rate ? D(d.outflow).mul(rate).toFixed(0) : d.outflow))]),
  );

  return (
    <div className="mny-page rpt-page">
      <PageHeader
        title="گزارش‌های مالی"
        action={
          <>
            <RowAction kind="snapshot" label="ثبت اسنپ‌شات" />
            <PdfButton />
          </>
        }
      />

      {/* The year at a glance — one <section>: «کل هزینه ثبت‌شده» and
          «نرخ پس‌انداز» are read together by the repayment-exclusion test. */}
      <section className="mny-stats" style={{ ["--mny-cols" as string]: 4 }} aria-label="خلاصهٔ ۱۲ ماه">
        <StatCard
          tone="ink"
          className="mny-stat-lead"
          icon="arrow-down"
          label="کل درآمد ثبت‌شده"
          period="۱۲ ماه اخیر"
          value={<FormattedMoney value={toman(incomeToman)} />}
          hint={usd(totalIncome)}
        />
        <StatCard icon="arrow-up" label="کل هزینه ثبت‌شده" period="بدون اقساط بدهی" value={<FormattedMoney value={toman(expenseToman)} />} hint={usd(totalExpense)} />
        <StatCard
          tone={savedToman.isNegative() ? "negative" : "positive"}
          icon="trend-up"
          label="نرخ پس‌انداز"
          period={`${savedToman.isNegative() ? "کسری" : "پس‌انداز"} ${toman(savedToman.abs())}`}
          value={formatPct(savingsRate, 1)}
        />
      </section>

      {/* Monthly report — printable (PdfButton reads #monthly-report). */}
      <Section title="گزارش ماهانه" hint="۱۲ ماه اخیر · تومان">
        <div id="monthly-report" className="space-y-3">
          <div className="card p-3 sm:p-4">
            <BarsChart
              height={150}
              currency="IRT"
              positiveLabel="درآمد"
              negativeLabel="هزینه"
              data={monthly.map((m) => ({ label: m.label, positive: Number(m.inT), negative: Number(m.outT) }))}
            />
          </div>

          {monthly.length ? (
            <ul className="card rpt-months" aria-label="درآمد و هزینهٔ هر ماه">
              <li className="rpt-month rpt-month-head" aria-hidden="true">
                <span>ماه</span>
                <span>درآمد</span>
                <span>هزینه</span>
                <span>خالص</span>
              </li>
              {[...monthly].reverse().map((m) => (
                <li key={m.month} className="rpt-month">
                  <span className="rpt-month-name">{m.label}</span>
                  <span className="rpt-cell" data-k="in" title={toman(m.inT)}>
                    <small>درآمد</small>
                    <b className="num">{compactToman(m.inT)}</b>
                  </span>
                  <span className="rpt-cell" data-k="out" title={toman(m.outT)}>
                    <small>هزینه</small>
                    <b className="num">{compactToman(m.outT)}</b>
                  </span>
                  <span className="rpt-cell" data-k="net" data-neg={m.netT.isNegative() || undefined} title={formatSignedMoney(m.netT.toFixed(0), "IRT")}>
                    <small>خالص</small>
                    <b className="num">{compactToman(m.netT)}</b>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card expense-empty">داده‌ای در ۱۲ ماه اخیر نیست.</p>
          )}

          <section className="card rpt-today" aria-label="وضعیت امروز">
            {(
              [
                ["ارزش خالص", nw.netWorthToman, nw.netWorth],
                ["دارایی", nw.totalAssetsToman, nw.totalAssets],
                ["بدهی", nw.totalLiabilitiesToman, nw.totalLiabilities],
                ["نقدشونده", nw.liquidToman, nw.liquid],
                ["میانگین هزینه ماهانه", avgExpenseToman, monthly.length ? totalExpense.div(monthly.length) : D("0")],
              ] as const
            ).map(([label, v, dollars]) => (
              <div key={label}>
                <span>{label}</span>
                <span className="rpt-today-fig">
                  <b className="num money-nowrap" dir="rtl">
                    {toman(v)}
                  </b>
                  {usd(dollars) && (
                    <small className="num money-nowrap" dir="rtl">
                      {usd(dollars)}
                    </small>
                  )}
                </span>
              </div>
            ))}
          </section>
        </div>
      </Section>

      <Section title={`گزارش ${monthName}`} hint="هر ماه شمسی را جدا ببینید">
        <div id="month-report" className="rpt-month scroll-mt-20">
          <MonthPicker year={month.y} selected={month} current={{ y: nowJ.y, m: nowJ.m }} href={monthHref} />
          <div className="card rpt-month-body">
            <dl className="rpt-month-kpis">
              <div>
                <dt>درآمد</dt>
                <dd className="num money-nowrap" dir="rtl" style={{ color: "var(--positive)" }}>
                  <FormattedMoney value={toman(monthIncomeToman)} />
                </dd>
              </div>
              <div>
                <dt>هزینه</dt>
                <dd className="num money-nowrap" dir="rtl" style={{ color: "var(--negative)" }}>
                  <FormattedMoney value={toman(monthExpense)} />
                </dd>
              </div>
              <div>
                <dt>خالص</dt>
                <dd className="num money-nowrap" dir="rtl" style={{ color: toneColor(trendTone(monthIncomeToman.sub(monthExpense).toString())) }}>
                  <FormattedMoney value={formatSignedMoney(monthIncomeToman.sub(monthExpense).toFixed(0), "IRT")} />
                </dd>
              </div>
            </dl>
            {monthGroups.length ? (
              <ul className="rpt-month-cats">
                {monthGroups.slice(0, 6).map(([name, v]) => {
                  const share = monthExpense.isZero() ? 0 : v.div(monthExpense).mul(100).toNumber();
                  return (
                    <li key={name}>
                      <span className="rpt-month-cat-head">
                        <span>{name}</span>
                        <span className="num money-nowrap" dir="rtl">
                          <FormattedMoney value={toman(v)} />
                        </span>
                      </span>
                      <span className="meter" aria-hidden="true">
                        <i style={{ width: `${Math.min(100, share)}%`, background: "var(--negative)" }} />
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="muted text-center text-[length:var(--fs-sm)]">در {monthName} هزینه‌ای ثبت نشده است.</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="هزینهٔ روزانه" hint="هر خانه یک روز · پررنگ‌تر یعنی خرج بیشتر">
        <SpendHeatmap year={heatYear} days={dailyToman} today={today} hrefForYear={(y) => `/reports?hy=${y}#heatmap`} />
      </Section>

      <div className="grid items-start gap-5 lg:grid-cols-2">
        {/* Investment results — Toman first, the dollar result beside it (they
            can differ in sign: nominal vs real). */}
        <Section title="سود و زیان سرمایه‌گذاری" action={<SectionLink href="/portfolio" label="جزئیات سبد" />}>
          <div className="space-y-3">
            <div className="card rpt-pair">
              <div>
                <span className="expense-sub">تحقق‌یافته</span>
                <b className="num money-nowrap" dir="rtl" style={{ color: toneColor(trendTone(pnl.totalToman)) }}>
                  {formatSignedMoney(pnl.totalToman, "IRT")}
                </b>
                <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">{formatSignedMoney(pnl.total, "USD")}</span>
              </div>
              <div>
                <span className="expense-sub">تحقق‌نیافته</span>
                <b className="num money-nowrap" dir="rtl" style={{ color: toneColor(trendTone(unrealizedToman ?? unrealized.toString())) }}>
                  {unrealizedToman ? formatSignedMoney(unrealizedToman, "IRT") : formatSignedMoneyFromUsd(unrealized.toString(), rate)}
                </b>
                {rate && <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">{formatSignedMoney(unrealized.toString(), "USD")}</span>}
              </div>
            </div>
            {pnl.bySymbol.length > 0 ? (
              <ul className="card plan-list">
                {pnl.bySymbol.map((s) => (
                  <li key={s.symbol} className="plan-queue-row">
                    <span className="min-w-0 flex-1 text-[length:var(--fs-sm)] font-bold" dir="rtl">
                      {currencyLabel(s.symbol)}
                    </span>
                    {/* A result in money — Toman first, dollars beside it — never in units of the asset sold. */}
                    <span className="num shrink-0 text-end" dir="rtl" style={{ color: D(s.pnlToman).gte(0) ? "var(--positive)" : "var(--negative)" }}>
                      {formatSignedMoney(s.pnlToman, "IRT")}
                      <span className="muted block text-[length:var(--fs-xs)] font-normal">{formatSignedMoney(s.pnl, "USD")}</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="card expense-empty">فروشی ثبت نشده است</p>
            )}
          </div>
        </Section>

        {/* Debt report — PAYABLES ONLY (receivables have their own section on
            «تعهدات مالی»; listing one here would report it as money owed). */}
        <Section title="بدهی و بازپرداخت" action={<SectionLink href="/debts" label="مدیریت بدهی‌ها" />}>
          {payableDebts.length > 0 ? (
            <ul className="card plan-list">
              {payableDebts.map((d) => (
                <li key={d.id} className="plan-row">
                  <div className="plan-row-head">
                    <span className="plan-row-title">
                      <b className="truncate">{d.title}</b>
                    </span>
                    <span
                      className="num plan-amount shrink-0 money-nowrap"
                      dir="rtl"
                      style={{ color: d.status === "settled" ? "var(--positive)" : "var(--negative)" }}
                    >
                      {d.outstandingToman != null
                        ? formatMoney(d.status === "settled" ? 0 : d.outstandingToman, "IRT")
                        : toIrt(d.status === "settled" ? 0 : d.outstandingBase) ?? formatMoney(d.status === "settled" ? 0 : d.outstandingBase)}
                    </span>
                  </div>
                  <Progress
                    value={d.totalCount ? (d.paidCount / d.totalCount) * 100 : 0}
                    color={d.status === "settled" ? "var(--positive)" : "var(--warning)"}
                    aria-label={`پیشرفت ${d.title}`}
                  />
                  <p className="plan-row-foot num" dir="rtl">
                    {faCount(d.paidCount)} / {faCount(d.totalCount)} قسط
                    {d.nextDue && <span dir="rtl"> · قسط بعدی {formatJalaliIso(d.nextDue.dueDate)}</span>}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="card expense-empty">بدهی‌ای ثبت نشده است</p>
          )}
        </Section>
      </div>

      {/* Forward liquidity — projection figures are ALREADY Toman (see
          projectCashflow: "Projection unit = Toman"). Never pass them through
          toIrt/usd→irt: that multiplies by the live rate a second time. */}
      <Section title="نقدینگی پیش‌رو" hint="۱۲ ماه آینده · برنامه‌ها، اقساط و تعهدات">
        <div className="card overflow-x-auto">
          <table className="table rpt-forward">
            <thead>
              <tr>
                <th scope="col">ماه</th>
                <th scope="col" className="td-num">ورودی</th>
                <th scope="col" className="td-num">خروجی</th>
                <th scope="col" className="td-num hidden sm:table-cell">خالص</th>
              </tr>
            </thead>
            <tbody>
              {projection.points.map((p) => {
                const net = D(p.inflow).sub(p.outflow);
                return (
                  <tr key={p.month}>
                    <td>{jalaliMonthLabel(jalaliMonthKey(p.month))}</td>
                    <td className="td-num money-nowrap" dir="rtl" style={{ color: D(p.inflow).gt(0) ? "var(--positive)" : "var(--text-3)" }}>
                      {formatMoney(p.inflow, "IRT")}
                    </td>
                    <td className="td-num money-nowrap" dir="rtl" style={{ color: D(p.outflow).gt(0) ? "var(--negative)" : "var(--text-3)" }}>
                      {formatMoney(p.outflow, "IRT")}
                    </td>
                    <td className="td-num money-nowrap font-semibold hidden sm:table-cell" dir="rtl" style={{ color: net.isZero() ? "var(--text-3)" : net.isNegative() ? "var(--negative)" : "var(--positive)" }}>
                      {formatSignedMoney(net.toFixed(0), "IRT")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>

      {/* Recovery & exports */}
      <section className="card rpt-backup">
        <span className="min-w-0">
          <b className="block text-[length:var(--fs-sm)]">پشتیبان و درون‌ریزی</b>
          <span className="expense-sub block">یک نسخه از داده‌ها بگیرید، یا سوابق بیرونی را وارد کنید.</span>
        </span>
        <span className="flex shrink-0 gap-2">
          <a href="/api/backup" className="btn btn-soft !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
            <Icon name="download" size={14} />
            دانلود پشتیبان
          </a>
          <Link href="/transactions/import" className="btn btn-ghost !min-h-9 !px-3.5 !py-1.5 text-[length:var(--fs-xs)]">
            <Icon name="import" size={14} />
            درون‌ریزی
          </Link>
        </span>
      </section>
    </div>
  );
}

/** «۱۲.۳ میلیون» — a month row reads at a glance; the exact Toman is its title. */
function compactToman(v: Decimal): string {
  const raw = Number(v.toFixed(0));
  const n = Math.abs(raw);
  const sign = raw < 0 ? -1 : 1;
  // The sign rides inside the number so a bidi isolate never splits it off.
  const fmt = (x: number) => formatNumber(String(sign * Number(x.toFixed(x >= 100 ? 0 : 1))), { decimals: x >= 100 || Number.isInteger(Number(x.toFixed(1))) ? 0 : 1 });
  if (n >= 1e9) return `${fmt(n / 1e9)} میلیارد`;
  if (n >= 1e6) return `${fmt(n / 1e6)} میلیون`;
  if (n >= 1e3) return `${fmt(n / 1e3)} هزار`;
  return formatNumber(String(raw), { decimals: 0 });
}
