import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { seedIfEmpty } from "@/db/seed";
import RegisterForm from "@/components/auth/RegisterForm";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  await seedIfEmpty();
  const user = await getCurrentUser();
  if (user) redirect("/");

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-8">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-[22px] font-bold tracking-tight">ایجاد حساب</h1>
          <p className="muted mt-1.5 text-[13px] leading-5">یک نام کاربری و رمز عبور برای حساب مستقل خود انتخاب کنید.</p>
        </div>

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
