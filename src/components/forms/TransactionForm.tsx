"use client";

import { useActionState, useEffect, useMemo, useState, useRef } from "react";
import { createTransactionAction, type ActionResult } from "@/app/actions";
import { formatMoney, getDualDate } from "@/lib/format";
import { SmartAmountPreview, DualDatePreview, PreviewCard, useLatestRate } from "@/components/ui/SmartPreview";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import DebtInstallmentExplorer, { type DebtOption } from "./DebtInstallmentExplorer";
import { D } from "@/domain/decimal";

export type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  symbol: string | null;
  decimals: number;
};

const TYPES = [
  { key: "expense", label: "هزینه", primary: "پرداخت از حساب", counter: "دسته هزینه" },
  { key: "income", label: "درآمد", primary: "واریز به حساب", counter: "دسته درآمد" },
  { key: "transfer", label: "انتقال", primary: "از حساب", counter: "به حساب" },
  { key: "buy", label: "خرید دارایی", primary: "حساب دارایی خریداری‌شده", counter: "پرداخت از حساب" },
  { key: "sell", label: "فروش دارایی", primary: "حساب دارایی فروخته‌شده", counter: "واریز به حساب" },
] as const;

type TxType = (typeof TYPES)[number]["key"];

type Props = {
  accounts: AccountOption[];
  debts?: DebtOption[];
  defaultType?: TxType;
  today: string;
  initialRate?: string | null;
  initialRateDate?: string;
  initialRateSource?: string;
  initialIrtAmount?: string;
  initialTitle?: string;
  initialDescription?: string;
  initialEntryDate?: string;
  initialDebtId?: string;
  initialInstallmentId?: string;
};

export default function TransactionForm({
  accounts,
  debts = [],
  defaultType = "expense",
  today,
  initialRate,
  initialRateDate,
  initialRateSource,
  initialIrtAmount,
  initialTitle,
  initialDescription,
  initialEntryDate,
  initialDebtId,
  initialInstallmentId,
}: Props) {
  const [type, setType] = useState<TxType>(defaultType);
  const [irtAmount, setIrtAmount] = useState(initialIrtAmount ?? "");
  const [quantity, setQuantity] = useState("");
  const [primaryAccountId, setPrimaryAccountId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState("");
  const [entryDate, setEntryDate] = useState(initialEntryDate ?? today);
  const [description, setDescription] = useState(initialDescription ?? initialTitle ?? "");
  const [fee, setFee] = useState("");
  const [selectedDebt, setSelectedDebt] = useState<DebtOption | null>(null);
  const [selectedInst, setSelectedInst] = useState<DebtOption["installments"][number] | null>(null);
  const [showExplorer, setShowExplorer] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const { rate, date: rateDate, source: rateSource } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveRateDate = initialRateDate ?? rateDate;
  const effectiveRateSource = initialRateSource ?? rateSource;

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(createTransactionAction, null);

  const meta = TYPES.find((t) => t.key === type)!;
  const cash = accounts.filter((a) => a.type === "asset");
  const primaryOptions = useMemo(() => {
    if (type === "buy" || type === "sell") return cash.filter((a) => !["IRT", "USD"].includes(a.symbol ?? ""));
    return cash;
  }, [type, cash]);
  const counterOptions = useMemo(() => {
    if (type === "expense") return accounts.filter((a) => a.type === "expense");
    if (type === "income") return accounts.filter((a) => a.type === "income");
    return cash;
  }, [type, accounts, cash]);

  const needsQty = type === "buy" || type === "sell" || type === "transfer";

  const handleSelectDebt = (d: DebtOption) => {
    setSelectedDebt(d);
    setSelectedInst(null);
    const pendingInst = d.installments.find((i) => i.status === "pending");
    const amt = pendingInst ? pendingInst.amountBase : d.outstandingBase;
    const irt = effectiveRate ? D(amt).mul(effectiveRate).toFixed(0) : amt;
    setIrtAmount(irt);
    setDescription(`پرداخت بدهی — ${d.title} (${d.creditor})`);
    setEntryDate(today);
    setType("expense");
    setShowExplorer(false);
    const expAcc = accounts.find((a) => a.type === "expense");
    if (expAcc) setCounterAccountId(expAcc.id);
    const cashAcc = accounts.find((a) => a.type === "asset");
    if (cashAcc) setPrimaryAccountId(cashAcc.id);
  };

  const handleSelectInstallment = (d: DebtOption, inst: DebtOption["installments"][number]) => {
    setSelectedDebt(d);
    setSelectedInst(inst);
    const irt = effectiveRate ? D(inst.amountBase).mul(effectiveRate).toFixed(0) : inst.amountBase;
    setIrtAmount(irt);
    setDescription(`پرداخت قسط ${inst.seq} — ${d.title}`);
    setEntryDate(inst.dueDate);
    setType("expense");
    setShowExplorer(false);
    const expAcc = accounts.find((a) => a.type === "expense");
    if (expAcc) setCounterAccountId(expAcc.id);
    const cashAcc = accounts.find((a) => a.type === "asset");
    if (cashAcc) setPrimaryAccountId(cashAcc.id);
  };

  // Auto-populate from initialDebt/Installment ids — useEffect to avoid setState during render (mobile hydration fix)
  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current) return;
    if (!debts.length) return;
    if (initialInstallmentId) {
      for (const d of debts) {
        const inst = d.installments.find((i) => i.id === initialInstallmentId);
        if (inst) {
          autoPopulatedRef.current = true;
          window.setTimeout(() => handleSelectInstallment(d, inst), 0);
          return;
        }
      }
    }
    if (initialDebtId) {
      const d = debts.find((x) => x.id === initialDebtId);
      if (d) {
        autoPopulatedRef.current = true;
        window.setTimeout(() => handleSelectDebt(d), 0);
      }
    }
    if (initialDebtId || initialInstallmentId) autoPopulatedRef.current = true;
    // The handlers are stable for this one-time auto-population path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debts, initialDebtId, initialInstallmentId]);

  const previewUsd = irtAmount && effectiveRate ? D(irtAmount).div(effectiveRate).toFixed(2) : "";
  const canPreview = irtAmount && D(irtAmount).gt(0) && description && entryDate && primaryAccountId && counterAccountId;

  const debtStatusAfter = useMemo(() => {
    if (!selectedDebt) return null;
    if (selectedInst) {
      const remaining = selectedDebt.installments.filter((i) => i.status === "pending").length - 1;
      if (remaining <= 0) return "پرداخت کامل — بدهی تسویه می‌شود";
      return `پرداخت بخشی — ${remaining} قسط باقی می‌ماند`;
    }
    return D(selectedDebt.outstandingBase).lte(previewUsd || "0") ? "پرداخت کامل" : "پرداخت بخشی از مانده";
  }, [selectedDebt, selectedInst, previewUsd]);

  return (
    <form action={formAction} className="space-y-4" style={{ touchAction: "manipulation" }}>
      {/* Type selector */}
      <div className="seg max-w-full overflow-x-auto" role="group" aria-label="نوع تراکنش" style={{ touchAction: "pan-x" }}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className={`!px-4 !min-h-9 ${type === t.key ? "seg-on" : ""}`}
            aria-pressed={type === t.key}
            style={{ touchAction: "manipulation" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input type="hidden" name="type" value={type} />
      {/* hidden FX + debt linkage */}
      <input type="hidden" name="irtAmount" value={irtAmount} />
      <input type="hidden" name="fxRate" value={effectiveRate ?? ""} />
      <input type="hidden" name="fxRateDate" value={effectiveRateDate ?? ""} />
      <input type="hidden" name="debtId" value={selectedDebt?.id ?? ""} />
      <input type="hidden" name="installmentId" value={selectedInst?.id ?? ""} />
      {/* Explorer toggle for expense */}
      {type === "expense" && debts.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowExplorer((v) => !v)} className="btn btn-ghost w-full !justify-between" style={{ touchAction: "manipulation" }}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="search" size={15} />
              انتخاب بدهی / قسط (Explorer)
            </span>
            <span className="chip">{showExplorer ? "بستن" : "نمایش"} · {debts.length} بدهی</span>
          </button>
          {showExplorer && (
            <div className="mt-3">
              <DebtInstallmentExplorer
                debts={debts}
                onSelectDebt={handleSelectDebt}
                onSelectInstallment={handleSelectInstallment}
                rate={effectiveRate}
              />
            </div>
          )}
          {(selectedDebt || selectedInst) && (
            <div className="soft mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] p-3 text-xs">
              <span>انتخاب شده: <strong>{selectedDebt?.title}</strong>{selectedInst ? ` — قسط ${selectedInst.seq}` : ""}</span>
              <button type="button" onClick={() => { setSelectedDebt(null); setSelectedInst(null); }} className="chip" style={{ touchAction: "manipulation" }}>حذف انتخاب</button>
            </div>
          )}
        </div>
      )}

      <div className="card space-y-3 p-4">
        <div>
          <label className="label">مبلغ به تومان (IRT) — مرجع برنامه‌ریزی</label>
          <input
            name="irtAmountInput"
            inputMode="numeric"
            required
            value={irtAmount}
            onChange={(e) => setIrtAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="مثال: 25000000"
            className="field num !text-2xl !font-bold"
            dir="ltr"
            style={{ touchAction: "manipulation" }}
          />
          <div className="mt-2">
            <SmartAmountPreview irtAmount={irtAmount} rate={effectiveRate ?? null} rateDate={effectiveRateDate} rateSource={effectiveRateSource} />
          </div>
          {/* hidden USD amount for server fallback (computed) */}
          <input type="hidden" name="amount" value={previewUsd} />
        </div>

        {needsQty && (
          <div>
            <label className="label">
              مقدار دارایی {type === "transfer" ? "(اختیاری — اگر خالی باشد از مبلغ محاسبه می‌شود)" : ""}
            </label>
            <input
              name="quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="field num"
              dir="ltr"
              placeholder="0.00000000"
              style={{ touchAction: "manipulation" }}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{meta.primary}</label>
            <select name="primaryAccountId" required className="field" value={primaryAccountId} onChange={(e) => setPrimaryAccountId(e.target.value)} style={{ touchAction: "manipulation" }}>
              <option value="" disabled>انتخاب کنید…</option>
              {primaryOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name} {a.symbol ? `(${a.symbol})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{meta.counter}</label>
            <select name="counterAccountId" required className="field" value={counterAccountId} onChange={(e) => setCounterAccountId(e.target.value)} style={{ touchAction: "manipulation" }}>
              <option value="" disabled>انتخاب کنید…</option>
              {counterOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name} {a.symbol ? `(${a.symbol})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Dual Date Engine — shared single source of truth */}
        <DualDateInput name="entryDate" value={entryDate} onChange={setEntryDate} label="تاریخ سند" required />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">کارمزد (اختیاری) — به تومان</label>
            <input
              name="fee"
              value={fee}
              onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="field num"
              dir="ltr"
              placeholder="0"
              style={{ touchAction: "manipulation" }}
            />
            {fee && effectiveRate && <p className="muted mt-1 text-[10px]">کارمزد دلاری ≈ {D(fee).div(effectiveRate).toFixed(2)} $</p>}
          </div>
          <div className="flex items-end">
            <div className="muted text-[11px] leading-5">
              کارمزد نیز با همین نرخ تبدیل و در همان سند ثبت می‌شود.
            </div>
          </div>
        </div>

        <div>
          <label className="label">شرح</label>
          <input
            name="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
            placeholder="مثلاً پرداخت قسط ۳ — وام مسکن"
            style={{ touchAction: "manipulation" }}
          />
        </div>
      </div>

      {/* Accounting rule preview — still present */}
      <div className="card soft p-3 text-[11px] leading-6">
        <strong>پیش‌نمایش قاعده حسابداری:</strong>{" "}
        {type === "buy" && "دارایی بدهکار می‌شود، حساب نقدی بستانکار؛ یک بسته FIFO باز می‌شود."}
        {type === "sell" && "دارایی به بهای تمام‌شده FIFO خارج می‌شود و اختلاف در «سود سرمایه‌ای تحقق‌یافته» ثبت می‌گردد."}
        {type === "transfer" && "ثروت تغییر نمی‌کند؛ فقط محل نگهداری جابه‌جا می‌شود (کارمزد هزینه است)."}
        {type === "income" && "حساب نقدی بدهکار و حساب درآمد بستانکار می‌شود."}
        {type === "expense" && "حساب هزینه بدهکار و حساب نقدی بستانکار می‌شود."}
        {" "}مجموع ارزش پایه سند همیشه باید صفر باشد.
      </div>

      {/* Smart Preview Before Commit */}
      {showPreview ? (
        <PreviewCard title="پیش‌نمایش هوشمند قبل از ثبت نهایی — فقط نمایشی">
          <div className="space-y-2 text-xs leading-6">
            <div><span className="muted">نوع تراکنش:</span> <strong>{TYPES.find(t=>t.key===type)?.label}</strong></div>
            <div><span className="muted">عنوان/شرح:</span> <strong>{description || "—"}</strong></div>
            <div className="soft rounded-xl p-2">
              <div className="muted text-[10px]">مبلغ به تومان و معادل دلاری (با نرخ لحظه‌ای)</div>
              <div className="num font-bold" dir="rtl">{irtAmount ? formatMoney(irtAmount, "IRT") : "—"}</div>
              <div className="num" dir="ltr" style={{ color:"var(--brand)" }}>{previewUsd ? formatMoney(previewUsd, "USD") : "—"} <span className="muted text-[10px]"> نرخ: {effectiveRate ? formatMoney(effectiveRate, "IRT")+" ≈ $1" : "ثبت نشده"}</span></div>
              {effectiveRateDate && <div className="muted text-[10px]">تاریخ نرخ: <span dir="ltr" className="num">{effectiveRateDate}</span> · منبع: {effectiveRateSource ?? "—"}</div>}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div><span className="muted">حساب مبدأ:</span> <strong>{accounts.find(a=>a.id===primaryAccountId)?.name ?? "—"}</strong> <span className="chip">{accounts.find(a=>a.id===primaryAccountId)?.code ?? ""}</span></div>
              <div><span className="muted">حساب مقابل:</span> <strong>{accounts.find(a=>a.id===counterAccountId)?.name ?? "—"}</strong> <span className="chip">{accounts.find(a=>a.id===counterAccountId)?.code ?? ""}</span></div>
            </div>
            <div>
              <span className="muted">تاریخ شمسی / میلادی:</span>
              <div className="soft rounded-xl p-2 mt-1 flex flex-wrap gap-3 text-[11px]">
                <span>شمسی: <strong dir="rtl">{entryDate ? getDualDate(entryDate).jalali : "—"}</strong></span>
                <span>میلادی: <strong dir="ltr" className="num">{entryDate || "—"}</strong></span>
              </div>
            </div>
            {needsQty && <div><span className="muted">مقدار دارایی:</span> <strong dir="ltr" className="num">{quantity || "محاسبه خودکار از مبلغ"}</strong></div>}
            {fee && <div><span className="muted">کارمزد:</span> <strong dir="ltr" className="num">{formatMoney(fee, "IRT")}</strong> ≈ {effectiveRate ? formatMoney(D(fee).div(effectiveRate).toFixed(2), "USD") : "—"}</div>}
            {(selectedDebt || selectedInst) && (
              <div className="soft rounded-xl p-2 border" style={{ borderColor:"var(--border)" }}>
                <div className="font-bold">مرجع بدهی/قسط</div>
                <div>بدهی: <strong>{selectedDebt?.title}</strong> — {selectedDebt?.creditor}</div>
                {selectedInst && <div>قسط: <strong>#{selectedInst.seq}</strong> — سررسید {getDualDate(selectedInst.dueDate).jalali} / <span dir="ltr">{selectedInst.dueDate}</span> — مبلغ <span dir="ltr">{formatMoney(selectedInst.amountBase,"USD")}</span></div>}
                <div>وضعیت پس از پرداخت: <strong style={{ color:"var(--brand)" }}>{debtStatusAfter}</strong></div>
                <div className="muted text-[10px]">شناسه مرجع در سند حسابداری ذخیره و قابل پیگیری از هر دو سمت خواهد بود.</div>
              </div>
            )}
            <div className="muted text-[10px] leading-5">
              تا قبل از «تأیید نهایی ثبت تراکنش» هیچ اطلاعاتی وارد Accounting Core, Ledger یا FIFO نمی‌شود. پس از تأیید، مبلغ تاریخی به تومان، معادل به دلار و نرخ زمان ثبت Freeze می‌شوند (Historical Immutability).
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1" style={{ touchAction: "manipulation" }}>بازگشت به ویرایش</button>
            <button type="submit" disabled={pending} className="btn btn-primary flex-1" style={{ touchAction: "manipulation" }}>
              {pending ? "در حال ثبت…" : "تأیید نهایی ثبت تراکنش"}
            </button>
          </div>
        </PreviewCard>
      ) : (
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => setShowPreview(true)}
          className="btn btn-primary w-full disabled:opacity-40"
          style={{ touchAction: "manipulation" }}
        >
          {canPreview ? "پیش‌نمایش هوشمند قبل از ثبت نهایی" : "برای پیش‌نمایش، مبلغ، تاریخ و حساب‌ها را تکمیل کنید"}
        </button>
      )}

      {state && (
        <p
          className="rounded-[var(--r-md)] px-4 py-3 text-xs font-medium"
          role="status"
          style={{
            background: state.ok ? "var(--positive-soft)" : "var(--negative-soft)",
            color: state.ok ? "var(--positive)" : "var(--negative)",
          }}
        >
          {state.message}
        </p>
      )}

      {/* entryDate is provided by DualDateInput hidden input */}
    </form>
  );
}
