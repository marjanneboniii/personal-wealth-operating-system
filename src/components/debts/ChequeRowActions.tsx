"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteChequeAction, setChequeStatusAction } from "@/app/actions/cheques";
import type { ChequeStatus } from "@/features/cheques/service";

const SMALL = "btn !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]";

/** What can be done to one cheque. «پاس شد» goes through the transaction form. */
export default function ChequeRowActions({ id, status, clearHref }: { id: string; status: ChequeStatus; clearHref: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; message: string }>, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.message);
    });
  };

  return (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {status === "pending" && (
        <>
          <Link href={clearHref} className={`${SMALL} btn-primary`}>
            ثبت پاس شدن
          </Link>
          <button type="button" className={`${SMALL} btn-ghost`} disabled={pending} onClick={() => run(() => setChequeStatusAction(id, "bounced"))}>
            برگشت خورد
          </button>
          <button type="button" className={`${SMALL} btn-ghost`} disabled={pending} onClick={() => run(() => setChequeStatusAction(id, "cancelled"))}>
            باطل / عودت
          </button>
        </>
      )}
      {(status === "bounced" || status === "cancelled") && (
        <button type="button" className={`${SMALL} btn-soft`} disabled={pending} onClick={() => run(() => setChequeStatusAction(id, "pending"))}>
          دوباره در جریان
        </button>
      )}
      {status === "bounced" && (
        <button type="button" className={`${SMALL} btn-ghost`} disabled={pending} onClick={() => run(() => setChequeStatusAction(id, "cancelled"))}>
          باطل / عودت
        </button>
      )}
      {status !== "cleared" && (
        <button
          type="button"
          className={`${SMALL} btn-ghost`}
          style={{ color: "var(--negative)" }}
          disabled={pending}
          onClick={() => run(() => deleteChequeAction(id), "این چک از دفتر چک حذف شود؟ چون پاس نشده، اثری در موجودی حساب‌ها ندارد.")}
        >
          حذف
        </button>
      )}
      {error && (
        <p className="w-full text-end text-[length:var(--fs-xs)]" role="alert" style={{ color: "var(--negative)" }}>
          {error}
        </p>
      )}
    </div>
  );
}
