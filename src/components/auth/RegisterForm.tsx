"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { registerAction, type AuthResult } from "@/lib/auth-actions";
import Icon from "@/components/ui/Icon";

export default function RegisterForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<AuthResult | null, FormData>(registerAction, null);

  useEffect(() => {
    if (state?.ok && state.redirectTo) {
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

      <GoogleButton />
    </form>
  );
}

function GoogleButton() {
  const handleGoogle = async () => {
    const clientId = (window as any).__GOOGLE_CLIENT_ID__ || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if ((window as any).google?.accounts?.id && clientId) {
      (window as any).google.accounts.id.prompt();
      return;
    }
    const email = window.prompt("برای ثبت‌نام آزمایشی با Google، ایمیل خود را وارد کنید:", "user@gmail.com");
    if (!email) return;
    const googleId = "mock-" + btoa(email).replace(/[^a-z0-9]/gi, "").slice(0, 16);
    const name = email.split("@")[0];
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, googleId, name }),
    });
    const j = await res.json();
    if (j.ok) window.location.href = "/";
    else alert(j.error || "خطا در ثبت‌نام با Google");
  };
  return (
    <button type="button" onClick={handleGoogle} className="btn w-full" style={{ touchAction: "manipulation" }}>
      <Icon name="globe" size={16} />
      ثبت‌نام با Google
    </button>
  );
}
