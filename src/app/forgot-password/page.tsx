import Link from "next/link";
import { requestPasswordResetAction } from "@/lib/auth-actions";

export default function ForgotPasswordPage() {
  return <div className="mx-auto max-w-md py-12">
    <div className="card space-y-4 p-6">
      <h1 className="type-page-title">بازیابی رمز عبور</h1>
      <p className="muted text-[12px]">لینک امن تغییر رمز به ایمیل شما ارسال می‌شود.</p>
      <form action={requestPasswordResetAction} className="space-y-3">
        <input className="field" name="email" type="email" required maxLength={254} dir="ltr" placeholder="name@example.com" />
        <button className="btn btn-primary w-full" type="submit">ارسال لینک بازیابی</button>
      </form>
      <Link className="muted block text-center text-[12px]" href="/login">بازگشت به ورود</Link>
    </div>
  </div>;
}
