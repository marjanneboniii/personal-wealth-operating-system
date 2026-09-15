"use client";

/**
 * «رمزارز و طلا» — every coin the user holds, WHERE it is held, plus physical gold.
 *
 * A coin is a card; its places (exchanges / wallets) are PICKED inline, right
 * inside that card — no dialog. One tap on a place adds it (a second tap
 * removes it), so the user always sees what is selected. One coin may sit in
 * several places and one place may hold several coins, so each picked place
 * is its own line with its own quantity and purchase price.
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
import { KNOWN_WALLETS, knownWalletOf, OTHER_PLACE_LABEL, walletKeyOf } from "@/features/setup/holdingWallets";

export type CryptoPlaceDraft = {
  key: string;
  /** Catalogue name of the place; "" = «سایر». */
  walletName: string;
  quantity: string;
  unitPrice: string;
};

export type CryptoDraftRow = {
  key: string;
  symbol: string;
  name: string;
  priceCurrency: "USDT" | "IRT";
  places: CryptoPlaceDraft[];
};

/** One opening line per (coin, place) — the shape the setup service receives. */
export function flattenHoldings(rows: CryptoDraftRow[]) {
  return rows.flatMap((r) =>
    r.places.map((p) => ({
      key: p.key,
      symbol: r.symbol,
      name: r.name,
      priceCurrency: r.priceCurrency,
      walletName: p.walletName,
      quantity: p.quantity,
      unitPrice: p.unitPrice,
    })),
  );
}

const PRICE_CURRENCIES: { value: "USDT" | "IRT"; label: string }[] = [
  { value: "USDT", label: "تتر" },
  { value: "IRT", label: "تومان" },
];

type PlaceTab = "exchange" | "wallet";
const PLACE_TABS: { value: PlaceTab; label: string }[] = [
  { value: "exchange", label: "صرافی" },
  { value: "wallet", label: "کیف پول" },
];
const TAB_PLACES: Record<PlaceTab, typeof KNOWN_WALLETS> = {
  exchange: KNOWN_WALLETS.filter((w) => w.kind === "exchange"),
  // Brokerages hold Toman only — never a coin.
  wallet: KNOWN_WALLETS.filter((w) => w.kind === "hot" || w.kind === "cold"),
};

const digitsOnly = (value: string) => value.replace(/[^\d.]/g, "");

function PlaceMark({ name, size }: { name: string; size: number }) {
  const logo = knownWalletOf(name)?.logo;
  if (logo) return <AssetLogo userLogoUrl={logo} name={name} size={size} />;
  return (
    <span className="place-mark-other" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="wallet" size={Math.round(size * 0.55)} />
    </span>
  );
}

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
  // Coins whose inline place picker is open, and the tab each one shows.
  const [openPickers, setOpenPickers] = useState<Set<string>>(new Set());
  const [tabs, setTabs] = useState<Record<string, PlaceTab>>({});

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(rows.map((r) => r.symbol));
    // Meme coins are not offered as an opening holding.
    return SUPPORTED_CRYPTO_ASSETS.filter((c) => !isMemeSymbol(c.symbol))
      .filter(
        (c) =>
          !taken.has(c.symbol) &&
          (c.displayName.includes(query.trim()) || c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [query, rows]);

  const patch = (key: string, next: Partial<CryptoDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const patchPlace = (row: CryptoDraftRow, placeKey: string, next: Partial<CryptoPlaceDraft>) =>
    patch(row.key, { places: row.places.map((p) => (p.key === placeKey ? { ...p, ...next } : p)) });

  const setPickerOpen = (rowKey: string, open: boolean) =>
    setOpenPickers((prev) => {
      const next = new Set(prev);
      if (open) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });

  const add = (coin: (typeof SUPPORTED_CRYPTO_ASSETS)[number]) => {
    const isTether = coin.symbol === "USDT";
    const key = newRowKey();
    onChange([...rows, { key, symbol: coin.symbol, name: coin.displayName, priceCurrency: isTether ? "IRT" : "USDT", places: [] }]);
    setQuery("");
    // Where it is held is the very next question — asked right in the card.
    setPickerOpen(key, true);
  };

  /** One tap adds the place; tapping it again removes it. */
  const togglePlace = (row: CryptoDraftRow, placeKey: string, walletName: string) => {
    const existing = row.places.find((p) => walletKeyOf(p.walletName) === placeKey);
    if (existing) {
      patch(row.key, { places: row.places.filter((p) => p.key !== existing.key) });
      return;
    }
    patch(row.key, {
      places: [
        ...row.places,
        // A tether's cost is its Toman price; today's rate is a sensible start.
        { key: newRowKey(), walletName, quantity: "", unitPrice: row.symbol === "USDT" ? rate : "" },
      ],
    });
  };

  const goldValue = lineValue(goldGrams, goldPrice);

  return (
    <section className="space-y-5">
      <StepIntro title="رمزارز و طلا" text="هر رمزارز، جایی که نگهداری می‌شود و قیمت خریدش را وارد کنید." />

      <div className="space-y-2">
        <label className="label" htmlFor="setup-crypto-search">
          افزودن رمزارز یا استیبل‌کوین
        </label>
        <input
          id="setup-crypto-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="بیت‌کوین، تتر، یو اس دی سی…"
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
                  <Icon name="plus" size={15} />
                </button>
              </li>
            ))}
            {matches.length === 0 && <li className="muted p-3 text-center text-[length:var(--fs-xs)]">پیدا نشد</li>}
          </ul>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => {
            const isTether = row.symbol === "USDT";
            const pickerOpen = row.places.length === 0 || openPickers.has(row.key);
            const tab = tabs[row.key] ?? "exchange";
            const picked = new Set(row.places.map((p) => walletKeyOf(p.walletName)));
            const chip = (placeKey: string, walletName: string, label: string) => {
              const on = picked.has(placeKey);
              return (
                <li key={placeKey || "other"}>
                  <button
                    type="button"
                    className={`place-chip${on ? " is-on" : ""}`}
                    aria-pressed={on}
                    onClick={() => togglePlace(row, placeKey, walletName)}
                  >
                    <PlaceMark name={walletName} size={24} />
                    <span className="place-chip-name">{label}</span>
                    <span className="place-chip-check" aria-hidden="true">
                      <Icon name={on ? "check" : "plus"} size={12} />
                    </span>
                  </button>
                </li>
              );
            };

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

                {pickerOpen ? (
                  <div className="place-picker">
                    <div className="place-picker-head">
                      <p className="min-w-0 flex-1 text-[length:var(--fs-sm)] font-semibold">
                        {row.name} کجا نگهداری می‌شود؟
                      </p>
                      <CurrencySwitch
                        label="نوع محل نگهداری"
                        value={tab}
                        options={PLACE_TABS}
                        onChange={(next) => setTabs((prev) => ({ ...prev, [row.key]: next }))}
                      />
                    </div>
                    <p className="muted text-[length:var(--fs-xs)] leading-6">
                      روی هر محل بزنید تا اضافه شود؛ چند محل هم‌زمان مجاز است.
                    </p>
                    <ul className="place-chips" role="list">
                      {TAB_PLACES[tab].map((w) => chip(walletKeyOf(w.name), w.name, w.name))}
                      {chip("", "", OTHER_PLACE_LABEL)}
                    </ul>
                    {row.places.length > 0 ? (
                      <button type="button" className="btn btn-soft w-full" onClick={() => setPickerOpen(row.key, false)}>
                        <Icon name="check" size={15} />
                        انتخاب محل تمام شد
                      </button>
                    ) : (
                      <p className="text-center text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                        برای ادامه، دست‌کم یک محل نگهداری انتخاب کنید.
                      </p>
                    )}
                  </div>
                ) : (
                  <button type="button" className="place-add" onClick={() => setPickerOpen(row.key, true)}>
                    <Icon name="plus" size={15} />
                    افزودن صرافی یا کیف پول دیگر
                  </button>
                )}

                {row.places.length > 0 && (
                  <ul className="place-lines">
                    {row.places.map((place) => {
                      const value = lineValue(place.quantity, place.unitPrice);
                      const missingPrice = value.isZero() && Number(place.quantity) > 0;
                      const label = place.walletName || OTHER_PLACE_LABEL;
                      return (
                        <li key={place.key} className="place-line">
                          <div className="flex items-center gap-2">
                            <PlaceMark name={place.walletName} size={26} />
                            <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] font-semibold">{label}</span>
                            {value.gt(0) && (
                              <span className="muted num money-nowrap text-[length:var(--fs-xs)]" dir="rtl">
                                {row.priceCurrency === "USDT"
                                  ? formatMoney(toToman(value, "USDT", rate).toFixed(0), "IRT")
                                  : formatMoney(value.toFixed(0), "IRT")}
                              </span>
                            )}
                            <button
                              type="button"
                              className="icon-btn !min-h-8 !min-w-8"
                              onClick={() => patch(row.key, { places: row.places.filter((p) => p.key !== place.key) })}
                              aria-label={`حذف ${row.name} در ${label}`}
                            >
                              <Icon name="x" size={13} />
                            </button>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="label">مقدار</label>
                              <AmountInput
                                inputMode="decimal"
                                value={place.quantity}
                                onChange={(e) => patchPlace(row, place.key, { quantity: digitsOnly(e.target.value) })}
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
                                value={place.unitPrice}
                                onChange={(e) => patchPlace(row, place.key, { unitPrice: digitsOnly(e.target.value) })}
                                placeholder="۰"
                                className="field num"
                                dir="ltr"
                                unit={row.priceCurrency === "IRT" ? "toman" : "usdt"}
                              />
                            </div>
                          </div>
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
