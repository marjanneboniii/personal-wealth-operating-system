"use client";

/**
 * افزودن حساب — a bank account, a cash box, or money held at a place:
 *
 *   صرافی      Toman (Iranian exchanges only) or Tether — «تومان - نوبیتکس»
 *   کارگزاری   Toman only — «تومان - کارگزاری مفید»
 *   کیف پول    Tether only — «تتر - ربی والت»
 *
 * The place is picked from the catalogue, with its logo, and names the
 * account; foreign exchanges are never offered for Toman. The service checks
 * the same rule (`moneyPlaceError`).
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMoneyAccountAction } from "@/app/actions";
import { D } from "@/domain/decimal";
import { currencyLabel, formatMoney } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import { BankLogo } from "@/components/ui/IranLogo";
import { holdingAccountName, isIranianExchange, KNOWN_WALLETS, moneyPlaceError } from "@/features/setup/holdingWallets";

export type MoneyCurrencyOption = {
  id: string;
  symbol: "IRT" | "USD" | "USDT";
  name: string;
  decimals: number;
};

type Kind = "bank" | "cash" | "exchange" | "broker" | "hot" | "cold";

const KINDS: Array<[Kind, string]> = [
  ["bank", "حساب بانکی"],
  ["cash", "نقد / صندوق"],
  ["exchange", "صرافی"],
  ["broker", "کارگزاری"],
  ["hot", "کیف پول"],
  ["cold", "کیف پول سرد"],
];

/** The units each kind of container holds. */
const KIND_SYMBOLS: Record<Kind, ReadonlyArray<string>> = {
  bank: ["IRT", "USD"],
  cash: ["IRT", "USD"],
  exchange: ["IRT", "USDT"],
  broker: ["IRT"],
  hot: ["USDT"],
  cold: ["USDT"],
};

const PLACE_KINDS = new Set<Kind>(["exchange", "broker", "hot", "cold"]);

function placesFor(kind: Kind, symbol: string | undefined) {
  return KNOWN_WALLETS.filter((w) => {
    if (kind === "broker") return w.kind === "broker";
    if (kind === "exchange") return w.kind === "exchange" && (symbol !== "IRT" || isIranianExchange(w.name));
    if (kind === "hot" || kind === "cold") return w.kind === kind;
    return false;
  });
}

export default function MoneyAccountForm({
  currencies,
  usdIrtRate,
}: {
  currencies: MoneyCurrencyOption[];
  usdIrtRate: string;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("bank");
  const [assetId, setAssetId] = useState("");
  const [place, setPlace] = useState("");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [openingQty, setOpeningQty] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const allowed = currencies.filter((c) => KIND_SYMBOLS[kind].includes(c.symbol));
  const currency = allowed.find((c) => c.id === assetId) ?? (allowed.length === 1 ? allowed[0] : null);
  const needsPlace = PLACE_KINDS.has(kind);
  const places = needsPlace ? placesFor(kind, currency?.symbol) : [];
  const placeInfo = places.find((w) => w.name === place) ?? null;
  const autoName = needsPlace && placeInfo && currency ? holdingAccountName(currencyLabel(currency.symbol), placeInfo.name) : "";
  const accountName = nameTouched ? name : autoName || name;
  const ruleError = currency ? moneyPlaceError(kind, currency.symbol, needsPlace ? place : undefined) : null;
  const canPreview = accountName.trim().length >= 2 && !!currency && (!needsPlace || !!placeInfo) && !ruleError;

  const kindLabel = KINDS.find(([v]) => v === kind)?.[1];
  const openingUnit =
    currency?.symbol === "IRT" ? "toman" : currency?.symbol === "USD" ? "usd" : currency?.symbol === "USDT" ? "usdt" : "none";
  const qty = openingQty ? D(openingQty) : D("0");
  const rate = D(usdIrtRate || "0");
  const previewBaseUsd = currency?.symbol === "IRT" ? (rate.gt(0) && qty.gt(0) ? qty.div(rate) : D("0")) : qty;

  const pickKind = (next: Kind) => {
    setKind(next);
    setPlace("");
    setPreview(false);
    if (!currencies.some((c) => c.id === assetId && KIND_SYMBOLS[next].includes(c.symbol))) setAssetId("");
  };

  const pickCurrency = (id: string) => {
    setAssetId(id);
    setPreview(false);
    const symbol = currencies.find((c) => c.id === id)?.symbol;
    // Tether → Toman at a foreign exchange is not a thing: drop the place.
    if (place && !placesFor(kind, symbol).some((w) => w.name === place)) setPlace("");
  };

  function confirm() {
    if (!currency) return;
    startTransition(async () => {
      const result = await createMoneyAccountAction({
        name: accountName.trim(),
        kind,
        assetId: currency.id,
        placeName: needsPlace ? place : "",
        openingQty,
        openingDate,
        note,
      });
      setMessage(result.message);
      if (result.ok) {
        setName("");
        setNameTouched(false);
        setPlace("");
        setOpeningQty("");
        setOpeningDate("");
        setNote("");
        setAssetId("");
        setPreview(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-4 text-xs">
      <div className="space-y-2">
        <span className="label">نوع حساب</span>
        <div className="expense-squares" role="radiogroup" aria-label="نوع حساب">
          {KINDS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={kind === value}
              className="expense-square"
              data-on={kind === value || undefined}
              onClick={() => pickKind(value)}
            >
              <span className="expense-square-label">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <span className="label">واحد حساب</span>
        <div className="expense-seg" role="radiogroup" aria-label="واحد حساب">
          {allowed.map((item) => {
            const on = currency?.id === item.id;
            return (
              <button key={item.id} type="button" role="radio" aria-checked={on} data-on={on || undefined} onClick={() => pickCurrency(item.id)}>
                {currencyLabel(item.symbol)}
              </button>
            );
          })}
        </div>
        {kind === "broker" && <p className="muted leading-5">سهام بورسی، صندوق‌ها و طلای آنلاین فقط با تومانِ کارگزاری معامله می‌شوند.</p>}
        {kind === "exchange" && currency?.symbol === "IRT" && (
          <p className="muted leading-5">تومان فقط در صرافی داخلی نگهداری می‌شود؛ صرافی‌های خارجی حساب تومانی ندارند.</p>
        )}
      </div>

      {needsPlace && (
        <div className="space-y-2">
          <span className="label">{kind === "broker" ? "کارگزاری" : kind === "exchange" ? "صرافی" : "کیف پول"}</span>
          <div className="expense-squares" role="radiogroup" aria-label="محل نگهداری">
            {places.map((w) => {
              const on = place === w.name;
              return (
                <button
                  key={w.name}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  className="expense-square"
                  data-on={on || undefined}
                  onClick={() => {
                    setPlace(w.name);
                    setPreview(false);
                  }}
                >
                  {w.logo && <AssetLogo userLogoUrl={w.logo} name={w.name} size={24} />}
                  <span className="expense-square-label">{w.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">نام حساب</span>
          <input
            className="field"
            value={accountName}
            onChange={(e) => {
              setName(e.target.value);
              setNameTouched(true);
            }}
            placeholder={needsPlace ? "تومان - نوبیتکس" : "مثلاً بانک ملت — حساب جاری"}
          />
        </label>
        <label className="space-y-1">
          <span className="label">موجودی اولیه{currency ? ` (${currencyLabel(currency.symbol)})` : ""}</span>
          <AmountInput
            className="field num"
            dir="ltr"
            inputMode="decimal"
            value={openingQty}
            onChange={(e) => setOpeningQty(e.target.value.replace(/[^0-9.]/g, ""))}
            unit={openingUnit}
            placeholder="۰"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <span className="label">تاریخ افتتاحیه (اختیاری)</span>
          <JalaliDatePicker value={openingDate} onChange={setOpeningDate} ariaLabel="تاریخ افتتاحیه" />
        </div>
        <label className="space-y-1">
          <span className="label">یادداشت (اختیاری)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      </div>

      {ruleError && (
        <p className="expense-note expense-note-warn" role="alert">
          {ruleError}
        </p>
      )}

      {!preview ? (
        <button className="btn btn-ghost" type="button" disabled={!canPreview} onClick={() => setPreview(true)}>
          پیش‌نمایش
        </button>
      ) : (
        <div className="soft rounded-[var(--r-lg)] p-3">
          <div className="muted mb-2">پیش‌نمایش — هنوز حسابی ایجاد نشده است</div>
          <div className="flex flex-wrap items-center gap-2">
            {kind === "bank" && <BankLogo name={accountName} size={32} />}
            {placeInfo?.logo && <AssetLogo userLogoUrl={placeInfo.logo} name={placeInfo.name} size={32} />}
            <strong>{accountName}</strong>
            <span className="chip">{kindLabel}</span>
            {currency && <span className="chip">{currencyLabel(currency.symbol)}</span>}
          </div>
          {qty.gt(0) && (
            <div className="mt-2">
              <p className="muted text-[length:var(--fs-xs)]">ارزش پایه دلاری افتتاحیه:</p>
              <p className="num font-bold" dir="rtl">
                {formatMoney(previewBaseUsd.toString())}
              </p>
              {currency?.symbol === "IRT" && rate.gt(0) && (
                <p className="muted mt-1 text-[length:var(--fs-xs)]">نرخ تبدیل جاری: هر دلار ≈ {formatMoney(usdIrtRate, "IRT")}</p>
              )}
            </div>
          )}
          {note && <div className="muted mt-1">{note}</div>}
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" type="button" disabled={pending} onClick={confirm}>
              {pending ? "در حال ثبت…" : "تأیید نهایی و ایجاد حساب"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setPreview(false)}>
              ویرایش
            </button>
          </div>
        </div>
      )}

      {message && <p className="muted">{message}</p>}
    </div>
  );
}
