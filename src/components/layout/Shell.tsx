"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const NAV = [
  { href: "/", label: "داشبورد", icon: "◎" },
  { href: "/portfolio", label: "سبد دارایی", icon: "◈" },
  { href: "/ledger", label: "دفترکل", icon: "≡" },
  { href: "/planning", label: "برنامه‌ریزی", icon: "◷" },
  { href: "/reports", label: "گزارش‌ها", icon: "▤" },
];

const MORE = [
  { href: "/debts", label: "بدهی و اقساط", icon: "⚖" },
  { href: "/accounts", label: "حساب‌ها و کیف‌پول‌ها", icon: "▣" },
  { href: "/settings", label: "تنظیمات و پشتیبان", icon: "⚙" },
];

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);
  return (
    <button
      aria-label="تغییر حالت روشن و تاریک"
      className="btn btn-ghost !min-h-10 !px-3 !py-2"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("pwos-theme", next ? "dark" : "light");
      }}
    >
      <span className="text-base">{dark ? "☀" : "☾"}</span>
    </button>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const all = [...NAV, ...MORE];

  return (
    <div className="min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex fixed inset-y-0 right-0 w-64 flex-col gap-1 border-l p-4" style={{ background: "var(--bg-elev)" }}>
        <div className="mb-6 px-2 pt-2">
          <div className="text-lg font-bold tracking-tight">PWOS</div>
          <div className="muted text-[11px]">سیستم‌عامل ثروت شخصی</div>
        </div>
        {all.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-sm transition"
            style={
              isActive(n.href)
                ? { background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 }
                : undefined
            }
          >
            <span className="w-5 text-center opacity-70">{n.icon}</span>
            {n.label}
          </Link>
        ))}
        <div className="mt-auto flex items-center justify-between px-2">
          <ThemeToggle />
          <Link href="/new" className="btn btn-primary !min-h-10 !py-2 text-xs">
            ثبت تراکنش
          </Link>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-3 backdrop-blur-xl" style={{ background: "color-mix(in oklab, var(--bg) 80%, transparent)" }}>
        <div>
          <div className="text-base font-bold tracking-tight">PWOS</div>
          <div className="muted text-[10px]">سیستم‌عامل ثروت شخصی</div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/new" className="btn btn-primary !min-h-10 !py-2 !px-4 text-xs">
            + ثبت
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-2 lg:pr-72 lg:pt-8 lg:pb-16">{children}</main>

      {/* Mobile bottom nav */}
      <nav
        className="lg:hidden fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 gap-1 border-t px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl"
        style={{ background: "color-mix(in oklab, var(--bg-elev) 88%, transparent)" }}
      >
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            aria-label={n.label}
            className="flex flex-col items-center gap-1 rounded-2xl py-1.5 text-[10px]"
            style={isActive(n.href) ? { color: "var(--accent)", fontWeight: 600 } : { color: "var(--fg-muted)" }}
          >
            <span className="text-lg leading-none">{n.icon}</span>
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
