"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loginAction, type AuthResult } from "@/lib/auth-actions";
import { purgeClientCaches } from "@/lib/swClient";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

export default function LoginForm({ claimMode, googleClientId }: { claimMode?: boolean; googleClientId?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(loginAction, null);

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
        <label className="label" htmlFor="login-username">نام کاربری یا ایمیل</label>
        <input
          id="login-username"
          name="username"
          required
          autoComplete="username"
          enterKeyHint="next"
          placeholder="نام کاربری یا ایمیل"
          className="field"
          dir="ltr"
          aria-invalid={state && !state.ok ? true : undefined}
          style={{ touchAction: "manipulation" }}
        />
      </div>
      <div>
        <label className="label" htmlFor="login-password">رمز عبور</label>
        <input
          id="login-password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          enterKeyHint="done"
          placeholder="رمز عبور"
          className="field"
          dir="ltr"
          aria-invalid={state && !state.ok ? true : undefined}
          style={{ touchAction: "manipulation" }}
        />
      </div>

      {state && !state.ok && (
        <p role="alert" className="rounded-[var(--r-md)] px-3 py-2 text-[12px] font-medium" style={{ background: "var(--negative-soft)", color: "var(--negative)" }}>
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full"
        style={{ touchAction: "manipulation" }}
      >
        {pending ? "در حال ورود…" : claimMode ? "تأیید و حفظ داده‌ها" : "ورود"}
      </button>

      <GoogleAuthButton clientId={googleClientId} label="ورود با Google" />
    </form>
  );
}
