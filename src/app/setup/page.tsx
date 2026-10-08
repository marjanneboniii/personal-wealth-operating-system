"use client";

import { validateSetupBankAccounts } from "@/features/setup/bankAccounts";
import IphoneSmsGuide from "@/components/transactions/IphoneSmsGuide";
import SetupBankPicker from "@/components/setup/SetupBankPicker";
import { SETUP_BANKS, isSuggestedBankAccountName, suggestedBankAccountName } from "@/features/setup/bankCatalog";
import SetupBankConnectionStep from "@/components/setup/SetupBankConnectionStep";
import { validateSetupBankIdentifiers, type SetupBankIdentifier } from "@/features/setup/bankConnection";

import { confirmExistingSetupAction, saveSetupDraftAction } from "@/app/actions/setupDraft";
import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { completeSetupAction, fetchSetupStateAction, type ActionResult } from "@/app/actions";
import { validateSetupDebtsAction } from "@/app/actions/setupDebts";
import { faCount, formatMoney, formatQty } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import ChoiceCard from "@/components/ui/ChoiceCard";
import AssetLogo from "@/components/ui/AssetLogo";
import { KNOWN_WALLETS } from "@/features/setup/holdingWallets";
import StepIntro, { CurrencySwitch } from "@/components/setup/StepIntro";
import SetupHoldingsStep, { flattenHoldings, type CryptoDraftRow } from "@/components/setup/SetupHoldingsStep";
import SetupInstrumentsStep, { type InstrumentDraftRow } from "@/components/setup/SetupInstrumentsStep";
import SetupDebtsStep, { draftOf, type DebtDraftRow } from "@/components/setup/SetupDebtsStep";
import {
  SetupPropertiesStep,
  SetupVehiclesStep,
  propertyRowReady,
  vehicleRowReady,
  vehicleYearOf,
  PurchaseUsd,
  type PropertyDraftRow,
  type VehicleDraftRow,
} from "@/components/setup/SetupRealAssetsStep";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
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

const STEPS = ["شروع", "حساب‌ها", "رمزارز و طلا", "صندوق و سهام", "ملک", "خودرو", "بدهی‌ها", "روش ورود اطلاعات", "بررسی و تأیید"] as const;
const LAST_STEP = STEPS.length;

/** Places that hold Toman: Iranian exchanges (crypto) and brokerages (Tehran market). */
const TOMAN_PLACE_GROUPS: Array<[string, typeof KNOWN_WALLETS]> = [
  ["صرافی داخلی", KNOWN_WALLETS.filter((w) => w.region === "ir")],
  ["کارگزاری", KNOWN_WALLETS.filter((w) => w.kind === "broker")],
];
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
  const [existingReview, setExistingReview] = useState<{id:string;name:string}[] | null>(null);
  const [existingSections,setExistingSections] = useState<string[][]>([]);
  const [reviewedExisting, setReviewedExisting] = useState<boolean[]>(Array(9).fill(false));
  const [reviewMessage, setReviewMessage] = useState("");
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
  const [bankPresence,setBankPresence] = useState<"" | "yes" | "no">("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankName, setBankName] = useState("");
  const [extraBanks, setExtraBanks] = useState<{ id: string; name: string; bankName: string; balance: string }[]>([]);
  const [extraConnections, setExtraConnections] = useState<{ bankId: string; connection: SetupBankIdentifier }[]>([]);
  const [bankConnection, setBankConnection] = useState<SetupBankIdentifier | null>(null);
  const [bankBalance, setBankBalance] = useState("");
  const [hasCash, setHasCash] = useState(false);
  const [cashName, setCashName] = useState("صندوق خانگی");
  const [cashCurrency, setCashCurrency] = useState<"IRT" | "USD">("IRT");
  const [cashBalance, setCashBalance] = useState("");
  // Toman held at an Iranian exchange or a brokerage — «تومان - نوبیتکس».
  const [tomanPlaces, setTomanPlaces] = useState<Array<{ walletName: string; balance: string }>>([]);
  const toggleTomanPlace = (walletName: string) =>
    setTomanPlaces((rows) =>
      rows.some((r) => r.walletName === walletName) ? rows.filter((r) => r.walletName !== walletName) : [...rows, { walletName, balance: "" }],
    );

  // Steps 3–6 — holdings and obligations, drafts until the final confirm.
  const [cryptoRows, setCryptoRows] = useState<CryptoDraftRow[]>([]);
  const [goldGrams, setGoldGrams] = useState("");
  const [goldPrice, setGoldPrice] = useState("");
  const [goldHoldingPlace, setGoldHoldingPlace] = useState("");
  const [goldPurchaseDate, setGoldPurchaseDate] = useState("");
  const [coreCommitted,setCoreCommitted] = useState(false);
  const draftSaveQueue=useRef<Promise<unknown>>(Promise.resolve());
  const persistDraft=useCallback((draft:unknown)=>{const request=draftSaveQueue.current.catch(()=>undefined).then(()=>saveSetupDraftAction(draft));draftSaveQueue.current=request;return request;},[]);
  const [draftSaving,setDraftSaving] = useState(false);
  const [draftMessage, setDraftMessage] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [inputMethod, setInputMethod] = useState<"" | "manual" | "file" | "sms">("");
  const [answers, setAnswers] = useState<Record<string, "yes" | "no">>({});
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
        const draft = "draft" in state ? state.draft as Record<string, any> | null : null;
        if (draft?.version === 1) {
          const setters: Record<string, (value: any) => void> = { inputMethod:(value) => setInputMethod(value === "file" ? "" : value),step:setStep,userName:setUserName,occupations:setOccupations,rateInput:setRateInput,editingRate:setEditingRate,bankPresence:setBankPresence,bankAccountName:setBankAccountName,bankName:setBankName,bankBalance:setBankBalance,extraBanks:setExtraBanks,extraConnections:setExtraConnections,bankConnection:setBankConnection,hasCash:setHasCash,cashName:setCashName,cashCurrency:setCashCurrency,cashBalance:setCashBalance,tomanPlaces:setTomanPlaces,cryptoRows:setCryptoRows,goldGrams:setGoldGrams,goldPrice:setGoldPrice,goldPurchaseDate:setGoldPurchaseDate,goldHoldingPlace:setGoldHoldingPlace,instrumentRows:setInstrumentRows,propertyRows:setPropertyRows,vehicleRows:setVehicleRows,debtRows:setDebtRows,answers:setAnswers };
          for (const [key,set] of Object.entries(setters)) if (draft[key] !== undefined) set(draft[key]);
        }
        if ("reviewExisting" in state && state.reviewExisting) {setExistingReview(state.existingAccounts);setExistingSections(state.reviewSections);}
        if("coreCommitted" in state) setCoreCommitted(state.coreCommitted);
        setHydrated(true);
        const s = state as { completed: boolean; usdIrtRate?: string; rateSource?: string };
        setStatus(s.completed ? "completed" : "pending");
        setMarketRate({ rate: s.usdIrtRate ?? "", source: s.rateSource ?? "" });
      })
      .catch(() => {
        if (active) { setStatus("pending"); setDraftMessage("وضعیت راه‌اندازی دریافت نشد؛ صفحه را دوباره بارگذاری کنید."); }
      });
    return () => {
      active = false;
    };
  }, [router]);

  const draftSnapshot = JSON.stringify({version:1,inputMethod,step,userName,occupations,rateInput,editingRate,bankPresence,bankAccountName,bankName,bankBalance,extraBanks,extraConnections,bankConnection,hasCash,cashName,cashCurrency,cashBalance,tomanPlaces,cryptoRows,goldGrams,goldPrice,goldPurchaseDate,goldHoldingPlace,instrumentRows,propertyRows,vehicleRows,debtRows,answers});
  useEffect(() => {
    if (!hydrated || status !== "pending") return;
    let alive = true;
    const timer = setTimeout(() => { void persistDraft(JSON.parse(draftSnapshot)).then(result => { if (alive) setDraftMessage(result.message); }).catch(() => { if (alive) setDraftMessage("پیش‌نویس ذخیره نشد؛ اتصال را بررسی کنید."); }); }, 800);
    return () => { alive = false; clearTimeout(timer); };
  }, [draftSnapshot,hydrated,status,persistDraft]);

  // A fallback/default rate is not a market figure — the user must confirm one.
  const needsRate = !isValidRate(marketRate.rate) || marketRate.source === "fallback" || marketRate.source === "default";
  const rateEditable = needsRate || editingRate;
  const rate = rateEditable ? rateInput : marketRate.rate;
  const rateReady = isValidRate(rate);

  const debtDrafts = debtRows.map(draftOf);

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(async (prev, fd) => {
    const saved = await persistDraft(JSON.parse(draftSnapshot));
    if (!saved.ok) {setDraftMessage(saved.message);return saved;}
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


    setCompletionNote(notes.length ? notes.join(" ") : null);
    setStatus("completed");
    // Final confirmation remains the last wizard step; device activation is offered on the receipt.
    return res;
  }, null);

  const readyVehicles = vehicleRows.filter(vehicleRowReady);
  const readyProperties = propertyRows.filter(propertyRowReady);
  const incompleteRealAssets = vehicleRows.length - readyVehicles.length + (propertyRows.length - readyProperties.length);

  /** Everything the user entered, in Toman, grouped the way the app shows it. */
  const review = useMemo(() => {
    const money: ReviewItem[] = [];
    for (const bank of bankPresence === "no" ? [] : extraBanks) money.push({ key: bank.id, label: bank.name || "حساب بانکی اضافه", detail: bank.bankName, toman: amountOf(bank.balance) });
    if(bankPresence !== "no") {
      money.push({ key: "bank", label: bankAccountName.trim() || "حساب بانکی اصلی", detail: bankName, toman: amountOf(bankBalance) });
    }
    if (hasCash && amountOf(cashBalance).gt(0)) {
      money.push({
        key: "cash",
        label: cashName.trim() || "صندوق نقد",
        detail: cashCurrency === "USD" ? formatMoney(cashBalance, "USD") : undefined,
        toman: toToman(amountOf(cashBalance), cashCurrency, rate),
      });
    }

    for (const place of tomanPlaces) {
      if (amountOf(place.balance).gt(0)) {
        money.push({ key: `toman-${place.walletName}`, label: `تومان - ${place.walletName}`, toman: amountOf(place.balance) });
      }
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
  }, [extraBanks, bankName, bankBalance, bankAccountName, bankPresence, tomanPlaces, hasCash, cashBalance, cashName, cashCurrency, rate, cryptoRows, goldGrams, goldPrice, instrumentRows, readyVehicles, readyProperties, debtRows]);

  // Every coin needs at least one picked place before the wizard moves on.
  const holdingsPlaced = cryptoRows.every((r) => r.places.length > 0);
  const allConnections = [...(bankConnection ? [bankConnection] : []), ...extraConnections.map((row) => row.connection)];
  const bankRows = bankPresence === "no" ? [] : [{ name: bankAccountName, bankName, balance: bankBalance || "0" }, ...extraBanks.map(({ name, bankName, balance }) => ({ name, bankName, balance: balance || "0" }))];
  let banksReady = bankPresence === "no";
  if(bankPresence === "yes") {try { validateSetupBankAccounts(bankRows);banksReady=true; } catch { banksReady = false; }}
  let connectionReady = true;
  try { validateSetupBankIdentifiers(allConnections, bankAccountName, bankName, "IRT", extraBanks); } catch { connectionReady = false; }
  const sectionKey = ({3:"holdings",4:"instruments",5:"properties",6:"vehicles",7:"debts"} as Record<number,string>)[step];
  const sectionHasRows = ({holdings: cryptoRows.length > 0 || amountOf(goldGrams).gt(0), instruments: instrumentRows.length > 0, properties: propertyRows.length > 0, vehicles: vehicleRows.length > 0, debts: debtRows.length > 0} as Record<string,boolean>);
  const sectionDataReady = ({holdings: flattenHoldings(cryptoRows).every(r => amountOf(r.quantity).gt(0) && amountOf(r.unitPrice).gt(0) && !!r.purchaseDate) && (!amountOf(goldGrams).gt(0) || (amountOf(goldPrice).gt(0) && !!goldPurchaseDate && !!goldHoldingPlace)), instruments: instrumentRows.every(r => amountOf(r.quantity).gt(0) && amountOf(r.unitPrice).gt(0) && (r.kind !== "wallex" || !!r.purchaseDate)), properties: propertyRows.every(propertyRowReady), vehicles: vehicleRows.every(vehicleRowReady), debts: debtRows.every(r => amountOf(r.principalIrt).gt(0))} as Record<string,boolean>);
  const sectionReady = !sectionKey || (answers[sectionKey] === "no" ? !sectionHasRows[sectionKey] : answers[sectionKey] === "yes" && sectionHasRows[sectionKey] && sectionDataReady[sectionKey]);
  const allSectionsReady = Object.keys(sectionHasRows).every(k => answers[k] === "no" ? !sectionHasRows[k] : answers[k] === "yes" && sectionHasRows[k] && sectionDataReady[k]);
  const canContinue = hydrated && sectionReady && ( step === 8 ? (!!inputMethod && (inputMethod !== "sms" || connectionReady)) : step === 1 ? (userName.trim().length >= 2 && rateReady) : step === 2 ? banksReady : step === 3 ? holdingsPlaced : true);

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
          <p className="text-sm">اطلاعات مالی ثبت شدند. روش ثبت انتخابی شما آماده است؛ می‌توانید از تراکنش‌ها ثبت دستی یا ورود فایل را انجام دهید. دریافت پیامک روی آیفون نیازمند تنظیم جداگانهٔ Shortcuts است.</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href="/setup/messages" className="btn btn-primary">تنظیم اتصال پیامک آیفون</Link>
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

  if (existingReview) return <div className="mx-auto max-w-2xl space-y-4 py-6"><h1 className="text-xl font-bold">بررسی اجباری اطلاعات قبلی</h1><p className="expense-note">حساب‌های قبلی شما حفظ می‌شوند. هر بخش را بررسی کنید؛ تأیید نهایی موجودی یا تراکنش دیگری نمی‌سازد.</p><div className="card space-y-2">{existingReview.map(a => <p key={a.id}>{a.name}</p>)}</div>{STEPS.map((title,index) => <section key={title} className="card space-y-3"><h2 className="font-bold">{title}</h2><ul className="space-y-2 text-sm">{(existingSections[index]?.length ? existingSections[index] : ["موردی ثبت نشده است؛ ندارم"]).map((line,i)=><li key={i}>{line}</li>)}</ul><label className="flex items-center gap-3"><input type="checkbox" checked={reviewedExisting[index]} onChange={e => setReviewedExisting(rows => rows.map((v,i) => i === index ? e.target.checked : v))} />همه اطلاعات این بخش را بررسی کردم و مورد ثبت‌نشده‌ای ندارم</label></section>)}<p role="status">{reviewMessage}</p><button type="button" className="btn btn-primary" disabled={!reviewedExisting.every(Boolean)} onClick={async () => { const result = await confirmExistingSetupAction(reviewedExisting); setReviewMessage(result.message); if(result.ok) {setExistingReview(null);setStatus("completed");router.refresh();} }}>تأیید اطلاعات موجود</button></div>;

  const move = async (destination:number) => {
    if (draftSaving) return;
    setDraftSaving(true);
    try {const saved=await persistDraft({...JSON.parse(draftSnapshot),step:destination});setDraftMessage(saved.message);if(saved.ok)setStep(destination);} catch {setDraftMessage("پیش‌نویس ذخیره نشد؛ دوباره تلاش کنید.");} finally {setDraftSaving(false);}
  };
  const next = () => void move(Math.min(LAST_STEP,step+1));
  const back = () => void move(Math.max(1,step-1));

  return (
    <div className="mx-auto max-w-2xl space-y-5 py-4">
      <header className="space-y-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="text-[length:var(--fs-xl)] font-bold tracking-tight">راه‌اندازی توازن</h1>
          <span className="flex items-center gap-2">
            <span className="muted num text-[length:var(--fs-xs)]">
              {faCount(step)} از {faCount(STEPS.length)}
            </span>
            <button type="button" onClick={logout} className="btn btn-ghost !min-h-8 !px-2.5 text-[length:var(--fs-xs)]">
              خروج
            </button>
          </span>
        </div>
        <p className="muted text-[length:var(--fs-xs)] leading-6">
          برای شروع استفاده از توازن، ابتدا این مراحل را کامل کنید. برای هر بخش پاسخ «دارم» یا «ندارم» لازم است.
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
        <p role="status" className="muted text-xs">{draftMessage || "پیش‌نویس پس از تغییر ذخیره می‌شود؛ تا تکمیل راه‌اندازی وارد محیط مالی نمی‌شوید."}</p>
        {coreCommitted && <p className="expense-note">حساب‌ها و موجودی اولیه ثبت شده‌اند؛ فقط ملک، خودرو یا بدهی ثبت‌نشده را اصلاح کنید. برای ویرایش موجودی‌های ثبت‌شده، ابتدا راه‌اندازی را تکمیل کنید.</p>}
        <input type="hidden" name="userName" value={userName} />
        <input type="hidden" name="occupations" value={JSON.stringify(occupations)} />
        <input type="hidden" name="baseCurrency" value="USD" />
        <input type="hidden" name="displayCurrency" value="IRT" />
        <input type="hidden" name="dateCalendar" value={dateCalendar} />
        <input type="hidden" name="digitStyle" value="fa" />
        <input type="hidden" name="fxRate" value={rateReady ? rate : ""} />
        <input type="hidden" name="bankPresence" value={bankPresence} />
        <input type="hidden" name="bankAccounts" value={JSON.stringify(bankRows)} />
        <input type="hidden" name="bankName" value={bankName} />
        <input type="hidden" name="bankIdentifiers" value={JSON.stringify(allConnections)} />
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
              purchaseDate: r.purchaseDate,
            })),
          )}
        />
        <input type="hidden" name="inputMethod" value={inputMethod} />
        <input type="hidden" name="goldHoldingPlace" value={goldHoldingPlace} />
        <input type="hidden" name="goldPurchaseDate" value={goldPurchaseDate} />
        <input type="hidden" name="setupDebts" value={JSON.stringify(debtDrafts)} />
        <input type="hidden" name="sectionAnswers" value={JSON.stringify(answers)} />
        <input type="hidden" name="goldOpeningQty" value={goldGrams} />
        <input type="hidden" name="goldUnitPrice" value={goldPrice} />
        <input type="hidden" name="goldPriceCurrency" value="IRT" />
        <input
          type="hidden"
          name="instruments"
          value={JSON.stringify(
            instrumentRows.map((r) => ({
              purchaseDate: r.purchaseDate,
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

        {sectionKey && <section className="setup-decision">
          <h3>{({holdings:"رمزارز یا طلا در سبد شما هست؟",instruments:"در صندوق یا بازار سهام سرمایه‌گذاری کرده‌اید؟",properties:"ملکی به نام شما هست؟",vehicles:"خودرویی دارید؟",debts:"بدهی یا قسطی برای پرداخت دارید؟"} as const)[sectionKey]}</h3>
          <div className="choice-grid" role="group" aria-label="وضعیت دارایی">
            <ChoiceCard selected={answers[sectionKey] === "yes"} title="بله، اضافه می‌کنم" detail="انتخاب و تکمیل اطلاعات" mark={<Icon name="plus" size={20}/>} disabled={coreCommitted && step <= 4} onClick={() => setAnswers(a => ({...a,[sectionKey]:"yes"}))}/>
            <ChoiceCard selected={answers[sectionKey] === "no"} title="فعلاً موردی ندارم" detail="ادامه به بخش بعد" mark={<Icon name="check" size={20}/>} disabled={sectionHasRows[sectionKey] || (coreCommitted && step <= 4)} onClick={() => setAnswers(a => ({...a,[sectionKey]:"no"}))}/>
          </div>
          {sectionHasRows[sectionKey] && <p className="muted mt-2 text-xs">اگر موردی ندارید، ابتدا ردیف‌های اضافه‌شده را حذف کنید.</p>}
        </section>}
        <fieldset disabled={!hydrated || (coreCommitted && step <= 4)} className="space-y-6">
        {step === 1 && (
          <section className="space-y-5">
            <StepIntro title="شروع" text="اطلاعات خود را قدم‌به‌قدم تکمیل کنید؛ اگر موردی ندارید، «فعلاً موردی ندارم» را انتخاب کنید." />

            <div>
              <label className="label" htmlFor="setup-name">
                نام شما یا خانواده
              </label>
              <input id="setup-name" type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="مثلاً علی و سارا" className="field" autoComplete="name" />
            </div>

            <div>
              <p className="label">وضعیت شغلی شما</p>
              <p className="muted mb-3 text-xs">می‌توانید چند مورد را انتخاب کنید یا این بخش را خالی بگذارید.</p>
              <div className="choice-grid" role="group" aria-label="وضعیت شغلی">
                {OCCUPATIONS.map(occupation => <ChoiceCard key={occupation.code} selected={occupations.includes(occupation.code)} title={occupation.label} detail={({employee_private:"حقوق از شرکت یا مجموعه خصوصی",employee_government:"حقوق از سازمان دولتی",student:"تحصیل و درآمدهای دانشجویی",homemaker:"مدیریت خانه و درآمدهای خانوادگی",freelancer:"پروژه و کار مستقل",employer:"مالک کسب‌وکار و استخدام‌کننده",entrepreneur:"راه‌اندازی یا توسعه کسب‌وکار",retired:"حقوق بازنشستگی",other:"وضعیت دیگری دارم"} as Record<string,string>)[occupation.code]} onClick={() => setOccupations(current => current.includes(occupation.code) ? current.filter(code => code !== occupation.code) : [...current,occupation.code])}/>) }
              </div>
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
                  <span className="muted text-[length:var(--fs-xs)] leading-6">رمزارز، سهام، شاخص و کامودیتی توکنیزه</span>
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
            <div className="choice-grid" role="group" aria-label="حساب بانکی">
              <ChoiceCard selected={bankPresence === "yes"} title="حسابم را اضافه می‌کنم" detail="انتخاب بانک و ثبت موجودی" onClick={()=>setBankPresence("yes")}/>
              <ChoiceCard selected={bankPresence === "no"} title="فعلاً حساب بانکی ندارم" detail="ادامه بدون حساب بانکی" disabled={amountOf(bankBalance).gt(0) || extraBanks.length>0} onClick={()=>{setBankPresence("no");setBankName("");setBankAccountName("");setBankBalance("");setBankConnection(null);if(inputMethod === "sms")setInputMethod("");}}/>
            </div>
            {bankPresence === "yes" && <>

            <div className="card setup-row space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flow-icon" aria-hidden="true">
                  <Icon name="card" size={15} />
                </span>
                <b className="min-w-0 flex-1 text-[length:var(--fs-sm)]">حساب بانکی اصلی</b>
                <span className="badge badge-neutral">تومان</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-3">
                  <SetupBankPicker value={bankName} onSelect={(bank) => {
                    const previous = SETUP_BANKS.find((option) => option.value === bankName);
                    if (isSuggestedBankAccountName(bankAccountName, previous)) {
                      setBankAccountName(suggestedBankAccountName(bank, extraBanks.map((row) => row.name)));
                    }
                    setBankName(bank.value);
                    if (bankName !== bank.value) setBankConnection(null);
                  }} />
                  <label className="block">
                    <span className="label">نام حساب <span className="muted">· قابل ویرایش</span></span>
                    <input id="setup-bank-name" type="text" value={bankAccountName} onChange={(e) => setBankAccountName(e.target.value)} placeholder="با انتخاب بانک، خودکار تکمیل می‌شود" className="field" autoComplete="off" maxLength={200} />
                  </label>
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

            {extraBanks.map((bank, index) => (
              <div key={bank.id} className="card setup-row space-y-3">
                <div className="flex items-center justify-between">
                  <b className="text-sm">حساب بانکی {faCount(index + 2)}</b>
                  <button type="button" className="btn btn-ghost" onClick={() => {
                    setExtraBanks((rows) => rows.filter((row) => row.id !== bank.id));
                    setExtraConnections((rows) => rows.filter((row) => row.bankId !== bank.id));
                  }}>حذف حساب</button>
                </div>
                <SetupBankPicker value={bank.bankName} onSelect={(selected) => {
                  const previous = SETUP_BANKS.find((option) => option.value === bank.bankName);
                  const useSuggestion = isSuggestedBankAccountName(bank.name, previous);
                  const name = useSuggestion ? suggestedBankAccountName(selected, [bankAccountName, ...extraBanks.filter((row) => row.id !== bank.id).map((row) => row.name)]) : bank.name;
                  setExtraBanks((rows) => rows.map((row) => row.id === bank.id ? { ...row, name, bankName: selected.value } : row));
                  if (bank.bankName !== selected.value) setExtraConnections((rows) => rows.filter((row) => row.bankId !== bank.id));
                }} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <label><span className="label">نام حساب <span className="muted">· قابل ویرایش</span></span><input className="field" value={bank.name} maxLength={200} placeholder="با انتخاب بانک، خودکار تکمیل می‌شود" onChange={(event) => setExtraBanks((rows) => rows.map((row) => row.id === bank.id ? { ...row, name: event.target.value } : row))} /></label>
                  <label><span className="label">موجودی این حساب (تومان)</span><AmountInput className="field num" value={bank.balance} unit="toman" onValueChange={(balance) => setExtraBanks((rows) => rows.map((row) => row.id === bank.id ? { ...row, balance } : row))} /></label>
                </div>
              </div>
            ))}
            <button type="button" className="btn btn-ghost w-full" disabled={extraBanks.length >= 9} onClick={() => setExtraBanks((rows) => [...rows, { id: crypto.randomUUID(), name: "", bankName: "", balance: "" }])}>+ افزودن حساب بانکی دیگر</button>
            {!banksReady && <p className="expense-note expense-note-warn">بانک را انتخاب کنید؛ نام هر حساب باید متفاوت باشد و موجودی به تومان صحیح و صفر یا مثبت باشد. حداکثر ۱۰ حساب.</p>}
            </>}

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

            <div className="card setup-row space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="flow-icon" aria-hidden="true">
                  <Icon name="coins" size={15} />
                </span>
                <b className="min-w-0 flex-1 text-[length:var(--fs-sm)]">تومان در صرافی و کارگزاری</b>
                <span className="badge badge-neutral">تومان</span>
              </div>
              {TOMAN_PLACE_GROUPS.map(([title, places]) => (
                <div key={title} className="space-y-2">
                  <p className="muted text-[length:var(--fs-xs)] font-semibold">{title}</p>
                  <div className="choice-grid" role="group" aria-label={title}>
                    {places.map((w) => {
                      const on = tomanPlaces.some((p) => p.walletName === w.name);
                      return (
                        <ChoiceCard key={w.name} selected={on} title={w.name} detail={on ? "انتخاب شده · موجودی را وارد کنید" : "افزودن موجودی تومان"} mark={w.logo ? <AssetLogo userLogoUrl={w.logo} name={w.name} size={26}/> : <Icon name="wallet" size={20}/>} onClick={() => toggleTomanPlace(w.name)} />
                      );
                    })}
                  </div>
                </div>
              ))}
              {tomanPlaces.map((p) => (
                <div key={p.walletName}>
                  <label className="label">{`موجودی تومان - ${p.walletName}`}</label>
                  <AmountInput
                    inputMode="numeric"
                    value={p.balance}
                    onChange={(e) =>
                      setTomanPlaces((rows) =>
                        rows.map((r) => (r.walletName === p.walletName ? { ...r, balance: e.target.value.replace(/[^\d]/g, "") } : r)),
                      )
                    }
                    placeholder="۰"
                    className="field num"
                    dir="ltr"
                    unit="toman"
                  />
                </div>
              ))}
            </div>
          </section>
        )}

        {step === 3 && answers.holdings === "yes" && (
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

        {step === 3 && answers.holdings === "yes" && amountOf(goldGrams).gt(0) && <div className="space-y-3"><label className="label">محل نگهداری طلا (اجباری)</label><select className="field" value={goldHoldingPlace} onChange={e => setGoldHoldingPlace(e.target.value)}><option value="">انتخاب کنید</option>{["نگهداری شخصی","میلی","ملی‌گلد","طلاسی","گلدیکا","طلاین"].map(place => <option key={place}>{place}</option>)}</select><label className="label">تاریخ خرید طلای آب‌شده (اجباری)</label><JalaliDatePicker value={goldPurchaseDate || undefined} onChange={setGoldPurchaseDate} /><PurchaseUsd currentRate={rate} dateIso={goldPurchaseDate} priceToman={lineValue(goldGrams,goldPrice).toString()} /></div>}
        {step === 4 && answers.instruments === "yes" && <SetupInstrumentsStep rows={instrumentRows} onChange={setInstrumentRows} rate={rate} />}

        </fieldset>
        {step === PROPERTIES_STEP && answers.properties === "yes" && <SetupPropertiesStep currentRate={rate} rows={propertyRows} onChange={setPropertyRows} />}

        {step === VEHICLES_STEP && answers.vehicles === "yes" && <SetupVehiclesStep currentRate={rate} rows={vehicleRows} onChange={setVehicleRows} />}

        {step === DEBTS_STEP && answers.debts === "yes" && (
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

        {step === 8 && <section className="space-y-5">
          <StepIntro title="تراکنش‌ها را چطور ثبت می‌کنید؟" text="روش مناسب خود را انتخاب کنید؛ بعداً هم قابل تغییر است." />
          <div className="choice-grid" role="group" aria-label="روش ورود اطلاعات">
            <ChoiceCard selected={inputMethod === "manual"} title="خودم ثبت می‌کنم" detail="ثبت درآمد، هزینه و پرداخت در اپ" mark={<Icon name="plus" size={22}/>} onClick={() => setInputMethod("manual")}/>
            <ChoiceCard selected={inputMethod === "sms"} title="با پیامک بانک" detail={bankPresence === "no" ? "ابتدا یک حساب بانکی معرفی کنید" : "دریافت پیامک و بررسی تراکنش پیشنهادی"} mark={<Icon name="card" size={22}/>} disabled={bankPresence === "no"} onClick={() => setInputMethod("sms")}/>
          </div>
          {inputMethod === "manual" && <p className="expense-note">همه تراکنش‌ها را خودتان ثبت و مدیریت می‌کنید.</p>}
          {inputMethod === "sms" && <div className="space-y-5"><StepIntro title="حساب‌های دریافت‌کننده پیامک" text="حساب‌ها را معرفی کنید؛ فعال‌سازی دریافت پیامک بعد از تأیید نهایی انجام می‌شود." />
            <SetupBankConnectionStep accountName={bankAccountName} bankName={bankName} draft={bankConnection} onChange={setBankConnection} onEditAccount={() => setStep(2)} />
            {extraBanks.map(bank => <SetupBankConnectionStep key={bank.id} accountName={bank.name} bankName={bank.bankName} draft={extraConnections.find(row => row.bankId === bank.id)?.connection ?? null} onChange={draft => setExtraConnections(rows => [...rows.filter(row => row.bankId !== bank.id),...(draft ? [{bankId:bank.id,connection:draft}] : [])])} onEditAccount={() => setStep(2)}/>)}
            {!connectionReady && <p className="expense-note expense-note-warn">اطلاعات حساب و شناسه پیامک را کامل و تأیید کنید.</p>}
            <details className="sms-guide"><summary>مراحل اتصال روی آیفون</summary><IphoneSmsGuide preview/></details>
          </div>}
        </section>}

        {step === LAST_STEP && (
          <section className="space-y-5">
            <StepIntro title="بررسی و تأیید نهایی" text="اطلاعات مالی و روش ورود را بررسی کنید؛ همه پس از تأیید نهایی ثبت می‌شوند." />
            <p className="expense-note">روش انتخابی: {inputMethod === "manual" ? "ثبت توسط خودم" : "پیامک بانک"}</p>
            {inputMethod === "sms" && <div className="card setup-row space-y-2"><h3 className="font-semibold text-sm">اتصال پیامک</h3>{allConnections.length ? <><ul className="space-y-2">{allConnections.map((connection, index) => <li key={index} className="text-sm">بانک {connection.bankName} · شناسهٔ …{connection.suffix} ← {connection.accountName}</li>)}</ul><p className="expense-note">{connectionReady ? "اتصال‌ها با حساب‌های معرفی‌شده مطابقت دارند و تأیید شما دریافت شد." : "اتصال با حساب مطابقت ندارد یا تأیید و شناسه ناقص است؛ مرحلهٔ ۸ را اصلاح کنید."}</p></> : <p className="muted text-sm">فعلاً بدون اتصال؛ بعداً می‌توانید تنظیم کنید.</p>}<button type="button" className="btn btn-ghost" onClick={() => setStep(8)}>بررسی اتصال بانک</button></div>}

            {[
              { title: "حساب‌ها و موجودی", items: review.money, tone:"income", step:2 },
              { title: "سرمایه‌گذاری‌ها · مبلغ خرید", items: review.investments, tone:"invest", step:3 },
              { title: "ملک و خودرو", items: review.real, tone:"asset", step:5 },
              { title: "بدهی‌ها و اقساط", items: review.debts, tone:"debt", step:7 },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <div key={group.title} className="setup-review-group" data-tone={group.tone}>
                  <div className="setup-review-head"><b>{group.title}</b><span>{faCount(group.items.length)} مورد</span><button type="button" className="btn btn-ghost !min-h-9 !px-2" onClick={()=>setStep(group.step)}>{group.step === 3 ? "رمزارز و طلا" : group.step === 5 ? "ملک" : "بازبینی"}</button>{(group.step === 3 || group.step === 5) && <button type="button" className="btn btn-ghost !min-h-9 !px-2" onClick={()=>setStep(group.step+1)}>{group.step === 3 ? "صندوق و سهام" : "خودرو"}</button>}</div>
                  <ul className="list-card">
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
              <div className="setup-summary">
                <div className="setup-total">
                  <span className="muted">جمع مبالغ ثبت اولیه دارایی‌ها</span>
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
                  <span className="font-semibold">خالص مبالغ ثبت اولیه</span>
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

        <input type="hidden" name="tomanPlaces" value={JSON.stringify(tomanPlaces)} />
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
            <button key="next" type="button" onClick={next} disabled={!canContinue || draftSaving || pending} className="btn btn-primary">
              ادامه
            </button>
          ) : (
            <button key="confirm" type="submit" disabled={draftSaving || pending || !hydrated || !inputMethod || !rateReady || !banksReady || (inputMethod === "sms" && !connectionReady) || !allSectionsReady} className="btn btn-primary">
              {pending ? "در حال ثبت…" : "تأیید نهایی و ثبت"}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
