"use client";

/**
 * بازپرداخت بدهی — the same plain cards as «ثبت هزینه»:
 *
 *   کدام بدهی یا قسط؟   the next instalment of every open debt, soonest first
 *                       (late in red, within a week in amber), then every open
 *                       debt for a free payment; a search box once the list grows
 *   مبلغ                 prefilled from the pick, with «مبلغ قسط» · «کل مانده»
 *   پرداخت از / واریز به the money accounts, as tiles with their balance
 *   تاریخ               today / yesterday / another date, fee and a note
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields (debtId, installmentId, irtAmount…) to `createTransactionAction`.
 */
import { useMemo, useState } from "react";
import { faCount, formatDaysUntil, formatMoney, getDualDate } from "@/lib/format";
import { D } from "@/domain/decimal";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import { isReceivable } from "@/features/planning/obligations";
import { balanceLabel } from "./TradeFields";
import type { AccountOption } from "./TransactionForm";

export type DebtOption = {
  id: string;
  title: string;
  creditor: string;
  principalBase: string;
  outstandingBase: string;
  /** Contractual principal in Toman — present for Phase 3+ records. */
  principalToman?: string | null;
  /** Outstanding Toman (derived) — present for Phase 3+ records. */
  outstandingToman?: string | null;
  interestRate: string;
  status: string;
  /** payable (بدهی من) or receivable (طلب من) */
  direction?: string | null;
  /** liability account of the debt — null for planning-only debts */
  accountId: string | null;
  installments: Array<{
    id: string;
    seq: number;
    dueDate: string;
    amountBase: string;
    /** Contractual installment amount in Toman — present for Phase 3+ records. */
    amountToman?: string | null;
    status: string;
  }>;
};

type Installment = DebtOption["installments"][number];

/** Lists longer than this get a search box. */
const SEARCH_FROM = 6;

const norm = (s: string) =>
  s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const toman = (value: string | null | undefined) => (value && D(value).gt(0) ? D(value).toFixed(0) : null);

type Props = {
  debts: DebtOption[];
  selectedDebt: DebtOption | null;
  selectedInst: Installment | null;
  onSelectDebt: (debt: DebtOption) => void;
  onSelectInstallment: (debt: DebtOption, inst: Installment) => void;
  onClear: () => void;
  /* amount */
  amount: string;
  setAmount: (value: string) => void;
  previewUsd: string;
  /* account */
  accounts: AccountOption[];
  balances: Record<string, string>;
  accountId: string;
  setAccountId: (id: string) => void;
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

export default function DebtRepaymentFields(p: Props) {
  const [query, setQuery] = useState("");
  const [pickingDate, setPickingDate] = useState(false);

  const open = useMemo(() => p.debts.filter((d) => d.status !== "settled"), [p.debts]);
  const due = useMemo(
    () =>
      open
        .flatMap((debt) => {
          const next = debt.installments
            .filter((i) => i.status === "pending")
            .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
          return next ? [{ debt, inst: next }] : [];
        })
        .sort((a, b) => a.inst.dueDate.localeCompare(b.inst.dueDate)),
    [open],
  );

  const q = norm(query);
  const matches = (d: DebtOption) => !q || norm(`${d.title} ${d.creditor}`).includes(q);
  const dueShown = due.filter(({ debt }) => matches(debt));
  const debtsShown = open.filter(matches);

  const debt = p.selectedDebt;
  const receivable = isReceivable(debt?.direction);
  const instAmount = toman(p.selectedInst?.amountToman);
  const outstanding = toman(debt?.outstandingToman);
  const typed = p.amount ? D(p.amount) : null;
  const yesterday = shiftIso(p.today, -1);
  const dateChoice = p.entryDate === p.today ? "today" : p.entryDate === yesterday ? "yesterday" : "other";

  return (
    <div className="expense-form">
      {/* ── What is paid ── */}
      <section className="card expense-card" aria-labelledby="repay-what-title">
        <header className="expense-head">
          <h2 id="repay-what-title">کدام بدهی یا قسط؟</h2>
          {debt && (
            <button type="button" className="expense-link" onClick={p.onClear}>
              تغییر
            </button>
          )}
        </header>

        {p.debts.length === 0 ? (
          <p className="expense-empty">
            هنوز بدهی یا قسطی ثبت نشده است.{" "}
            <a href="/debts#new" style={{ color: "var(--action)" }}>
              ثبت بدهی
            </a>
          </p>
        ) : debt ? (
          <div className="trade-asset" data-on>
            <span className="flow-icon" aria-hidden="true">
              <Icon name="debts" size={15} />
            </span>
            <span className="trade-asset-text">
              <b>{p.selectedInst ? `قسط ${faCount(p.selectedInst.seq)} — ${debt.title}` : debt.title}</b>
              <span className="expense-sub">
                {debt.creditor}
                {" · "}
                {debt.accountId
                  ? receivable
                    ? "از مانده طلب کم می‌شود"
                    : "از مانده بدهی کم می‌شود"
                  : "در «پرداخت اقساط» ثبت می‌شود، نه در هزینه‌ها"}
              </span>
            </span>
          </div>
        ) : (
          <>
            {open.length >= SEARCH_FROM && (
              <div className="expense-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  className="field"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جست‌وجو: وام مسکن، بانک…"
                  aria-label="جست‌وجوی بدهی"
                />
              </div>
            )}

            {dueShown.length > 0 && (
              <>
                <p className="expense-sub">قسط‌های پیش‌رو</p>
                <div className="expense-accounts" role="list" aria-label="قسط‌های پیش‌رو">
                  {dueShown.map(({ debt: d, inst }) => {
                    const days = daysBetween(p.today, inst.dueDate);
                    const late = days < 0;
                    const soon = !late && days <= 7;
                    const amount = toman(inst.amountToman);
                    return (
                      <button
                        key={inst.id}
                        type="button"
                        role="listitem"
                        className="expense-acct"
                        onClick={() => p.onSelectInstallment(d, inst)}
                      >
                        <span className="expense-acct-text">
                          <span className="expense-acct-name">{`قسط ${faCount(inst.seq)} — ${d.title}`}</span>
                          <span className="expense-acct-bal">
                            {amount ? <span className="num">{formatMoney(amount, "IRT")}</span> : "—"}
                            {" · "}
                            <span style={late ? { color: "var(--negative)" } : soon ? { color: "var(--warning)" } : undefined}>
                              {formatDaysUntil(days)}
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {debtsShown.length > 0 && (
              <>
                <p className="expense-sub">پرداخت آزاد</p>
                <div className="expense-accounts" role="list" aria-label="بدهی‌ها">
                  {debtsShown.map((d) => {
                    const left = toman(d.outstandingToman);
                    return (
                      <button key={d.id} type="button" role="listitem" className="expense-acct" onClick={() => p.onSelectDebt(d)}>
                        <span className="expense-acct-text">
                          <span className="expense-acct-name">{d.title}</span>
                          <span className="expense-acct-bal">
                            {left ? (
                              <>
                                مانده <span className="num">{formatMoney(left, "IRT")}</span>
                              </>
                            ) : (
                              d.creditor
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {q && dueShown.length === 0 && debtsShown.length === 0 && (
              <p className="expense-empty">موردی با «{query}» پیدا نشد.</p>
            )}
            {!q && open.length === 0 && <p className="expense-empty">همهٔ بدهی‌ها تسویه شده‌اند.</p>}
          </>
        )}
      </section>

      {debt && (
        <>
          {/* ── Amount ── */}
          <section className="card expense-card" aria-labelledby="repay-amount-title">
            <header className="expense-head">
              <h2 id="repay-amount-title">{receivable ? "مبلغ دریافت" : "مبلغ پرداخت"}</h2>
              <span className="expense-sub">تومان</span>
            </header>
            <AmountInput
              value={p.amount}
              onValueChange={p.setAmount}
              placeholder="۰"
              className="field num"
              unit="toman"
              aria-labelledby="repay-amount-title"
            />
            {p.previewUsd && (
              <p className="expense-sub">
                ≈ <span className="num">{formatMoney(p.previewUsd, "USD")}</span>
              </p>
            )}
            {(instAmount || outstanding) && (
              <div className="expense-presets" role="group" aria-label="مبلغ‌های آماده">
                {(
                  [
                    ["مبلغ قسط", instAmount],
                    ["کل مانده", outstanding],
                  ] as const
                )
                  .filter(([, value]) => value)
                  .map(([label, value]) => {
                    const on = !!typed && typed.raw === D(value!).raw;
                    return (
                      <button
                        key={label}
                        type="button"
                        className="expense-preset"
                        data-on={on || undefined}
                        aria-pressed={on}
                        onClick={() => p.setAmount(value!)}
                      >
                        {label}
                      </button>
                    );
                  })}
              </div>
            )}
          </section>

          {/* ── Account ── */}
          <section className="card expense-card" aria-labelledby="repay-account-title">
            <header className="expense-head">
              <h2 id="repay-account-title">{receivable ? "واریز به" : "پرداخت از"}</h2>
            </header>
            {p.accounts.length === 0 ? (
              <p className="expense-empty">
                هنوز حساب نقد یا بانکی ندارید.{" "}
                <a href="/accounts" style={{ color: "var(--action)" }}>
                  افزودن حساب
                </a>
              </p>
            ) : (
              <div className="expense-accounts" role="radiogroup" aria-label={receivable ? "حساب واریز" : "حساب پرداخت"}>
                {p.accounts.map((a) => {
                  const on = a.id === p.accountId;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => p.setAccountId(a.id)}
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
        </>
      )}

      {/* ── Date, fee & note ── */}
      <section className="card expense-card expense-details">
        <div className="expense-row">
          <span className="expense-row-label">تاریخ</span>
          <div className="expense-seg" role="group" aria-label="تاریخ پرداخت">
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
            <DualDateInput name="entryDate" value={p.entryDate} onChange={p.setEntryDate} label="تاریخ پرداخت" required showGregorian={false} />
          ) : (
            <input type="hidden" name="entryDate" value={p.entryDate} />
          )}
        </div>

        <div className="expense-row">
          <label htmlFor="repay-fee" className="expense-row-label">
            کارمزد (اختیاری)
          </label>
          <AmountInput
            id="repay-fee"
            inputMode={p.feeInToman ? "numeric" : "decimal"}
            value={p.fee}
            onValueChange={p.setFee}
            className="field num"
            unit={p.feeInToman ? "toman" : p.feeSymbol}
            placeholder="۰"
          />
        </div>

        <div className="expense-row">
          <label htmlFor="repay-note" className="expense-row-label">
            یادداشت
          </label>
          <input
            id="repay-note"
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
