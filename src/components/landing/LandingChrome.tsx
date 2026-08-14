"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import BrandMark from "@/components/layout/BrandMark";
import ThemeToggleButton from "@/components/landing/ThemeToggleButton";
import Icon from "@/components/ui/Icon";

const NAV_LINKS = [
  { href: "#product", label: "محصول" },
  { href: "#features", label: "امکانات" },
  { href: "#how", label: "نحوه کار" },
  { href: "#about", label: "درباره تراز" },
];

/**
 * Mobile navigation — native <details> disclosure so it works with zero JS.
 * The tiny client script only adds polish: close on outside click, Esc or
 * after choosing a destination.
 */
function MobileNav() {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const close = () => el.removeAttribute("open");
    const onDocClick = (e: MouseEvent) => {
      if (!el.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <details ref={ref} className="ld-burger">
      <summary className="ld-burger-btn" aria-label="باز کردن منوی اصلی">
        <span />
        <span />
        <span />
      </summary>
      <nav className="ld-menu" aria-label="بخش‌های سایت">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} onClick={() => ref.current?.removeAttribute("open")}>
            {l.label}
          </Link>
        ))}
        <div className="ld-menu-divider" />
        <Link href="/login" onClick={() => ref.current?.removeAttribute("open")}>
          <Icon name="lock" size={16} />
          ورود به حساب
        </Link>
        <Link href="/register" className="ld-menu-cta" onClick={() => ref.current?.removeAttribute("open")}>
          <Icon name="arrow-start" size={16} />
          شروع مدیریت مالی
        </Link>
      </nav>
    </details>
  );
}

export function LandingHeader() {
  return (
    <header className="landing-header">
      <div className="landing-wrap landing-header-inner">
        <Link href="/" className="ld-logo" aria-label="تراز — سیستم‌عامل ثروت شخصی">
          <span className="ld-logo-tile">
            <BrandMark size={22} />
          </span>
          <span className="leading-tight">
            <span className="ld-logo-name block">تراز</span>
            <span className="ld-logo-tag hidden sm:block">سیستم‌عامل ثروت شخصی</span>
          </span>
        </Link>

        <nav className="ld-nav" aria-label="بخش‌های سایت">
          {NAV_LINKS.map((l) => (
            <Link key={l.href} href={l.href}>
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <span className="ld-theme-wrap">
            <ThemeToggleButton />
          </span>
          <Link href="/login" className="btn btn-ghost hidden !min-h-12 !px-3.5 text-[13px] sm:inline-flex">
            ورود
          </Link>
          <Link href="/register" className="btn btn-primary !min-h-12 !px-3.5 text-[13px] sm:!px-5">
            <span className="hidden min-[380px]:inline">شروع مدیریت مالی</span>
            <span className="min-[380px]:hidden">شروع</span>
          </Link>
          <MobileNav />
        </div>
      </div>
    </header>
  );
}

const FOOT_PRODUCT = [
  { href: "/", label: "داشبورد" },
  { href: "/transactions", label: "تراکنش‌ها" },
  { href: "/portfolio", label: "دارایی‌ها" },
  { href: "/reports", label: "گزارش‌ها" },
];

const FOOT_INFO = [
  { href: "/about", label: "درباره تراز" },
  { href: "/privacy", label: "حریم خصوصی" },
  { href: "/terms", label: "شرایط استفاده" },
];

function FootLinks({ items }: { items: { href: string; label: string }[] }) {
  return (
    <ul>
      {items.map((l) => (
        <li key={l.href + l.label}>
          <Link href={l.href}>{l.label}</Link>
        </li>
      ))}
    </ul>
  );
}

export function LandingFooter() {
  return (
    <footer className="landing-footer">
      {/* Desktop columns */}
      <div className="landing-wrap ld-foot-grid">
        <div className="ld-foot-col ld-foot-brand">
          <Link href="/" className="ld-logo" aria-label="تراز">
            <span className="ld-logo-tile !h-9 !w-9">
              <BrandMark size={20} />
            </span>
            <span className="ld-logo-name !text-[15px]">تراز</span>
          </Link>
          <p>مدیریت مالی شخصی با نگاه کامل به پول، دارایی و ثروت — از هر تراکنش تا تصویر کامل ثروت.</p>
        </div>
        <div className="ld-foot-col">
          <h4>محصول</h4>
          <FootLinks items={FOOT_PRODUCT} />
        </div>
        <div className="ld-foot-col">
          <h4>اطلاعات</h4>
          <FootLinks items={FOOT_INFO} />
        </div>
        <div className="ld-foot-col">
          <h4>ارتباط</h4>
          <p className="text-[0.8rem] leading-7" style={{ color: "var(--text-3)" }}>
            راه‌های ارتباطی رسمی هنوز در این نسخه پیکربندی نشده است؛ پس از تعیین نشانی واقعی، همین‌جا نمایش داده می‌شود.
          </p>
        </div>
      </div>

      {/* Mobile accordion (native <details> — zero JS) */}
      <div className="landing-wrap ld-foot-acc">
        <details>
          <summary>محصول</summary>
          <FootLinks items={FOOT_PRODUCT} />
        </details>
        <details>
          <summary>اطلاعات</summary>
          <FootLinks items={FOOT_INFO} />
        </details>
        <details>
          <summary>ارتباط</summary>
          <p className="pb-3 text-[0.82rem] leading-7" style={{ color: "var(--text-3)" }}>
            راه‌های ارتباطی رسمی هنوز در این نسخه پیکربندی نشده است؛ پس از تعیین نشانی واقعی، همین‌جا نمایش داده می‌شود.
          </p>
        </details>
      </div>

      <div className="landing-wrap ld-foot-bottom">
        <p>© {new Date().getFullYear()} تراز — سیستم‌عامل ثروت شخصی</p>
        <div className="ld-foot-links">
          <Link href="/privacy">حریم خصوصی</Link>
          <Link href="/terms">شرایط استفاده</Link>
        </div>
      </div>
    </footer>
  );
}
