"use client";

/**
 * خرید و فروش دارایی — tap the asset, type the quantity, tap the account:
 *
 *   دارایی          what is bought or sold, as logo tiles: your holdings, or
 *                   the market by family tabs (buy); your holdings,
 *                   properties and vehicles (sell)
 *   مقدار و قیمت    quantity (with ۲۵٪ · ۵۰٪ · همه on a sale), market or limit
 *                   price, and what it comes to
 *   پرداخت با /     the money accounts that can settle this trade, as logo
 *   واریز به        tiles with their balance («تومان - نوبیتکس», «تتر - ربی والت»)
 *   کی؟            امروز · دیروز · پریروز · تقویم, and an optional fee
 *
 * A property or vehicle sale replaces «مقدار و قیمت» with its sale price.
 * Assets are named in Persian only — no Latin ticker.
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields to `createTransactionAction` as before.
 */
import type { ComponentProps } from "react";
import { formatMoney, formatQty } from "@/lib/format";
import { D } from "@/domain/decimal";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import Icon from "@/components/ui/Icon";
import { AutomobileLogo, RealEstateLogo } from "@/components/ui/IranLogo";
import WallexAssetPicker from "@/components/assets/WallexAssetPicker";
import type { MarketRow } from "@/features/pricing/marketSearch";
import type { PriceUnit, quoteTrade } from "@/features/trade/rules";
import { AccountTiles, AmountHero, DateChips, FeeToggle, Presets, Tile, TxCard } from "./txKit";
import type { AccountOption, RegistrySaleOption } from "./TransactionForm";

type Quote = NonNullable<ReturnType<typeof quoteTrade>>;

const SELL_SHARES: Array<[string, string]> = [
  ["۲۵٪", "0.25"],
  ["۵۰٪", "0.5"],
  ["همه", "1"],
];

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
};

export default function TradeFields(p: Props) {
  const buy = p.type === "buy";
  const hasAsset = !!p.asset || !!p.registryItem;
  const held = p.heldQty ? D(p.heldQty) : null;
  const nameOf = (a: AccountOption) => p.market.get((a.symbol ?? "").toUpperCase())?.displayName ?? a.name;
  const logoOf = (a: AccountOption, size: number) => (
    <AssetLogo
      symbol={a.symbol}
      name={nameOf(a)}
      logoUrl={p.market.get((a.symbol ?? "").toUpperCase())?.logoUrl ?? a.logoUrl ?? null}
      coingeckoId={a.coingeckoId ?? null}
      assetClassName={a.className ?? null}
      size={size}
      radius={Math.round(size / 3.4)}
    />
  );
  const shares = !buy && held?.gt(0) ? SELL_SHARES.map(([label, share]) => ({ label, value: cutDecimals(held.mul(share).toString(), p.qtyDecimals) })) : [];
  const lastValue = p.registryItem?.valueToman && D(p.registryItem.valueToman).gt(0) ? D(p.registryItem.valueToman).toFixed(0) : null;

  return (
    <div className="txr-stack">
      {/* ── Asset ── */}
      <TxCard
        icon={buy ? "trend-up" : "trend-down"}
        title={buy ? "چه دارایی‌ای خریدید؟" : "چه دارایی‌ای فروختید؟"}
        aside={
          hasAsset && !p.pickerOpen ? (
            <button type="button" className="txr-link" onClick={p.onClearAsset}>
              تغییر
            </button>
          ) : undefined
        }
      >
        {p.registryItem ? (
          <div className="txr-picked">
            {p.registryItem.kind === "property" ? <RealEstateLogo size={40} /> : <AutomobileLogo name={p.registryItem.detail} size={40} />}
            <span className="txr-picked-text">
              <b>{p.registryItem.label}</b>
              <span className="txr-sub">{p.registryItem.detail}</span>
            </span>
            <span className="txr-tick txr-tick-static" aria-hidden="true">
              <Icon name="check" size={10} strokeWidth={3} />
            </span>
          </div>
        ) : p.asset && !p.pickerOpen ? (
          <div className="txr-picked">
            {logoOf(p.asset, 40)}
            <span className="txr-picked-text">
              <b>{p.assetName}</b>
              <span className="txr-sub">
                موجودی: <span className="num">{held ? formatQty(held.toString(), p.qtyDecimals) : "۰"}</span>
                {p.marketRow?.priceTmn && (
                  <>
                    {" · "}قیمت: <span className="num">{inUnit(p.marketRow.priceTmn, "IRT")}</span>
                  </>
                )}
              </span>
            </span>
            <span className="txr-tick txr-tick-static" aria-hidden="true">
              <Icon name="check" size={10} strokeWidth={3} />
            </span>
          </div>
        ) : p.pickerOpen || (buy && p.ownedAssets.length === 0) ? (
          <>
            <WallexAssetPicker actionLabel="انتخاب" hideFootnote onRegistered={p.onRegistered} />
            {p.ownedAssets.length > 0 && (
              <button type="button" className="txr-link justify-self-start" onClick={() => p.setPickerOpen(false)}>
                <Icon name="arrow-start" size={16} />
                دارایی‌های من
              </button>
            )}
          </>
        ) : (
          <>
            {p.ownedAssets.length > 0 && (
              <>
                <p className="txr-sub">دارایی‌های شما</p>
                <div className="txr-tiles" role="radiogroup" aria-label="دارایی‌های شما">
                  {p.ownedAssets.slice(0, 30).map((a) => (
                    <Tile
                      key={a.id}
                      onClick={() => p.onPickAsset(a.id)}
                      label={nameOf(a)}
                      mark={logoOf(a, 30)}
                      meta={
                        p.balances[a.id] && D(p.balances[a.id]).gt(0) ? (
                          <span className="num">{formatQty(p.balances[a.id], Math.min(Math.max(a.decimals, 0), 8))}</span>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              </>
            )}

            {!buy && p.registryAssets.length > 0 && (
              <>
                <p className="txr-sub">ملک و خودرو</p>
                <div className="txr-tiles" role="radiogroup" aria-label="ملک و خودرو">
                  {p.registryAssets.map((r) => (
                    <Tile
                      key={`${r.kind}:${r.id}`}
                      onClick={() => p.onPickRegistry(`${r.kind}:${r.id}`)}
                      label={r.label}
                      meta={r.detail}
                      mark={r.kind === "property" ? <RealEstateLogo size={30} /> : <AutomobileLogo name={r.detail} size={30} />}
                    />
                  ))}
                </div>
              </>
            )}

            {buy ? (
              <>
                <p className="txr-sub">یا</p>
                <div className="txr-tiles">
                  <Tile role="button" onClick={() => p.setPickerOpen(true)} label="دارایی دیگر از بازار" icon="globe" color="#8e4ec6" />
                  <a href="/asset-registry#real-estate" className="txr-tile" style={{ "--tile": "#3e63dd" } as React.CSSProperties}>
                    <RealEstateLogo size={30} />
                    <span className="txr-tile-label">ملک</span>
                  </a>
                  <a href="/asset-registry#vehicle" className="txr-tile" style={{ "--tile": "#0090ff" } as React.CSSProperties}>
                    <AutomobileLogo size={30} />
                    <span className="txr-tile-label">خودرو</span>
                  </a>
                </div>
              </>
            ) : (
              p.ownedAssets.length === 0 &&
              p.registryAssets.length === 0 && <p className="txr-empty">هنوز دارایی‌ای برای فروش ثبت نشده است.</p>
            )}
          </>
        )}
      </TxCard>

      {/* ── Quantity & price — or a property / vehicle's sale price ── */}
      {p.registryItem ? (
        <section className="txr-card">
          <AmountHero label="مبلغ فروش" unit="تومان">
            <AmountInput value={p.salePrice} onValueChange={p.setSalePrice} placeholder="۰" className="txr-amount num" unit="toman" aria-label="مبلغ فروش" />
          </AmountHero>
          <Presets
            items={lastValue ? [{ label: <>آخرین ارزش: <span className="num">{formatMoney(lastValue, "IRT")}</span></>, value: lastValue }] : []}
            current={p.salePrice}
            onPick={p.setSalePrice}
            label="مبلغ پیشنهادی"
          />
        </section>
      ) : (
        p.asset &&
        !p.pickerOpen && (
          <section className="txr-card">
            <AmountHero label={buy ? "چه مقدار خریدید؟" : "چه مقدار فروختید؟"} unit={p.assetName}>
              <AmountInput
                inputMode="decimal"
                maxDecimals={p.qtyDecimals}
                value={p.quantity}
                onValueChange={p.setQuantity}
                placeholder="۰"
                className="txr-amount num"
                showWords={false}
                unit="none"
                aria-label="مقدار"
              />
            </AmountHero>
            {held?.gt(0) && (
              <p className="txr-sub txr-center">
                موجودی: <span className="num">{formatQty(held.toString(), p.qtyDecimals)}</span>
              </p>
            )}
            <Presets items={shares} current={p.quantity} onPick={p.setQuantity} label="بخشی از موجودی" />
            {p.overHeld && (
              <p className="txr-note txr-note-warn" role="alert">
                مقدار واردشده از موجودی شما بیشتر است.
              </p>
            )}

            <div className="txr-seg txr-seg-2" role="group" aria-label="نوع قیمت">
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
              <p className="txr-sub txr-center">
                هر واحد <span className="num">{inUnit(p.marketUnitPrice, p.priceUnit)}</span>
              </p>
            ) : (
              <div className="txr-inline-field">
                <span className="txr-sub">قیمت هر واحد به {p.priceUnit === "IRT" ? "تومان" : "تتر"}</span>
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
                {!p.marketUnitPrice && <p className="txr-sub">قیمت بازار این دارایی در دسترس نیست؛ قیمت هر واحد را وارد کنید.</p>}
              </div>
            )}

            {p.quote && (
              <dl className="txr-quote" aria-live="polite">
                <div>
                  <dt>{buy ? "از حساب کم می‌شود" : "به حساب واریز می‌شود"}</dt>
                  <dd className="num txr-quote-total">{p.settleTotalLabel}</dd>
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
        <TxCard icon="wallet" title={buy ? "پرداخت با" : "واریز به"}>
          {p.settleOptions.length === 0 ? (
            <p className="txr-empty">
              {p.settleHint}{" "}
              <a href="/accounts" className="txr-link">
                افزودن حساب
              </a>
            </p>
          ) : (
            <AccountTiles
              value={p.moneyId}
              options={p.settleOptions}
              balances={p.balances}
              onChange={p.onMoneyChange}
              placeholder={buy ? "انتخاب حساب پرداخت" : "انتخاب حساب واریز"}
              sheetTitle={buy ? "پرداخت با کدام حساب؟" : "واریز به کدام حساب؟"}
            />
          )}
        </TxCard>
      )}

      {/* ── Date & fee ── */}
      <TxCard icon="calendar" title="کی؟">
        <DateChips value={p.entryDate} onChange={p.setEntryDate} today={p.today} label="تاریخ معامله" />
        <input type="hidden" name="entryDate" value={p.entryDate} />
        {!p.registryItem && (
          <FeeToggle
            fee={p.fee}
            setFee={p.setFee}
            feeInToman={p.feeInToman}
            feeSymbol={p.feeSymbol}
            foot={
              p.feeApplied && (
                <p className="txr-sub">
                  {buy ? "کل مبلغ پرداختی با کارمزد: " : "خالص دریافتی پس از کسر کارمزد: "}
                  <b className="num" style={{ color: p.feeExceedsProceeds ? "var(--negative)" : undefined }}>
                    {p.settleTotalLabel}
                  </b>
                </p>
              )
            }
          />
        )}
      </TxCard>
    </div>
  );
}
