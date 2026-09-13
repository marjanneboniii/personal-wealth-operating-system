"use client";

/**
 * «رمزارز و طلا» — every coin the user holds, WHERE it is held, plus physical gold.
 *
 * A coin is a card; its places (exchanges / wallets) are PICKED from a logo
 * grid, never typed. One coin may sit in several places and one place may
 * hold several coins, so each picked place is its own line with its own
 * quantity and purchase price.
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
import Sheet from "@/components/ui/Sheet";
import StepIntro, { CurrencySwitch } from "@/components/setup/StepIntro";
import { SUPPORTED_CRYPTO_ASSETS } from "@/features/pricing/supportedAssets";
import { isMemeSymbol } from "@/features/pricing/wallexKinds";
import { faCount, formatMoney } from "@/lib/format";
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
  wallet: KNOWN_WALLETS.filter((w) => w.kind !== "exchange"),
};
/** Selection keys in catalogue order; "" (سایر) last. */
const PLACE_ORDER = [...KNOWN_WALLETS.map((w) => walletKeyOf(w.name)), ""];
const NAME_BY_KEY = new Map(KNOWN_WALLETS.map((w) => [walletKeyOf(w.name), w.name]));

const digitsOnly = (value: string) => value.replace(/[^\d.]/g, "");

function PlaceMark({ name, size }: { name: string; size: number }) {
  const logo = knownWalletOf(name)?.logo;
  if (logo) return <AssetLogo userLogoUrl={logo} name={name} size={size} />;
  return (
    <span className="place-mark-other" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="wallet" size={Math.round(size * 0.5)} />
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
  // Place picker: which coin it is open for, the tab, and the pending picks.
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [tab, setTab] = useState<PlaceTab>("exchange");
  const [selection, setSelection] = useState<Set<string>>(new Set());

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

  const openPicker = (rowKey: string, current: CryptoPlaceDraft[]) => {
    setSelection(new Set(current.map((p) => walletKeyOf(p.walletName))));
    const first = current[0] ? knownWalletOf(current[0].walletName) : null;
    setTab(first && first.kind !== "exchange" ? "wallet" : "exchange");
    setPickerFor(rowKey);
  };
  const closePicker = () => setPickerFor(null);

  const add = (coin: (typeof SUPPORTED_CRYPTO_ASSETS)[number]) => {
    const isTether = coin.symbol === "USDT";
    const key = newRowKey();
    onChange([...rows, { key, symbol: coin.symbol, name: coin.displayName, priceCurrency: isTether ? "IRT" : "USDT", places: [] }]);
    setQuery("");
    // Where it is held is the very next question.
    openPicker(key, []);
  };

  const toggle = (key: string) =>
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const confirmPicker = () => {
    const row = rows.find((r) => r.key === pickerFor);
    if (row) {
      // Keep what was already typed for places that stay selected.
      const kept = row.places.filter((p) => selection.has(walletKeyOf(p.walletName)));
      const have = new Set(kept.map((p) => walletKeyOf(p.walletName)));
      const added = PLACE_ORDER.filter((k) => selection.has(k) && !have.has(k)).map((k) => ({
        key: newRowKey(),
        walletName: NAME_BY_KEY.get(k) ?? "",
        quantity: "",
        // A tether's cost is its Toman price; today's rate is a sensible start.
        unitPrice: row.symbol === "USDT" ? rate : "",
      }));
      patch(row.key, { places: [...kept, ...added] });
    }
    closePicker();
  };

  const pickerRow = rows.find((r) => r.key === pickerFor);
  const goldValue = lineValue(goldGrams, goldPrice);

  const tile = (key: string, name: string, label: string) => {
    const on = selection.has(key);
    return (
      <li key={key || "other"}>
        <button type="button" className={`place-tile${on ? " is-on" : ""}`} aria-pressed={on} onClick={() => toggle(key)}>
          <span className="place-tile-check" aria-hidden="true">
            <Icon name="check" size={11} />
          </span>
          <PlaceMark name={name} size={34} />
          <span className="place-tile-name">{label}</span>
        </button>
      </li>
    );
  };

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

                {row.places.length > 0 && (
                  <ul className="place-lines">
                    {row.places.map((place) => {
                      const value = lineValue(place.quantity, place.unitPrice);
                      const missingPrice = value.isZero() && Number(place.quantity) > 0;
                      const label = place.walletName || OTHER_PLACE_LABEL;
                      return (
                        <li key={place.key} className="place-line">
                          <div className="flex items-center gap-2">
                            <PlaceMark name={place.walletName} size={24} />
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

                <button type="button" className={`place-add${row.places.length === 0 ? " is-empty" : ""}`} onClick={() => openPicker(row.key, row.places)}>
                  <Icon name={row.places.length === 0 ? "plus" : "wallet"} size={15} />
                  {row.places.length === 0 ? "انتخاب صرافی یا کیف پول" : "افزودن یا تغییر محل نگهداری"}
                </button>
                {row.places.length === 0 && (
                  <p className="text-center text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                    برای ادامه، محل نگهداری {row.name} را انتخاب کنید.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Sheet open={!!pickerRow} onClose={closePicker} title={pickerRow ? `${pickerRow.name} کجا نگهداری می‌شود؟` : undefined} wide>
        <div className="space-y-3 p-4">
          <p className="muted text-[length:var(--fs-xs)] leading-6">هر جایی که دارید را انتخاب کنید؛ چند انتخاب هم‌زمان مجاز است.</p>
          <CurrencySwitch label="نوع محل نگهداری" value={tab} options={PLACE_TABS} onChange={setTab} />
          <ul className="place-grid" role="list">
            {TAB_PLACES[tab].map((w) => tile(walletKeyOf(w.name), w.name, w.name))}
            {tile("", "", OTHER_PLACE_LABEL)}
          </ul>
        </div>
        <div className="place-sheet-foot">
          <span className="muted min-w-0 flex-1 text-[length:var(--fs-xs)]">
            {selection.size > 0 ? `${faCount(selection.size)} محل انتخاب شده` : "هنوز محلی انتخاب نشده"}
          </span>
          <button type="button" className="btn btn-ghost" onClick={closePicker}>
            انصراف
          </button>
          <button type="button" className="btn btn-primary" onClick={confirmPicker}>
            تأیید
          </button>
        </div>
      </Sheet>

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
