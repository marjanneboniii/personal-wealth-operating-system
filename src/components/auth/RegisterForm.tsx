"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerAction, type AuthResult } from "@/lib/auth-actions";
import { purgeClientCaches } from "@/lib/swClient";
import GoogleAuthButton from "@/components/auth/GoogleAuthButton";

export default function RegisterForm({ googleClientId }: { googleClientId?: string }) {
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
        <label className="label">نام کاربری</label>
        <input
          name="username"
          required
          minLength={3}
          pattern="[a-zA-Z0-9_.\-]+"
          autoComplete="username"
          placeholder="example"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
        <p className="muted mt-1 text-[10px]">فقط حروف انگلیسی، عدد، _ و - مجاز است.</p>
      </div>

      <div>
        <label className="label">نام نمایشی (اختیاری)</label>
        <input name="name" placeholder="نام شما" className="field" style={{ touchAction: "manipulation" }} />
      </div>

      <div>
        <label className="label">رمز عبور</label>
        <input
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="••••••••"
          className="field"
          dir="ltr"
          style={{ touchAction: "manipulation" }}
        />
      </div>

      <div>
        <label className="label">تأیید رمز عبور</label>
        <input
          name="confirmPassword"
          type="password"
          required
          minLength={6}
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

      <button type="submit" disabled={pending} className="btn btn-primary w-full" style={{ touchAction: "manipulation" }}>
        {pending ? "در حال ثبت‌نام…" : "ثبت‌نام"}
      </button>

      <GoogleAuthButton clientId={googleClientId} label="ثبت‌نام با Google" />
    </form>
  );
}
