"use client";

/**
 * انتقال — tap the source, tap the destination, type the amount:
 *
 *   از حساب     every account, as logo tiles (bank, exchange, coin) with balance
 *   به حساب     only the accounts this money may go to:
 *                 تومان      → a bank account, exchange Toman or brokerage Toman
 *                 a coin     → the same coin at an exchange or a wallet, on a
 *                              network that place supports
 *               …plus «+ جای جدید»: catalogue places, created with one tap
 *   مبلغ        Toman, or the coin's quantity (۲۵٪ · ۵۰٪ · همه)
 *   کی؟         امروز · دیروز · پریروز · تقویم, and an optional fee
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields to `createTransactionAction` as before.
 */
import { useState, useTransition } from "react";
import { currencyLabel, formatMoney, formatQty } from "@/lib/format";
import { D } from "@/domain/decimal";
import type { KnownWallet } from "@/features/setup/holdingWallets";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import Icon from "@/components/ui/Icon";
import { AccountTiles, AmountHero, DateChips, FeeToggle, Presets, Tile, TxCard } from "./txKit";
import type { AccountOption } from "./TransactionForm";

const SHARES: Array<[string, string]> = [
  ["۲۵٪", "0.25"],
  ["۵۰٪", "0.5"],
  ["همه", "1"],
];

function cutDecimals(value: string, decimals: number): string {
  const [int, frac = ""] = value.split(".");
  const cut = frac.slice(0, decimals).replace(/0+$/, "");
  return cut ? `${int}.${cut}` : int;
}

type Props = {
  sources: AccountOption[];
  targets: AccountOption[];
  balances: Record<string, string>;
  fromId: string;
  setFromId: (id: string) => void;
  toId: string;
  setToId: (id: string) => void;
  /** Why the destination list is what it is — shown when it is empty. */
  targetHint: string;
  /** Exchanges and wallets that may receive this money and hold no account for it yet. */
  newPlaces: KnownWallet[];
  /** Creates the source's asset at that place (zero balance) and selects it; returns an error or `null`. */
  onAddDestination: (placeName: string) => Promise<string | null>;
  /* amount */
  isToman: boolean;
  amount: string;
  setAmount: (value: string) => void;
  previewUsd: string;
  quantity: string;
  setQuantity: (value: string) => void;
  qtyDecimals: number;
  heldQty: string | null;
  /** Toman value of the typed quantity, when the coin has a market price. */
  quantityToman: string;
  /* details */
  fee: string;
  setFee: (value: string) => void;
  feeInToman: boolean;
  feeSymbol: string;
  entryDate: string;
  setEntryDate: (iso: string) => void;
  today: string;
};

export default function TransferFields(p: Props) {
  const [addingTo, setAddingTo] = useState(false);
  const [addError, setAddError] = useState("");
  const [adding, startAdding] = useTransition();
  const from = p.sources.find((a) => a.id === p.fromId) ?? null;
  const addDestination = (placeName: string) =>
    startAdding(async () => {
      const error = await p.onAddDestination(placeName);
      setAddError(error ?? "");
      if (!error) setAddingTo(false);
    });
  const held = p.heldQty ? D(p.heldQty) : null;
  const typed = p.isToman ? (p.amount ? D(p.amount) : null) : p.quantity ? D(p.quantity) : null;
  const overBalance = !!typed && !!held && typed.gt(0) && typed.gt(held);
  // The unit in Persian: «تتر», or the asset's own name («آمازون ایکس»).
  const symbolLabel = from ? currencyLabel(from.symbol) : "";
  const unit = from && symbolLabel === (from.symbol ?? "") ? from.name.split(" - ")[0] : symbolLabel;
  const shares = held?.gt(0)
    ? SHARES.map(([label, share]) => ({
        label,
        value: p.isToman ? held.mul(share).toFixed(0) : cutDecimals(held.mul(share).toString(), p.qtyDecimals),
      }))
    : [];

  return (
    <div className="txr-stack">
      {/* ── From ── */}
      <TxCard icon="upload" title="از حساب">
        {p.sources.length === 0 ? (
          <p className="txr-empty">
            هنوز حسابی ندارید.{" "}
            <a href="/accounts" className="txr-link">
              افزودن حساب
            </a>
          </p>
        ) : (
          <AccountTiles value={p.fromId} options={p.sources} balances={p.balances} onChange={p.setFromId} placeholder="انتخاب حساب مبدأ" sheetTitle="انتقال از کدام حساب؟" />
        )}
      </TxCard>

      {from && (
        <>
          <div className="txr-flow" aria-hidden="true">
            <Icon name="arrow-down" size={16} />
          </div>

          {/* ── To ── */}
          <TxCard
            icon="download"
            title="به حساب"
            aside={
              p.newPlaces.length > 0 ? (
                <button
                  type="button"
                  className="txr-link"
                  aria-expanded={addingTo}
                  onClick={() => {
                    setAddingTo((v) => !v);
                    setAddError("");
                  }}
                >
                  {addingTo ? "بستن" : "+ جای جدید"}
                </button>
              ) : (
                p.isToman ? "بانک، صرافی یا کارگزاری" : `${unit} در صرافی یا کیف پول`
              )
            }
          >
            {p.targets.length === 0 && !addingTo && <p className="txr-empty">{p.targetHint}</p>}
            {p.targets.length > 0 && !addingTo && (
              <AccountTiles value={p.toId} options={p.targets} balances={p.balances} onChange={p.setToId} placeholder="انتخاب حساب مقصد" sheetTitle="انتقال به کدام حساب؟" />
            )}
            {(addingTo || (p.targets.length === 0 && p.newPlaces.length > 0)) && (
              <>
                <p className="txr-sub">
                  {p.isToman ? "تومان در کدام صرافی یا کارگزاری؟" : `«${unit}» در کدام صرافی یا کیف پول؟`} با یک لمس ساخته و انتخاب می‌شود.
                </p>
                <div className="txr-tiles" role="group" aria-label="افزودن حساب مقصد" aria-busy={adding}>
                  {p.newPlaces.map((w) => (
                    <Tile
                      key={w.name}
                      role="button"
                      onClick={() => !adding && addDestination(w.name)}
                      label={w.name}
                      mark={w.logo ? <AssetLogo userLogoUrl={w.logo} name={w.name} size={30} /> : undefined}
                      icon="plus"
                    />
                  ))}
                </div>
                {addError && (
                  <p className="txr-note txr-note-warn" role="alert">
                    {addError}
                  </p>
                )}
              </>
            )}
          </TxCard>

          {/* ── Amount ── */}
          <section className="txr-card">
            {p.isToman ? (
              <AmountHero
                label="مبلغ انتقال"
                unit="تومان"
                foot={p.previewUsd ? <p className="txr-sub">≈ <span className="num">{formatMoney(p.previewUsd, "USD")}</span></p> : null}
              >
                <AmountInput value={p.amount} onValueChange={p.setAmount} placeholder="۰" className="txr-amount num" unit="toman" aria-label="مبلغ انتقال" />
              </AmountHero>
            ) : (
              <AmountHero
                label="مقدار انتقال"
                unit={unit}
                foot={p.quantityToman ? <p className="txr-sub">≈ <span className="num">{formatMoney(D(p.quantityToman).toFixed(0), "IRT")}</span></p> : null}
              >
                <AmountInput
                  inputMode="decimal"
                  maxDecimals={p.qtyDecimals}
                  value={p.quantity}
                  onValueChange={p.setQuantity}
                  placeholder="۰"
                  className="txr-amount num"
                  showWords={false}
                  unit="none"
                  aria-label="مقدار انتقال"
                />
              </AmountHero>
            )}
            {!p.isToman && !p.quantityToman && !!typed?.gt(0) && (
              <div className="txr-inline-field">
                <span className="txr-sub">ارزش تقریبی (تومان)</span>
                <AmountInput value={p.amount} onValueChange={p.setAmount} placeholder="۰" className="field num" unit="toman" aria-label="ارزش تقریبی به تومان" />
              </div>
            )}
            {held && (
              <p className="txr-sub txr-center">
                موجودی: <span className="num">{p.isToman ? formatMoney(held.toFixed(0), "IRT") : `${formatQty(held.toString(), p.qtyDecimals)} ${unit}`}</span>
              </p>
            )}
            <Presets
              items={shares}
              current={p.isToman ? p.amount : p.quantity}
              onPick={(v) => (p.isToman ? p.setAmount(v) : p.setQuantity(v))}
              label="بخشی از موجودی"
            />
            {overBalance && (
              <p className="txr-note txr-note-warn" role="status">
                مبلغ از موجودی ثبت‌شدهٔ این حساب بیشتر است.
              </p>
            )}
          </section>
        </>
      )}

      {/* ── Date & fee ── */}
      <TxCard icon="calendar" title="کی؟">
        <DateChips value={p.entryDate} onChange={p.setEntryDate} today={p.today} label="تاریخ انتقال" />
        <input type="hidden" name="entryDate" value={p.entryDate} />
        <FeeToggle fee={p.fee} setFee={p.setFee} feeInToman={p.feeInToman} feeSymbol={p.feeSymbol} />
      </TxCard>
    </div>
  );
}
