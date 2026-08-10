"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loginAction, type AuthResult } from "@/lib/auth-actions";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

export default function LoginForm({ claimMode, googleClientId }: { claimMode?: boolean; googleClientId?: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(loginAction, null);

  useEffect(() => {
    if (state?.ok && state.redirectTo) {
      router.push(state.redirectTo);
      router.refresh();
    }
  }, [state, router]);

  return (
    <form action={formAction} className="space-y-4" dir="rtl">
      <div>
        <label className="label">نام کاربری یا ایمیل</label>
        <input
          name="username"
          required
          autoComplete="username"
          placeholder="example"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
      </div>
      <div>
        <label className="label">رمز عبور</label>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
      </div>

      {state && !state.ok && (
        <p className="rounded-[var(--r-md)] px-3 py-2 text-[12px] font-medium" style={{ background: "var(--negative-soft)", color: "var(--negative)" }}>
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
