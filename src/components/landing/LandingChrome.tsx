import Link from "next/link";
import BrandMark from "@/components/layout/BrandMark";
import ThemeToggleButton from "@/components/landing/ThemeToggleButton";
import { DownloadIosButton } from "@/components/pwa/IosInstallGuide";

export function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-wrap landing-header-inner">
        <Link href="/" className="landing-brand" aria-label="وِزان — سیستم‌عامل ثروت شخصی">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
            style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
          >
            <BrandMark size={20} />
          </span>
          <span className="min-w-0 leading-tight">
            <span className="block text-[15px] font-bold tracking-tight">وِزان</span>
            <span className="muted hidden text-[10px] sm:block">سیستم‌عامل ثروت شخصی</span>
          </span>
        </Link>
        <nav className="landing-header-nav" aria-label="ورود به محصول">
          <ThemeToggleButton />
          <span className="hidden sm:inline-flex">
            <DownloadIosButton className="!min-h-12 !px-3 text-[13px] sm:!px-4" variant="ghost" />
          </span>
          <Link href="/login" className="btn btn-ghost !min-h-12 !px-2.5 text-[13px] sm:!px-4">
            ورود
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
      <div className="landing-wrap flex flex-col gap-5 py-8 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <BrandMark size={18} style={{ color: "var(--brand)" }} />
            <span className="font-bold">وِزان</span>
          </div>
          <p className="sub mt-2 max-w-xs text-[13px] leading-6">سیستم‌عامل ثروت شخصی — آرام، خصوصی، دقیق.</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]" aria-label="پاورقی">
          <Link href="/about" className="sub hover:underline">
            درباره
          </Link>
          <Link href="/privacy" className="sub hover:underline">
            حریم خصوصی
          </Link>
          <Link href="/terms" className="sub hover:underline">
            شرایط
          </Link>
          <Link href="/login" className="sub hover:underline">
            ورود
          </Link>
        </nav>
      </div>
      <div className="landing-wrap border-t py-4 text-[12px]" style={{ borderColor: "var(--border)" }}>
        <p className="muted">© {new Date().getFullYear()} وِزان — سیستم‌عامل ثروت شخصی</p>
      </div>
    </footer>
  );
}
