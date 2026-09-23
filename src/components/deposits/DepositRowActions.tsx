"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { closeDepositAction, deleteDepositAction } from "@/app/actions/deposits";

const SMALL = "btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]";

export default function DepositRowActions({ id, active, nextPlanId }: { id: string; active: boolean; nextPlanId: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = (fn: () => Promise<{ ok: boolean; message: string }>, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.message);
    });
  };

  return (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {active && nextPlanId && (
        <Link href={`/new?type=income&planId=${nextPlanId}`} className={`${SMALL} btn-primary`}>
          ثبت سود این ماه
        </Link>
      )}
      {active && (
        <button
          type="button"
          className={`${SMALL} btn-ghost`}
          disabled={pending}
          onClick={() => run(() => closeDepositAction(id), "سپرده بسته شود؟ یادآور سود بعدی لغو می‌شود. برگرداندن اصل پول را با یک «انتقال» ثبت کنید.")}
        >
          بستن سپرده
        </button>
      )}
      <button
        type="button"
        className={`${SMALL} btn-ghost`}
        style={{ color: "var(--negative)" }}
        disabled={pending}
        onClick={() => run(() => deleteDepositAction(id), "این سپرده حذف شود؟ سودهای ثبت‌شده در دفترکل می‌مانند.")}
      >
        حذف
      </button>
      {error && (
        <p className="w-full text-end text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
