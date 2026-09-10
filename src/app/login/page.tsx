import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { seedIfEmpty } from "@/db/seed";
import LoginForm from "@/components/auth/LoginForm";
import BrandMark, { BrandWordmark } from "@/components/layout/BrandMark";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ claim?: string }>;
}) {
  // The auth pages must stay reachable even when the database is unavailable.
  // Otherwise a stale session cookie plus a sleeping database traps the user:
  // every route — including /login — throws, so signing in becomes impossible.
  // Fail-closed semantics are preserved: a session that cannot be verified is
  // treated as "not signed in", so no financial data is ever exposed here.
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

  const params = await searchParams;
  const isClaim = params.claim === "1";

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-md flex-col justify-center px-1 py-6 sm:px-4">
      <p className="mb-4 text-center">
        <Link href="/" className="muted text-[length:var(--fs-xs)] font-medium hover:underline">
          بازگشت به معرفی توازن
        </Link>
      </p>
      <div className="card p-5 sm:p-8">
        <div className="mb-5 text-center">
          <span className="mx-auto mb-3 inline-flex">
            <BrandMark size={56} framed />
          </span>
          <BrandWordmark className="mb-3 block text-[18px]" />
          <h1 className="type-page-title">ورود به حساب</h1>
          <p className="sub mt-2 text-[length:var(--fs-sm)] leading-6">
            {isClaim ? "حساب فعلی شما بدون نام کاربری است. لطفاً نام کاربری خود را انتخاب کنید تا مالکیت داده‌ها حفظ شود." : "برای دسترسی به سیستم مدیریت ثروت وارد شوید."}
          </p>
        </div>

        {databaseUnavailable && (
          <p
            role="status"
            className="mb-4 rounded-[var(--r-md)] px-3 py-2 text-[length:var(--fs-xs)] leading-6"
            style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
          >
            ارتباط با سرور برقرار نیست. داده‌های شما امن است.</p>
        )}

        <LoginForm
          claimMode={isClaim}
          turnstileSiteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY}
        />

        <div className="mt-6 flex items-center gap-3">
          <span className="h-px flex-1" style={{ background: "var(--border)" }} />
          <span className="muted text-[length:var(--fs-xs)]">یا</span>
          <span className="h-px flex-1" style={{ background: "var(--border)" }} />
        </div>

        <p className="muted mt-6 text-center text-[length:var(--fs-xs)]">
          حساب ندارید؟{" "}
          <a href="/register" className="font-semibold underline underline-offset-4" style={{ color: "var(--brand)" }}>
            ثبت‌نام
          </a>
        </p>
      </div>

      <p className="muted mt-4 text-center text-[length:var(--fs-xs)]">ورود شما در سرور اعتبارسنجی می‌شود. نشست پس از خروج یا انقضا پایان می‌یابد.</p>
    </div>
  );
}
