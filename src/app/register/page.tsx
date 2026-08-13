import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { seedIfEmpty } from "@/db/seed";
import RegisterForm from "@/components/auth/RegisterForm";
import BrandMark from "@/components/layout/BrandMark";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  // Kept reachable even when the database is down — see the note in
  // src/app/login/page.tsx. An unverifiable session counts as "not signed in".
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  let databaseUnavailable = false;
  try {
    await seedIfEmpty();
    user = await getCurrentUser();
  } catch {
    user = null;
    databaseUnavailable = true;
  }
  if (user) redirect("/");

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-md flex-col justify-center px-1 py-6 sm:px-4">
      <p className="mb-4 text-center">
        <a href="/" className="muted text-[12.5px] font-medium hover:underline">
          بازگشت به معرفی تراز
        </a>
      </p>
      <div className="card p-5 sm:p-8">
        <div className="mb-5 text-center">
          <span
            className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
          >
            <BrandMark size={32} />
          </span>
          <h1 className="type-page-title">ایجاد حساب</h1>
          <p className="sub mt-2 text-[13px] leading-6">یک نام کاربری و رمز عبور برای حساب مستقل خود انتخاب کنید.</p>
        </div>

        {databaseUnavailable && (
          <p
            role="status"
            className="mb-4 rounded-[var(--r-md)] px-3 py-2 text-[12px] leading-6"
            style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
          >
            ارتباط با پایگاه داده برقرار نیست. داده‌های شما امن‌اند. می‌توانید فرم را کامل کنید؛ اگر ثبت‌نام ناموفق بود، چند لحظه بعد دوباره تلاش کنید.
          </p>
        )}

        <RegisterForm googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID} />

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "var(--border)" }} />
          <span className="muted text-[11px]">یا</span>
          <span className="h-px flex-1" style={{ background: "var(--border)" }} />
        </div>

        <p className="muted mt-6 text-center text-[12px]">
          قبلاً ثبت‌نام کرده‌اید؟{" "}
          <a href="/login" className="font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            ورود
          </a>
        </p>
      </div>
    </div>
  );
}
