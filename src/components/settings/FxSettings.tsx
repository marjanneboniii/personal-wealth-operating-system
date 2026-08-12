"use client";

/* The countdown synchronizes with wall-clock time; its state updates are intentional. */
/* eslint-disable react-hooks/set-state-in-effect */

import { useActionState, useEffect, useState } from "react";
import { updateFxRateAction, type AuthResult } from "@/lib/auth-actions";
import { formatMoney, formatJalaliIso } from "@/lib/format";
import Icon from "@/components/ui/Icon";

type Props = {
  currentRate: string;
  lastUpdatedAt: string | null;
  nextUpdateAt: string | null;
  canUpdate: boolean;
};

export default function FxSettings({ currentRate, lastUpdatedAt, nextUpdateAt, canUpdate }: Props) {
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(updateFxRateAction, null);
  const [rate, setRate] = useState(currentRate);
  const [localCanUpdate, setLocalCanUpdate] = useState(canUpdate);

  useEffect(() => {
    setRate(currentRate);
    setLocalCanUpdate(canUpdate);
  }, [currentRate, canUpdate]);

  // Countdown for next update
  const [countdown, setCountdown] = useState<string | null>(null);
  useEffect(() => {
    if (!nextUpdateAt) {
      setCountdown(null);
      return;
    }
    const tick = () => {
      const diff = new Date(nextUpdateAt).getTime() - Date.now();
      if (diff <= 0) {
        setLocalCanUpdate(true);
        setCountdown(null);
        return;
      }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      setCountdown(`${h} ساعت و ${m} دقیقه`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [nextUpdateAt]);

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-bold">ثبت و ویرایش دستی نرخ دلار</h3>
        </div>
        <span className="badge badge-brand">هر ۲۴ ساعت یک‌بار</span>
      </div>

      <div className="soft mt-4 rounded-[var(--r-lg)] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <p className="muted text-[11px]">نرخ فعلی</p>
            <p className="num text-[22px] font-bold" dir="ltr">
              {formatMoney(currentRate, "IRT")} <span className="muted text-[12px]">≈ $1</span>
            </p>
          </div>
          <div className="text-left">
            <p className="muted text-[11px]">آخرین به‌روزرسانی</p>
            <p className="num text-[12px] font-medium" dir="rtl">
              {lastUpdatedAt ? `${formatJalaliIso(lastUpdatedAt.slice(0, 10))} — ${new Date(lastUpdatedAt).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}` : "هنوز به‌روزرسانی نشده"}
            </p>
            {nextUpdateAt && !localCanUpdate && (
              <p className="muted text-[11px]">به‌روزرسانی بعدی: {countdown ? `حدود ${countdown} دیگر` : formatJalaliIso(nextUpdateAt.slice(0, 10))}</p>
            )}
            {localCanUpdate && <p className="pos text-[11px]">اکنون می‌توانید نرخ را به‌روزرسانی کنید.</p>}
          </div>
        </div>
      </div>

      <form action={formAction} className="mt-4 space-y-3">
        <div>
          <label className="label">ثبت نرخ دستی دلار (تومان برای هر دلار)</label>
          <div className="flex gap-2">
            <input
              name="rate"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^0-9]/g, ""))}
              disabled={!localCanUpdate || pending}
              placeholder="190000"
              inputMode="numeric"
              dir="ltr"
              className="field num flex-1 disabled:opacity-50"
              style={{ touchAction: "manipulation" }}
            />
            <button
              type="submit"
              disabled={!localCanUpdate || pending || !rate || rate === currentRate}
              className="btn btn-primary !min-h-[44px] shrink-0 disabled:opacity-40"
              style={{ touchAction: "manipulation" }}
            >
              <Icon name="refresh" size={15} />
              ذخیره نرخ دستی
            </button>
          </div>
          {!localCanUpdate && (
            <p className="muted mt-2 flex items-center gap-1.5 text-[11px]">
              <Icon name="clock" size={12} />
              نرخ ارز فقط هر ۲۴ ساعت یک‌بار قابل به‌روزرسانی است.
            </p>
          )}
          <p className="muted mt-1 text-[10.5px]">پس از ذخیره، ارزش خالص فعلی و دارایی‌های جاری با نرخ جدید محاسبه می‌شوند؛ تراکنش‌های تاریخی بدون تغییر می‌مانند.</p>
        </div>

        {state && (
          <p
            className="rounded-[var(--r-md)] px-3 py-2 text-[12px] font-medium"
            style={{ background: state.ok ? "var(--positive-soft)" : "var(--negative-soft)", color: state.ok ? "var(--positive)" : "var(--negative)" }}
          >
            {state.message}
          </p>
        )}
      </form>
    </div>
  );
}
