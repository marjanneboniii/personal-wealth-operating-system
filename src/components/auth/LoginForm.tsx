"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { loginAction, type AuthResult } from "@/lib/auth-actions";
import Icon from "@/components/ui/Icon";

export default function LoginForm({ claimMode }: { claimMode?: boolean }) {
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

      <GoogleButton />
    </form>
  );
}

function GoogleButton() {
  const handleGoogle = async () => {
    // Try Google Identity Services if available, else mock
    const clientId = (window as any).__GOOGLE_CLIENT_ID__ || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if ((window as any).google?.accounts?.id && clientId) {
      // Real GIS flow — will be handled by script; trigger prompt
      (window as any).google.accounts.id.prompt();
      return;
    }
    // Fallback: mock Google login for demo — prompt for email
    const email = window.prompt("برای ورود آزمایشی با Google، ایمیل Google خود را وارد کنید:", "user@gmail.com");
    if (!email) return;
    const googleId = "mock-" + btoa(email).replace(/[^a-z0-9]/gi, "").slice(0, 16);
    const name = email.split("@")[0];
    const res = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, googleId, name }),
    });
    const j = await res.json();
    if (j.ok) {
      window.location.href = "/";
    } else {
      alert(j.error || "خطا در ورود با Google");
    }
  };

  return (
    <button
      type="button"
      onClick={handleGoogle}
      className="btn w-full"
      style={{ touchAction: "manipulation", background: "var(--surface)" }}
    >
      <Icon name="globe" size={16} />
      ورود با Google
    </button>
  );
}
