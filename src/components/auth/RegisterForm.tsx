"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerAction, type AuthResult } from "@/lib/auth-actions";
import { purgeClientCaches } from "@/lib/swClient";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";
import TurnstileWidget from "@/components/auth/TurnstileWidget";

export default function RegisterForm({ turnstileSiteKey }: { turnstileSiteKey?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(registerAction, null);

  useEffect(() => {
    if (state?.ok && state.redirectTo) {
      // SECURITY (L-03): a new tenant starts with a clean device cache.
      void purgeClientCaches();
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      <div>
        <label className="label" htmlFor="reg-email">ایمیل</label>
        <input id="reg-email" name="email" type="email" required maxLength={254} autoComplete="email" placeholder="name@example.com" className="field" dir="ltr" />
      </div>

      <div>
        <label className="label" htmlFor="reg-username">نام کاربری</label>
        <input
          id="reg-username"
          name="username"
          required
          minLength={3}
          maxLength={64}
          pattern="[a-zA-Z0-9_.\-]+"
          autoComplete="username"
          placeholder="example"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
        <p className="muted mt-1 text-[length:var(--fs-xs)]">فقط حروف انگلیسی، عدد، _ و - مجاز است.</p>
      </div>

      <div>
        <label className="label" htmlFor="reg-name">نام نمایشی (اختیاری)</label>
        <input id="reg-name" name="name" maxLength={120} placeholder="نام شما" className="field" style={{ touchAction: "manipulation" }} />
      </div>

      <div>
        <label className="label">رمز عبور</label>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          placeholder="••••••••"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
      </div>

      <div>
        <label className="label" htmlFor="reg-confirm">تأیید رمز عبور</label>
        <input
          id="reg-confirm"
          name="confirmPassword"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="new-password"
          placeholder="••••••••"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
      </div>

      {state && (
        <p
          className="rounded-[var(--r-md)] px-3 py-2 text-[12px] font-medium"
          style={{
            background: state.ok ? "var(--positive-soft)" : "var(--negative-soft)",
            color: state.ok ? "var(--positive)" : "var(--negative)",
          }}
        >
          {state.message}
        </p>
      )}

      <TurnstileWidget siteKey={turnstileSiteKey} />
      <button type="submit" disabled={pending} className="btn btn-primary w-full" style={{ touchAction: "manipulation" }}>
        {pending ? "در حال ثبت‌نام…" : "ثبت‌نام"}
      </button>

      <GoogleAuthButton label="ثبت‌نام با Google" />
    </form>
  );
}
