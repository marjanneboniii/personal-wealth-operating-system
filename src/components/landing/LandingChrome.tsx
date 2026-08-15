import Link from "next/link";
import BrandMark from "@/components/layout/BrandMark";
import ThemeToggleButton from "@/components/landing/ThemeToggleButton";

export function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-wrap flex items-center justify-between gap-3 py-3">
        <Link href="/" className="flex min-h-12 items-center gap-2" aria-label="وِزان — صفحه معرفی">
          <span
            className="flex h-9 w-9 items-center justify-center rounded-[10px]"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
          >
            <BrandMark size={20} />
          </span>
          <span className="leading-tight">
            <span className="block text-[15px] font-bold tracking-tight">وِزان</span>
            <span className="muted hidden text-[10px] sm:block">سیستم‌عامل ثروت شخصی</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-2" aria-label="ورود به محصول">
          <ThemeToggleButton />
          <Link href="/login" className="btn btn-ghost !min-h-12 !px-3 text-[13px] sm:!px-4">
            ورود به سیستم
          </Link>
          <Link href="/register" className="btn btn-primary !min-h-12 !px-3 text-[13px] sm:!px-4">
            ایجاد حساب
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      <div className="landing-wrap grid gap-8 py-10 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark size={18} style={{ color: "var(--brand)" }} />
            <span className="font-bold">وِزان</span>
          </div>
          <p className="sub mt-3 max-w-xs text-[13px] leading-6">
            هسته مالی خصوصی برای دیدن و مدیریت ثروت شخصی — دارایی، نقدینگی، تراکنش و ارزش خالص.
          </p>
        </div>
        <div>
          <p className="type-label mb-3">محصول</p>
          <ul className="space-y-2 text-[13px]">
            <li>
              <Link href="/about" className="sub hover:underline">
                درباره ما
              </Link>
            </li>
            <li>
              <Link href="/login" className="sub hover:underline">
                ورود به سیستم
              </Link>
            </li>
            <li>
              <Link href="/register" className="sub hover:underline">
                ایجاد حساب
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="type-label mb-3">حقوقی</p>
          <ul className="space-y-2 text-[13px]">
            <li>
              <Link href="/privacy" className="sub hover:underline">
                حریم خصوصی
              </Link>
            </li>
            <li>
              <Link href="/terms" className="sub hover:underline">
                شرایط استفاده
              </Link>
            </li>
          </ul>
        </div>
        <div>
          <p className="type-label mb-3">ارتباط</p>
          <p className="sub text-[13px] leading-6">
            لینک شبکه‌های اجتماعی رسمی هنوز در این نسخه پیکربندی نشده است. پس از تعیین نشانی واقعی، اینجا نمایش داده می‌شود.
          </p>
        </div>
      </div>
      <div className="landing-wrap border-t py-4 text-[12px]" style={{ borderColor: "var(--border)" }}>
        <p className="muted">© {new Date().getFullYear()} وِزان — سیستم‌عامل ثروت شخصی</p>
      </div>
    </footer>
  );
}
