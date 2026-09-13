"use client";

/**
 * «رمزارز و طلا» — every coin the user holds, plus physical gold.
 *
 * A coin is recorded in the currency it was BOUGHT with: Tether (the usual case
 * on Iranian exchanges) or Toman. Tether itself is priced in Toman — «a tether
 * for 1 tether» says nothing. Physical gold is always bought in Toman.
 *
 * DRAFTS ONLY: nothing is written until the wizard's final confirmation.
 */
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import StepIntro, { CurrencySwitch } from "@/components/setup/StepIntro";
import { SUPPORTED_CRYPTO_ASSETS } from "@/features/pricing/supportedAssets";
import { isMemeSymbol } from "@/features/pricing/wallexKinds";
import { formatMoney } from "@/lib/format";
import { lineValue, newRowKey, toToman } from "@/components/setup/setupMoney";

export type CryptoDraftRow = {
  key: string;
  symbol: string;
  name: string;
  quantity: string;
  unitPrice: string;
  priceCurrency: "USDT" | "IRT";
};

const PRICE_CURRENCIES: { value: "USDT" | "IRT"; label: string }[] = [
  { value: "USDT", label: "تتر" },
  { value: "IRT", label: "تومان" },
];

const digitsOnly = (value: string) => value.replace(/[^\d.]/g, "");

export default function SetupHoldingsStep({
  rows,
  onChange,
  goldGrams,
  goldPrice,
  onGoldGramsChange,
  onGoldPriceChange,
  rate,
}: {
  rows: CryptoDraftRow[];
  onChange: (next: CryptoDraftRow[]) => void;
  goldGrams: string;
  goldPrice: string;
  onGoldGramsChange: (next: string) => void;
  onGoldPriceChange: (next: string) => void;
  /** USD→IRT setup rate, for the Toman equivalent of a Tether price. */
  rate: string;
}) {
  const [query, setQuery] = useState("");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(rows.map((r) => r.symbol));
    // Meme coins are not offered as an opening holding.
    return SUPPORTED_CRYPTO_ASSETS.filter((c) => !isMemeSymbol(c.symbol)).filter(
      (c) =>
        !taken.has(c.symbol) &&
        (c.displayName.includes(query.trim()) || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)),
    ).slice(0, 6);
  }, [query, rows]);

  const add = (coin: (typeof SUPPORTED_CRYPTO_ASSETS)[number]) => {
    const isTether = coin.symbol === "USDT";
    onChange([
      ...rows,
      {
        key: newRowKey(),
        symbol: coin.symbol,
        name: coin.displayName,
        quantity: "",
        // A tether's cost is its Toman price; today's rate is a sensible start.
        unitPrice: isTether ? rate : "",
        priceCurrency: isTether ? "IRT" : "USDT",
      },
    ]);
    setQuery("");
  };

  const patch = (key: string, next: Partial<CryptoDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const goldValue = lineValue(goldGrams, goldPrice);

  return (
    <section className="space-y-5">
      <StepIntro title="رمزارز و طلا" text="مقدار هر رمزارز و قیمت خرید آن را به همان واحدی که خریده‌اید وارد کنید." />

      <div className="space-y-2">
        <label className="label" htmlFor="setup-crypto-search">
          افزودن رمزارز یا تتر
        </label>
        <input
          id="setup-crypto-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بیت‌کوین، تتر، اتریوم…"
          className="field"
          autoComplete="off"
        />
        {query.trim().length > 0 && (
          <ul className="card list-card">
            {matches.map((coin) => (
              <li key={coin.symbol}>
                <button type="button" className="list-row w-full text-right hover:bg-[color:var(--hover)]" onClick={() => add(coin)}>
                  <AssetLogo symbol={coin.symbol} name={coin.displayName} size={28} />
                  <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-medium">{coin.displayName}</span>
                  <span className="muted num text-[length:var(--fs-xs)]" dir="ltr">
                    {coin.symbol}
                  </span>
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="muted p-3 text-center text-[length:var(--fs-xs)]">پیدا نشد</li>}
          </ul>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const isTether = row.symbol === "USDT";
            const value = lineValue(row.quantity, row.unitPrice);
            const missingPrice = value.isZero() && Number(row.quantity) > 0;
            return (
              <li key={row.key} className="card setup-row space-y-3">
                <div className="flex items-center gap-2.5">
                  <AssetLogo symbol={row.symbol} name={row.name} size={30} />
                  <b className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{row.name}</b>
                  {!isTether && (
                    <CurrencySwitch
                      label={`واحد خرید ${row.name}`}
                      value={row.priceCurrency}
                      options={PRICE_CURRENCIES}
                      onChange={(priceCurrency) => patch(row.key, { priceCurrency })}
                    />
                  )}
                  <button
                    type="button"
                    className="icon-btn !min-h-9 !min-w-9"
                    onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                    aria-label={`حذف ${row.name}`}
                  >
                    <Icon name="x" size={15} />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">مقدار</label>
                    <AmountInput
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) => patch(row.key, { quantity: digitsOnly(e.target.value) })}
                      placeholder="۰"
                      className="field num"
                      dir="ltr"
                      showWords={false}
                      unit="none"
                    />
                  </div>
                  <div>
                    <label className="label">
                      قیمت خرید هر واحد ({row.priceCurrency === "IRT" ? "تومان" : "تتر"})
                    </label>
                    <AmountInput
                      inputMode="decimal"
                      value={row.unitPrice}
                      onChange={(e) => patch(row.key, { unitPrice: digitsOnly(e.target.value) })}
                      placeholder="۰"
                      className="field num"
                      dir="ltr"
                      unit={row.priceCurrency === "IRT" ? "toman" : "usdt"}
                    />
                  </div>
                </div>
                {value.gt(0) && (
                  <p className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                    بهای خرید {formatMoney(value.toString(), row.priceCurrency)}
                    {row.priceCurrency === "USDT" && ` · ${formatMoney(toToman(value, "USDT", rate).toFixed(0), "IRT")}`}
                  </p>
                )}
                {missingPrice && (
                  <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                    بدون قیمت خرید، سود و زیان این دارایی قابل محاسبه نیست.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="card setup-row space-y-3">
        <div className="flex items-center gap-2.5">
          <span className="flow-icon" aria-hidden="true">
            <Icon name="coins" size={15} />
          </span>
          <b className="min-w-0 flex-1 text-[length:var(--fs-sm)]">طلای آب‌شده و زیورآلات</b>
          <span className="badge badge-neutral">تومان</span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">وزن (گرم ۱۸ عیار)</label>
            <AmountInput
              inputMode="decimal"
              value={goldGrams}
              onChange={(e) => onGoldGramsChange(digitsOnly(e.target.value))}
              placeholder="۰"
              className="field num"
              dir="ltr"
              showWords={false}
              unit="none"
            />
          </div>
          <div>
            <label className="label">قیمت خرید هر گرم (تومان)</label>
            <AmountInput
              inputMode="numeric"
              value={goldPrice}
              onChange={(e) => onGoldPriceChange(e.target.value.replace(/[^\d]/g, ""))}
              placeholder="۰"
              className="field num"
              dir="ltr"
              unit="toman"
            />
          </div>
        </div>
        {goldValue.gt(0) && (
          <p className="muted num text-[length:var(--fs-xs)]" dir="rtl">
            بهای خرید {formatMoney(goldValue.toFixed(0), "IRT")}
          </p>
        )}
      </div>

      <p className="muted text-[length:var(--fs-xs)]">صندوق‌های طلا در مرحلهٔ بعد، کنار صندوق‌ها و سهام.</p>
    </section>
  );
}
