import Link from "next/link";
import BrandMark, { BrandWordmark } from "@/components/layout/BrandMark";
import ThemeToggleButton from "@/components/landing/ThemeToggleButton";
import { DownloadIosButton } from "@/components/pwa/IosInstallGuide";

export function LandingHeader() {
  return (
    <header className="landing-header landing-ink">
      <div className="landing-wrap landing-header-inner">
        <Link href="/" className="landing-brand" aria-label="توازن — سیستم‌عامل ثروت شخصی">
          <BrandMark size={28} style={{ color: "var(--l-accent)" }} />
          <span className="min-w-0 leading-tight">
            <BrandWordmark className="block text-[length:var(--fs-md)] text-[color:var(--l-text)]" />
            <span className="landing-on-primary-muted hidden text-[length:var(--fs-xs)] sm:block">سیستم‌عامل ثروت شخصی</span>
          </span>
        </Link>
        <nav className="landing-header-nav" aria-label="ورود به محصول">
          <ThemeToggleButton />
          <span className="hidden sm:inline-flex">
            <DownloadIosButton className="!min-h-12 !px-3 text-[length:var(--fs-sm)] sm:!px-4" variant="ghost" />
          </span>
          <Link href="/login" className="btn btn-ghost !min-h-12 !px-2.5 text-[length:var(--fs-sm)] sm:!px-4">
            ورود
          </Link>
          <Link href="/register" className="btn btn-primary !min-h-12 !px-3 text-[length:var(--fs-sm)] sm:!px-4">
            ایجاد حساب
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function LandingFooter() {
  return (
    <footer className="landing-footer landing-ink">
      <div className="landing-wrap flex flex-col gap-6 py-9 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2" style={{ color: "var(--l-accent)" }}>
            <BrandMark size={22} />
            <BrandWordmark className="text-[length:var(--fs-md)] text-[color:var(--l-text)]" />
          </div>
          <p className="sub mt-2.5 max-w-xs text-[length:var(--fs-sm)] leading-7">سیستم‌عامل ثروت شخصی — آرام، خصوصی، دقیق.</p>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[length:var(--fs-sm)]" aria-label="پاورقی">
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
      <div className="landing-wrap border-t py-4 text-[length:var(--fs-xs)]">
        <p className="muted">© {new Date().getFullYear()} توازن — سیستم‌عامل ثروت شخصی</p>
      </div>
    </footer>
  );
}
