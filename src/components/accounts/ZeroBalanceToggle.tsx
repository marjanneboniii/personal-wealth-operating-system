"use client";
// ZeroBalanceToggle.tsx — «نمایش حساب‌های با موجودی صفر» on «حساب‌ها».
//
// An account emptied by a transfer («همه») stays in the ledger with a zero
// balance. Whether it is listed is the viewer's choice, kept in a cookie the
// page reads on the server, so the list never flashes the other way.
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { SHOW_ZERO_BALANCES_COOKIE } from "@/lib/zeroBalances";

export default function ZeroBalanceToggle({ showing, hiddenCount }: { showing: boolean; hiddenCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = () => {
    document.cookie = `${SHOW_ZERO_BALANCES_COOKIE}=${showing ? "0" : "1"}; path=/; max-age=31536000; samesite=lax`;
    startTransition(() => router.refresh());
  };

  return (
    <label className="flex cursor-pointer items-center gap-2 text-[length:var(--fs-xs)]">
      <input type="checkbox" checked={showing} disabled={pending} onChange={toggle} />
      <span>
        نمایش حساب‌های با موجودی صفر
        {!showing && hiddenCount > 0 ? <span className="muted num"> ({hiddenCount.toLocaleString("fa-IR")} پنهان)</span> : null}
      </span>
    </label>
  );
}
