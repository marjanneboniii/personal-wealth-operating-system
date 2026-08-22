"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeSetupAction, fetchSetupStateAction, type ActionResult } from "@/app/actions";
import { getTranslations } from "@/i18n";
import { D } from "@/domain/decimal";
import { currencyLabel, faCount, formatMoney, formatQty } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";

const t = getTranslations("fa").setup;

type MoneySymbol = "IRT" | "USD" | "USDT";

const MONEY_DENOMS: { symbol: MoneySymbol; label: string }[] = [
  { symbol: "IRT", label: "تومان" },
  { symbol: "USD", label: "دلار" },
  { symbol: "USDT", label: "تتر" },
];

function amountUnit(symbol: MoneySymbol) {
  return symbol === "IRT" ? "toman" : symbol === "USDT" ? "usdt" : "usd";
}

function nativeToBookUsd(qty: ReturnType<typeof D>, symbol: MoneySymbol, rate: ReturnType<typeof D>) {
  if (!qty.gt(0)) return D("0");
  if (symbol === "IRT") return rate.gt(0) ? qty.div(rate) : D("0");
  return qty;
}

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [setupStatus, setSetupStatus] = useState<"loading" | "pending" | "completed">("loading");
  const [usdIrtRate, setUsdIrtRate] = useState("190000");

  useEffect(() => {
    let active = true;
    fetchSetupStateAction()
      .then((state) => {
        if (!active) return;
        // LOGIN-GATED APP: an anonymous visitor never runs the wizard —
        // they are sent to /login (landing stays the public surface).
        if ((state as { loginRequired?: boolean }).loginRequired) {
          router.replace("/login");
          return;
        }
        setSetupStatus(state.completed ? "completed" : "pending");
        if (state.usdIrtRate) setUsdIrtRate(state.usdIrtRate);
      })
      .catch(() => {
        if (active) setSetupStatus("pending");
      });
    return () => {
      active = false;
    };
  }, [router]);

  // Step 1 State
  const [userName, setUserName] = useState("مالک خانواده");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [displayCurrency, setDisplayCurrency] = useState("IRT");
  const [dateCalendar, setDateCalendar] = useState<"jalali" | "gregorian">("jalali");
  const [digitStyle, setDigitStyle] = useState<"fa" | "en">("fa");

  // Step 2 State — names + native denomination (independent of book USD).
  // NO hardcoded bank/account names (Directive §0): the user names their own
  // accounts; only a neutral generic fallback exists server-side.
  const [bankAccountName, setBankAccountName] = useState("");
  const [cashWalletName, setCashWalletName] = useState("صندوق خانگی");
  const [bankAssetSymbol, setBankAssetSymbol] = useState<MoneySymbol>("IRT");
  const [cashAssetSymbol, setCashAssetSymbol] = useState<MoneySymbol>("IRT");

  // Step 3 State — amounts are native units of the selected denomination
  const [bankOpeningBalance, setBankOpeningBalance] = useState("");
  const [cashOpeningBalance, setCashOpeningBalance] = useState("");
  const [cryptoOpeningQty, setCryptoOpeningQty] = useState("");
  const [cryptoUnitPrice, setCryptoUnitPrice] = useState("");
  const [goldOpeningQty, setGoldOpeningQty] = useState("");
  const [goldUnitPrice, setGoldUnitPrice] = useState("");

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, fd) => {
      const res = await completeSetupAction(prev, fd);
      if (res.ok) {
        setSetupStatus("completed");
        setTimeout(() => router.push("/"), 1000);
      }
      return res;
    },
    null,
  );

  // Unit label for crypto/gold cost basis (book currency remains USD).
  const baseUnit = baseCurrency === "IRT" ? "toman" : baseCurrency === "IRR" ? "rial" : baseCurrency === "EUR" ? "eur" : "usd";
  const bankUnit = amountUnit(bankAssetSymbol);
  const cashUnit = amountUnit(cashAssetSymbol);
  const fxRate = D(usdIrtRate || "0");

  // Preview: native qty per account + server-style USD book value (non-authoritative).
  const previewData = useMemo(() => {
    const bankQty = D(bankOpeningBalance || "0");
    const cashQty = D(cashOpeningBalance || "0");
    const bankBook = nativeToBookUsd(bankQty, bankAssetSymbol, fxRate);
    const cashBook = nativeToBookUsd(cashQty, cashAssetSymbol, fxRate);
    const ethQty = D(cryptoOpeningQty || "0");
    const ethPrice = D(cryptoUnitPrice || "0");
    const ethVal = ethQty.mul(ethPrice);
    const goldQty = D(goldOpeningQty || "0");
    const goldPrice = D(goldUnitPrice || "0");
    const goldVal = goldQty.mul(goldPrice);

    const totalEquity = bankBook.add(cashBook).add(ethVal).add(goldVal);

    return {
      bankQty: bankQty.toString(),
      cashQty: cashQty.toString(),
      bankBook: bankBook.toString(),
      cashBook: cashBook.toString(),
      ethQty: ethQty.toString(),
      ethVal: ethVal.toString(),
      goldQty: goldQty.toString(),
      goldVal: goldVal.toString(),
      totalEquity: totalEquity.toString(),
      hasItems: totalEquity.gt(0) || bankQty.gt(0) || cashQty.gt(0) || ethQty.gt(0) || goldQty.gt(0),
    };
  }, [
    bankOpeningBalance,
    cashOpeningBalance,
    bankAssetSymbol,
    cashAssetSymbol,
    usdIrtRate,
    cryptoOpeningQty,
    cryptoUnitPrice,
    goldOpeningQty,
    goldUnitPrice,
  ]);

  if (setupStatus === "loading") {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="card p-8 text-center">
          <p className="muted text-sm" role="status">در حال بررسی وضعیت راه‌اندازی…</p>
        </div>
      </div>
    );
  }

  if (setupStatus === "completed") {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="card rise space-y-4 p-6 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-xl" style={{ background: "var(--positive-soft)", color: "var(--positive)" }}>✓</span>
          <div>
            <h1 className="text-xl font-bold">راه‌اندازی اولیه کامل است</h1>
            <p className="muted mt-2 text-xs leading-6">
              حساب‌های پایه آماده‌اند. برای افزودن بانک، صندوق، صرافی یا کیف‌پول از بخش حساب‌ها استفاده کنید.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/accounts" className="btn btn-primary">مدیریت حساب‌ها و کیف‌پول‌ها</Link>
            <Link href="/" className="btn btn-ghost">بازگشت به نمای کلی</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl py-6">
      <div className="card rise p-6">
        <header className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
          <p className="muted mt-1 text-xs">{t.subtitle}</p>

          {/* Stepper Progress */}
          <div className="mt-6 flex items-center justify-center gap-2">
            {[1, 2, 3, 4].map((s) => (
              <div
                key={s}
                className="flex items-center gap-2"
                onClick={() => s < step && setStep(s)}
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    s === step
                      ? "bg-[var(--brand)] text-white shadow-md"
                      : s < step
                        ? "bg-[var(--brand-soft)] text-[var(--brand)] cursor-pointer"
                        : "bg-[var(--border)] muted"
                  }`}
                >
                  {s}
                </span>
                {s < 4 && <div className="h-0.5 w-8 bg-[var(--border)]" />}
              </div>
            ))}
          </div>
        </header>

        <form action={formAction} className="space-y-6">
          {/* Hidden Form Inputs */}
          <input type="hidden" name="userName" value={userName} />
          <input type="hidden" name="baseCurrency" value={baseCurrency} />
          <input type="hidden" name="displayCurrency" value={displayCurrency} />
          <input type="hidden" name="dateCalendar" value={dateCalendar} />
          <input type="hidden" name="digitStyle" value={digitStyle} />
          <input type="hidden" name="bankAccountName" value={bankAccountName} />
          <input type="hidden" name="cashWalletName" value={cashWalletName} />
          <input type="hidden" name="bankAssetSymbol" value={bankAssetSymbol} />
          <input type="hidden" name="cashAssetSymbol" value={cashAssetSymbol} />
          <input type="hidden" name="bankOpeningBalance" value={bankOpeningBalance} />
          <input type="hidden" name="cashOpeningBalance" value={cashOpeningBalance} />
          <input type="hidden" name="cryptoOpeningQty" value={cryptoOpeningQty} />
          <input type="hidden" name="cryptoUnitPrice" value={cryptoUnitPrice} />
          <input type="hidden" name="goldOpeningQty" value={goldOpeningQty} />
          <input type="hidden" name="goldUnitPrice" value={goldUnitPrice} />

          {/* STEP 1 */}
          {step === 1 && (
            <section className="space-y-4">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">{t.step1Title}</h2>
                <p className="muted text-xs">{t.step1Desc}</p>
              </div>

              <div>
                <label className="label">{t.userNameLabel}</label>
                <input
                  type="text"
                  required
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  placeholder={t.userNamePlaceholder}
                  className="field"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">{t.accountingCurrencyLabel}</label>
                  <select
                    value={baseCurrency}
                    onChange={(e) => setBaseCurrency(e.target.value)}
                    className="field"
                  >
                    <option value="USD">دلار</option>
                    <option value="EUR">یورو</option>
                    <option value="IRT">تومان</option>
                    <option value="IRR">ریال</option>
                  </select>
                  <p className="muted mt-1 text-[10px]">{t.accountingCurrencyHelp}</p>
                </div>

                <div>
                  <label className="label">{t.displayCurrencyLabel}</label>
                  <select
                    value={displayCurrency}
                    onChange={(e) => setDisplayCurrency(e.target.value)}
                    className="field"
                  >
                    <option value="IRT">تومان</option>
                    <option value="USD">دلار</option>
                    <option value="EUR">یورو</option>
                  </select>
                  <p className="muted mt-1 text-[10px]">{t.displayCurrencyHelp}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">{t.dateCalendarLabel}</label>
                  <select
                    value={dateCalendar}
                    onChange={(e) => setDateCalendar(e.target.value as "jalali" | "gregorian")}
                    className="field"
                  >
                    <option value="jalali">{t.dateCalendarJalali}</option>
                    <option value="gregorian">{t.dateCalendarGregorian}</option>
                  </select>
                </div>

                <div>
                  <label className="label">سبد نمایش ارقام</label>
                  <select
                    value={digitStyle}
                    onChange={(e) => setDigitStyle(e.target.value as "fa" | "en")}
                    className="field"
                  >
                    <option value="fa">فارسی (۱۲۳۴۵۶۷۸۹۰)</option>
                    <option value="en">English (1234567890)</option>
                  </select>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setStep(2)}
                className="btn btn-primary w-full"
              >
                ادامه به مرحله بعد ←
              </button>
            </section>
          )}

          {/* STEP 2 */}
          {step === 2 && (
            <section className="space-y-4">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">{t.step2Title}</h2>
                <p className="muted text-xs">{t.step2Desc}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">{t.mainBankAccount}</label>
                  <input
                    type="text"
                    required
                    value={bankAccountName}
                    onChange={(e) => setBankAccountName(e.target.value)}
                    placeholder="مثلاً حساب بانکی اصلی"
                    className="field"
                  />
                </div>
                <div>
                  <label className="label">{t.accountDenominationLabel}</label>
                  <select
                    value={bankAssetSymbol}
                    onChange={(e) => setBankAssetSymbol(e.target.value as MoneySymbol)}
                    className="field"
                  >
                    {MONEY_DENOMS.map((item) => (
                      <option key={item.symbol} value={item.symbol}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                  <span className="chip mt-1 inline-block">{t.bookCurrencyChip}</span>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">
                    {t.cashWallet} <span className="muted">(اختیاری)</span>
                  </label>
                  <input
                    type="text"
                    value={cashWalletName}
                    onChange={(e) => setCashWalletName(e.target.value)}
                    className="field"
                    placeholder="خالی بگذارید تا بعداً از ماژول حساب‌ها اضافه کنید"
                  />
                </div>
                <div>
                  <label className="label">{t.accountDenominationLabel}</label>
                  <select
                    value={cashAssetSymbol}
                    onChange={(e) => setCashAssetSymbol(e.target.value as MoneySymbol)}
                    className="field"
                  >
                    {MONEY_DENOMS.map((item) => (
                      <option key={item.symbol} value={item.symbol}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="card soft p-3 text-[11px] leading-6">
                <strong>چه چیزهایی ساخته می‌شود:</strong>
                <ul className="mt-1 list-disc space-y-0.5 pr-4">
                  <li>حساب بانکی اصلی — صندوق نقد فقط در صورت تمایل</li>
                  <li>دسته‌های بدهی، درآمد و هزینه خانوار</li>
                  <li>سرمایه اولیه برای شروع تصویر ثروت</li>
                </ul>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn w-1/3"
                >
                  ← قبلی
                </button>
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="btn btn-primary w-2/3"
                >
                  ادامه به مرحله بعد ←
                </button>
              </div>
            </section>
          )}

          {/* STEP 3 */}
          {step === 3 && (
            <section className="space-y-4">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">{t.step3Title}</h2>
                <p className="muted text-xs">{t.step3Desc}</p>
              </div>

              <p className="muted text-[11px] leading-5">{t.openingBalanceHelp}</p>
              <span className="chip inline-block">{t.bookCurrencyChip}</span>

              {/* فقط حساب بانکی الزامی است؛ بقیه موجودی‌ها کاملاً اختیاری هستند. */}
              <div>
                <label className="label">{t.cashAmount} ({currencyLabel(bankAssetSymbol)})</label>
                <AmountInput
                  type="text"
                  inputMode="decimal"
                  value={bankOpeningBalance}
                  onChange={(e) => setBankOpeningBalance(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder={bankAssetSymbol === "IRT" ? "مثلاً 35000000" : "0.00"}
                  className="field num"
                  dir="ltr"
                  unit={bankUnit}
                />
                {D(previewData.bankQty).gt(0) && (
                  <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--brand)" }}>
                    {t.bookValueApprox}: ≈ {formatMoney(previewData.bankBook, "USD")}
                  </p>
                )}
                <p className="muted mt-1 text-[10px] leading-5">
                  مبلغ را به واحد {currencyLabel(bankAssetSymbol)} همین حساب وارد کنید. اگر موجودی ندارید خالی بگذارید.
                </p>
              </div>

              {/* موجودی‌های اختیاری — صندوق نقد، رمزارز و طلا (بعداً هم از ماژول حساب‌ها قابل افزودن است) */}
              <details className="card soft rounded-[var(--r-md)] p-3">
                <summary className="cursor-pointer list-none text-xs font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                  موجودی‌های اختیاری — صندوق نقد، رمزارز و طلا
                  <span className="chip mr-2 text-[10px]">اختیاری</span>
                </summary>

                <div className="mt-3 space-y-3">
                  <div>
                    <label className="label">موجودی صندوق نقد ({currencyLabel(cashAssetSymbol)}) — اختیاری</label>
                    <AmountInput
                      type="text"
                      inputMode="decimal"
                      value={cashOpeningBalance}
                      onChange={(e) => setCashOpeningBalance(e.target.value.replace(/[^\d.]/g, ""))}
                      placeholder={cashAssetSymbol === "IRT" ? "مثلاً 5000000" : "0.00"}
                      className="field num"
                      dir="ltr"
                      unit={cashUnit}
                    />
                    {D(previewData.cashQty).gt(0) && (
                      <p className="mt-1 text-[11px] leading-5" style={{ color: "var(--brand)" }}>
                        {t.bookValueApprox}: ≈ {formatMoney(previewData.cashBook, "USD")}
                      </p>
                    )}
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">مقدار اتریوم (ETH)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={cryptoOpeningQty}
                        onChange={(e) => setCryptoOpeningQty(e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="0.0000"
                        className="field num"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="label">قیمت خرید هر اتریوم ({currencyLabel(baseCurrency)}) — فقط Cost Basis افتتاحیه</label>
                      <AmountInput
                        type="text"
                        inputMode="decimal"
                        value={cryptoUnitPrice}
                        onChange={(e) => setCryptoUnitPrice(e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="3000"
                        className="field num"
                        dir="ltr"
                        unit={baseUnit}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">طلا (گرم ۱۸ عیار)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={goldOpeningQty}
                        onChange={(e) => setGoldOpeningQty(e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="0.00"
                        className="field num"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="label">قیمت خرید هر گرم ({currencyLabel(baseCurrency)})</label>
                      <AmountInput
                        type="text"
                        inputMode="decimal"
                        value={goldUnitPrice}
                        onChange={(e) => setGoldUnitPrice(e.target.value.replace(/[^\d.]/g, ""))}
                        placeholder="60"
                        className="field num"
                        dir="ltr"
                        unit={baseUnit}
                      />
                    </div>
                  </div>

                  <p className="muted text-[10px] leading-5">
                    لازم نیست این موارد را الان وارد کنید؛ می‌توانید بعداً از ماژول «حساب‌ها» (صندوق نقد) یا ثبت خرید رمزارز/دارایی، آن‌ها را اضافه کنید.
                  </p>
                </div>
              </details>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  className="btn w-1/3"
                >
                  ← قبلی
                </button>
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="btn btn-primary w-2/3"
                >
                  پیش‌نمایش و تایید ←
                </button>
              </div>
            </section>
          )}

          {/* STEP 4 */}
          {step === 4 && (
            <section className="space-y-4">
              <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
                <h2 className="text-base font-semibold">{t.step4Title}</h2>
                <p className="muted text-xs">{t.step4Desc}</p>
              </div>

              <div className="soft rounded-[var(--r-md)] p-4 space-y-3">
                <h3 className="text-xs font-bold">{t.previewTitle}</h3>
                <div className="divide-y text-xs" style={{ borderColor: "var(--border)" }}>
                  {D(previewData.bankQty).gt(0) && (
                    <div className="flex justify-between gap-3 py-2">
                      <span>به {bankAccountName} ({formatMoney(previewData.bankQty, bankAssetSymbol)})</span>
                      <span className="num font-bold" dir="rtl">
                        {formatMoney(previewData.bankBook, "USD")}
                      </span>
                    </div>
                  )}

                  {D(previewData.cashQty).gt(0) && (
                    <div className="flex justify-between gap-3 py-2">
                      <span>به {cashWalletName} ({formatMoney(previewData.cashQty, cashAssetSymbol)})</span>
                      <span className="num font-bold" dir="rtl">
                        {formatMoney(previewData.cashBook, "USD")}
                      </span>
                    </div>
                  )}

                  {D(previewData.ethQty).gt(0) && (
                    <div className="flex justify-between py-2">
                      <span>به کیف رمزارز ({formatQty(previewData.ethQty, 8)} ETH)</span>
                      <span className="num font-bold" dir="rtl">
                        {formatMoney(previewData.ethVal, "USD")}
                      </span>
                    </div>
                  )}

                  {D(previewData.goldQty).gt(0) && (
                    <div className="flex justify-between py-2">
                      <span>به طلای ۱۸ عیار ({formatQty(previewData.goldQty, 2)} گرم)</span>
                      <span className="num font-bold" dir="rtl">
                        {formatMoney(previewData.goldVal, "USD")}
                      </span>
                    </div>
                  )}

                  {previewData.hasItems ? (
                    <div className="flex justify-between py-2 font-bold" style={{ color: "var(--negative)" }}>
                      <span>از سرمایه اولیه</span>
                      <span className="num" dir="rtl">
                        −{formatMoney(previewData.totalEquity, baseCurrency)}
                      </span>
                    </div>
                  ) : (
                    <div className="muted py-4 text-center">
                      موجودی اولیه‌ای وارد نشده است. سیستم با حساب‌های خالی و موجودی صفر شروع می‌شود.
                    </div>
                  )}
                </div>

                <p className="text-[11px] font-medium" style={{ color: "var(--brand)" }}>
                  {t.balancedCheck}
                </p>
              </div>

              {state && (
                <p
                  className="rounded-[var(--r-md)] px-4 py-3 text-xs"
                  style={{
                    background: state.ok ? "var(--brand-soft)" : "rgba(225,29,72,0.12)",
                    color: state.ok ? "var(--brand)" : "var(--negative)",
                  }}
                >
                  {state.message}
                </p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  disabled={pending}
                  className="btn w-1/3"
                >
                  ← قبلی
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="btn btn-primary w-2/3"
                >
                  {pending ? t.submitting : t.submitBtn}
                </button>
              </div>
            </section>
          )}
        </form>
      </div>
    </div>
  );
}
