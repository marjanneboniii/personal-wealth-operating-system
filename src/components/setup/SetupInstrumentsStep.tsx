"use client";

/**
 * «صندوق، سهام و بازار جهانی» — instruments the user already owns.
 *
 * PURCHASE CURRENCY FOLLOWS THE MARKET, not the app:
 *   صندوق‌ها (incl. gold funds) and TSE stocks trade in Toman — fixed.
 *   US stocks, indices and commodities (والکس) are bought with Tether or Toman.
 *
 * The price field used to be labelled in the wizard's «base currency» (USD),
 * so a fund bought at ۲۵٬۰۰۰ تومان had to be typed in dollars — and a Toman
 * figure typed there was booked as dollars.
 *
 * A row with no quantity is still registered (identity + account), so the
 * user can enter the purchase later. DRAFTS ONLY until the final confirmation.
 */
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import WallexAssetPicker from "@/components/assets/WallexAssetPicker";
import { FUND_KIND_MARKS } from "@/components/ui/AssetTypeMarks";
import StepIntro, { CurrencySwitch } from "@/components/setup/StepIntro";
import { formatMoney } from "@/lib/format";
import { WALLEX_RWA_KINDS } from "@/features/pricing/wallexKinds";
import { searchFunds, searchStocks, type FundKind } from "@/features/funds/search";
import { lineValue, newRowKey, toToman } from "@/components/setup/setupMoney";

export type InstrumentDraftRow = {
  key: string;
  kind: "fund" | "stock" | "wallex";
  symbol: string;
  name: string;
  /** Sub-kind of a fund, for the mark only. */
  fundKind?: FundKind;
  /** والکس artwork, for the mark only. */
  logoUrl?: string | null;
  /** Persian label of the والکس family («سهام آمریکا», «کامودیتی»…). */
  kindLabel?: string;
  quantity: string;
  unitPrice: string;
  /** Always Toman for a fund or TSE stock. */
  priceCurrency: "IRT" | "USDT";
};

type Family = "fund" | "stock" | "wallex";

const PRICE_CURRENCIES: { value: "USDT" | "IRT"; label: string }[] = [
  { value: "USDT", label: "تتر" },
  { value: "IRT", label: "تومان" },
];

const digitsOnly = (value: string) => value.replace(/[^\d.]/g, "");

function Mark({ row, size }: { row: Pick<InstrumentDraftRow, "kind" | "symbol" | "name" | "logoUrl" | "fundKind">; size: number }) {
  if (row.kind === "wallex") {
    return <AssetLogo symbol={row.symbol} name={row.name} logoUrl={row.logoUrl ?? null} size={size} />;
  }
  const FundMark = row.fundKind ? FUND_KIND_MARKS[row.fundKind] : null;
  if (FundMark) {
    return (
      <span className="inline-flex shrink-0 overflow-hidden" style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }} aria-hidden="true">
        <FundMark size={size} />
      </span>
    );
  }
  return (
    <span className="flow-icon" style={{ width: size, height: size }} aria-hidden="true">
      <Icon name="trend-up" size={15} />
    </span>
  );
}

export default function SetupInstrumentsStep({
  rows,
  onChange,
  rate,
}: {
  rows: InstrumentDraftRow[];
  onChange: (next: InstrumentDraftRow[]) => void;
  /** USD→IRT setup rate, for the Toman equivalent of a Tether price. */
  rate: string;
}) {
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<Family>("fund");

  const patch = (key: string, next: Partial<InstrumentDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const results = useMemo(() => {
    if (family === "wallex" || !query.trim()) return [];
    const taken = new Set(rows.map((r) => r.symbol));
    if (family === "stock") {
      return searchStocks(query, { limit: 6 })
        .filter((s) => !taken.has(s.symbol))
        .map((s) => ({ symbol: s.symbol, name: s.name, label: s.sectorLabel, fundKind: undefined as FundKind | undefined }));
    }
    return searchFunds(query, { limit: 6 })
      .filter((f) => !taken.has(f.symbol))
      .map((f) => ({ symbol: f.symbol, name: f.name, label: f.kindLabel, fundKind: f.kind as FundKind | undefined }));
  }, [query, family, rows]);

  const append = (row: Omit<InstrumentDraftRow, "key" | "quantity" | "unitPrice">) => {
    onChange([...rows, { ...row, key: newRowKey(), quantity: "", unitPrice: "" }]);
    setQuery("");
  };

  return (
    <section className="space-y-5">
      <StepIntro title="صندوق، سهام و بازار جهانی" text="صندوق و سهام بورس تهران به تومان؛ سهام آمریکا، شاخص و کامودیتی به تتر یا تومان." />

      <div className="space-y-2">
        <CurrencySwitch<Family>
          label="نوع دارایی"
          value={family}
          onChange={(next) => {
            setFamily(next);
            setQuery("");
          }}
          options={[
            { value: "fund", label: "صندوق" },
            { value: "stock", label: "سهام بورسی" },
            { value: "wallex", label: "آمریکا، شاخص، کامودیتی" },
          ]}
        />

        {family === "wallex" ? (
          <WallexAssetPicker
            kinds={WALLEX_RWA_KINDS}
            actionLabel="افزودن"
            hideFootnote
            exclude={rows.map((r) => r.symbol)}
            limit={40}
            onPick={(asset) =>
              append({
                kind: "wallex",
                symbol: asset.symbol,
                name: asset.displayName,
                logoUrl: asset.logoUrl,
                kindLabel: asset.kindLabel,
                priceCurrency: "USDT",
              })
            }
          />
        ) : (
          <>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={family === "stock" ? "فولاد، شستا، وبملت…" : "عیار، کهربا، اعتماد…"}
              className="field"
              aria-label={family === "stock" ? "جست‌وجوی سهام" : "جست‌وجوی صندوق"}
              autoComplete="off"
            />
            {query.trim().length > 0 && (
              <ul className="card list-card">
                {results.map((r) => (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      onClick={() => append({ kind: family, symbol: r.symbol, name: r.name, fundKind: r.fundKind, priceCurrency: "IRT" })}
                      className="list-row w-full text-right hover:bg-[color:var(--hover)]"
                    >
                      <Mark row={{ kind: family, symbol: r.symbol, name: r.name, fundKind: r.fundKind }} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[length:var(--fs-sm)] font-medium">{r.name}</span>
                        <span className="muted block truncate text-[length:var(--fs-xs)]">{r.label}</span>
                      </span>
                      <span className="chip shrink-0">{r.symbol}</span>
                    </button>
                  </li>
                ))}
                {results.length === 0 && <li className="muted p-3 text-center text-[length:var(--fs-xs)]">پیدا نشد — بعداً از «ثبت صندوق و سهام» اضافه کنید</li>}
              </ul>
            )}
          </>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const value = lineValue(row.quantity, row.unitPrice);
            const toman = toToman(value, row.priceCurrency, rate);
            return (
              <li key={row.key} className="card setup-row space-y-3">
                <div className="flex items-center gap-2.5">
                  <Mark row={row} size={30} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[length:var(--fs-sm)]">{row.name}</b>
                    {row.kindLabel && <span className="muted block text-[length:var(--fs-xs)]">{row.kindLabel}</span>}
                  </span>
                  {row.kind === "wallex" ? (
                    <CurrencySwitch
                      label={`واحد خرید ${row.name}`}
                      value={row.priceCurrency}
                      options={PRICE_CURRENCIES}
                      onChange={(priceCurrency) => patch(row.key, { priceCurrency })}
                    />
                  ) : (
                    <span className="badge badge-neutral">تومان</span>
                  )}
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                    className="icon-btn !min-h-9 !min-w-9"
                    aria-label={`حذف ${row.name}`}
                  >
                    <Icon name="x" size={15} />
                  </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">تعداد واحد</label>
                    <AmountInput
                      inputMode="decimal"
                      value={row.quantity}
                      onChange={(e) => patch(row.key, { quantity: digitsOnly(e.target.value) })}
                      placeholder="خالی = فقط ثبت نماد"
                      className="field num"
                      dir="ltr"
                      showWords={false}
                      unit="none"
                    />
                  </div>
                  <div>
                    <label className="label">قیمت خرید هر واحد ({row.priceCurrency === "IRT" ? "تومان" : "تتر"})</label>
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
                    بهای خرید {formatMoney(row.priceCurrency === "IRT" ? value.toFixed(0) : value.toString(), row.priceCurrency)}
                    {row.priceCurrency === "USDT" && ` · ${formatMoney(toman.toFixed(0), "IRT")}`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
