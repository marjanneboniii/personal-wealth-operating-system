"use client";

/**
 * بازپرداخت بدهی — tap the instalment, check the amount, tap the account:
 *
 *   کدام بدهی یا قسط؟   the next instalment of every open debt, soonest first
 *                       (late in red, within a week in amber), then every open
 *                       debt for a free payment — all as tap-to-pick cards
 *   مبلغ                 prefilled from the pick, with «مبلغ قسط» · «کل مانده»
 *   پرداخت از / واریز به the Toman bank accounts, as logo tiles with balance
 *   کی؟                 امروز · دیروز · پریروز · تقویم, and an optional fee
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields (debtId, installmentId, irtAmount…) to `createTransactionAction`.
 */
import { useMemo } from "react";
import { faCount, formatDaysUntil, formatMoney } from "@/lib/format";
import { D } from "@/domain/decimal";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import { isReceivable } from "@/features/planning/obligations";
import { AccountTiles, AmountHero, DateChips, FeeToggle, Presets, TxCard } from "./txKit";
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
};

export default function DebtRepaymentFields(p: Props) {
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

  const debt = p.selectedDebt;
  const receivable = isReceivable(debt?.direction);
  const instAmount = toman(p.selectedInst?.amountToman);
  const outstanding = toman(debt?.outstandingToman);
  const presets = [
    instAmount ? { label: "مبلغ قسط", value: instAmount, key: "inst" } : null,
    outstanding ? { label: "کل مانده", value: outstanding, key: "all" } : null,
  ].filter((x): x is { label: string; value: string; key: string } => !!x);

  return (
    <div className="txr-stack">
      {/* ── What is paid ── */}
      <TxCard
        icon="debts"
        title="کدام بدهی یا قسط؟"
        aside={
          debt && (
            <button type="button" className="txr-link" onClick={p.onClear}>
              تغییر
            </button>
          )
        }
      >
        {p.debts.length === 0 ? (
          <p className="txr-empty">
            هنوز بدهی یا قسطی ثبت نشده است.{" "}
            <a href="/debts#new" className="txr-link">
              ثبت بدهی یا طلب
            </a>
          </p>
        ) : debt ? (
          <div className="txr-picked">
            <span className="txr-tile-icon" aria-hidden="true">
              <Icon name="debts" size={18} />
            </span>
            <span className="txr-picked-text">
              <b>{p.selectedInst ? `قسط ${faCount(p.selectedInst.seq)} — ${debt.title}` : debt.title}</b>
              <span className="txr-sub">
                {debt.creditor}
                {" · "}
                {debt.accountId
                  ? receivable
                    ? "از مانده طلب کم می‌شود"
                    : "از مانده بدهی کم می‌شود"
                  : "در «پرداخت اقساط» ثبت می‌شود، نه در هزینه‌ها"}
              </span>
            </span>
            <span className="txr-tick txr-tick-static" aria-hidden="true">
              <Icon name="check" size={10} strokeWidth={3} />
            </span>
          </div>
        ) : (
          <>
            {due.length > 0 && (
              <>
                <p className="txr-sub">قسط‌های پیش‌رو</p>
                <div className="txr-debts" role="list" aria-label="قسط‌های پیش‌رو">
                  {due.map(({ debt: d, inst }) => {
                    const days = daysBetween(p.today, inst.dueDate);
                    const tone = days < 0 ? "late" : days <= 7 ? "soon" : undefined;
                    const amount = toman(inst.amountToman);
                    return (
                      <button key={inst.id} type="button" role="listitem" className="txr-debt" data-tone={tone} onClick={() => p.onSelectInstallment(d, inst)}>
                        <span className="txr-debt-seq num" aria-hidden="true">
                          {faCount(inst.seq)}
                        </span>
                        <span className="txr-acct-text">
                          <span className="txr-acct-name">{d.title}</span>
                          <span className="txr-acct-sub">
                            <span className="txr-debt-due">{formatDaysUntil(days)}</span>
                            {d.creditor ? ` · ${d.creditor}` : ""}
                          </span>
                        </span>
                        <b className="num txr-debt-amt">{amount ? formatMoney(amount, "IRT") : "—"}</b>
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {open.length > 0 && (
              <>
                <p className="txr-sub">پرداخت آزاد</p>
                <div className="txr-debts" role="list" aria-label="بدهی‌ها">
                  {open.map((d) => {
                    const left = toman(d.outstandingToman);
                    return (
                      <button key={d.id} type="button" role="listitem" className="txr-debt" onClick={() => p.onSelectDebt(d)}>
                        <span className="txr-debt-seq" aria-hidden="true">
                          <Icon name={isReceivable(d.direction) ? "download" : "debts"} size={15} />
                        </span>
                        <span className="txr-acct-text">
                          <span className="txr-acct-name">{d.title}</span>
                          <span className="txr-acct-sub">{d.creditor || " "}</span>
                        </span>
                        {left && (
                          <span className="txr-debt-amt">
                            <span className="txr-sub">مانده </span>
                            <b className="num">{formatMoney(left, "IRT")}</b>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            {open.length === 0 && <p className="txr-empty">همهٔ بدهی‌ها تسویه شده‌اند.</p>}
          </>
        )}
      </TxCard>

      {debt && (
        <>
          {/* ── Amount ── */}
          <section className="txr-card">
            <AmountHero
              label={receivable ? "مبلغ دریافت" : "مبلغ پرداخت"}
              unit="تومان"
              foot={p.previewUsd ? <p className="txr-sub">≈ <span className="num">{formatMoney(p.previewUsd, "USD")}</span></p> : null}
            >
              <AmountInput value={p.amount} onValueChange={p.setAmount} placeholder="۰" className="txr-amount num" unit="toman" aria-label={receivable ? "مبلغ دریافت" : "مبلغ پرداخت"} />
            </AmountHero>
            <Presets items={presets} current={p.amount} onPick={p.setAmount} label="مبلغ‌های آماده" />
          </section>

          {/* ── Account ── */}
          <TxCard icon="wallet" title={receivable ? "واریز به" : "پرداخت از"}>
            {p.accounts.length === 0 ? (
              <p className="txr-empty">
                هنوز حساب بانکی ندارید.{" "}
                <a href="/accounts" className="txr-link">
                  افزودن حساب
                </a>
              </p>
            ) : (
              <AccountTiles
                value={p.accountId}
                options={p.accounts}
                balances={p.balances}
                onChange={p.setAccountId}
                placeholder={receivable ? "انتخاب حساب واریز" : "انتخاب حساب پرداخت"}
                sheetTitle={receivable ? "واریز به کدام حساب؟" : "پرداخت از کدام حساب؟"}
              />
            )}
          </TxCard>
        </>
      )}

      {/* ── Date & fee ── */}
      <TxCard icon="calendar" title="کی؟">
        <DateChips value={p.entryDate} onChange={p.setEntryDate} today={p.today} label="تاریخ پرداخت" />
        <input type="hidden" name="entryDate" value={p.entryDate} />
        <FeeToggle fee={p.fee} setFee={p.setFee} feeInToman={p.feeInToman} feeSymbol={p.feeSymbol} />
      </TxCard>
    </div>
  );
}
