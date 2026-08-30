"use client";

import Image from "next/image";
import { useActionState, useState, useTransition } from "react";
import { beginTwoFactorSetup, confirmTwoFactorSetup, type TwoFactorResult } from "@/lib/two-factor-actions";

export default function TwoFactorPanel({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<TwoFactorResult | null>(null);
  const [starting, startTransition] = useTransition();
  const [result, confirm, confirming] = useActionState<TwoFactorResult | null, FormData>(confirmTwoFactorSetup, null);

  if (enabled || (result?.ok && !result.setup)) {
    return <div className="card p-4"><p className="font-semibold">تأیید دو مرحله‌ای فعال است</p><p className="muted mt-1 text-[12px]">برای ورود، کد برنامه تأییدکننده نیز لازم است.</p></div>;
  }
  if (!setup?.setup) {
    return <div className="card p-4 sm:p-5"><h3 className="font-semibold">تأیید دو مرحله‌ای</h3><p className="muted mt-1 text-[12px] leading-6">با Google Authenticator، Microsoft Authenticator یا Authy از حساب خود محافظت کنید.</p><button type="button" disabled={starting} className="btn btn-primary mt-4" onClick={() => startTransition(async () => setSetup(await beginTwoFactorSetup()))}>{starting ? "در حال آماده‌سازی…" : "فعال‌سازی تأیید دو مرحله‌ای"}</button>{setup && !setup.ok && <p role="alert" className="mt-3 text-[12px]" style={{color:"var(--negative)"}}>{setup.message}</p>}</div>;
  }
  return <div className="card p-4 sm:p-5"><h3 className="type-page-title">راه‌اندازی تأیید دو مرحله‌ای</h3><p className="sub mt-2 text-[13px] leading-6">کد QR را با Google Authenticator اسکن کنید. سپس کد ۶ رقمی تولیدشده را وارد کنید.</p>{setup.qrDataUrl && <Image unoptimized width={240} height={240} src={setup.qrDataUrl} alt="کد QR راه‌اندازی تأیید دو مرحله‌ای" className="mx-auto my-5 h-auto w-full max-w-[240px] rounded-xl bg-white p-2" />}{setup.manualKey && <details className="mb-4"><summary className="cursor-pointer text-[12px] font-medium">نمایش کلید راه‌اندازی دستی</summary><code className="mt-2 block break-all rounded-lg p-3 text-left text-[12px]" dir="ltr" style={{background:"var(--sunken)"}}>{setup.manualKey}</code></details>}<form action={confirm} className="space-y-3"><label className="label" htmlFor="setup-totp">کد تأیید</label><input id="setup-totp" name="totpCode" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9۰-۹٠-٩]{6}" className="field auth-otp" dir="ltr" placeholder="کد ۶ رقمی" />{result && !result.ok && <p role="alert" className="text-[12px]" style={{color:"var(--negative)"}}>{result.message}</p>}<button className="btn btn-primary w-full" disabled={confirming}>{confirming ? "در حال بررسی…" : "تأیید و فعال‌سازی"}</button></form></div>;
}
