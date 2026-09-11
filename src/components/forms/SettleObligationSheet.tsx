"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { payInstallmentAction, type ActionResult } from "@/app/actions";
import { D } from "@/domain/decimal";
import { formatMoney } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import Sheet from "@/components/ui/Sheet";

type Props = {
  /** The installment being settled. */
  installmentId: string;
  /** Toman still owed on it — the ceiling for any settlement. */
  dueToman: string;
  /** Toman already settled against it (non-zero on a partly-paid row). */
  paidSoFarToman?: string;
  /** The tenant's cash account the money moves through. */
  cashAccountId?: string | null;
  /** payable «بدهی من» → پرداخت · receivable «طلب من» → دریافت. */
  direction: string;
  /** What is being settled, for the sheet heading. */
  label: string;
  /** Extra classes for the trigger button wrapper. */
  className?: string;
  buttonClassName?: string;
};

/**
 * ثبت پرداخت / دریافت — full or partial settlement of one installment.
 *
 * WHY A SHEET AND NOT A ONE-CLICK BUTTON
 * The existing one-click `RowAction` settles the whole row, which is right most
 * of the time and wrong exactly when it matters: a user who paid 30 of a 50
 * million installment had no way to record that and was pushed to either
 * overstate the payment or skip recording it. The sheet keeps the one-click
 * path as its default (the amount is pre-filled with the full remaining
 * balance, so «تأیید» is still one decision) and makes the partial case
 * possible rather than making it the norm.
 *
 * DIRECTION is passed down, never inferred from the caption: the SERVER reads
 * it from the obligation row inside the payment transaction and decides the
 * sign of the cash leg there. This component only words the button.
 */
export default function SettleObligationSheet({
  installmentId,
  dueToman,
  paidSoFarToman,
  cashAccountId,
  direction,
  label,
  className,
  buttonClassName,
}: Props) {
  const router = useRouter();
  const receivable = direction === "receivable";
  const verb = receivable ? "دریافت" : "پرداخت";

  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(() => D(dueToman || "0").toFixed(0));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const due = D(dueToman || "0");
  const entered = amount ? D(amount) : D("0");
  const partial = entered.gt(0) && entered.lt(due);
  const invalid = !entered.gt(0) || entered.gt(due);
  const alreadyPaid = paidSoFarToman != null && D(paidSoFarToman).gt(0);

  const submit = () => {
    if (invalid || !cashAccountId) return;
    start(async () => {
      // The full-balance case sends NO amount, so the server settles the
      // remaining balance it reads inside the transaction. That avoids a race
      // where the client's idea of "the whole thing" is one stale partial
      // payment behind the database.
      const res = await payInstallmentAction(
        installmentId,
        cashAccountId,
        partial ? entered.toFixed(0) : undefined,
      );
      setResult(res);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <span className={`inline-flex flex-col items-stretch gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => {
          setAmount(due.toFixed(0));
          setResult(null);
          setOpen(true);
        }}
        disabled={!cashAccountId || !due.gt(0)}
        className={`btn btn-primary !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)] ${buttonClassName ?? ""}`}
        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
      >
        {receivable ? "ثبت دریافت" : "پرداخت قسط"}
      </button>

      {result && !result.ok && (
        <span
          className="badge"
          role="status"
          style={{ background: "var(--negative-soft)", color: "var(--negative)" }}
        >
          {result.message}
        </span>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={`ثبت ${verb} — ${label}`}>
        <div className="space-y-4" dir="rtl">
          <div className="soft rounded-[var(--r-md)] p-3 text-[length:var(--fs-xs)] leading-6">
            <div className="flex justify-between gap-2">
              <span className="muted">مانده این قسط</span>
              <span className="num font-bold" dir="rtl">{formatMoney(due.toFixed(0), "IRT")}</span>
            </div>
            {alreadyPaid && (
              <div className="flex justify-between gap-2">
                <span className="muted">تاکنون {verb} شده</span>
                <span className="num" dir="rtl">{formatMoney(D(paidSoFarToman!).toFixed(0), "IRT")}</span>
              </div>
            )}
          </div>

          <div>
            <label className="label">مبلغ {verb} به تومان</label>
            <AmountInput
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              className="field num !text-lg !font-bold"
              inputMode="numeric"
              dir="ltr"
              unit="toman"
            />
            {entered.gt(due) && (
              <p className="neg mt-1 text-[length:var(--fs-xs)]">
                مبلغ از مانده این قسط بیشتر است. برای ثبت مبلغ اضافه، قسط بعدی را جداگانه تسویه کنید.
              </p>
            )}
            {partial && (
              <p className="muted mt-1 text-[length:var(--fs-xs)]">
                باقی‌مانده پس از این {verb}:{" "}
                <span className="num" dir="rtl">{formatMoney(due.sub(entered).toFixed(0), "IRT")}</span> · وضعیت قسط
                «بخشی پرداخت شده» می‌شود.
              </p>
            )}
          </div>

          {/* Toman is the contract. The USD equivalent is frozen from the rate
              at the moment this posts — the server captures it inside the same
              transaction, so nothing here needs to compute or send it. */}
          <p className="muted text-[length:var(--fs-xs)] leading-5">
            مبلغ تومان قرارداد ثابت است؛ معادل دلاری در لحظه ثبت با نرخ همان لحظه ذخیره و برای همیشه فریز
            می‌شود.
          </p>

          {result && !result.ok && <p className="neg text-[length:var(--fs-xs)]">{result.message}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost flex-1">
              انصراف
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={pending || invalid || !cashAccountId}
              className="btn btn-primary flex-1 disabled:opacity-40"
            >
              {pending ? "در حال ثبت…" : `تأیید ${verb}`}
            </button>
          </div>
        </div>
      </Sheet>
    </span>
  );
}
