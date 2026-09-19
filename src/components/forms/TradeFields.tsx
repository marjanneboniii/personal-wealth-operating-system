"use client";

/**
 * خرید و فروش دارایی — the same plain cards as «ثبت هزینه»:
 *
 *   دارایی          what is bought or sold: your holdings, or a search of the
 *                   market (buy); your holdings, properties and vehicles (sell)
 *   مقدار و قیمت    quantity (with ۲۵٪ · ۵۰٪ · همه on a sale), market or limit
 *                   price, and what it comes to
 *   پرداخت با /     the money accounts that can settle this trade, as tiles
 *   واریز به        with their balance («تومان - نوبیتکس», «تتر - ربی والت»)
 *   تاریخ          today / yesterday / another date, fee and a note
 *
 * A property or vehicle sale replaces «مقدار و قیمت» with its sale price.
 * Assets are named in Persian only — no Latin ticker.
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields to `createTransactionAction` as before.
 */
import { useState, type ComponentProps } from "react";
import { currencyLabel, formatMoney, formatNumber, formatQty, getDualDate } from "@/lib/format";
import { D } from "@/domain/decimal";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import { AutomobileLogo, RealEstateLogo } from "@/components/ui/IranLogo";
import WallexAssetPicker from "@/components/assets/WallexAssetPicker";
import type { MarketRow } from "@/features/pricing/marketSearch";
import type { PriceUnit, quoteTrade } from "@/features/trade/rules";
import type { AccountOption, RegistrySaleOption } from "./TransactionForm";

type Quote = NonNullable<ReturnType<typeof quoteTrade>>;

const SELL_SHARES: Array<[string, string]> = [
  ["۲۵٪", "0.25"],
  ["۵۰٪", "0.5"],
  ["همه", "1"],
];

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A unit price or total in the price unit: Toman whole, Tether to 6 places. */
function inUnit(value: string | null | undefined, unit: PriceUnit): string {
  if (!value) return "—";
  return unit === "IRT" ? formatMoney(D(value).toFixed(0), "IRT") : `${formatQty(value, 6)} تتر`;
}

/** Cut (never round up) to `decimals` places — «همه» must not exceed the holding. */
function cutDecimals(value: string, decimals: number): string {
  const [int, frac = ""] = value.split(".");
  const cut = frac.slice(0, decimals).replace(/0+$/, "");
  return cut ? `${int}.${cut}` : int;
}

/** A balance in the account's own unit. */
export function balanceLabel(account: AccountOption, raw: string | undefined): React.ReactNode {
  if (raw === undefined) return "موجودی ثبت نشده";
  const unit = (account.symbol ?? "IRT").toUpperCase();
  if (unit === "IRT" || unit === "IRR") {
    const toman = unit === "IRR" ? D(raw).div(10) : D(raw);
    return (
      <>
        <span className="num">{formatNumber(toman.toFixed(0), { decimals: 0 })}</span> تومان
      </>
    );
  }
  return (
    <>
      <span className="num">{formatQty(raw, Math.min(Math.max(account.decimals, 0), 8))}</span>{" "}
      {currencyLabel(unit) !== unit ? currencyLabel(unit) : account.name.split(" - ")[0]}
    </>
  );
}

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

type Props = {
  type: "buy" | "sell";
  /* asset */
  asset: AccountOption | null;
  assetName: string;
  assetLogoUrl: string | null;
  heldQty: string | null;
  qtyDecimals: number;
  marketRow: MarketRow | undefined;
  ownedAssets: AccountOption[];
  market: Map<string, MarketRow>;
  balances: Record<string, string>;
  onPickAsset: (accountId: string) => void;
  registryAssets: RegistrySaleOption[];
  registryItem: RegistrySaleOption | null;
  onPickRegistry: (key: string) => void;
  onClearAsset: () => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  onRegistered: ComponentProps<typeof WallexAssetPicker>["onRegistered"];
  /* settlement */
  settleOptions: AccountOption[];
  moneyId: string;
  onMoneyChange: (id: string) => void;
  /** Why no account can settle this trade, and which account would. */
  settleHint: string;
  /* quantity & price */
  quantity: string;
  setQuantity: (value: string) => void;
  overHeld: boolean;
  usingMarket: boolean;
  setPriceMode: (mode: "market" | "limit") => void;
  marketUnitPrice: string | null;
  priceUnit: PriceUnit;
  limitPrice: string;
  setLimitPrice: (value: string) => void;
  quote: Quote | null;
  /** Net of the fee: a sale deposits proceeds − fee, a buy withdraws value + fee. */
  settleTotalLabel: string;
  feeApplied: boolean;
  feeExceedsProceeds: boolean;
  /* registry sale */
  salePrice: string;
  setSalePrice: (value: string) => void;
  /* details */
  fee: string;
  setFee: (value: string) => void;
  feeInToman: boolean;
  feeSymbol: string;
  entryDate: string;
  setEntryDate: (iso: string) => void;
  today: string;
  description: string;
  setDescription: (value: string) => void;
  autoDescription: string;
};

export default function TradeFields(p: Props) {
  const [pickingDate, setPickingDate] = useState(false);
  const buy = p.type === "buy";
  const hasAsset = !!p.asset || !!p.registryItem;
  const yesterday = shiftIso(p.today, -1);
  const dateChoice = p.entryDate === p.today ? "today" : p.entryDate === yesterday ? "yesterday" : "other";
  const held = p.heldQty ? D(p.heldQty) : null;
  const nameOf = (a: AccountOption) => p.market.get((a.symbol ?? "").toUpperCase())?.displayName ?? a.name;

  return (
    <div className="expense-form">
      {/* ── Asset ── */}
      <section className="card expense-card" aria-labelledby="trade-asset-title">
        <header className="expense-head">
          <h2 id="trade-asset-title">{buy ? "چه دارایی‌ای خریدید؟" : "چه دارایی‌ای فروختید؟"}</h2>
          {hasAsset && !p.pickerOpen && (
            <button type="button" className="expense-link" onClick={p.onClearAsset}>
              تغییر
            </button>
          )}
        </header>

        {p.registryItem ? (
          <div className="trade-asset" data-on>
            {p.registryItem.kind === "property" ? <RealEstateLogo size={36} /> : <AutomobileLogo name={p.registryItem.detail} size={36} />}
            <span className="trade-asset-text">
              <b>{p.registryItem.label}</b>
              <span className="expense-sub">{p.registryItem.detail}</span>
            </span>
            <Check />
          </div>
        ) : p.asset && !p.pickerOpen ? (
          <div className="trade-asset" data-on>
            <AssetLogo
              symbol={p.asset.symbol}
              name={p.assetName}
              logoUrl={p.assetLogoUrl}
              coingeckoId={p.asset.coingeckoId ?? null}
              assetClassName={p.asset.className ?? null}
              size={36}
              radius={10}
            />
            <span className="trade-asset-text">
              <b>{p.assetName}</b>
              <span className="expense-sub">
                موجودی: <span className="num">{held ? formatQty(held.toString(), p.qtyDecimals) : "۰"}</span>
                {p.marketRow?.priceTmn && (
                  <>
                    {" · "}قیمت: <span className="num">{inUnit(p.marketRow.priceTmn, "IRT")}</span>
                  </>
                )}
              </span>
            </span>
            <Check />
          </div>
        ) : p.pickerOpen || (buy && p.ownedAssets.length === 0) ? (
          <>
            <WallexAssetPicker actionLabel="انتخاب" hideFootnote onRegistered={p.onRegistered} />
            {p.ownedAssets.length > 0 && (
              <button type="button" className="expense-link justify-self-start" onClick={() => p.setPickerOpen(false)}>
                <Icon name="arrow-start" size={16} />
                دارایی‌های من
              </button>
            )}
          </>
        ) : (
          <>
            {p.ownedAssets.length > 0 && (
              <>
                <p className="expense-sub">دارایی‌های شما</p>
                <ul className="expense-results" aria-label="دارایی‌های شما">
                  {p.ownedAssets.slice(0, 30).map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => p.onPickAsset(a.id)}>
                        <AssetLogo
                          symbol={a.symbol}
                          name={nameOf(a)}
                          logoUrl={a.logoUrl ?? null}
                          coingeckoId={a.coingeckoId ?? null}
                          assetClassName={a.className ?? null}
                          size={24}
                          radius={7}
                        />
                        <span className="min-w-0 flex-1 truncate">{nameOf(a)}</span>
                        {p.balances[a.id] && D(p.balances[a.id]).gt(0) && (
                          <span className="expense-sub num shrink-0">
                            {formatQty(p.balances[a.id], Math.min(Math.max(a.decimals, 0), 8))}
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {!buy && p.registryAssets.length > 0 && (
              <>
                <p className="expense-sub">ملک و خودرو</p>
                <ul className="expense-results" aria-label="ملک و خودرو">
                  {p.registryAssets.map((r) => (
                    <li key={`${r.kind}:${r.id}`}>
                      <button type="button" onClick={() => p.onPickRegistry(`${r.kind}:${r.id}`)}>
                        {r.kind === "property" ? <RealEstateLogo size={24} /> : <AutomobileLogo name={r.detail} size={24} />}
                        <span className="min-w-0 flex-1 truncate">{r.label}</span>
                        <span className="expense-sub shrink-0 truncate">{r.detail}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}

            {buy ? (
              <div className="expense-squares">
                <button type="button" className="expense-square" onClick={() => p.setPickerOpen(true)}>
                  <Icon name="search" size={16} />
                  <span className="expense-square-label">دارایی دیگر</span>
                </button>
                <a href="/asset-registry#real-estate" className="expense-square">
                  <RealEstateLogo size={18} />
                  <span className="expense-square-label">ملک</span>
                </a>
                <a href="/asset-registry#vehicle" className="expense-square">
                  <AutomobileLogo size={18} />
                  <span className="expense-square-label">خودرو</span>
                </a>
              </div>
            ) : (
              p.ownedAssets.length === 0 &&
              p.registryAssets.length === 0 && <p className="expense-empty">هنوز دارایی‌ای برای فروش ثبت نشده است.</p>
            )}
          </>
        )}
      </section>

      {/* ── Quantity & price — or a property / vehicle's sale price ── */}
      {p.registryItem ? (
        <section className="card expense-card" aria-labelledby="trade-sale-title">
          <header className="expense-head">
            <h2 id="trade-sale-title">مبلغ فروش</h2>
            <span className="expense-sub">تومان</span>
          </header>
          <AmountInput
            value={p.salePrice}
            onValueChange={p.setSalePrice}
            placeholder="۰"
            className="field num"
            unit="toman"
            aria-labelledby="trade-sale-title"
          />
          {p.registryItem.valueToman && D(p.registryItem.valueToman).gt(0) && (
            <div className="expense-presets" role="group" aria-label="مبلغ پیشنهادی">
              <button
                type="button"
                className="expense-preset trade-preset-wide"
                data-on={p.salePrice === D(p.registryItem.valueToman).toFixed(0) || undefined}
                onClick={() => p.setSalePrice(D(p.registryItem!.valueToman!).toFixed(0))}
              >
                آخرین ارزش: <span className="num">{formatMoney(D(p.registryItem.valueToman).toFixed(0), "IRT")}</span>
              </button>
            </div>
          )}
        </section>
      ) : (
        p.asset &&
        !p.pickerOpen && (
          <section className="card expense-card" aria-labelledby="trade-qty-title">
            <header className="expense-head">
              <h2 id="trade-qty-title">مقدار</h2>
              {held?.gt(0) && (
                <span className="expense-sub">
                  موجودی: <span className="num">{formatQty(held.toString(), p.qtyDecimals)}</span>
                </span>
              )}
            </header>
            <AmountInput
              inputMode="decimal"
              maxDecimals={p.qtyDecimals}
              value={p.quantity}
              onValueChange={p.setQuantity}
              placeholder="۰"
              className="field num"
              showWords={false}
              unit="none"
              aria-labelledby="trade-qty-title"
            />
            {!buy && held?.gt(0) && (
              <div className="expense-presets" role="group" aria-label="بخشی از موجودی">
                {SELL_SHARES.map(([label, share]) => {
                  const value = cutDecimals(held.mul(share).toString(), p.qtyDecimals);
                  const on = !!p.quantity && D(p.quantity).raw === D(value).raw;
                  return (
                    <button
                      key={share}
                      type="button"
                      className="expense-preset"
                      data-on={on || undefined}
                      aria-pressed={on}
                      onClick={() => p.setQuantity(value)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {p.overHeld && (
              <p className="expense-note expense-note-warn" role="alert">
                مقدار واردشده از موجودی شما بیشتر است.
              </p>
            )}

            <div className="expense-row">
              <span className="expense-row-label">قیمت</span>
              <div className="expense-seg" role="group" aria-label="نوع قیمت">
                {(
                  [
                    ["market", "قیمت بازار"],
                    ["limit", "قیمت دلخواه"],
                  ] as const
                ).map(([key, label]) => {
                  const on = key === "market" ? p.usingMarket : !p.usingMarket;
                  return (
                    <button
                      key={key}
                      type="button"
                      data-on={on || undefined}
                      aria-pressed={on}
                      disabled={key === "market" && !p.marketUnitPrice}
                      onClick={() => p.setPriceMode(key)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {p.usingMarket ? (
                <p className="expense-sub">
                  هر واحد <span className="num">{inUnit(p.marketUnitPrice, p.priceUnit)}</span>
                </p>
              ) : (
                <>
                  <AmountInput
                    inputMode="decimal"
                    maxDecimals={p.priceUnit === "IRT" ? 0 : 6}
                    value={p.limitPrice}
                    onValueChange={p.setLimitPrice}
                    placeholder={p.marketUnitPrice ? inUnit(p.marketUnitPrice, p.priceUnit) : "۰"}
                    className="field num"
                    unit={p.priceUnit === "IRT" ? "toman" : "USDT"}
                    aria-label={`قیمت هر واحد به ${p.priceUnit === "IRT" ? "تومان" : "تتر"}`}
                  />
                  {!p.marketUnitPrice && <p className="expense-sub">قیمت بازار این دارایی در دسترس نیست؛ قیمت هر واحد را وارد کنید.</p>}
                </>
              )}
            </div>

            {p.quote && (
              <dl className="trade-quote" aria-live="polite">
                <div>
                  <dt>{buy ? "از حساب کم می‌شود" : "به حساب واریز می‌شود"}</dt>
                  <dd className="num trade-quote-total">{p.settleTotalLabel}</dd>
                </div>
                <div>
                  <dt>ارزش کل</dt>
                  <dd className="num">
                    {inUnit(p.quote.totalToman, "IRT")}
                    {p.quote.totalUsdt ? ` · ${inUnit(p.quote.totalUsdt, "USDT")}` : ""}
                  </dd>
                </div>
              </dl>
            )}
          </section>
        )
      )}

      {/* ── Settlement account ── */}
      {hasAsset && !p.pickerOpen && (
        <section className="card expense-card" aria-labelledby="trade-account-title">
          <header className="expense-head">
            <h2 id="trade-account-title">{buy ? "پرداخت با" : "واریز به"}</h2>
          </header>
          {p.settleOptions.length === 0 ? (
            <p className="expense-empty">
              {p.settleHint}{" "}
              <a href="/accounts" style={{ color: "var(--action)" }}>
                افزودن حساب
              </a>
            </p>
          ) : (
            <div className="expense-accounts" role="radiogroup" aria-label={buy ? "حساب پرداخت" : "حساب واریز"}>
              {p.settleOptions.map((a) => {
                const on = a.id === p.moneyId;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => p.onMoneyChange(a.id)}
                    className="expense-acct"
                    data-on={on || undefined}
                  >
                    <span className="expense-radio" aria-hidden="true" />
                    <span className="expense-acct-text">
                      <span className="expense-acct-name">{a.name}</span>
                      <span className="expense-acct-bal">{balanceLabel(a, p.balances[a.id])}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ── Date, fee & note ── */}
      <section className="card expense-card expense-details">
        <div className="expense-row">
          <span className="expense-row-label">تاریخ</span>
          <div className="expense-seg" role="group" aria-label="تاریخ معامله">
            {(
              [
                ["today", "امروز", p.today],
                ["yesterday", "دیروز", yesterday],
              ] as const
            ).map(([key, label, iso]) => {
              const on = dateChoice === key && !pickingDate;
              return (
                <button
                  key={key}
                  type="button"
                  data-on={on || undefined}
                  aria-pressed={on}
                  onClick={() => {
                    p.setEntryDate(iso);
                    setPickingDate(false);
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              data-on={dateChoice === "other" || pickingDate || undefined}
              aria-expanded={pickingDate}
              onClick={() => setPickingDate((v) => !v)}
            >
              <Icon name="calendar" size={14} />
              {dateChoice === "other" && p.entryDate ? getDualDate(p.entryDate).jalali : "تاریخ دیگر"}
            </button>
          </div>
          {pickingDate ? (
            <DualDateInput name="entryDate" value={p.entryDate} onChange={p.setEntryDate} label="تاریخ معامله" required showGregorian={false} />
          ) : (
            <input type="hidden" name="entryDate" value={p.entryDate} />
          )}
        </div>

        {!p.registryItem && (
          <div className="expense-row">
            <label htmlFor="trade-fee" className="expense-row-label">
              {p.feeInToman ? "کارمزد (تومان، اختیاری)" : `کارمزد (${currencyLabel(p.feeSymbol)}، اختیاری)`}
            </label>
            <AmountInput
              id="trade-fee"
              inputMode={p.feeInToman ? "numeric" : "decimal"}
              value={p.fee}
              onValueChange={p.setFee}
              className="field num"
              unit={p.feeInToman ? "toman" : p.feeSymbol}
              placeholder="۰"
            />
            {p.feeApplied && (
              <p className="expense-sub">
                {buy ? "کل مبلغ پرداختی با کارمزد: " : "خالص دریافتی پس از کسر کارمزد: "}
                <b className="num" style={{ color: p.feeExceedsProceeds ? "var(--negative)" : undefined }}>
                  {p.settleTotalLabel}
                </b>
              </p>
            )}
          </div>
        )}

        <div className="expense-row">
          <label htmlFor="trade-note" className="expense-row-label">
            یادداشت
          </label>
          <input
            id="trade-note"
            className="field"
            value={p.description}
            onChange={(e) => p.setDescription(e.target.value)}
            placeholder={p.autoDescription}
          />
        </div>
      </section>
    </div>
  );
}
