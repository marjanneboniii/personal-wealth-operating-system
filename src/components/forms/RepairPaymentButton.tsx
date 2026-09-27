"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { repairInstallmentPaymentAction, type ActionResult } from "@/app/actions";
import { formatMoney } from "@/lib/format";
import AccountPicker, { type PickerAccount } from "@/components/ui/AccountPicker";
import Sheet from "@/components/ui/Sheet";
import type { UnsettledPayment } from "@/features/planning/repairPayments";

/**
 * «انتخاب حساب» on a paid installment whose money never left a Toman bank
 * (paid before Quick Pay asked for the account). Shown only on those rows, so
 * it disappears once they are fixed.
 */
export default function RepairPaymentButton({
  item,
  accounts,
  balances,
}: {
  item: UnsettledPayment;
  accounts: PickerAccount[];
  balances?: Record<string, string>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(() => (accounts.length === 1 ? accounts[0].id : ""));
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pending, start] = useTransition();

  const submit = () => {
    if (!accountId) return;
    start(async () => {
      const res = await repairInstallmentPaymentAction(item.installmentId, accountId);
      setResult(res);
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
        style={{ color: "var(--warning)" }}
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
      >
        از حساب کم نشده · انتخاب حساب
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={`حساب پرداخت — قسط ${item.seq}`}>
        <div className="space-y-4 p-4">
          <p className="muted text-[length:var(--fs-xs)] leading-5">
            <span className="num" dir="rtl">{formatMoney(item.amountToman, "IRT")}</span> از حسابی که انتخاب کنید کم می‌شود
            {item.fromAccountName ? ` و به «${item.fromAccountName}» برمی‌گردد` : ""}.
          </p>

          <AccountPicker
            label="پرداخت از حساب"
            value={accountId}
            options={accounts}
            balances={balances}
            onChange={setAccountId}
            placeholder="انتخاب حساب بانکی"
            sheetTitle="پرداخت از کدام حساب؟"
            empty={<p className="muted text-[length:var(--fs-xs)]">هنوز حساب بانکی تومانی ثبت نکرده‌اید.</p>}
          />

          {result && !result.ok && <p className="neg text-[length:var(--fs-xs)]">{result.message}</p>}

          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="btn btn-ghost flex-1">
              انصراف
            </button>
            <button type="button" onClick={submit} disabled={pending || !accountId} className="btn btn-primary flex-1 disabled:opacity-40">
              {pending ? "در حال ثبت…" : "تأیید"}
            </button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
