"use client";

import { useActionState } from "react";
import { setProModeAction, type AuthResult } from "@/lib/auth-actions";
import Icon from "@/components/ui/Icon";

/*
 * Global «حالت حرفه‌ای» toggle (Directive §2).
 * Default = SIMPLE: the app-wide UI speaks in ورودی/خروجی، دسته‌بندی و جریان پول.
 * PRO reveals accounting vocabulary everywhere (کد معین، بدهکار/بستانکار،
 * جزئیات دفتر کل). The flag is stored per-user server-side; this control only
 * submits the intent — the server re-reads it for every render.
 */
export default function ProModeToggle({ initialPro }: { initialPro: boolean }) {
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(setProModeAction, null);
  const pro = state?.ok ? !initialPro : initialPro;

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[14px] font-bold">نمایش و حالت حرفه‌ای</h3>
          <p className="muted mt-1 max-w-xl text-[12px] leading-5">
            پیش‌فرض، همه‌جای برنامه با زبان ساده نمایش داده می‌شود: «ورودی / خروجی»، «دسته‌بندی» و
            «از کدام حساب به کدام حساب». با فعال‌سازی حالت حرفه‌ای، اصطلاحات حسابداری
            (کد معین، بدهکار / بستانکار و جزئیات دفتر کل) در سراسر برنامه نمایان می‌شود.
          </p>
        </div>
        <span className={`badge ${pro ? "badge-brand" : "badge-neutral"} shrink-0`}>
          {pro ? "حالت حرفه‌ای" : "نمای ساده"}
        </span>
      </div>

      <form action={formAction} className="mt-4">
        <input type="hidden" name="proMode" value={pro ? "false" : "true"} />
        <button
          type="submit"
          disabled={pending}
          className={`btn ${pro ? "btn-soft" : "btn-primary"} !min-h-9`}
          style={{ touchAction: "manipulation" }}
        >
          <Icon name={pro ? "undo" : "check"} size={15} />
          {pending ? "در حال ذخیره…" : pro ? "بازگشت به نمای ساده" : "فعال‌سازی حالت حرفه‌ای"}
        </button>
      </form>

      {state && !state.ok && <p className="mt-2 text-[12px]" style={{ color: "var(--negative)" }}>{state.message}</p>}
      {state && state.ok && <p className="muted mt-2 text-[11.5px]">{state.message}</p>}
    </div>
  );
}
