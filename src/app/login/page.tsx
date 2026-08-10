import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { seedIfEmpty } from "@/db/seed";
import LoginForm from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; claim?: string }>;
}) {
  await seedIfEmpty();
  const user = await getCurrentUser();
  if (user) redirect("/");

  const params = await searchParams;
  const isClaim = params.claim === "1";

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col justify-center px-4 py-8">
      <div className="card p-6 sm:p-8">
        <div className="mb-6 text-center">
          <h1 className="text-[22px] font-bold tracking-tight">ورود به حساب</h1>
          <p className="muted mt-1.5 text-[13px] leading-5">
            {isClaim ? "حساب فعلی شما بدون نام کاربری است. لطفاً نام کاربری خود را انتخاب کنید تا مالکیت داده‌ها حفظ شود." : "برای دسترسی به سیستم مدیریت ثروت وارد شوید."}
          </p>
        </div>

        <LoginForm
          claimMode={isClaim}
          googleClientId={process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID}
        />

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "var(--border)" }} />
          <span className="muted text-[11px]">یا</span>
          <span className="h-px flex-1" style={{ background: "var(--border)" }} />
        </div>

        <p className="muted mt-6 text-center text-[12px]">
          حساب ندارید؟{" "}
          <a href="/register" className="font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            ثبت‌نام
          </a>
        </p>
      </div>

      <p className="muted mt-4 text-center text-[11px]">ورود شما در سرور اعتبارسنجی می‌شود. نشست پس از خروج یا انقضا پایان می‌یابد.</p>
    </div>
  );
}
