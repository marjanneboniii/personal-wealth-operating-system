"use client";

/**
 * انتقال — the same plain cards as «ثبت هزینه»:
 *
 *   از حساب     every account, in the shared AccountPicker (grouped by what it
 *               holds, with its mark and balance)
 *   به حساب     only the accounts this money may go to:
 *                 تومان      → a bank account, exchange Toman or brokerage Toman
 *                 a coin     → the same coin at an exchange or a wallet, on a
 *                              network that place supports
 *   مبلغ        Toman, or the coin's quantity (۲۵٪ · ۵۰٪ · همه)
 *   تاریخ      today / yesterday / another date, fee and a note
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields to `createTransactionAction` as before.
 */
import { useState, useTransition } from "react";
import { currencyLabel, formatMoney, formatQty, getDualDate } from "@/lib/format";
import { D } from "@/domain/decimal";
import type { KnownWallet } from "@/features/setup/holdingWallets";
import AccountPicker from "@/components/ui/AccountPicker";
import AmountInput from "@/components/ui/AmountInput";
import AssetLogo from "@/components/ui/AssetLogo";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import type { AccountOption } from "./TransactionForm";

const SHARES: Array<[string, string]> = [
  ["۲۵٪", "0.25"],
  ["۵۰٪", "0.5"],
  ["همه", "1"],
];

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

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
  description: string;
  setDescription: (value: string) => void;
  autoDescription: string;
};

export default function TransferFields(p: Props) {
  const [pickingDate, setPickingDate] = useState(false);
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
  const yesterday = shiftIso(p.today, -1);
  const dateChoice = p.entryDate === p.today ? "today" : p.entryDate === yesterday ? "yesterday" : "other";
  // The unit in Persian: «تتر», or the asset's own name («آمازون ایکس»).
  const symbolLabel = from ? currencyLabel(from.symbol) : "";
  const unit = from && symbolLabel === (from.symbol ?? "") ? from.name.split(" - ")[0] : symbolLabel;

  return (
    <div className="expense-form">
      {/* ── From ── */}
      <section className="card expense-card" aria-labelledby="transfer-from-title">
        <header className="expense-head">
          <h2 id="transfer-from-title">از حساب</h2>
        </header>
        {p.sources.length === 0 ? (
          <p className="expense-empty">
            هنوز حسابی ندارید.{" "}
            <a href="/accounts" style={{ color: "var(--action)" }}>
              افزودن حساب
            </a>
          </p>
        ) : (
          <AccountPicker value={p.fromId} options={p.sources} balances={p.balances} onChange={p.setFromId} placeholder="انتخاب حساب مبدأ" sheetTitle="انتقال از کدام حساب؟" />
        )}
      </section>

      {from && (
        <>
          {/* ── To ── */}
          <section className="card expense-card" aria-labelledby="transfer-to-title">
            <header className="expense-head">
              <h2 id="transfer-to-title">به حساب</h2>
              {p.newPlaces.length > 0 ? (
                <button
                  type="button"
                  className="expense-link"
                  aria-expanded={addingTo}
                  onClick={() => {
                    setAddingTo((v) => !v);
                    setAddError("");
                  }}
                >
                  {addingTo ? "بستن" : "+ افزودن"}
                </button>
              ) : (
                <span className="expense-sub">{p.isToman ? "حساب بانکی، صرافی یا کارگزاری" : `${unit} در صرافی یا کیف پول`}</span>
              )}
            </header>
            {p.targets.length === 0 && !addingTo && (
              <p className="expense-empty">
                {p.targetHint}{" "}
                {p.newPlaces.length > 0 ? (
                  <button type="button" className="expense-link" onClick={() => setAddingTo(true)}>
                    + افزودن {p.isToman ? "حساب تومانی" : `«${unit}» در صرافی یا کیف پول`}
                  </button>
                ) : (
                  <a href="/accounts" style={{ color: "var(--action)" }}>
                    افزودن حساب
                  </a>
                )}
              </p>
            )}
            {p.targets.length > 0 && (
              <AccountPicker value={p.toId} options={p.targets} balances={p.balances} onChange={p.setToId} placeholder="انتخاب حساب مقصد" sheetTitle="انتقال به کدام حساب؟" />
            )}
            {addingTo && (
              <>
                <p className="expense-sub">
                  {p.isToman ? "تومان در کدام صرافی یا کارگزاری؟" : `«${unit}» در کدام صرافی یا کیف پول؟`} حساب با موجودی صفر ساخته و انتخاب می‌شود.
                </p>
                <div className="expense-squares" role="group" aria-label="افزودن حساب مقصد" aria-busy={adding}>
                  {p.newPlaces.map((w) => (
                    <button key={w.name} type="button" className="expense-square" disabled={adding} onClick={() => addDestination(w.name)}>
                      {w.logo && <AssetLogo userLogoUrl={w.logo} name={w.name} size={24} />}
                      <span className="expense-square-label">{w.name}</span>
                    </button>
                  ))}
                </div>
                {addError && (
                  <p className="expense-note expense-note-warn" role="alert">
                    {addError}
                  </p>
                )}
              </>
            )}
          </section>

          {/* ── Amount ── */}
          <section className="card expense-card" aria-labelledby="transfer-amount-title">
            <header className="expense-head">
              <h2 id="transfer-amount-title">{p.isToman ? "مبلغ" : "مقدار"}</h2>
              {held && (
                <span className="expense-sub">
                  موجودی: <span className="num">{p.isToman ? formatMoney(held.toFixed(0), "IRT") : `${formatQty(held.toString(), p.qtyDecimals)} ${unit}`}</span>
                </span>
              )}
            </header>

            {p.isToman ? (
              <>
                <AmountInput
                  value={p.amount}
                  onValueChange={p.setAmount}
                  placeholder="۰"
                  className="field num"
                  unit="toman"
                  aria-labelledby="transfer-amount-title"
                />
                {p.previewUsd && (
                  <p className="expense-sub">
                    ≈ <span className="num">{formatMoney(p.previewUsd, "USD")}</span>
                  </p>
                )}
              </>
            ) : (
              <>
                <AmountInput
                  inputMode="decimal"
                  maxDecimals={p.qtyDecimals}
                  value={p.quantity}
                  onValueChange={p.setQuantity}
                  placeholder="۰"
                  className="field num"
                  showWords={false}
                  unit="none"
                  aria-labelledby="transfer-amount-title"
                />
                {p.quantityToman && (
                  <p className="expense-sub">
                    ≈ <span className="num">{formatMoney(D(p.quantityToman).toFixed(0), "IRT")}</span>
                  </p>
                )}
                {!p.quantityToman && !!typed?.gt(0) && (
                  <div className="expense-row">
                    <label htmlFor="transfer-value" className="expense-row-label">
                      ارزش تقریبی (تومان)
                    </label>
                    <AmountInput id="transfer-value" value={p.amount} onValueChange={p.setAmount} placeholder="۰" className="field num" unit="toman" />
                  </div>
                )}
              </>
            )}

            {held?.gt(0) && (
              <div className="expense-presets" role="group" aria-label="بخشی از موجودی">
                {SHARES.map(([label, share]) => {
                  const value = p.isToman ? held.mul(share).toFixed(0) : cutDecimals(held.mul(share).toString(), p.qtyDecimals);
                  const on = !!typed && typed.raw === D(value).raw;
                  return (
                    <button
                      key={share}
                      type="button"
                      className="expense-preset"
                      data-on={on || undefined}
                      aria-pressed={on}
                      onClick={() => (p.isToman ? p.setAmount(value) : p.setQuantity(value))}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {overBalance && (
              <p className="expense-note expense-note-warn" role="status">
                مبلغ از موجودی ثبت‌شدهٔ این حساب بیشتر است.
              </p>
            )}
          </section>
        </>
      )}

      {/* ── Date, fee & note ── */}
      <section className="card expense-card expense-details">
        <div className="expense-row">
          <span className="expense-row-label">تاریخ</span>
          <div className="expense-seg" role="group" aria-label="تاریخ انتقال">
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
            <DualDateInput name="entryDate" value={p.entryDate} onChange={p.setEntryDate} label="تاریخ انتقال" required showGregorian={false} />
          ) : (
            <input type="hidden" name="entryDate" value={p.entryDate} />
          )}
        </div>

        <div className="expense-row">
          <label htmlFor="transfer-fee" className="expense-row-label">
            {p.feeInToman ? "کارمزد (تومان، اختیاری)" : `کارمزد (${currencyLabel(p.feeSymbol)}، اختیاری)`}
          </label>
          <AmountInput
            id="transfer-fee"
            inputMode={p.feeInToman ? "numeric" : "decimal"}
            value={p.fee}
            onValueChange={p.setFee}
            className="field num"
            unit={p.feeInToman ? "toman" : p.feeSymbol}
            placeholder="۰"
          />
        </div>

        <div className="expense-row">
          <label htmlFor="transfer-note" className="expense-row-label">
            یادداشت
          </label>
          <input
            id="transfer-note"
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
