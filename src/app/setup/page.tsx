"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeSetupAction, fetchSetupStateAction, type ActionResult } from "@/app/actions";
import { registerSetupDebtsAction, validateSetupDebtsAction } from "@/app/actions/setupDebts";
import { faCount, formatMoney, formatQty } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import StepIntro, { CurrencySwitch } from "@/components/setup/StepIntro";
import SetupHoldingsStep, { flattenHoldings, type CryptoDraftRow } from "@/components/setup/SetupHoldingsStep";
import SetupInstrumentsStep, { type InstrumentDraftRow } from "@/components/setup/SetupInstrumentsStep";
import SetupDebtsStep, { type DebtDraftRow } from "@/components/setup/SetupDebtsStep";
import {
  SetupPropertiesStep,
  SetupVehiclesStep,
  propertyRowReady,
  vehicleRowReady,
  vehicleYearOf,
  type PropertyDraftRow,
  type VehicleDraftRow,
} from "@/components/setup/SetupRealAssetsStep";
import { amountOf, isValidRate, lineValue, toToman } from "@/components/setup/setupMoney";
import { OCCUPATIONS } from "@/features/income/occupations";

/**
 * راه‌اندازی اولیه توازن.
 *
 * CURRENCY MODEL (see features/setup/service.ts): nothing here asks for an
 * «accounting currency». Every holding is typed in the currency it was bought
 * with — Toman for bank accounts, debts, property, vehicles, physical gold,
 * funds and TSE stocks; Tether or Toman for crypto and US markets — and one
 * confirmed USD→IRT rate converts them. The book currency (USD) is internal.
 */

const STEPS = ["شروع", "حساب‌ها", "رمزارز و طلا", "صندوق و سهام", "ملک", "خودرو", "بدهی‌ها", "تأیید"] as const;
const LAST_STEP = STEPS.length;
const PROPERTIES_STEP = 5;
const VEHICLES_STEP = 6;
const DEBTS_STEP = 7;
// The calendar is not a preference: dates are always picked in Jalali. The
// value is still submitted so the stored `date_calendar` config stays explicit.
const dateCalendar = "jalali" as const;

const RATE_SOURCE_LABEL: Record<string, string> = {
  market: "نرخ بازار",
  user_settings: "نرخ تنظیمات شما",
  exchange_rates: "نرخ ثبت‌شده",
  settings: "نرخ ثبت‌شده",
  manual: "نرخ ثبت‌شده",
};

type ReviewItem = { key: string; label: string; detail?: string; toman: ReturnType<typeof amountOf> | null };

export default function SetupWizardPage() {
  const router = useRouter();
  // The app navigation is hidden during the mandatory setup, so the wizard
  // offers its own way out.
  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/login");
  };
  const [status, setStatus] = useState<"loading" | "pending" | "completed">("loading");
  const [step, setStep] = useState(1);
  const [completionNote, setCompletionNote] = useState<string | null>(null);

  // Step 1 — who, and the one rate every Toman amount converts at.
  const [userName, setUserName] = useState("");
  // Occupations only order the income sources offered first; optional, several allowed.
  const [occupations, setOccupations] = useState<string[]>([]);
  const [marketRate, setMarketRate] = useState({ rate: "", source: "" });
  const [editingRate, setEditingRate] = useState(false);
  const [rateInput, setRateInput] = useState("");

  // Step 2 — cash. A bank account in Iran holds Toman; a cash box may be dollars.
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankBalance, setBankBalance] = useState("");
  const [hasCash, setHasCash] = useState(false);
  const [cashName, setCashName] = useState("صندوق خانگی");
  const [cashCurrency, setCashCurrency] = useState<"IRT" | "USD">("IRT");
  const [cashBalance, setCashBalance] = useState("");

  // Steps 3–6 — holdings and obligations, drafts until the final confirm.
  const [cryptoRows, setCryptoRows] = useState<CryptoDraftRow[]>([]);
  const [goldGrams, setGoldGrams] = useState("");
  const [goldPrice, setGoldPrice] = useState("");
  const [instrumentRows, setInstrumentRows] = useState<InstrumentDraftRow[]>([]);
  const [vehicleRows, setVehicleRows] = useState<VehicleDraftRow[]>([]);
  const [propertyRows, setPropertyRows] = useState<PropertyDraftRow[]>([]);
  const [debtRows, setDebtRows] = useState<DebtDraftRow[]>([]);
  const [debtError, setDebtError] = useState<{ message: string; index: number | null } | null>(null);

  useEffect(() => {
    let active = true;
    fetchSetupStateAction()
      .then((state) => {
        if (!active) return;
        // LOGIN-GATED APP: an anonymous visitor never runs the wizard.
        if ((state as { loginRequired?: boolean }).loginRequired) {
          router.replace("/login");
          return;
        }
        const s = state as { completed: boolean; usdIrtRate?: string; rateSource?: string };
        setStatus(s.completed ? "completed" : "pending");
        setMarketRate({ rate: s.usdIrtRate ?? "", source: s.rateSource ?? "" });
      })
      .catch(() => {
        if (active) setStatus("pending");
      });
    return () => {
      active = false;
    };
  }, [router]);

  // A fallback/default rate is not a market figure — the user must confirm one.
  const needsRate = !isValidRate(marketRate.rate) || marketRate.source === "fallback" || marketRate.source === "default";
  const rateEditable = needsRate || editingRate;
  const rate = rateEditable ? rateInput : marketRate.rate;
  const rateReady = isValidRate(rate);

  const debtDrafts = debtRows.map(({ key: _key, ...draft }) => draft);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    // Debts are validated BEFORE setup commits: once setup is complete the
    // wizard cannot be submitted again, so a bad row must be fixed now.
    if (debtDrafts.length > 0) {
      const check = await validateSetupDebtsAction(debtDrafts);
      if (!check.ok) {
        setDebtError({ message: check.message ?? "اطلاعات بدهی‌ها کامل نیست.", index: check.failedIndex ?? null });
        setStep(DEBTS_STEP);
        return { ok: false, message: check.message ?? "اطلاعات بدهی‌ها کامل نیست." };
      }
    }

    const res = await completeSetupAction(prev, fd);
    if (!res.ok) return res;

    const notes: string[] = [];
    if (res.message?.includes("ناموفق")) notes.push(res.message);
    if (debtDrafts.length > 0) {
      const debtRes = await registerSetupDebtsAction(debtDrafts);
      if (!debtRes.ok) {
        notes.push(`بدهی‌ها ثبت نشدند (${debtRes.message ?? "خطای نامشخص"}) — از «تعهدات مالی» اضافه کنید.`);
      }
    }

    setCompletionNote(notes.length ? notes.join(" ") : null);
    setStatus("completed");
    if (notes.length === 0) setTimeout(() => router.push("/"), 1200);
    return res;
  }, null);

  const readyVehicles = vehicleRows.filter(vehicleRowReady);
  const readyProperties = propertyRows.filter(propertyRowReady);
  const incompleteRealAssets = vehicleRows.length - readyVehicles.length + (propertyRows.length - readyProperties.length);

  /** Everything the user entered, in Toman, grouped the way the app shows it. */
  const review = useMemo(() => {
    const money: ReviewItem[] = [];
    if (amountOf(bankBalance).gt(0)) {
      money.push({ key: "bank", label: bankAccountName.trim() || "حساب بانکی اصلی", toman: amountOf(bankBalance) });
    }
    if (hasCash && amountOf(cashBalance).gt(0)) {
      money.push({
        key: "cash",
        label: cashName.trim() || "صندوق نقد",
        detail: cashCurrency === "USD" ? formatMoney(cashBalance, "USD") : undefined,
        toman: toToman(amountOf(cashBalance), cashCurrency, rate),
      });
    }

    const investments: ReviewItem[] = [];
    let usesRate = cashCurrency === "USD" && hasCash && amountOf(cashBalance).gt(0);
    for (const row of flattenHoldings(cryptoRows)) {
      if (!amountOf(row.quantity).gt(0)) continue;
      const cost = lineValue(row.quantity, row.unitPrice);
      if (row.priceCurrency === "USDT") usesRate = true;
      investments.push({
        key: row.key,
        label: row.walletName ? `${row.name} - ${row.walletName}` : row.name,
        detail: `${formatQty(row.quantity, 8)} واحد`,
        toman: cost.gt(0) ? toToman(cost, row.priceCurrency, rate) : null,
      });
    }
    if (amountOf(goldGrams).gt(0)) {
      const cost = lineValue(goldGrams, goldPrice);
      investments.push({ key: "gold", label: "طلای ۱۸ عیار", detail: `${formatQty(goldGrams, 3)} گرم`, toman: cost.gt(0) ? cost : null });
    }
    for (const row of instrumentRows) {
      const cost = lineValue(row.quantity, row.unitPrice);
      if (row.priceCurrency === "USDT" && cost.gt(0)) usesRate = true;
      investments.push({
        key: row.key,
        label: row.name,
        detail: amountOf(row.quantity).gt(0) ? `${formatQty(row.quantity, 4)} واحد` : "فقط ثبت نماد",
        toman: cost.gt(0) ? toToman(cost, row.priceCurrency, rate) : null,
      });
    }

    const real: ReviewItem[] = [
      ...readyVehicles.map((r) => ({ key: r.key, label: r.label, detail: "خودرو", toman: amountOf(r.currentValueToman || r.purchasePriceToman) })),
      ...readyProperties.map((r) => ({ key: r.key, label: r.label || "ملک", detail: "ملک", toman: amountOf(r.currentValueToman || r.purchasePriceToman) })),
    ];

    const debts: ReviewItem[] = debtRows
      .filter((r) => amountOf(r.principalIrt).gt(0))
      .map((r) => ({ key: r.key, label: r.title.trim() || "بدهی", detail: r.creditor.trim() || undefined, toman: amountOf(r.principalIrt) }));

    const sum = (items: ReviewItem[]) => items.reduce((s, i) => (i.toman ? s.add(i.toman) : s), amountOf("0"));
    const assetsTotal = sum(money).add(sum(investments)).add(sum(real));
    const debtsTotal = sum(debts);
    return { money, investments, real, debts, assetsTotal, debtsTotal, net: assetsTotal.sub(debtsTotal), usesRate };
  }, [bankBalance, bankAccountName, hasCash, cashBalance, cashName, cashCurrency, rate, cryptoRows, goldGrams, goldPrice, instrumentRows, readyVehicles, readyProperties, debtRows]);

  // Every coin needs at least one picked place before the wizard moves on.
  const holdingsPlaced = cryptoRows.every((r) => r.places.length > 0);
  const canContinue = step === 1 ? rateReady : step === 2 ? bankAccountName.trim().length > 0 : step === 3 ? holdingsPlaced : true;

  if (status === "loading") {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <p className="card muted text-center text-[length:var(--fs-sm)]" role="status">
          در حال بررسی وضعیت راه‌اندازی…
        </p>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="mx-auto max-w-2xl py-6">
        <div className="card setup-card space-y-4 text-center">
          <span className="flow-icon is-in mx-auto" aria-hidden="true">
            <Icon name="check" size={17} />
          </span>
          <h1 className="text-[length:var(--fs-lg)] font-bold">راه‌اندازی کامل شد</h1>
          {completionNote && (
            <p className="text-right text-[length:var(--fs-xs)] leading-6" role="alert" style={{ color: "var(--warning)" }}>
              {completionNote}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/" className="btn btn-primary">
              نمای کلی
            </Link>
            <Link href="/accounts" className="btn btn-ghost">
              حساب‌ها
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const next = () => setStep((s) => Math.min(LAST_STEP, s + 1));
  const back = () => setStep((s) => Math.max(1, s - 1));

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-4">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[length:var(--fs-xl)] font-bold tracking-tight">راه‌اندازی توازن</h1>
          <span className="flex items-center gap-2">
            <span className="muted num text-[length:var(--fs-xs)]">
              {faCount(step)} از {faCount(LAST_STEP)}
            </span>
            <button type="button" onClick={logout} className="btn btn-ghost !min-h-8 !px-2.5 text-[length:var(--fs-xs)]">
              خروج
            </button>
          </span>
        </div>
        <p className="muted text-[length:var(--fs-xs)] leading-6">
          برای شروع استفاده از توازن، ابتدا این مراحل را کامل کنید. هر بخشی که ندارید را می‌توانید رد کنید.
        </p>
        <ol className="setup-steps" aria-label="مراحل راه‌اندازی">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const phase = n === step ? "is-current" : n < step ? "is-done" : "is-todo";
            return (
              <li key={label} className={`setup-step ${phase}`}>
                <button type="button" disabled={n >= step || pending} onClick={() => setStep(n)} aria-current={n === step ? "step" : undefined}>
                  <span className="setup-step-dot">{n < step ? <Icon name="check" size={12} /> : faCount(n)}</span>
                  <span className="setup-step-label">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </header>

      <form action={formAction} className="card setup-card space-y-6">
        <input type="hidden" name="userName" value={userName} />
        <input type="hidden" name="occupations" value={JSON.stringify(occupations)} />
        <input type="hidden" name="baseCurrency" value="USD" />
        <input type="hidden" name="displayCurrency" value="IRT" />
        <input type="hidden" name="dateCalendar" value={dateCalendar} />
        <input type="hidden" name="digitStyle" value="fa" />
        <input type="hidden" name="fxRate" value={rateReady ? rate : ""} />
        <input type="hidden" name="bankAccountName" value={bankAccountName} />
        <input type="hidden" name="bankAssetSymbol" value="IRT" />
        <input type="hidden" name="bankOpeningBalance" value={bankBalance} />
        <input type="hidden" name="cashWalletName" value={hasCash ? cashName : ""} />
        <input type="hidden" name="cashAssetSymbol" value={cashCurrency} />
        <input type="hidden" name="cashOpeningBalance" value={hasCash ? cashBalance : ""} />
        <input
          type="hidden"
          name="cryptoHoldings"
          value={JSON.stringify(
            flattenHoldings(cryptoRows).map((r) => ({
              symbol: r.symbol,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              priceCurrency: r.priceCurrency,
              walletName: r.walletName,
            })),
          )}
        />
        <input type="hidden" name="goldOpeningQty" value={goldGrams} />
        <input type="hidden" name="goldUnitPrice" value={goldPrice} />
        <input type="hidden" name="goldPriceCurrency" value="IRT" />
        <input
          type="hidden"
          name="instruments"
          value={JSON.stringify(
            instrumentRows.map((r) => ({
              kind: r.kind,
              symbol: r.symbol,
              name: r.name,
              quantity: r.quantity,
              unitPrice: r.unitPrice,
              priceCurrency: r.priceCurrency,
            })),
          )}
        />
        {/* Only COMPLETE registry rows are sent: a half-filled one would fail
            after the accounts had already been committed. */}
        <input
          type="hidden"
          name="vehicles"
          value={JSON.stringify(
            readyVehicles.map((r) => ({
              catalogId: r.catalogId,
              manufacturingYear: vehicleYearOf(r),
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
            readyProperties.map((r) => ({
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

        {step === 1 && (
          <section className="space-y-5">
            <StepIntro title="شروع" text="چند دقیقه طول می‌کشد؛ هر مرحله‌ای که ندارید را رد کنید." />

            <div>
              <label className="label" htmlFor="setup-name">
                نام شما یا خانواده
              </label>
              <input id="setup-name" type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="مثلاً علی و سارا" className="field" autoComplete="name" />
            </div>

            <div>
              <p className="label">وضعیت شغلی (اختیاری — چند مورد مجاز است)</p>
              <div className="flex flex-wrap gap-2" role="group" aria-label="وضعیت شغلی">
                {OCCUPATIONS.map((occupation) => {
                  const on = occupations.includes(occupation.code);
                  return (
                    <button
                      key={occupation.code}
                      type="button"
                      className="chip"
                      aria-pressed={on}
                      style={on ? { borderColor: "var(--action)", background: "var(--action-soft)", color: "var(--action)" } : undefined}
                      onClick={() =>
                        setOccupations((current) =>
                          on ? current.filter((code) => code !== occupation.code) : [...current, occupation.code],
                        )
                      }
                    >
                      {occupation.label}
                    </button>
                  );
                })}
              </div>
              <p className="muted mt-1 text-[length:var(--fs-xs)] leading-5">منابع درآمد مرتبط با شغل شما در فرم ثبت درآمد زودتر نمایش داده می‌شوند.</p>
            </div>

            <div>
              <h3 className="mb-1 text-[length:var(--fs-sm)] font-semibold">هر دارایی با واحدی که خریده‌اید ثبت می‌شود</h3>
              <ul className="setup-units">
                <li>
                  <span className="setup-unit">تومان</span>
                  <span className="muted text-[length:var(--fs-xs)] leading-6">حساب بانکی، بدهی و اقساط، ملک، خودرو، طلای آب‌شده، صندوق‌ها و سهام بورس</span>
                </li>
                <li>
                  <span className="setup-unit">تتر یا تومان</span>
                  <span className="muted text-[length:var(--fs-xs)] leading-6">رمزارز، سهام آمریکا، شاخص و کامودیتی</span>
                </li>
                <li>
                  <span className="setup-unit">دلار</span>
                  <span className="muted text-[length:var(--fs-xs)] leading-6">فقط مبنای داخلی سنجش سود و زیان؛ همه‌جا به تومان نمایش داده می‌شود</span>
                </li>
              </ul>
            </div>

            <div className="card setup-row space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[length:var(--fs-sm)] font-semibold">نرخ هر دلار (تتر) امروز</p>
                  <p className="muted text-[length:var(--fs-xs)]">
                    {needsRate ? "نرخ بازار دریافت نشد — نرخ امروز را وارد کنید" : RATE_SOURCE_LABEL[marketRate.source] ?? "نرخ ثبت‌شده"}
                  </p>
                </div>
                {!rateEditable && (
                  <div className="flex items-center gap-2">
                    <span className="num text-[length:var(--fs-sm)] font-semibold money-nowrap" dir="rtl">
                      {formatMoney(marketRate.rate, "IRT")}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                      onClick={() => {
                        setRateInput(marketRate.rate);
                        setEditingRate(true);
                      }}
                    >
                      ویرایش
                    </button>
                  </div>
                )}
              </div>
              {rateEditable && (
                <div>
                  <AmountInput
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value.replace(/[^\d]/g, ""))}
                    className="field num"
                    dir="ltr"
                    inputMode="numeric"
                    unit="toman"
                    placeholder="۰"
                    aria-label="نرخ هر دلار به تومان"
                  />
                  {rateInput && !rateReady && (
                    <p className="neg mt-1 text-[length:var(--fs-xs)]">نرخ باید بین ۱٬۰۰۰ و ۱۰٬۰۰۰٬۰۰۰ تومان باشد.</p>
                  )}
                </div>
              )}
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="space-y-5">
            <StepIntro title="حساب‌ها" text="موجودی امروز حساب‌ها را وارد کنید. کیف پول تتر در مرحلهٔ بعد است." />

            <div className="card setup-row space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flow-icon" aria-hidden="true">
                  <Icon name="card" size={15} />
                </span>
                <b className="min-w-0 flex-1 text-[length:var(--fs-sm)]">حساب بانکی اصلی</b>
                <span className="badge badge-neutral">تومان</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="setup-bank-name">
                    نام حساب
                  </label>
                  <input id="setup-bank-name" type="text" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} placeholder="مثلاً ملت جاری" className="field" autoComplete="off" />
                </div>
                <div>
                  <label className="label">موجودی (تومان)</label>
                  <AmountInput
                    inputMode="numeric"
                    value={bankBalance}
                    onChange={(e) => setBankBalance(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="۰"
                    className="field num"
                    dir="ltr"
                    unit="toman"
                  />
                </div>
              </div>
            </div>

            <div className="card list-card">
              <label className="setup-toggle">
                <input type="checkbox" checked={hasCash} onChange={(e) => setHasCash(e.target.checked)} />
                صندوق نقد یا دلار نقد دارم
              </label>
              {hasCash && (
                <div className="space-y-3 p-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">نام</label>
                      <input type="text" value={cashName} onChange={(e) => setCashName(e.target.value)} className="field" autoComplete="off" />
                    </div>
                    <div>
                      <label className="label">واحد</label>
                      <CurrencySwitch
                        label="واحد صندوق نقد"
                        value={cashCurrency}
                        onChange={setCashCurrency}
                        options={[
                          { value: "IRT", label: "تومان" },
                          { value: "USD", label: "دلار نقد" },
                        ]}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="label">موجودی ({cashCurrency === "IRT" ? "تومان" : "دلار"})</label>
                    <AmountInput
                      inputMode="decimal"
                      value={cashBalance}
                      onChange={(e) => setCashBalance(e.target.value.replace(/[^\d.]/g, ""))}
                      placeholder="۰"
                      className="field num"
                      dir="ltr"
                      unit={cashCurrency === "IRT" ? "toman" : "usd"}
                    />
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {step === 3 && (
          <SetupHoldingsStep
            rows={cryptoRows}
            onChange={setCryptoRows}
            goldGrams={goldGrams}
            goldPrice={goldPrice}
            onGoldGramsChange={setGoldGrams}
            onGoldPriceChange={setGoldPrice}
            rate={rate}
          />
        )}

        {step === 4 && <SetupInstrumentsStep rows={instrumentRows} onChange={setInstrumentRows} rate={rate} />}

        {step === PROPERTIES_STEP && <SetupPropertiesStep rows={propertyRows} onChange={setPropertyRows} />}

        {step === VEHICLES_STEP && <SetupVehiclesStep rows={vehicleRows} onChange={setVehicleRows} />}

        {step === DEBTS_STEP && (
          <div className="space-y-3">
            {debtError && (
              <p className="text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
                {debtError.message}
              </p>
            )}
            <SetupDebtsStep
              rows={debtRows}
              failedIndex={debtError?.index ?? null}
              onChange={(nextRows) => {
                setDebtRows(nextRows);
                setDebtError(null);
              }}
            />
          </div>
        )}

        {step === LAST_STEP && (
          <section className="space-y-5">
            <StepIntro title="مرور و تأیید" text="همه‌چیز را یک بار ببینید؛ بعد از تأیید ثبت می‌شود." />

            {[
              { title: "حساب‌ها", items: review.money },
              { title: "سرمایه‌گذاری‌ها (بهای خرید)", items: review.investments },
              { title: "ملک و خودرو", items: review.real },
              { title: "بدهی‌ها", items: review.debts },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.title} className="space-y-2">
                  <h3 className="muted text-[length:var(--fs-xs)] font-semibold">{group.title}</h3>
                  <ul className="card list-card">
                    {group.items.map((item) => (
                      <li key={item.key} className="list-row">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[length:var(--fs-sm)] font-medium">{item.label}</p>
                          {item.detail && (
                            <p className="muted num truncate text-[length:var(--fs-xs)]" dir="rtl">
                              {item.detail}
                            </p>
                          )}
                        </div>
                        <span className="num shrink-0 text-[length:var(--fs-sm)] font-semibold money-nowrap" dir="rtl">
                          {item.toman ? formatMoney(item.toman.toFixed(0), "IRT") : "—"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

            {review.assetsTotal.isZero() && review.debts.length === 0 ? (
              <p className="card muted text-center text-[length:var(--fs-sm)]">موجودی‌ای وارد نشده؛ با حساب‌های خالی شروع می‌کنید.</p>
            ) : (
              <div className="card setup-row">
                <div className="setup-total">
                  <span className="muted">جمع دارایی‌ها</span>
                  <span className="num font-semibold money-nowrap" dir="rtl">
                    {formatMoney(review.assetsTotal.toFixed(0), "IRT")}
                  </span>
                </div>
                {review.debtsTotal.gt(0) && (
                  <div className="setup-total">
                    <span className="muted">جمع بدهی‌ها</span>
                    <span className="num font-semibold money-nowrap" dir="rtl">
                      {formatMoney(review.debtsTotal.toFixed(0), "IRT")}
                    </span>
                  </div>
                )}
                <div className="setup-total">
                  <span className="font-semibold">خالص ارزش اولیه</span>
                  <span className="num font-bold money-nowrap" dir="rtl">
                    {formatMoney(review.net.toFixed(0), "IRT")}
                  </span>
                </div>
              </div>
            )}

            {incompleteRealAssets > 0 && (
              <p className="price-flag">
                <Icon name="alert" size={14} />
                {faCount(incompleteRealAssets)} ملک یا خودروی ناقص ثبت نمی‌شود
              </p>
            )}
            {review.usesRate && (
              <p className="muted text-[length:var(--fs-xs)] leading-6">
                مبالغ تتری و دلاری با نرخ هر دلار{" "}
                <span className="num" dir="rtl">
                  {formatMoney(rate, "IRT")}
                </span>{" "}
                به تومان تبدیل شده‌اند.
              </p>
            )}

            {state && !state.ok && (
              <p className="text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
                {state.message}
              </p>
            )}
          </section>
        )}

        <div className="setup-nav">
          {step > 1 && (
            <button type="button" onClick={back} disabled={pending} className="btn btn-ghost">
              قبلی
            </button>
          )}
          {/* Distinct keys are load-bearing: without them React reuses the
              «ادامه» <button> and flips its type to "submit" while its own
              click is still being dispatched, so reaching the review step
              submitted the wizard before the user ever saw it. */}
          {step < LAST_STEP ? (
            <button key="next" type="button" onClick={next} disabled={!canContinue} className="btn btn-primary">
              ادامه
            </button>
          ) : (
            <button key="confirm" type="submit" disabled={pending || !rateReady} className="btn btn-primary">
              {pending ? "در حال ثبت…" : "تأیید و شروع"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
