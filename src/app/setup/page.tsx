"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeSetupAction, fetchSetupStateAction, type ActionResult } from "@/app/actions";
import { getTranslations } from "@/i18n";
import { D } from "@/domain/decimal";
import { formatMoney } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";

const t = getTranslations("fa").setup;

export default function SetupWizardPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [setupStatus, setSetupStatus] = useState<"loading" | "pending" | "completed">("loading");

  useEffect(() => {
    let active = true;
    fetchSetupStateAction()
      .then((state) => {
        if (active) setSetupStatus(state.completed ? "completed" : "pending");
      })
      .catch(() => {
        if (active) setSetupStatus("pending");
      });
    return () => {
      active = false;
    };
  }, []);

  // Step 1 State
  const [userName, setUserName] = useState("مالک خانواده");
  const [baseCurrency, setBaseCurrency] = useState("USD");
  const [displayCurrency, setDisplayCurrency] = useState("IRT");
  const [dateCalendar, setDateCalendar] = useState<"jalali" | "gregorian">("jalali");
  const [digitStyle, setDigitStyle] = useState<"fa" | "en">("fa");

  // Step 2 State
  const [bankAccountName, setBankAccountName] = useState("بانک ملت — جاری");
  const [cashWalletName, setCashWalletName] = useState("صندوق خانگی");

  // Step 3 State
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

  // Unit label for the real-time amount-in-words hints (follows the base currency).
  const baseUnit = baseCurrency === "IRR" ? "rial" : baseCurrency === "EUR" ? "eur" : "usd";

  // Calculate opening balance preview
  const previewData = useMemo(() => {
    const bankVal = D(bankOpeningBalance || "0");
    const cashVal = D(cashOpeningBalance || "0");
    const ethQty = D(cryptoOpeningQty || "0");
    const ethPrice = D(cryptoUnitPrice || "0");
    const ethVal = ethQty.mul(ethPrice);
    const goldQty = D(goldOpeningQty || "0");
    const goldPrice = D(goldUnitPrice || "0");
    const goldVal = goldQty.mul(goldPrice);

    const totalEquity = bankVal.add(cashVal).add(ethVal).add(goldVal);

    return {
      bankVal: bankVal.toString(),
      cashVal: cashVal.toString(),
      ethQty: ethQty.toString(),
      ethVal: ethVal.toString(),
      goldQty: goldQty.toString(),
      goldVal: goldVal.toString(),
      totalEquity: totalEquity.toString(),
      hasItems: totalEquity.gt(0),
    };
  }, [
    bankOpeningBalance,
    cashOpeningBalance,
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
              حساب «سرمایه افتتاحیه» (3010) و نمودار حساب‌های پایه آماده‌اند. برای افزودن هر تعداد حساب بانکی، صندوق، صرافی یا کیف‌پول از بخش حساب‌ها استفاده کنید؛ هر مورد شناسه و کد مستقل دارد.
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
                    <option value="USD">USD ($ — دلار آمریکا)</option>
                    <option value="EUR">EUR (€ — یورو)</option>
                    <option value="IRR">IRR (ریال)</option>
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
                    <option value="IRT">IRT (تومان)</option>
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
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

              <div>
                <label className="label">{t.mainBankAccount}</label>
                <input
                  type="text"
                  required
                  value={bankAccountName}
                  onChange={(e) => setBankAccountName(e.target.value)}
                  className="field"
                />
              </div>

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

              <div className="card soft p-3 text-[11px] leading-6">
                <strong>نمودار حساب‌های پیش‌فرض ایجادشده:</strong>
                <ul className="mt-1 list-disc space-y-0.5 pr-4">
                  <li>حساب بانکی (الزامی) — صندوق نقد فقط در صورت تمایل یا داشتن موجودی ایجاد می‌شود</li>
                  <li>بدهی‌ها: وام و بدهی عمومی</li>
                  <li>سرمایه: حساب سرمایه افتتاحیه (Opening Balance Equity - 3010)</li>
                  <li>درآمدها و هزینه‌ها: دسته‌ها و هزینه‌های استاندارد خانوار</li>
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

              {/* فقط حساب بانکی الزامی است؛ بقیه موجودی‌ها کاملاً اختیاری هستند. */}
              <div>
                <label className="label">{t.cashAmount} ({baseCurrency})</label>
                <AmountInput
                  type="text"
                  inputMode="decimal"
                  value={bankOpeningBalance}
                  onChange={(e) => setBankOpeningBalance(e.target.value.replace(/[^\d.]/g, ""))}
                  placeholder="0.00"
                  className="field num"
                  dir="ltr"
                  unit={baseUnit}
                />
                <p className="muted mt-1 text-[10px] leading-5">
                  اگر موجودی ندارید خالی بگذارید؛ سیستم با مانده صفر شروع می‌شود.
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
                    <label className="label">موجودی صندوق نقد ({baseCurrency}) — اختیاری</label>
                    <AmountInput
                      type="text"
                      inputMode="decimal"
                      value={cashOpeningBalance}
                      onChange={(e) => setCashOpeningBalance(e.target.value.replace(/[^\d.]/g, ""))}
                      placeholder="0.00"
                      className="field num"
                      dir="ltr"
                      unit={baseUnit}
                    />
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
                      <label className="label">قیمت خرید هر اتریوم ({baseCurrency}) — فقط Cost Basis افتتاحیه</label>
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
                      <label className="label">قیمت خرید هر گرم ({baseCurrency})</label>
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
                  {D(previewData.bankVal).gt(0) && (
                    <div className="flex justify-between py-2">
                      <span>بدهکار: {bankAccountName}</span>
                      <span className="num font-bold" dir="ltr">
                        {formatMoney(previewData.bankVal, baseCurrency)}
                      </span>
                    </div>
                  )}

                  {D(previewData.cashVal).gt(0) && (
                    <div className="flex justify-between py-2">
                      <span>بدهکار: {cashWalletName}</span>
                      <span className="num font-bold" dir="ltr">
                        {formatMoney(previewData.cashVal, baseCurrency)}
                      </span>
                    </div>
                  )}

                  {D(previewData.ethQty).gt(0) && (
                    <div className="flex justify-between py-2">
                      <span>بدهکار: کیف رمزارز ({previewData.ethQty} ETH)</span>
                      <span className="num font-bold" dir="ltr">
                        {formatMoney(previewData.ethVal, baseCurrency)}
                      </span>
                    </div>
                  )}

                  {D(previewData.goldQty).gt(0) && (
                    <div className="flex justify-between py-2">
                      <span>بدهکار: طلای ۱۸ عیار ({previewData.goldQty} گرم)</span>
                      <span className="num font-bold" dir="ltr">
                        {formatMoney(previewData.goldVal, baseCurrency)}
                      </span>
                    </div>
                  )}

                  {previewData.hasItems ? (
                    <div className="flex justify-between py-2 font-bold" style={{ color: "var(--negative)" }}>
                      <span>بستانکار: سرمایه افتتاحیه (Opening Equity - 3010)</span>
                      <span className="num" dir="ltr">
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
