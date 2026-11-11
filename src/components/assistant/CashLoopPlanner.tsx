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
  const bankToman = s.netWorth.availableCashToman;
  const exchangeToman = s.netWorth.exchangeTomanToman;
  const stablecoinToman = s.netWorth.stablecoinToman;
  const baseRate = s.usdToToman > 0 ? s.usdToToman : 70000;

  // Filter bank and exchange accounts
  const bankAccounts = s.accounts.filter(
    (a) => a.kind === "bank" || (["IRT", "IRR"].includes(a.currency) && a.kind !== "exchange"),
  );
  const exchangeAccounts = s.accounts.filter(
    (a) =>
      a.kind === "exchange" ||
      a.name.includes("بیت") ||
      a.name.includes("والکس") ||
      a.name.includes("نوبیتکس"),
  );
  const stablecoinAccounts = s.accounts.filter(
    (a) => ["USDT", "USDC", "DAI"].includes(a.currency) || a.name.includes("تتر"),
  );

  // Exact USDT quantity from accounts or derived
  const actualUsdtHoldings = stablecoinAccounts.reduce((sum, a) => sum + (a.balance > 0 ? a.balance : 0), 0);
  const totalUsdt = actualUsdtHoldings > 0 ? Math.round(actualUsdtHoldings) : Math.round(stablecoinToman / baseRate);

  // Default monthly expense from actual system analysis, with sane fallback
  const defaultMonthlyExpense =
    s.cashflow.avgMonthlyExpenseToman > 0
      ? s.cashflow.avgMonthlyExpenseToman
      : s.cashflow.currentMonth.expenseToman > 0
        ? s.cashflow.currentMonth.expenseToman
        : 18_000_000;

  // ── Interactive user controls ──
  const [horizon, setHorizon] = useState<Horizon>(1);
  const [monthlyExpense, setMonthlyExpense] = useState<number>(defaultMonthlyExpense);
  const [rate, setRate] = useState<number>(baseRate);
  const [bufferPct, setBufferPct] = useState<number>(5);
  const [tradingPortionPct, setTradingPortionPct] = useState<number>(10);

  // ── Obligations within the selected horizon ──
  const today = s.asOf || todayIso();
  const maxDays = horizon * 30;

  const obligationsInWindow = useMemo(() => {
    return s.obligations.upcoming.filter((u) => {
      const days = daysUntilIso(u.date, today);
      return days >= 0 && days <= maxDays;
    });
  }, [s.obligations.upcoming, today, maxDays]);

  const totalObligationsToman = useMemo(() => {
    return obligationsInWindow.reduce((sum, u) => sum + u.toman, 0);
  }, [obligationsInWindow]);

  // ── Calculations ──
  const totalLivingToman = monthlyExpense * horizon;
  const baseNeedToman = totalLivingToman + totalObligationsToman;
  const bufferToman = Math.round(baseNeedToman * (bufferPct / 100));
  const grossNeedToman = baseNeedToman + bufferToman;

  // Ready Toman liquidity (Bank + Exchange Toman already available)
  const readyToman = bankToman + exchangeToman;
  const deficitToman = Math.max(0, grossNeedToman - readyToman);

  // How many USDT must be sold on Bitpin?
  const neededUsdt = deficitToman > 0 ? Math.ceil(deficitToman / Math.max(1, rate)) : 0;
  const usdtCoverageRatio = totalUsdt > 0 ? neededUsdt / totalUsdt : 0;
  const remainingUsdt = Math.max(0, totalUsdt - neededUsdt);

  // Runway calculation (months until liquid cash + stablecoins exhaust)
  const totalLiquidNetWorthToman = readyToman + totalUsdt * rate;
  const monthlyBurnToman = monthlyExpense + (horizon > 0 ? totalObligationsToman / horizon : 0);
  const runwayMonths =
    monthlyBurnToman > 0 ? Math.round((totalLiquidNetWorthToman / monthlyBurnToman) * 10) / 10 : 0;

  // Trading allocation
  const safeTradingUsdt = Math.round((totalUsdt * tradingPortionPct) / 100);
  const emergencyReserveUsdt = Math.max(0, totalUsdt - safeTradingUsdt);

  // Dispatch question to AI Assistant
  const askAssistantWithScenario = () => {
    const text = `من حسابگر نقدینگی و تبدیل تتر را برای افق ${toFaDigits(String(horizon))} ماهه بررسی کردم:
- مخارج زندگی ماهانه: ${full(monthlyExpense)}
- مجموع اقساط و تعهدات این دوره: ${full(totalObligationsToman)}
- نیاز کل نقدینگی: ${full(grossNeedToman)}
- موجودی تومان بانک و صرافی: ${full(readyToman)}
- کسری نقدینگی: ${full(deficitToman)}
- تتر مورد نیاز برای فروش در بیت‌پین: ${num(neededUsdt)} تتر (به نرخ ${num(rate)} تومان)
- کل موجودی تتر: ${num(totalUsdt)} تتر
با توجه به اینکه بیکار هستم و با حدود ${toFaDigits(String(tradingPortionPct))}٪ تترها ترید می‌کنم، نظرت درباره این برنامه نقدینگی چیه و چطور سود و ریسک تریدم را با هزینه‌های واقعی بالانس کنم؟`;
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
            <h2 className="text-xl font-bold text-[var(--text)]">صندوق مخارج تتری، پرداخت اقساط و تاب‌آوری</h2>
            <p className="text-sm text-[var(--text-2)] max-w-2xl leading-relaxed">
              این بخش مستقیماً حساب بانکی، کیف پول تتر در بیت‌پین و اقساط شما را مدیریت می‌کند تا مشخص شود چه میزان تتر به عنوان «صندوق مخارج» باید از سرمایه ترید جدا شده و به ریال تبدیل شود.
            </p>
          </div>
          <div className="text-center px-4 py-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)] shrink-0 min-w-[170px]">
            <p className="text-xs text-[var(--text-3)] mb-1">تاب‌آوری نقدینگی بدون شغل</p>
            <p className="text-2xl font-black num text-[var(--positive)]">
              {toFaDigits(runwayMonths.toFixed(1))} <span className="text-sm font-normal">ماه</span>
            </p>
            <p className="text-[11px] text-[var(--text-3)] mt-0.5">پوشش کامل هزینه‌ها و اقساط</p>
          </div>
        </div>
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
              <span className="text-xs font-bold text-[var(--action)] uppercase tracking-wider">نتیجه محاسبات</span>
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
            </div>

            {/* کادر قرمز/سبز کسری و تتر */}
            <div
              className={`p-4 rounded-xl border ${
                deficitToman > 0
                  ? "bg-[var(--negative-soft)] border-[var(--negative)] text-[var(--negative)]"
                  : "bg-[var(--positive-soft)] border-[var(--positive)] text-[var(--positive)]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold">
                  {deficitToman > 0 ? "کسری نقدینگی ریالی" : "مازاد نقدینگی ریالی"}
                </span>
                <span className="text-sm font-black num">
                  {deficitToman > 0 ? full(deficitToman) : `${full(readyToman - grossNeedToman)} مازاد`}
                </span>
              </div>

              {deficitToman > 0 ? (
                <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
                  <p className="text-xs text-[var(--text-2)] mb-1">تتر مورد نیاز جهت فروش در بیت‌پین:</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[var(--text)] num">{num(neededUsdt)}</span>
                    <span className="text-sm font-bold text-[var(--text)]">USDT</span>
                    <span className="text-xs text-[var(--text-3)] mr-auto">
                      ({toFaDigits((usdtCoverageRatio * 100).toFixed(0))}٪ از کل تترها)
                    </span>
                  </div>
                  <p className="text-[11px] text-[var(--text-3)] mt-2">
                    مانده تتر پس از تبدیل: <strong className="num text-[var(--text)]">{num(remainingUsdt)} USDT</strong>
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-2)] mt-2">
                  موجودی تومان در بانک و بیت‌پین برای کل این دوره کافی است و نیازی به تبدیل تتر ندارید.
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
              مشاوره و تحلیل این سناریو با دستیار هوشمند
            </button>
          </section>
        </div>
      </div>

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
              تعداد <strong className="num text-[var(--text)]">{num(neededUsdt)} تتر</strong> را در بازار تتر/تومان صرافی بیت‌پین به صورت سفارش عادی (Maker) برای کاهش کارمزد بفروشید.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              ارزش تومانی حاصل: <strong className="num text-[var(--text)]">{short(neededUsdt * rate)} تومان</strong>
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
              مبلغ <strong className="num text-[var(--text)]">{short(deficitToman)} تومان</strong> را از کیف پول ریالی بیت‌پین به حساب بانکی اصلی خود (مثلاً سامان یا بلوبانک) ثبت برداشت کنید.
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

      {/* ── راهبرد اساسی برای شرایط بیکاری و ترید با استیبل‌کوین‌ها ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <Icon name="shield" size={16} />
            راهکار اساسی بقا مالی و پاسخ به: «آیا سود ترید درآمد است؟»
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1">
            قوانین اثبات‌شده مالی برای کسی که شغل ثابت ندارد و با بخشی از استیبل‌کوین‌ها معامله می‌کند:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* کارت ۱: تمایز سود ترید از درآمد */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2 text-[var(--negative)] font-bold text-xs">
              <Icon name="alert" size={14} />
              سود ترید «درآمد» نیست؛ سود سرمایه است!
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              در حسابداری، <strong>درآمد (Income)</strong> بدون کاهش ریسک یا اصل سرمایه ایجاد می‌شود (مثل حقوق یا اجاره). اما ترید نوسان دارد و در ماه‌های رِنج یا نزولی ممکن است سود صفر یا منفی شود. اگر سود ترید را مستقیماً خرج مخارج کنید، در واقع دارید از اصل سرمایه تغذیه می‌کنید.
            </p>
          </div>

          {/* کارت ۲: قانون سه سبد (Three-Bucket Rule) */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2 text-[var(--accent)] font-bold text-xs">
              <Icon name="overview" size={14} />
              تفکیک سه سبد دارایی (قانون تفکیک)
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              <strong>سبد ۱ (صندوق بقا):</strong> ۶ ماه هزینه زندگی و اقساط در بانک و تتر امن (دست‌نخورده).<br />
              <strong>سبد ۲ (دارایی پایه):</strong> هولد، طلا یا ملک برای حفظ قدرت خرید.<br />
              <strong>سبد ۳ (ترید):</strong> حداکثر {toFaDigits(String(tradingPortionPct))}٪ از استیبل‌کوین‌ها، تا با خیال راحت و بدون استرس معامله کنید.
            </p>
          </div>

          {/* کارت ۳: فرمول ۳۰/۷۰ برداشت سود */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2 text-[var(--positive)] font-bold text-xs">
              <Icon name="trend-up" size={14} />
              فرمول برداشت امن (قانون ۳۰/۷۰)
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              هر زمان ترید شما سودده بود، همه آن را برداشت نکنید:<br />
              • <strong>۳۰٪ سود</strong> را به عنوان حقوق شخصی یا پاداش برداشت کنید.<br />
              • <strong>۷۰٪ مابقی</strong> را به اصل سرمایه ترید اضافه کنید تا اثر تورم، افت احتمالی بعدی و کارمزدها پوشش داده شود.
            </p>
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
