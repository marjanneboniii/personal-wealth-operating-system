import Link from "next/link";
import BrandMark, { BrandWordmark } from "@/components/layout/BrandMark";
import ThemeToggleButton from "@/components/landing/ThemeToggleButton";
import { DownloadIosButton } from "@/components/pwa/IosInstallGuide";

export function LandingHeader() {
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand" aria-label="توازن — سیستم‌عامل ثروت شخصی">
          <BrandMark framed size={34} />
          <div className="flex flex-col">
            <BrandWordmark className="text-[1.05rem] font-extrabold tracking-tight" />
            <span className="text-[0.65rem] font-medium text-[var(--slate-500)] hidden sm:block">
              سیستم‌عامل ثروت شخصی
            </span>
          </div>
        </Link>

        <nav className="main-nav" aria-label="ناوبری اصلی">
          <a href="#modules">قابلیت‌ها</a>
          <a href="#insights">راهنما و بینش‌ها</a>
          <Link href="/watch">تور تعاملی</Link>
          <Link href="/about">درباره ما</Link>
        </nav>

        <div className="header-actions">
          <ThemeToggleButton />
          <Link href="/login" className="btn btn-ghost">
            ورود
          </Link>
          <Link href="/register" className="btn btn-primary">
            شروع رایگان
          </Link>
        </div>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <Link href="/" className="brand" aria-label="توازن">
          <BrandMark framed size={28} />
          <span className="text-[0.95rem] font-bold">توازن</span>
        </Link>
        <nav className="flex items-center gap-4 text-[0.8rem] text-[var(--slate-500)]" aria-label="پیوندهای پاورقی">
          <Link href="/about" className="hover:text-[var(--sky-700)]">
            درباره
          </Link>
          <Link href="/privacy" className="hover:text-[var(--sky-700)]">
            حریم خصوصی
          </Link>
          <Link href="/terms" className="hover:text-[var(--sky-700)]">
            شرایط استفاده
          </Link>
          <Link href="/watch" className="hover:text-[var(--sky-700)]">
            تور توازن
          </Link>
        </nav>
        <p className="footer-note">© ۱۴۰۵ توازن — همهٔ حقوق برای حفظ محرمانگی داده‌ها محفوظ است.</p>
      </div>
    </footer>
  );
}
