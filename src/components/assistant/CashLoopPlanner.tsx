"use client";

import { useMemo, useState } from "react";
import type { FinancialSnapshot } from "@/features/assistant/snapshot";
import { fmtToman } from "@/features/assistant/analysis";
import { daysUntilIso, formatShortDate, toFaDigits, todayIso } from "@/lib/format";
import Icon from "@/components/ui/Icon";

const short = (n: number) => fmtToman(n).replace(/ تومان$/, "");
const full = (n: number) => `${Math.round(n).toLocaleString("fa-IR")} تومان`;
const num = (n: number) => Math.round(n).toLocaleString("fa-IR");

interface Props {
  s: FinancialSnapshot;
}

type Horizon = 1 | 2 | 3 | 6;

export default function CashLoopPlanner({ s }: Props) {
  // ── Existing accounts & liquid positions ──
  const bankToman = s?.netWorth?.availableCashToman ?? 0;
  const exchangeToman = s?.netWorth?.exchangeTomanToman ?? 0;
  const stablecoinToman = s?.netWorth?.stablecoinToman ?? 0;
  const baseRate = s?.usdToToman && s.usdToToman > 0 ? s.usdToToman : 70000;

  // Filter bank and exchange accounts
  const accounts = Array.isArray(s?.accounts) ? s.accounts : [];
  const bankAccounts = accounts.filter(
    (a) => a && (a.kind === "bank" || (["IRT", "IRR"].includes(a.currency ?? "") && a.kind !== "exchange")),
  );
  const stablecoinAccounts = accounts.filter(
    (a) =>
      a &&
      (["USDT", "USDC", "DAI"].includes(a.currency ?? "") ||
        (typeof a.name === "string" && a.name.includes("تتر"))),
  );

  // Exact USDT quantity from accounts or derived
  const actualUsdtHoldings = stablecoinAccounts.reduce((sum, a) => sum + (a && a.balance > 0 ? a.balance : 0), 0);
  const totalUsdt = actualUsdtHoldings > 0 ? Math.round(actualUsdtHoldings) : Math.round(stablecoinToman / Math.max(1, baseRate));

  // Default monthly expense from actual system analysis, with sane fallback
  const defaultMonthlyExpense =
    s?.cashflow?.avgMonthlyExpenseToman && s.cashflow.avgMonthlyExpenseToman > 0
      ? s.cashflow.avgMonthlyExpenseToman
      : s?.cashflow?.currentMonth?.expenseToman && s.cashflow.currentMonth.expenseToman > 0
        ? s.cashflow.currentMonth.expenseToman
        : 18_000_000;

  // ── Interactive user controls ──
  const [horizon, setHorizon] = useState<Horizon>(1);
  const [monthlyExpense, setMonthlyExpense] = useState<number>(defaultMonthlyExpense);
  const [rate, setRate] = useState<number>(baseRate);
  const [bufferPct, setBufferPct] = useState<number>(5);
  const [tradingPortionPct, setTradingPortionPct] = useState<number>(10);

  // ── Dual Scenario Controls (اشتغال در آینده در برابر عدم اشتغال) ──
  const [simulateJob, setSimulateJob] = useState<boolean>(false);
  const [monthlySalary, setMonthlySalary] = useState<number>(25_000_000);

  // ── Obligations within the selected horizon ──
  const today = s?.asOf || todayIso();
  const maxDays = horizon * 30;
  const upcoming = Array.isArray(s?.obligations?.upcoming) ? s.obligations.upcoming : [];

  const obligationsInWindow = useMemo(() => {
    return upcoming.filter((u) => {
      if (!u || !u.date) return false;
      const days = daysUntilIso(u.date, today);
      return days >= 0 && days <= maxDays;
    });
  }, [upcoming, today, maxDays]);

  const totalObligationsToman = useMemo(() => {
    return obligationsInWindow.reduce((sum, u) => sum + (u.toman || 0), 0);
  }, [obligationsInWindow]);

  // ── Calculations for Base Scenario (بدون شغل) ──
  const totalLivingToman = monthlyExpense * horizon;
  const baseNeedToman = totalLivingToman + totalObligationsToman;
  const bufferToman = Math.round(baseNeedToman * (bufferPct / 100));
  const grossNeedToman = baseNeedToman + bufferToman;

  // Ready Toman liquidity (Bank + Exchange Toman already available)
  const readyToman = bankToman + exchangeToman;
  const deficitTomanBase = Math.max(0, grossNeedToman - readyToman);
  const neededUsdtBase = deficitTomanBase > 0 ? Math.ceil(deficitTomanBase / Math.max(1, rate)) : 0;
  const remainingUsdtBase = Math.max(0, totalUsdt - neededUsdtBase);

  // ── Calculations for Job Scenario (با شغل و حقوق ماهانه) ──
  const totalSalaryInHorizon = simulateJob ? monthlySalary * horizon : 0;
  const deficitTomanJob = Math.max(0, grossNeedToman - readyToman - totalSalaryInHorizon);
  const neededUsdtJob = deficitTomanJob > 0 ? Math.ceil(deficitTomanJob / Math.max(1, rate)) : 0;
  const remainingUsdtJob = Math.max(0, totalUsdt - neededUsdtJob);

  // Active scenario outputs
  const activeDeficitToman = simulateJob ? deficitTomanJob : deficitTomanBase;
  const activeNeededUsdt = simulateJob ? neededUsdtJob : neededUsdtBase;
  const activeRemainingUsdt = simulateJob ? remainingUsdtJob : remainingUsdtBase;
  const savedUsdtWithJob = Math.max(0, neededUsdtBase - neededUsdtJob);

  // Runway calculation (months until liquid cash + stablecoins exhaust)
  const totalLiquidNetWorthToman = readyToman + totalUsdt * rate;
  const monthlyBurnBase = monthlyExpense + (horizon > 0 ? totalObligationsToman / horizon : 0);
  const runwayMonthsBase =
    monthlyBurnBase > 0 ? Math.round((totalLiquidNetWorthToman / monthlyBurnBase) * 10) / 10 : 0;

  const monthlyNetBurnJob = Math.max(0, monthlyBurnBase - monthlySalary);
  const runwayMonthsJob =
    monthlyNetBurnJob > 0
      ? Math.round((totalLiquidNetWorthToman / monthlyNetBurnJob) * 10) / 10
      : Infinity;

  // Trading allocation
  const safeTradingUsdt = Math.round((totalUsdt * tradingPortionPct) / 100);
  const emergencyReserveUsdt = Math.max(0, totalUsdt - safeTradingUsdt);

  // FX Sensitivity Matrix
  const sensitivityRates = [
    Math.round(rate * 0.9),
    rate,
    Math.round(rate * 1.1),
    Math.round(rate * 1.25),
  ];

  // Dispatch question to AI Assistant
  const askAssistantWithScenario = () => {
    const text = `من سناریوی صندوق مخارج تتری را با حسابگر تحلیل کردم:
- افق انتخابی: ${toFaDigits(String(horizon))} ماهه
- مخارج زندگی ماهانه: ${full(monthlyExpense)}
- اقساط این دوره: ${full(totalObligationsToman)}
- نیاز کل نقدینگی: ${full(grossNeedToman)}
- موجودی ریالی آماده: ${full(readyToman)}
- حالت اشتغال شبیه‌سازی‌شده: ${simulateJob ? `شاغل با حقوق ماهانه ${full(monthlySalary)}` : "بدون شغل / متکی به صندوق تتری"}
- کسری ریالی نهایی: ${full(activeDeficitToman)}
- تتر مورد نیاز جهت فروش در بیت‌پین: ${num(activeNeededUsdt)} تتر
- تتر صرفه‌جویی‌شده با اشتغال: ${num(savedUsdtWithJob)} تتر
- تاب‌آوری مالی: ${simulateJob && runwayMonthsJob === Infinity ? "پایدار و نامحدود" : `${toFaDigits((simulateJob ? runwayMonthsJob : runwayMonthsBase).toFixed(1))} ماه`}
با توجه به اینکه بخشی از تترها را در ترید نگه می‌دارم، لطفاً گزارش عمیق مهندسی بده که در هر دو حالت (اگر کار پیدا کردم و اگر تا ۶ ماه پیدا نکردم) چه استراتژی دقیق مالی برای حفظ ثروت و ترید باید اجرا کنم؟`;
    window.dispatchEvent(new CustomEvent("assistant:ask", { detail: text }));
  };

  return (
    <div className="ai-loop space-y-4" dir="rtl">
      {/* ── خلاصه تاب‌آوری و وضعیت کل ── */}
      <section className="ai-loop-hero card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[length:var(--fs-xs)] font-medium bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon name="swap" size={13} />
              صندوق مخارج و تبدیل تتر
            </span>
            <h2 className="text-xl font-bold text-[var(--text)]">صندوق مخارج تتری، برنامه‌ریزی دوسطحی و تاب‌آوری</h2>
            <p className="text-sm text-[var(--text-2)] max-w-2xl leading-relaxed">
              این مدل مهندسی‌شده، سرمایه شما را در دو سناریو تحلیل می‌کند: **۱. اگر شغلی پیدا کنید** تا فروش تتر به حداقل یا صفر برسد، و **۲. اگر فعلاً بیکار بمانید** تا با بهینه‌ترین فروش تتر و کمترین ریسک ترید، بیشترین ماه‌های تاب‌آوری را داشته باشید.
            </p>
          </div>

          <div className="text-center px-4 py-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)] shrink-0 min-w-[190px]">
            <p className="text-xs text-[var(--text-3)] mb-1">
              {simulateJob ? "تاب‌آوری در سناریوی اشتغال" : "تاب‌آوری در سناریوی بدون شغل"}
            </p>
            <p className="text-2xl font-black num text-[var(--positive)]">
              {simulateJob && runwayMonthsJob === Infinity
                ? "پایدار (نامحدود)"
                : `${toFaDigits((simulateJob ? runwayMonthsJob : runwayMonthsBase).toFixed(1))} ماه`}
            </p>
            <p className="text-[11px] text-[var(--text-3)] mt-0.5">
              {simulateJob && runwayMonthsJob === Infinity
                ? "حقوق مخارج را کامل پوشش می‌دهد"
                : "پوشش کامل هزینه‌ها و اقساط"}
            </p>
          </div>
        </div>
      </section>

      {/* ── بخش سناریوسازی دوسطحی: اشتغال در آینده در برابر عدم اشتغال ── */}
      <section className="card p-4 border border-[var(--border)] rounded-2xl bg-[var(--surface)]">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className="font-bold text-sm text-[var(--text)] flex items-center gap-1.5">
              <Icon name="briefcase" size={16} className="text-[var(--action)]" />
              سناریوسازی وضعیت اشتغال و درآمد
            </span>
            <span className="text-xs text-[var(--text-3)]">(تأثیر شغل روی کاهش فروش تتر)</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[var(--sunken)] p-1 rounded-xl border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setSimulateJob(false)}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${
                !simulateJob
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              وضعیت فعلی (بدون شغل)
            </button>
            <button
              type="button"
              onClick={() => setSimulateJob(true)}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-colors ${
                simulateJob
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              شبیه‌سازی اشتغال در آینده
            </button>
          </div>
        </div>

        {simulateJob ? (
          <div className="pt-3 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-5">
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">
                  حقوق ماهانه فرضی در آینده (تومان):
                </label>
                <input
                  type="number"
                  step="1000000"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[var(--sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] num font-bold focus:border-[var(--action)] outline-none"
                />
              </div>

              <div className="md:col-span-7">
                <label className="block text-xs font-medium text-[var(--text-3)] mb-1">
                  پیش‌فرض‌های سریع حقوق ماهانه:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[15_000_000, 20_000_000, 25_000_000, 35_000_000, 50_000_000].map((sal) => (
                    <button
                      key={sal}
                      type="button"
                      onClick={() => setMonthlySalary(sal)}
                      className={`px-2.5 py-1 text-xs rounded-lg border num ${
                        monthlySalary === sal
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)] font-bold"
                          : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)]"
                      }`}
                    >
                      {short(sal)} تومان
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* کارت هایلایت تأثیر اشتغال بر حفظ تترها */}
            <div className="p-3.5 rounded-xl bg-[var(--positive-soft)] border border-[var(--positive)] text-[var(--positive)] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="space-y-0.5">
                <p className="font-bold flex items-center gap-1.5 text-sm">
                  <Icon name="check" size={15} />
                  تأثیر شغل: نجات <span className="num font-black">{num(savedUsdtWithJob)} تتر</span> از فروش اجباری در این دوره!
                </p>
                <p className="text-[11px] opacity-90 leading-relaxed">
                  با این حقوق، فروش تتر شما از <strong className="num">{num(neededUsdtBase)} USDT</strong> به <strong className="num">{num(neededUsdtJob)} USDT</strong> کاهش می‌یابد و تترهای شما برای رشد و ترید بلندمدت محافظت می‌شوند.
                </p>
              </div>
              <div className="text-right num font-black text-base shrink-0">
                +{short(savedUsdtWithJob * rate)} <span className="text-xs font-normal">تومان حفظ دارایی</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-3)] pt-3 leading-relaxed">
            در این حالت، سیستم فرض می‌کند درآمد فعالی ندارید و هزینه‌های زندگی و اقساط تماماً توسط موجودی نقدی و «صندوق مخارج تتری» تأمین می‌شود. این حالت بقای شما را با کمترین فشار به اصل سرمایه ترید تضمین می‌کند.
          </p>
        )}
      </section>

      {/* ── ۴ کارت اتصال زنده به حساب‌ها ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* تومان در بانک */}
        <div className="ai-card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">تومان در بانک</span>
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--positive)]" title="متصل" />
          </div>
          <p className="text-lg font-bold text-[var(--text)] num">{short(bankToman)} <small className="text-xs font-normal">تومان</small></p>
          <p className="text-[11px] text-[var(--text-3)] mt-1 truncate">
            {bankAccounts.length > 0 ? bankAccounts.map((a) => a.name).join(" · ") : "حساب‌های جاری و پس‌انداز"}
          </p>
        </div>

        {/* تومان در صرافی بیت‌پین */}
        <div className="ai-card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">تومان در بیت‌پین / صرافی</span>
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" title="آماده تسویه" />
          </div>
          <p className="text-lg font-bold text-[var(--text)] num">{short(exchangeToman)} <small className="text-xs font-normal">تومان</small></p>
          <p className="text-[11px] text-[var(--text-3)] mt-1">آماده پایا به بانک (بدون معامله)</p>
        </div>

        {/* موجودی تتر */}
        <div className="ai-card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">موجودی تتر (استیبل‌کوین)</span>
            <Icon name="crypto" size={14} className="text-[var(--text-3)]" />
          </div>
          <p className="text-lg font-bold text-[var(--text)] num">{num(totalUsdt)} <small className="text-xs font-normal">USDT</small></p>
          <p className="text-[11px] text-[var(--text-3)] mt-1">ارزش: {short(totalUsdt * rate)} تومان</p>
        </div>

        {/* نرخ تتر / دلار */}
        <div className="ai-card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">نرخ تبدیل تتر (تومان)</span>
            <span className="text-[10px] text-[var(--text-3)]">قابل ویرایش</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(Math.max(1000, Number(e.target.value) || baseRate))}
              className="w-full text-base font-bold bg-[var(--sunken)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-[var(--text)] num outline-none focus:border-[var(--action)]"
            />
          </div>
          <p className="text-[11px] text-[var(--text-3)] mt-1">نرخ پیش‌فرض سیستم: {num(baseRate)} تومان</p>
        </div>
      </div>

      {/* ── پنل محاسباتی تعاملی و نتایج تبدیل ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ستون راست: تنظیمات ورودی و اقساط (7 ستون) */}
        <div className="lg:col-span-7 space-y-4">
          <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
              <Icon name="overview" size={16} />
              تنظیمات افق زمانی و هزینه‌ها
            </h3>

            {/* انتخاب افق زمانی */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">افق زمانی برنامه‌ریزی نقدینگی:</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { key: 1, label: "۱ ماهه (۳۰ روز)" },
                  { key: 2, label: "۲ ماهه (۶۰ روز)" },
                  { key: 3, label: "۳ ماهه (فصلی)" },
                  { key: 6, label: "۶ ماهه (اضطراری)" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setHorizon(item.key as Horizon)}
                    className={`py-2 px-1 text-xs rounded-xl font-medium border transition-colors ${
                      horizon === item.key
                        ? "bg-[var(--action)] text-[var(--on-ink)] border-[var(--action)] shadow-sm"
                        : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* هزینه ماهانه زندگی */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">
                  مخارج ماهانه زندگی (تومان):
                </label>
                <input
                  type="number"
                  step="1000000"
                  value={monthlyExpense}
                  onChange={(e) => setMonthlyExpense(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[var(--sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] num font-semibold focus:border-[var(--action)] outline-none"
                />
                <span className="text-[11px] text-[var(--text-3)] mt-1 block">
                  میانگین واقعی سیستم: {short(defaultMonthlyExpense)} تومان
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">
                  حاشیه اطمینان نوسان و فورس‌ماژور:
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[0, 5, 10, 15].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setBufferPct(pct)}
                      className={`py-2 text-xs rounded-xl font-medium border ${
                        bufferPct === pct
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]"
                          : "bg-[var(--sunken)] text-[var(--text-3)] border-[var(--border)]"
                      }`}
                    >
                      {toFaDigits(String(pct))}٪
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-[var(--text-3)] mt-1 block">
                  مبلغ حاشیه: {short(bufferToman)} تومان
                </span>
              </div>
            </div>

            {/* لیست اقساط سررسیدشده در این افق */}
            <div className="pt-2 border-t border-[var(--border)]">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-[var(--text)]">
                  اقساط و تعهدات قطعی در افق {toFaDigits(String(horizon))} ماهه ({toFaDigits(String(obligationsInWindow.length))} مورد):
                </span>
                <span className="text-xs font-bold text-[var(--negative)] num">
                  {full(totalObligationsToman)}
                </span>
              </div>

              {obligationsInWindow.length === 0 ? (
                <p className="text-xs text-[var(--text-3)] py-2 bg-[var(--sunken)] text-center rounded-lg">
                  هیچ قسط یا سررسید تعهداتی در این بازه یافت نشد.
                </p>
              ) : (
                <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1 text-xs">
                  {obligationsInWindow.map((o, idx) => (
                    <li
                      key={`${o.date}-${o.title}-${idx}`}
                      className="flex items-center justify-between p-2 rounded-lg bg-[var(--sunken)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface)] text-[var(--text-2)] num">
                          {formatShortDate(o.date)}
                        </span>
                        <span className="font-medium text-[var(--text)]">{o.title}</span>
                      </div>
                      <span className="font-semibold text-[var(--text)] num">{full(o.toman)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ستون چپ: خروجی حسابگر و تعداد تتر لازم برای انتقال (5 ستون) */}
        <div className="lg:col-span-5 space-y-4">
          <section className="card p-5 border-2 border-[var(--action)] rounded-2xl bg-[var(--surface)] shadow-md space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--action)] uppercase tracking-wider">
                نتیجه محاسبات {simulateJob ? "(سناریوی اشتغال)" : "(سناریوی بدون شغل)"}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--sunken)] text-[var(--text-3)]">
                افق {toFaDigits(String(horizon))} ماهه
              </span>
            </div>

            <div className="space-y-2.5 text-xs text-[var(--text-2)]">
              <div className="flex justify-between">
                <span>مخارج زندگی ({toFaDigits(String(horizon))} ماه):</span>
                <span className="font-semibold text-[var(--text)] num">{full(totalLivingToman)}</span>
              </div>
              <div className="flex justify-between">
                <span>تعهدات و اقساط سررسید:</span>
                <span className="font-semibold text-[var(--text)] num">{full(totalObligationsToman)}</span>
              </div>
              {bufferPct > 0 && (
                <div className="flex justify-between text-[var(--text-3)]">
                  <span>حاشیه اطمینان ({toFaDigits(String(bufferPct))}٪):</span>
                  <span className="num">+{short(bufferToman)} تومان</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-[var(--border)] font-bold text-[var(--text)]">
                <span>کل خروجی نقدی مورد نیاز:</span>
                <span className="num">{full(grossNeedToman)}</span>
              </div>
              <div className="flex justify-between text-[var(--positive)]">
                <span>موجودی تومان نقد (بانک + صرافی):</span>
                <span className="num font-semibold">−{full(readyToman)}</span>
              </div>
              {simulateJob && totalSalaryInHorizon > 0 && (
                <div className="flex justify-between text-[var(--positive)] font-semibold">
                  <span>درآمد کاری این دوره:</span>
                  <span className="num">−{full(totalSalaryInHorizon)}</span>
                </div>
              )}
            </div>

            {/* کادر قرمز/سبز کسری و تتر */}
            <div
              className={`p-4 rounded-xl border ${
                activeDeficitToman > 0
                  ? "bg-[var(--negative-soft)] border-[var(--negative)] text-[var(--negative)]"
                  : "bg-[var(--positive-soft)] border-[var(--positive)] text-[var(--positive)]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold">
                  {activeDeficitToman > 0 ? "کسری نقدینگی ریالی نهایی" : "پوشش کامل ریالی (بدون نیاز به تتر)"}
                </span>
                <span className="text-sm font-black num">
                  {activeDeficitToman > 0
                    ? full(activeDeficitToman)
                    : `${full(readyToman + totalSalaryInHorizon - grossNeedToman)} مازاد`}
                </span>
              </div>

              {activeDeficitToman > 0 ? (
                <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
                  <p className="text-xs text-[var(--text-2)] mb-1">تتر مورد نیاز جهت فروش در بیت‌پین:</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[var(--text)] num">{num(activeNeededUsdt)}</span>
                    <span className="text-sm font-bold text-[var(--text)]">USDT</span>
                    {simulateJob && savedUsdtWithJob > 0 && (
                      <span className="text-xs text-[var(--positive)] mr-auto font-bold">
                        ({num(savedUsdtWithJob)} تتر کمتر از حالت بدون شغل)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-3)] mt-2">
                    مانده تتر پس از تبدیل: <strong className="num text-[var(--text)]">{num(activeRemainingUsdt)} USDT</strong>
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-2)] mt-2">
                  {simulateJob
                    ? "با درآمد حاصل از شغل، هزینه‌ها و اقساط شما کاملاً تأمین است و نیازی به فروش حتی ۱ تتر ندارید!"
                    : "موجودی تومان در بانک و بیت‌پین برای کل این دوره کافی است و نیازی به تبدیل تتر ندارید."}
                </p>
              )}
            </div>

            {/* دکمه ارسال به دستیار هوشمند */}
            <button
              type="button"
              onClick={askAssistantWithScenario}
              className="w-full py-2.5 px-3 rounded-xl bg-[var(--action)] text-[var(--on-ink)] font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 transition-opacity"
            >
              <Icon name="sparkle" size={14} />
              دریافت گزارش تفصیلی و تحلیل این سناریو از دستیار
            </button>
          </section>
        </div>
      </div>

      {/* ── جدول ماتریس تحلیل حساسیت نرخ تتر (FX Sensitivity Analysis) ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
              <Icon name="reports" size={16} />
              ماتریس تحلیل حساسیت: اگر قیمت دلار تغییر کند، چند تتر باید بفروشید؟
            </h3>
            <p className="text-xs text-[var(--text-3)] mt-0.5">
              مهندسی سناریوهای نوسان نرخ تبدیل برای کسری نقدینگی {short(activeDeficitToman)} تومان:
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-3)] bg-[var(--sunken)]">
                <th className="py-2.5 px-3">سناریوی نرخ تتر</th>
                <th className="py-2.5 px-3">نرخ هر تتر (تومان)</th>
                <th className="py-2.5 px-3">تتر لازم جهت فروش</th>
                <th className="py-2.5 px-3">مانده تتر پس از فروش</th>
                <th className="py-2.5 px-3">درصد حفظ سرمایه</th>
                <th className="py-2.5 px-3">ارزیابی فنی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sensitivityRates.map((r, i) => {
                const req = activeDeficitToman > 0 ? Math.ceil(activeDeficitToman / r) : 0;
                const rem = Math.max(0, totalUsdt - req);
                const preservedPct = totalUsdt > 0 ? Math.round((rem / totalUsdt) * 100) : 100;
                const isCurrent = r === rate;

                return (
                  <tr
                    key={r}
                    className={`transition-colors ${
                      isCurrent
                        ? "bg-[var(--accent-soft)]/40 font-bold"
                        : "hover:bg-[var(--sunken)]"
                    }`}
                  >
                    <td className="py-2.5 px-3">
                      {i === 0
                        ? "افت ۱۰٪ نرخ"
                        : isCurrent
                          ? "نرخ انتخابی فعلی"
                          : i === 2
                            ? "رشد ۱۰٪ نرخ"
                            : "رشد ۲۵٪ نرخ"}
                    </td>
                    <td className="py-2.5 px-3 num font-semibold">{num(r)} تومان</td>
                    <td className="py-2.5 px-3 num text-[var(--negative)] font-black">
                      {num(req)} USDT
                    </td>
                    <td className="py-2.5 px-3 num text-[var(--positive)] font-semibold">
                      {num(rem)} USDT
                    </td>
                    <td className="py-2.5 px-3 num">{toFaDigits(String(preservedPct))}٪</td>
                    <td className="py-2.5 px-3 text-[var(--text-3)]">
                      {r > rate
                        ? "صرفه‌جویی بیشتر در تتر با افزایش نرخ"
                        : r < rate
                          ? "نیاز به تبدیل تتر بیشتر"
                          : "مبنای فعلی محاسبات"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── مراحل ۳ گانه تأمین نقدینگی (بیت‌پین → بانک → اقساط) ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <Icon name="swap" size={16} />
            مراحل اجرایی تأمین نقدینگی (بیت‌پین → بانک → اقساط)
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1">
            برای جلوگیری از اتلاف کارمزد و استرس سررسید، مراحل تبدیل و انتقال را دقیقاً در سه گام زیر اجرا کنید:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* گام ۱ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[var(--action)] text-[var(--on-ink)] text-xs font-black flex items-center justify-center num">
                ۱
              </span>
              <span className="text-xs font-bold text-[var(--text)]">فروش تتر در بیت‌پین</span>
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              تعداد <strong className="num text-[var(--text)]">{num(activeNeededUsdt)} تتر</strong> را در بازار تتر/تومان صرافی بیت‌پین به صورت سفارش عادی (Maker) برای کاهش کارمزد بفروشید.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              ارزش تومانی حاصل: <strong className="num text-[var(--text)]">{short(activeNeededUsdt * rate)} تومان</strong>
            </div>
          </div>

          {/* گام ۲ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[var(--action)] text-[var(--on-ink)] text-xs font-black flex items-center justify-center num">
                ۲
              </span>
              <span className="text-xs font-bold text-[var(--text)]">تسویه پایا به حساب بانکی</span>
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              مبلغ <strong className="num text-[var(--text)]">{short(activeDeficitToman)} تومان</strong> را از کیف پول ریالی بیت‌پین به حساب بانکی اصلی خود (مثلاً سامان یا بلوبانک) ثبت برداشت کنید.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              زمان تسویه: سیکل‌های پایا (حدود ساعت ۳:۴۵ یا ۱۳:۴۵ کاری)
            </div>
          </div>

          {/* گام ۳ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[var(--positive)] text-[var(--on-ink)] text-xs font-black flex items-center justify-center num">
                ۳
              </span>
              <span className="text-xs font-bold text-[var(--text)]">پرداخت اقساط و شارژ مخارج</span>
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              مبلغ اقساط را در سررسیدها پرداخت کنید و مانده را برای هزینه‌های روزانه ماه جاری در حساب نگه دارید تا سرمایه ترید دست‌نخورده بماند.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              آرامش فکری: استرس روزمره از معاملات ترید کاملاً حذف می‌شود.
            </div>
          </div>
        </div>
      </section>

      {/* ── راهبرد اساسی و ماتریس تصمیم‌گیری بیکاری / اشتغال ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <Icon name="shield" size={16} />
            نقشه راه مهندسی مالی: مدیریت دوگانه (بیکاری در برابر اشتغال)
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1">
            پروتکل مدیریت ثروت و ترید برای هر دو مسیر پیش‌روی شما:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* مسیر اول: اگر کار پیدا نشد */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-3">
            <div className="flex items-center gap-2 text-[var(--warning)] font-bold text-sm">
              <Icon name="alert" size={16} />
              مسیر ۱: اگر تا ۶ ماه آینده کار پیدا نشد
            </div>
            <ul className="text-xs text-[var(--text-2)] space-y-2 list-disc list-inside leading-relaxed">
              <li>
                <strong>کاهش نرخ سوخت ماهانه (Burn-rate):</strong> هزینه‌های غیرضروری و اشتراک‌ها را به حداقل برسانید تا هر ماه تتر کمتری فروخته شود.
              </li>
              <li>
                <strong>حفاظت از صندوق بقا (Emergency Fund):</strong> حداقل معادل ۶ ماه مخارج را در تتر امن هولد نگه دارید و تحت هیچ شرایطی وارد پوزیشن لوریج یا پرریسک نکنید.
              </li>
              <li>
                <strong>محدودیت سقف سرمایه ترید:</strong> با حداکثر {toFaDigits(String(tradingPortionPct))}٪ از تترها معامله کنید (معادل <span className="num font-bold text-[var(--text)]">{num(safeTradingUsdt)} USDT</span>) تا افت بازار زندگی شما را فلج نکند.
              </li>
              <li>
                <strong>فروش پله‌ای بر مبنای نیاز ماهانه:</strong> تتر را یکجا نقد نکنید؛ فقط در اول هر ماه به اندازه نیاز قطعی همان ماه به ریال تبدیل کنید.
              </li>
            </ul>
          </div>

          {/* مسیر دوم: اگر کار پیدا شد */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-3">
            <div className="flex items-center gap-2 text-[var(--positive)] font-bold text-sm">
              <Icon name="check-circle" size={16} />
              مسیر ۲: به محض یافتن شغل و درآمد ریالی
            </div>
            <ul className="text-xs text-[var(--text-2)] space-y-2 list-disc list-inside leading-relaxed">
              <li>
                <strong>قطع کامل فروش تتر:</strong> درآمد حقوق، هزینه‌های جاری و اقساط را پوشش می‌دهد و فروش تتر متوقف می‌شود.
              </li>
              <li>
                <strong>رشد مرکب تترها (Compounding):</strong> تمام تترها و استیبل‌کوین‌های شما دست‌نخورده باقی می‌مانند و از تورم ریال سبقت می‌گیرند.
              </li>
              <li>
                <strong>ترید با آرامش روانی مطلق:</strong> چون دغدغه مخارج ندارید، تصمیمات ترید منطقی‌تر، بدون احساسات و کم‌ریسک‌تر خواهند بود.
              </li>
              <li>
                <strong>امکان شارژ سرمایه:</strong> مازاد حقوق را می‌توانید دوباره به تتر تبدیل کنید و دارایی دلاری خود را گسترش دهید.
              </li>
            </ul>
          </div>
        </div>

        {/* اسلایدر تخصیص سرمایه به ترید */}
        <div className="p-4 rounded-xl bg-[var(--sunken)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-[var(--text)]">سهم سرمایه اختصاص‌یافته به ترید فعال:</p>
            <p className="text-[11px] text-[var(--text-3)]">
              از کل {num(totalUsdt)} تتر: معادل <strong className="num text-[var(--text)]">{num(safeTradingUsdt)} USDT</strong> درگیر در ترید و <strong className="num text-[var(--positive)]">{num(emergencyReserveUsdt)} USDT</strong> در صندوق امنیت دست‌نخورده
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[5, 10, 15, 20].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTradingPortionPct(p)}
                className={`py-1 px-3 text-xs rounded-lg font-bold border transition-colors ${
                  tradingPortionPct === p
                    ? "bg-[var(--action)] text-[var(--on-ink)] border-[var(--action)]"
                    : "bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)]"
                }`}
              >
                {toFaDigits(String(p))}٪
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
