"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import CommandPalette from "@/components/ui/CommandPalette";
import BrandMark from "@/components/layout/BrandMark";
import InstallPromotion, { usePwaInstallState } from "@/components/pwa/InstallPromotion";
import {
  NAV_GROUPS,
  SECONDARY_ITEMS,
  ADVANCED_ITEMS,
  MOBILE_TABS,
  QUICK_ACTIONS,
  isNavActive,
  isGroupActive,
  type NavItem,
  type NavGroup,
} from "@/lib/nav";

const MARKETING_PATHS = new Set(["/about", "/privacy", "/terms"]);

/* ───────────────────────── Theme ───────────────────────── */

function subscribeTheme(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

function ThemeToggle() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return (
    <button
      type="button"
      aria-label="تغییر حالت روشن و تاریک"
      className="icon-btn"
      style={{ touchAction: "manipulation" }}
      onClick={() => {
        const next = !dark;
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("pwos-theme", next ? "dark" : "light");
      }}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}

/* ───────────────────── Connectivity ────────────────────── */

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

function useOnline() {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

/* ─────────────────── Collapsed sidebar pref ────────────── */

const NAV_EVENT = "pwos-nav-change";

function subscribeNav(cb: () => void) {
  window.addEventListener(NAV_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(NAV_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

function useNavCollapsed() {
  return useSyncExternalStore(
    subscribeNav,
    () => localStorage.getItem("pwos-nav") === "collapsed",
    () => false,
  );
}

type ShellUser = {
  name: string;
  username: string | null;
  email: string | null;
  role: string;
};

function AccountLink({ user, compact = false }: { user: ShellUser | null; compact?: boolean }) {
  if (user) {
    const label = user.name || user.username || "حساب کاربری";
    return (
      <Link
        href="/settings"
        className={`inline-flex items-center gap-1.5 rounded-[var(--r-md)] text-[11.5px] font-medium ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}
        style={{ background: "var(--brand-soft)", color: "var(--brand)", touchAction: "manipulation" }}
        aria-label={`حساب کاربری ${label}`}
        title={user.email || user.username || label}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "var(--brand)", color: "var(--on-brand)" }}>
          {(user.username?.[0] || user.name?.[0] || "U").toUpperCase()}
        </span>
        {!compact && <span className="max-w-[110px] truncate">{label}</span>}
      </Link>
    );
  }

  return (
    <Link
      href="/login"
      className={`inline-flex items-center gap-1.5 rounded-[var(--r-md)] text-[11.5px] font-semibold ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}
      style={{ background: "var(--brand-soft)", color: "var(--brand)", touchAction: "manipulation" }}
      aria-label="ورود یا ساخت حساب کاربری"
    >
      <Icon name="lock" size={14} />
      {compact ? "ورود" : "ورود / ثبت‌نام"}
    </Link>
  );
}

/* ─────────────────── Desktop nav link ──────────────────── */

function SideLink({ item, active, collapsed }: { item: NavItem; active: boolean; collapsed: boolean }) {
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      data-tip={item.label}
      className={`nav-item nav-tip ${active ? "nav-active" : ""} ${collapsed ? "justify-center !px-0 !py-2.5" : ""}`}
      style={{ touchAction: "manipulation" }}
    >
      <Icon name={item.icon} size={19} className="shrink-0" />
      {!collapsed && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

/* ───────────── Collapsible domain group (desktop sidebar) ─────────────
   Large domains (پول، دارایی‌ها، بدهی، ثروت، برنامه‌ریزی) collapse so the
   sidebar stays low-noise. The open/closed choice is remembered per device.
   Purely presentational — navigation never triggers a financial mutation.
   ──────────────────────────────────────────────────────────────────── */

const GROUP_PREF_KEY = "pwos-nav-groups";

/**
 * The raw preference string is the external store snapshot. Keeping it a
 * primitive (not a parsed object) is required: useSyncExternalStore compares
 * snapshots by identity, so returning a fresh object each call would loop.
 */
function getGroupPrefsRaw(): string {
  try {
    return localStorage.getItem(GROUP_PREF_KEY) ?? "";
  } catch {
    return "";
  }
}

function useGroupPrefs(): Record<string, boolean> {
  const raw = useSyncExternalStore(subscribeNav, getGroupPrefsRaw, () => "");
  return useMemo(() => {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as Record<string, boolean>;
    } catch {
      return {};
    }
  }, [raw]);
}

function NavGroupBlock({
  group,
  pathname,
  collapsed,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
}) {
  const groupActive = isGroupActive(pathname, group);
  const prefs = useGroupPrefs();

  // Simple groups (خانه، بینش‌ها، گزارش‌ها) render as plain links.
  if (!group.collapsible) {
    return (
      <div role="group" aria-label={group.label}>
        {!collapsed ? (
          <div className="nav-group-label">{group.label}</div>
        ) : (
          <div className="mx-4 my-2 border-t" style={{ borderColor: "var(--border)" }} />
        )}
        <div className="space-y-0.5">
          {group.items.map((n) => (
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed={collapsed} />
          ))}
        </div>
      </div>
    );
  }

  // A collapsed rail has no room for group chrome — show the items directly.
  if (collapsed) {
    return (
      <div role="group" aria-label={group.label}>
        <div className="mx-4 my-2 border-t" style={{ borderColor: "var(--border)" }} />
        <div className="space-y-0.5">
          {group.items.map((n) => (
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed />
          ))}
        </div>
      </div>
    );
  }

  // Default: open when the user is inside the domain, otherwise closed.
  const open = group.id in prefs ? prefs[group.id] : groupActive;
  const panelId = `nav-group-${group.id}`;

  const toggle = () => {
    const next = { ...prefs, [group.id]: !open };
    try {
      localStorage.setItem(GROUP_PREF_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — the sidebar simply keeps its default state */
    }
    window.dispatchEvent(new CustomEvent(NAV_EVENT));
  };

  return (
    <div role="group" aria-label={group.label}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className="nav-group-toggle"
        style={{ touchAction: "manipulation" }}
      >
        {group.icon && (
          <Icon
            name={group.icon}
            size={16}
            className="shrink-0"
            style={groupActive ? { color: "var(--brand)" } : undefined}
          />
        )}
        <span className="flex-1 text-right" style={groupActive ? { color: "var(--brand)" } : undefined}>
          {group.label}
        </span>
        <Icon name="chevronDown" size={14} className={`shrink-0 nav-chevron ${open ? "nav-chevron-open" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="space-y-0.5 pb-1">
          {group.items.map((n) => (
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed={false} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Mobile More ───────────────────── */

function MoreSheet({ open, onClose, pathname, authUser }: { open: boolean; onClose: () => void; pathname: string; authUser: ShellUser | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="بیشتر">
      <nav className="px-2 pb-5 pt-1" aria-label="همه بخش‌ها">
        <div className="mb-3 rounded-[var(--r-md)] border p-2" style={{ borderColor: "var(--border)" }}>
          <AccountLink user={authUser} />
          {!authUser && <p className="muted mt-1.5 px-1 text-[10.5px]">ورود برای مدیریت نرخ ارز و مالکیت داده‌ها</p>}
        </div>
        <div className="nav-group-label">اقدامات سریع</div>
        <div className="mb-1 grid grid-cols-3 gap-1.5 px-2">
          {QUICK_ACTIONS.slice(0, 3).map((a) => (
            <Link
              key={a.href}
              href={a.href}
              onClick={onClose}
              className="soft flex flex-col items-center gap-1.5 rounded-[var(--r-md)] px-2 py-3 text-[11px] font-medium"
              style={{ color: "var(--text-2)", touchAction: "manipulation" }}
            >
              <span style={{ color: "var(--brand)" }}>
                <Icon name={a.icon} size={17} />
              </span>
              {a.label}
            </Link>
          ))}
        </div>
        {NAV_GROUPS.map((g) => (
          <div key={g.id}>
            <div className="nav-group-label">{g.label}</div>
            <ul>
              {g.items.map((n) => {
                const active = isNavActive(pathname, n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={onClose}
                      className="flex min-h-11 items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5 text-[13.5px]"
                      style={
                        active
                          ? { background: "var(--brand-soft)", color: "var(--brand)", fontWeight: 600, touchAction: "manipulation" }
                          : { color: "var(--text-2)", touchAction: "manipulation" }
                      }
                    >
                      <Icon name={n.icon} size={18} />
                      <span className="flex-1">{n.label}</span>
                      {active && <Icon name="check" size={15} />}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
        <div className="nav-group-label">سیستم</div>
        <ul>
          {SECONDARY_ITEMS.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onClose}
                className="flex min-h-11 items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5 text-[13.5px]"
                style={{ color: "var(--text-2)", touchAction: "manipulation" }}
              >
                <Icon name={n.icon} size={18} />
                {n.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* Accounting-grade views stay available but deliberately de-emphasised. */}
        <div className="nav-group-label">پیشرفته</div>
        <ul>
          {ADVANCED_ITEMS.map((n) => (
            <li key={n.href}>
              <Link
                href={n.href}
                onClick={onClose}
                className="flex min-h-11 items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5 text-[13.5px]"
                style={{ color: "var(--text-2)", touchAction: "manipulation" }}
              >
                <Icon name={n.icon} size={18} />
                <span className="flex-1">{n.label}</span>
                {isNavActive(pathname, n.href) && <Icon name="check" size={15} />}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </Sheet>
  );
}

/* ───────────────────────── Shell ───────────────────────── */

export default function Shell({
  children,
  authUser = null,
  publicHome = false,
}: {
  children: ReactNode;
  authUser?: ShellUser | null;
  publicHome?: boolean;
}) {
  const pathname = usePathname();
  const collapsed = useNavCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const online = useOnline();
  const pwa = usePwaInstallState();

  // Global keyboard: ⌘K / Ctrl+K → command palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (pathname === "/login" || pathname === "/register" || pathname === "/about" || pathname === "/privacy" || pathname === "/terms") return;
      if (pathname === "/" && publicHome) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pathname, publicHome]);

  // PWA service worker: production always; preview HTTPS too. Skip localhost so HMR stays intact.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const host = window.location.hostname;
    const isLocal = host === "localhost" || host === "127.0.0.1";
    if (process.env.NODE_ENV !== "production" && isLocal) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);

  const toggleCollapse = () => {
    localStorage.setItem("pwos-nav", collapsed ? "expanded" : "collapsed");
    window.dispatchEvent(new CustomEvent(NAV_EVENT));
  };

  const moreActive = !MOBILE_TABS.some((t) =>
    t.match ? t.match.some((m) => (m === "/" ? pathname === "/" : isNavActive(pathname, m))) : false,
  );

  const isAuthRoute = pathname === "/login" || pathname === "/register";
  const isMarketing = MARKETING_PATHS.has(pathname);
  const isLanding = pathname === "/" && publicHome;
  const isPublicChrome = isAuthRoute || isMarketing || isLanding;

  return (
    <div
      className="min-h-dvh"
      style={{ ["--nav-w" as never]: isPublicChrome ? "0px" : collapsed ? "76px" : "264px" }}
    >
      {/* Offline banner — trust first: never lose context */}
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 px-4 py-1.5 text-[11.5px] font-medium"
          style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
        >
          <Icon name="alert" size={14} />
          اتصال اینترنت قطع است — داده‌های ذخیره‌شده نمایش داده می‌شود و تغییرات پس از اتصال ثبت می‌شوند.
        </div>
      )}

      {/* ───────────── Desktop sidebar (hidden on public/marketing/auth) ───────────── */}
      {!isPublicChrome && (
      <aside
        className={`fixed inset-y-0 right-0 z-40 hidden flex-col border-l transition-[width] duration-200 lg:flex ${collapsed ? "nav-collapsed w-[76px]" : "w-[264px]"}`}
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        aria-label="ناوبری اصلی"
      >
        {/* Brand + collapse — برند «وِزان» */}
        <div className={`flex items-center gap-2 px-4 pb-2 pt-4 ${collapsed ? "justify-center !px-2" : "justify-between"}`}>
          <Link
            href="/"
            className={`flex items-center gap-2.5 rounded-[10px] px-1 py-1 ${collapsed ? "justify-center" : ""}`}
            style={{ touchAction: "manipulation" }}
            aria-label="وِزان — صفحه اصلی"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
              style={{ background: "var(--brand-soft)", color: "var(--brand)" }}
            >
              <BrandMark size={22} />
            </span>
            {!collapsed && (
              <span className="leading-tight">
                <span className="block text-[15px] font-bold tracking-tight">وِزان</span>
                <span className="muted block text-[10px]">سیستم‌عامل ثروت شخصی</span>
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={toggleCollapse}
            className="icon-btn !min-h-8 !min-w-8"
            aria-label={collapsed ? "باز کردن ناوبری" : "جمع کردن ناوبری"}
            aria-expanded={!collapsed}
            style={{ touchAction: "manipulation" }}
          >
            <Icon name={collapsed ? "chevronLeft" : "chevronRight"} size={16} />
          </button>
        </div>

        {/* Command trigger */}
        <div className="px-3 pb-2 pt-1">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className={`flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-[12.5px] transition-colors ${
              collapsed ? "justify-center !px-0" : ""
            }`}
            style={{ borderColor: "var(--border)", color: "var(--text-3)", background: "var(--sunken)", touchAction: "manipulation" }}
            aria-label="مرکز فرمان — جستجو و اقدام سریع"
            aria-keyshortcuts="Control+K Meta+K"
          >
            <Icon name="search" size={15} />
            {!(collapsed) && (
              <>
                <span className="flex-1 text-right">جستجو یا فرمان…</span>
                <span className="flex gap-0.5" dir="ltr">
                  <kbd className="kbd">⌘</kbd>
                  <kbd className="kbd">K</kbd>
                </span>
              </>
            )}
          </button>
        </div>

        {/* Groups */}
        <nav className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="بخش‌های اصلی">
          {NAV_GROUPS.map((g) => (
            <NavGroupBlock key={g.id} group={g} pathname={pathname} collapsed={collapsed} />
          ))}
        </nav>

        {/* Bottom cluster */}
        <div className="border-t px-1.5 py-2" style={{ borderColor: "var(--border)" }}>
          {SECONDARY_ITEMS.map((n) => (
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed={collapsed} />
          ))}
          <div className={`mt-1.5 flex items-center gap-1.5 px-1.5 ${collapsed ? "flex-col" : ""}`}>
            <AccountLink user={authUser} compact={collapsed} />
            <ThemeToggle />
            <Link
              href="/new"
              className={`btn btn-primary flex-1 !text-[12.5px] ${collapsed ? "!w-11 !px-0" : ""}`}
              aria-label="ثبت تراکنش جدید"
              style={{ touchAction: "manipulation" }}
            >
              <Icon name="plus" size={16} />
              {!(collapsed) && "ثبت تراکنش"}
            </Link>
          </div>
        </div>
      </aside>
      )}

      {/* ───────────── Mobile top bar (app only) ───────────── */}
      {!isPublicChrome && (
      <header
        className="sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 backdrop-blur-xl lg:hidden"
        style={{
          background: "color-mix(in oklab, var(--bg) 82%, transparent)",
          borderBottom: "1px solid var(--border)",
          paddingTop: "max(0.625rem, env(safe-area-inset-top))",
        }}
      >
        <Link href="/" className="flex items-center gap-2" style={{ touchAction: "manipulation" }} aria-label="وِزان">
          <BrandMark size={22} style={{ color: "var(--brand)" }} />
          <span className="text-[15px] font-bold tracking-tight">وِزان</span>
        </Link>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="جستجو و فرمان" style={{ touchAction: "manipulation" }}>
            <Icon name="search" size={18} />
          </button>
          <AccountLink user={authUser} compact />
          <ThemeToggle />
          <Link href="/new" className="btn btn-primary !min-h-9 !px-3 !py-1.5 !text-[12px]" aria-label="ثبت تراکنش جدید" style={{ touchAction: "manipulation" }}>
            <Icon name="plus" size={15} />
            ثبت
          </Link>
        </div>
      </header>
      )}

      {/* ───────────── Content ───────────── */}
      <main
        id="main"
        className={
          isLanding || isMarketing
            ? "w-full max-w-none p-0"
            : `mx-auto w-full max-w-[1180px] px-4 pt-4 transition-[padding] duration-200 sm:px-6 ${
                isAuthRoute ? "pb-8 lg:pb-10 lg:px-6 lg:pt-8" : "pb-28 lg:pb-16 lg:pl-10 lg:pr-[var(--nav-w)] lg:pt-7"
              }`
        }
      >
        {children}
        {!isPublicChrome && pwa.show && (
          <InstallPromotion ios={pwa.ios} canPrompt={pwa.canPrompt} onInstall={() => void pwa.install()} onDismiss={pwa.dismiss} />
        )}
      </main>

      {/* ───────────── Mobile bottom nav (app only — never on landing/auth/legal) ───────────── */}
      {!isPublicChrome && (
      <nav
        className="fixed inset-x-0 bottom-0 z-40 lg:hidden"
        aria-label="ناوبری اصلی موبایل"
        style={{
          background: "color-mix(in oklab, var(--surface) 92%, transparent)",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "max(0.35rem, env(safe-area-inset-bottom))",
          touchAction: "manipulation",
        }}
      >
        <div className="grid grid-cols-5 px-1.5 pt-1.5">
          {MOBILE_TABS.map((t) => {
            const active = t.match!.some((m) => (m === "/" ? pathname === "/" : isNavActive(pathname, m)));
            return (
              <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`tab-item ${active ? "tab-active" : ""}`} style={{ touchAction: "manipulation" }}>
                <Icon name={t.icon as IconName} size={21} strokeWidth={active ? 2 : 1.7} />
                {t.label}
              </Link>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-label="بیشتر"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            className={`tab-item ${moreActive ? "tab-active" : ""}`}
            style={{ touchAction: "manipulation" }}
          >
            <Icon name="more" size={21} />
            بیشتر
          </button>
        </div>
      </nav>
      )}

      {!isPublicChrome && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} authUser={authUser} />}
      {!isPublicChrome && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
