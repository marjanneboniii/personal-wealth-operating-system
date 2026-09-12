"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeSetupAction, fetchSetupStateAction, type ActionResult } from "@/app/actions";
import { getTranslations } from "@/i18n";
import { D } from "@/domain/decimal";
import { currencyLabel, faCount, formatMoney, formatMoneyWithSign, formatQty } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import { SUPPORTED_CRYPTO_ASSETS } from "@/features/pricing/supportedAssets";
import SetupDebtsStep, { type DebtDraftRow } from "@/components/setup/SetupDebtsStep";
import SetupInstrumentsStep, { type InstrumentDraftRow } from "@/components/setup/SetupInstrumentsStep";
import SetupRealAssetsStep, {
  propertyRowReady,
  vehicleRowReady,
  type PropertyDraftRow,
  type VehicleDraftRow,
} from "@/components/setup/SetupRealAssetsStep";
import { registerSetupDebtsAction } from "@/app/actions/setupDebts";

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
  // The calendar is NOT a preference: dates are always picked in Jalali and the
  // Gregorian equivalent is computed by the app. The value is still submitted so
  // the stored `date_calendar` config stays explicit (and legacy rows valid).
  const dateCalendar = "jalali" as const;
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
  // WHICH coin, chosen by the user. The wizard used to hard-code Ethereum, so
  // everyone got a «کیف پول اتریوم» whether they held ETH or not. Empty means
  // no crypto wallet is created at all.
  // Step 4 — existing obligations. A list, because a person arriving here
  // usually has more than one: a mortgage, a car plan, a loan from family.
  const [debtRows, setDebtRows] = useState<DebtDraftRow[]>([]);
  const [debtError, setDebtError] = useState<string | null>(null);

  const [cryptoSymbol, setCryptoSymbol] = useState("");
  const [cryptoQuery, setCryptoQuery] = useState("");
  const [cryptoOpeningQty, setCryptoOpeningQty] = useState("");
  const [cryptoUnitPrice, setCryptoUnitPrice] = useState("");
  const [goldOpeningQty, setGoldOpeningQty] = useState("");
  const [goldUnitPrice, setGoldUnitPrice] = useState("");
  // Step 4 — صندوق و سهام. A list for the same reason the debts step is one:
  // a person arriving here typically owns several, not exactly one.
  const [instrumentRows, setInstrumentRows] = useState<InstrumentDraftRow[]>([]);
  // Step 5 — خودرو و ملک. Registry assets, kept apart from the ledger balances
  // above: they are written by the registry's own services, not by the opening
  // entry (see features/setup/service.ts).
  const [vehicleRows, setVehicleRows] = useState<VehicleDraftRow[]>([]);
  const [propertyRows, setPropertyRows] = useState<PropertyDraftRow[]>([]);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    async (prev, fd) => {
      const res = await completeSetupAction(prev, fd);
      if (!res.ok) return res;

      /*
       * Debts are registered AFTER the base setup, and only if it succeeded:
       * they belong to the user's tenant, which the wizard has just created.
       * A failure here is reported but does NOT roll back the accounts — the
       * user keeps a working setup and can add the obligations from the debts
       * module instead of starting the whole wizard again.
       */
      if (debtRows.length > 0) {
        const debtRes = await registerSetupDebtsAction(
          debtRows.map(({ key: _key, ...draft }) => draft),
        );
        if (!debtRes.ok) {
          setDebtError(debtRes.message ?? "ثبت بدهی‌ها ناموفق بود.");
          setStep(6);
          return { ok: false, message: debtRes.message ?? "ثبت بدهی‌ها ناموفق بود." };
        }
      }

      setSetupStatus("completed");
      setTimeout(() => router.push("/"), 1000);
      return res;
    },
    null,
  );

  const selectedCrypto = useMemo(
    () => SUPPORTED_CRYPTO_ASSETS.find((c) => c.symbol === cryptoSymbol),
    [cryptoSymbol],
  );

  /** Matches on the Persian name OR the Latin ticker — a user may type either. */
  const cryptoMatches = useMemo(() => {
    const q = cryptoQuery.trim().toLowerCase();
    if (!q) return [];
    return SUPPORTED_CRYPTO_ASSETS.filter(
      (c) =>
        c.displayName.includes(cryptoQuery.trim()) ||
        c.symbol.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [cryptoQuery]);

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
    const ethQty = D(cryptoSymbol ? cryptoOpeningQty || "0" : "0");
    const ethPrice = D(cryptoUnitPrice || "0");
    const ethVal = ethQty.mul(ethPrice);
    const goldQty = D(goldOpeningQty || "0");
    const goldPrice = D(goldUnitPrice || "0");
    const goldVal = goldQty.mul(goldPrice);

    // صندوق/سهام contribute to the SAME opening entry, so the equity
    // counterweight the preview states must include them — otherwise the
    // «از سرمایه اولیه» line would understate what is about to be posted.
    const instrumentsVal = instrumentRows.reduce((sum, r) => {
      const qty = D(r.quantity || "0");
      const price = D(r.unitPrice || "0");
      return qty.gt(0) && price.gt(0) ? sum.add(qty.mul(price)) : sum;
    }, D("0"));

    const totalEquity = bankBook.add(cashBook).add(ethVal).add(goldVal).add(instrumentsVal);

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
      instrumentsVal: instrumentsVal.toString(),
      hasItems:
        totalEquity.gt(0) ||
        bankQty.gt(0) ||
        cashQty.gt(0) ||
        ethQty.gt(0) ||
        goldQty.gt(0) ||
        instrumentsVal.gt(0),
    };
  }, [
    cryptoSymbol,
    bankOpeningBalance,
    cashOpeningBalance,
    bankAssetSymbol,
    cashAssetSymbol,
    fxRate,
    cryptoOpeningQty,
    cryptoUnitPrice,
    goldOpeningQty,
    goldUnitPrice,
    instrumentRows,
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
              حساب‌های پایه آماده‌اند. برای افزودن بانک، صندوق، صرافی یا کیف پول از بخش حساب‌ها استفاده کنید.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/accounts" className="btn btn-primary">مدیریت حساب‌ها و کیف پول‌ها</Link>
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
            {[1, 2, 3, 4, 5, 6, 7].map((s) => (
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
                {s < 6 && <div className="h-0.5 w-8 bg-[var(--border)]" />}
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
          <input type="hidden" name="cryptoSymbol" value={cryptoSymbol} />
          <input type="hidden" name="cryptoOpeningQty" value={cryptoOpeningQty} />
          <input type="hidden" name="cryptoUnitPrice" value={cryptoUnitPrice} />
          <input type="hidden" name="goldOpeningQty" value={goldOpeningQty} />
          <input type="hidden" name="goldUnitPrice" value={goldUnitPrice} />
          {/* A FormData field cannot carry a list of objects and this is a
              plain <form>, so the chosen صندوق/سهام travel as JSON. The server
              action parses and validates them with zod before the service sees
              them; malformed JSON fails loudly rather than silently dropping
              what the user just entered. The internal `key` is a React list id
              and is stripped here — it is not part of the contract. */}
          <input
            type="hidden"
            name="instruments"
            value={JSON.stringify(
              instrumentRows
                .filter((r) => r.symbol.trim().length > 0)
                .map((r) => ({
                  kind: r.kind,
                  symbol: r.symbol,
                  name: r.name,
                  quantity: r.quantity,
                  unitPrice: r.unitPrice,
                })),
            )}
          />

          {/* خودرو و ملک travel as JSON for the same reason صندوق/سهام do.
              Only rows that are COMPLETE are sent: a half-filled card would
              otherwise fail its registration after the wizard had already
              committed the accounts, and the user would see an error for
              something they had not finished entering. */}
          <input
            type="hidden"
            name="vehicles"
            value={JSON.stringify(
              vehicleRows.filter(vehicleRowReady).map((r) => ({
                catalogId: r.catalogId,
                manufacturingYear: r.manufacturingYear,
                ownershipDate: r.ownershipDate,
                purchasePriceToman: r.purchasePriceToman,
                currentValueToman: r.currentValueToman,
              })),
            )}
          />
          <input
            type="hidden"
            name="properties"
            value={JSON.stringify(
              propertyRows.filter(propertyRowReady).map((r) => ({
                cityId: r.cityId,
                neighborhoodId: r.neighborhoodId,
                propertyTypeId: r.propertyTypeId,
                acquisitionDate: r.acquisitionDate,
                purchasePriceToman: r.purchasePriceToman,
                currentValueToman: r.currentValueToman,
                sizeSqm: r.sizeSqm,
              })),
            )}
          />

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
                  <p className="muted mt-1 text-[length:var(--fs-xs)]">{t.accountingCurrencyHelp}</p>
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
                  <p className="muted mt-1 text-[length:var(--fs-xs)]">{t.displayCurrencyHelp}</p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="label">{t.dateCalendarLabel}</label>
                  {/* Read-only on purpose: the Gregorian calendar is not an option. */}
                  <div className="field flex items-center justify-between gap-2">
                    <span className="text-[length:var(--fs-sm)] font-medium">{t.dateCalendarJalali}</span>
                    <span className="badge badge-neutral">{t.dateCalendarFixedBadge}</span>
                  </div>
                  <p className="muted mt-1 text-[length:var(--fs-xs)]">{t.dateCalendarHelp}</p>
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

              <div className="card soft p-3 text-[length:var(--fs-xs)] leading-6">
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

              <p className="muted text-[length:var(--fs-xs)] leading-5">{t.openingBalanceHelp}</p>
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
                  <p className="mt-1 text-[length:var(--fs-xs)] leading-5" style={{ color: "var(--brand)" }}>
                    {t.bookValueApprox}: ≈ {formatMoney(previewData.bankBook, "USD")}
                  </p>
                )}
                <p className="muted mt-1 text-[length:var(--fs-xs)] leading-5">
                  مبلغ را به واحد {currencyLabel(bankAssetSymbol)} همین حساب وارد کنید. اگر موجودی ندارید خالی بگذارید.
                </p>
              </div>

              {/* موجودی‌های اختیاری — صندوق نقد، رمزارز و طلا (بعداً هم از ماژول حساب‌ها قابل افزودن است) */}
              <details className="card soft rounded-[var(--r-md)] p-3">
                <summary className="cursor-pointer list-none text-xs font-semibold marker:hidden [&::-webkit-details-marker]:hidden">
                  موجودی‌های اختیاری — صندوق نقد، رمزارز و طلا
                  <span className="chip mr-2 text-[length:var(--fs-xs)]">اختیاری</span>
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
                      <p className="mt-1 text-[length:var(--fs-xs)] leading-5" style={{ color: "var(--brand)" }}>
                        {t.bookValueApprox}: ≈ {formatMoney(previewData.cashBook, "USD")}
                      </p>
                    )}
                  </div>

                  {/* Search → select → amount. The coin is the user's choice,
                      not a preset, and skipping this creates no crypto wallet. */}
                  <div className="space-y-2">
                    <label className="label" htmlFor="crypto-search">رمزارز (اختیاری)</label>
                    {selectedCrypto ? (
                      <div className="field flex items-center gap-2.5">
                        <AssetLogo symbol={selectedCrypto.symbol} name={selectedCrypto.displayName} size={26} />
                        <span className="min-w-0 flex-1 truncate font-semibold">{selectedCrypto.displayName}</span>
                        <button
                          type="button"
                          className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                          onClick={() => { setCryptoSymbol(""); setCryptoQuery(""); setCryptoOpeningQty(""); setCryptoUnitPrice(""); }}
                        >
                          تغییر
                        </button>
                      </div>
                    ) : (
                      <>
                        <input
                          id="crypto-search"
                          type="text"
                          value={cryptoQuery}
                          onChange={(e) => setCryptoQuery(e.target.value)}
                          placeholder="جست‌وجو: بیت‌کوین، تتر، BTC…"
                          className="field"
                        />
                        {cryptoQuery.trim().length > 0 && (
                          <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border p-1" style={{ borderColor: "var(--border)" }}>
                            {cryptoMatches.map((c) => (
                              <li key={c.symbol}>
                                <button
                                  type="button"
                                  className="flex w-full items-center gap-2.5 rounded-lg p-2 text-right hover:bg-[color:var(--hover)]"
                                  onClick={() => { setCryptoSymbol(c.symbol); setCryptoQuery(""); }}
                                >
                                  <AssetLogo symbol={c.symbol} name={c.displayName} size={24} />
                                  <span className="min-w-0 flex-1 truncate">{c.displayName}</span>
                                  <span className="muted num text-[length:var(--fs-xs)]" dir="ltr">{c.symbol}</span>
                                </button>
                              </li>
                            ))}
                            {cryptoMatches.length === 0 && (
                              <li className="muted p-3 text-center text-[length:var(--fs-xs)]">رمزارزی با این نام پیدا نشد.</li>
                            )}
                          </ul>
                        )}
                      </>
                    )}
                  </div>

                  {selectedCrypto && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label">مقدار {selectedCrypto.displayName}</label>
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
                        <label className="label">قیمت خرید هر {selectedCrypto.displayName} ({currencyLabel(baseCurrency)}) — فقط Cost Basis افتتاحیه</label>
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
                  )}

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

                  <p className="muted text-[length:var(--fs-xs)] leading-5">
                    می‌توانید این‌ها را بعداً هم اضافه کنید.</p>
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
                  صندوق و سهام ←
                </button>
              </div>
            </section>
          )}

          {/* STEP 4 — صندوق و سهام the user already owns */}
          {step === 4 && (
            <section className="space-y-4">
              <SetupInstrumentsStep
                rows={instrumentRows}
                onChange={setInstrumentRows}
                baseUnit={baseUnit}
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(3)} className="btn w-1/3">
                  ← قبلی
                </button>
                <button type="button" onClick={() => setStep(5)} className="btn btn-primary w-2/3">
                  {instrumentRows.length === 0 ? "ندارم، ادامه ←" : "خودرو و ملک ←"}
                </button>
              </div>
            </section>
          )}

          {/* STEP 5 — خودرو و ملک the user already owns */}
          {step === 5 && (
            <section className="space-y-4">
              <SetupRealAssetsStep
                vehicles={vehicleRows}
                properties={propertyRows}
                onVehiclesChange={setVehicleRows}
                onPropertiesChange={setPropertyRows}
              />
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(4)} className="btn w-1/3">
                  ← قبلی
                </button>
                <button type="button" onClick={() => setStep(6)} className="btn btn-primary w-2/3">
                  {vehicleRows.length === 0 && propertyRows.length === 0
                    ? "ندارم، ادامه ←"
                    : "بدهی‌ها و اقساط ←"}
                </button>
              </div>
            </section>
          )}

          {/* STEP 6 — existing obligations */}
          {step === 6 && (
            <section className="space-y-4">
              {debtError && (
                <div
                  role="alert"
                  className="card p-3 text-[length:var(--fs-sm)]"
                  style={{ borderColor: "var(--negative)", color: "var(--negative)" }}
                >
                  {debtError}
                </div>
              )}
              <SetupDebtsStep rows={debtRows} onChange={(next) => { setDebtRows(next); setDebtError(null); }} />
              <div className="flex gap-2">
                <button type="button" onClick={() => setStep(5)} className="btn w-1/3">
                  ← قبلی
                </button>
                <button type="button" onClick={() => setStep(7)} className="btn btn-primary w-2/3">
                  {debtRows.length === 0 ? "بدهی ندارم، ادامه ←" : "پیش‌نمایش و تایید ←"}
                </button>
              </div>
            </section>
          )}

          {/* STEP 7 — preview & confirm */}
          {step === 7 && (
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
                      <span>به کیف پول {selectedCrypto?.displayName ?? ""} (مقدار: {formatQty(previewData.ethQty, 8)})</span>
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

                  {/* One line per instrument that carries an opening position.
                      A registered-only row (no quantity) is deliberately absent
                      here: it moves no money, so it has nothing to show on a
                      preview whose subject is the opening entry. */}
                  {instrumentRows
                    .filter((r) => D(r.quantity || "0").gt(0) && D(r.unitPrice || "0").gt(0))
                    .map((r) => (
                      <div key={r.key} className="flex justify-between gap-3 py-2">
                        <span>
                          به {r.name} (مقدار: {formatQty(r.quantity, 2)})
                        </span>
                        <span className="num font-bold" dir="rtl">
                          {formatMoney(D(r.quantity).mul(r.unitPrice).toString(), "USD")}
                        </span>
                      </div>
                    ))}

                  {previewData.hasItems ? (
                    <div className="flex justify-between py-2 font-bold" style={{ color: "var(--negative)" }}>
                      <span>از سرمایه اولیه</span>
                      <span className="num" dir="rtl">
                        {formatMoneyWithSign("−", previewData.totalEquity, baseCurrency)}
                      </span>
                    </div>
                  ) : (
                    <div className="muted py-4 text-center">
                      موجودی اولیه‌ای وارد نشده است. سیستم با حساب‌های خالی و موجودی صفر شروع می‌شود.
                    </div>
                  )}
                </div>

                {/* خودرو و ملک are REGISTRY assets, not ledger balances, so they
                    are summarised in their own block below the opening entry
                    rather than inside it. Putting them in the list above would
                    imply they move the 3010 equity counterweight, which they do
                    not — a property posts its own separate entry, and a vehicle
                    posts none at all. */}
                {(vehicleRows.filter(vehicleRowReady).length > 0 ||
                  propertyRows.filter(propertyRowReady).length > 0) && (
                  <div className="border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <h3 className="text-xs font-bold">دارایی‌های واقعی</h3>
                    <div className="mt-1.5 divide-y text-xs" style={{ borderColor: "var(--border)" }}>
                      {vehicleRows.filter(vehicleRowReady).map((r) => (
                        <div key={r.key} className="flex justify-between gap-3 py-2">
                          <span>خودرو — {r.label}</span>
                          <span className="num font-bold" dir="rtl">
                            {formatMoney(r.currentValueToman || r.purchasePriceToman, "IRT")}
                          </span>
                        </div>
                      ))}
                      {propertyRows.filter(propertyRowReady).map((r) => (
                        <div key={r.key} className="flex justify-between gap-3 py-2">
                          <span>ملک — {r.label || "ملک"}</span>
                          <span className="num font-bold" dir="rtl">
                            {formatMoney(r.currentValueToman, "IRT")}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="muted mt-2 text-[length:var(--fs-xs)] leading-6">
                      این موارد در «دارایی‌های واقعی» ثبت می‌شوند و جدا از موجودی حساب‌ها هستند.
                    </p>
                  </div>
                )}

                <p className="text-[length:var(--fs-xs)] font-medium" style={{ color: "var(--brand)" }}>
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
                  onClick={() => setStep(6)}
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
