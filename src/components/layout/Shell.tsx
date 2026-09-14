"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import Icon, { type IconName } from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import CommandPalette from "@/components/ui/CommandPalette";
import BrandMark, { BrandWordmark } from "@/components/layout/BrandMark";
import InstallPromotion, { usePwaInstallState } from "@/components/pwa/InstallPromotion";
import {
  NAV_GROUPS,
  SECONDARY_ITEMS,
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
    const isAdmin = user.role === "owner" || user.role === "admin";
    return (
      <span className="inline-flex items-center gap-1.5">
      {isAdmin && (
        <Link
          href="/admin"
          className={`inline-flex items-center rounded-[var(--r-md)] text-[length:var(--fs-xs)] font-medium ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}
          style={{ background: "var(--sunken)", color: "var(--text)", touchAction: "manipulation" }}
          aria-label="پنل مدیریت کاربران"
          title="پنل مدیریت کاربران"
        >
          مدیریت
        </Link>
      )}
      <Link
        href="/settings"
        className={`inline-flex items-center gap-1.5 rounded-[var(--r-md)] text-[length:var(--fs-xs)] font-medium ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}
        style={{ background: "var(--action-soft)", color: "var(--action)", touchAction: "manipulation" }}
        aria-label={`حساب کاربری ${label}`}
        title={user.email || user.username || label}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full text-[length:var(--fs-xs)] font-bold" style={{ background: "var(--action)", color: "var(--on-ink)" }}>
          {(user.username?.[0] || user.name?.[0] || "U").toUpperCase()}
        </span>
        {!compact && <span className="max-w-[110px] truncate">{label}</span>}
      </Link>
      </span>
    );
  }

  return (
    <Link
      href="/login"
      className={`inline-flex items-center gap-1.5 rounded-[var(--r-md)] text-[length:var(--fs-xs)] font-semibold ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}
      style={{ background: "var(--action-soft)", color: "var(--action)", touchAction: "manipulation" }}
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

  const moduleClass = "nav-group";

  // Simple groups (خانه، بینش‌ها، گزارش‌ها) render as plain links.
  if (!group.collapsible) {
    return (
      <div role="group" aria-label={group.label} className={moduleClass}>
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
      <div role="group" aria-label={group.label} className={moduleClass}>
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
    <div role="group" aria-label={group.label} className={moduleClass}>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={panelId}
        className={`nav-group-toggle ${groupActive ? "is-active" : ""}`}
        style={{ touchAction: "manipulation" }}
      >
        {group.icon && (
          <Icon
            name={group.icon}
            size={16}
            className="shrink-0"
          />
        )}
        <span className="flex-1 text-right">
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
    <Sheet open={open} onClose={onClose} title="همه بخش‌ها">
      {/* Sections are tile grids, three across: the whole app fits in about
          one screen instead of a long list that had to be scrolled. */}
      <nav className="more-sheet" aria-label="همه بخش‌ها">
        <div className="more-profile">
          <AccountLink user={authUser} />
          {!authUser && <p className="muted min-w-0 flex-1 text-[length:var(--fs-xs)]">برای مدیریت داده‌ها وارد شوید</p>}
        </div>

        <div className="more-quick">
          {QUICK_ACTIONS.slice(0, 3).map((a) => (
            <Link key={a.href} href={a.href} onClick={onClose}>
              <Icon name={a.icon} size={15} />
              <span className="truncate">{a.label.replace("انتقال بین حساب‌ها", "انتقال")}</span>
            </Link>
          ))}
        </div>

        {/* «خانه» is already a bottom tab. */}
        {NAV_GROUPS.filter((g) => g.id !== "home").map((g) => (
          <section key={g.id} aria-label={g.label}>
            <h3 className="more-group-title">{g.label}</h3>
            <ul className="more-grid">
              {g.items.map((n) => {
                const active = isNavActive(pathname, n.href);
                return (
                  <li key={n.href}>
                    <Link
                      href={n.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      className={`more-tile${active ? " is-active" : ""}`}
                    >
                      <span className="more-tile-icon">
                        <Icon name={n.icon} size={18} />
                      </span>
                      {n.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        {/* Setup and settings: one quiet list at the end. */}
        <section aria-label="سیستم">
          <h3 className="more-group-title">سیستم</h3>
          <ul className="more-list">
            {SECONDARY_ITEMS.map((n) => {
              const active = isNavActive(pathname, n.href);
              return (
                <li key={n.href}>
                  <Link href={n.href} onClick={onClose} aria-current={active ? "page" : undefined}>
                    <Icon name={n.icon} size={17} />
                    <span className="flex-1">{n.label}</span>
                    {active ? <Icon name="check" size={15} /> : <Icon name="chevronLeft" size={14} />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
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
  const [quickOpen, setQuickOpen] = useState(false);
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

  // Bottom-tab sync (presentation only): «بیشتر» is active only when NONE of
  // the real tabs matches the current page, so the highlight always follows
  // the page the user is on (money → /transactions·/accounts·/cash-flow,
  // assets → /assets·/portfolio·/crypto·/asset-registry, …).
  const anyTabActive = MOBILE_TABS.some((t) =>
    t.match?.some((m) => (m === "/" ? pathname === "/" : isNavActive(pathname, m))),
  );
  const moreActive = !anyTabActive;

  const isAuthRoute = pathname === "/login" || pathname === "/register";
  const isMarketing = MARKETING_PATHS.has(pathname);
  const isLanding = pathname === "/" && publicHome;
  const isPublicChrome = isAuthRoute || isMarketing || isLanding;
  // Initial setup is mandatory and focused: no app navigation while on it.
  const hideAppNav = isPublicChrome || pathname === "/setup";

  return (
    <div
      className="shell-root min-h-dvh"
      data-chrome={isPublicChrome ? "public" : "app"}
      style={{ ["--nav-w" as never]: hideAppNav ? "0px" : collapsed ? "76px" : "264px" }}
    >
      {/* Offline banner — trust first: never lose context */}
      {!online && (
        <div
          role="status"
          aria-live="polite"
          className="offline-banner fixed inset-x-0 top-0 z-[70] flex items-center justify-center gap-2 px-4 py-1.5 text-[length:var(--fs-xs)] font-medium"
          style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
        >
          <Icon name="alert" size={14} />
          اتصال اینترنت برقرار نیست — اطلاعات مالی شما عمداً در حافظه آفلاین ذخیره نشده است.
        </div>
      )}

      {/* ───────────── Desktop sidebar (hidden on public/marketing/auth) ───────────── */}
      {!hideAppNav && (
      <aside
        className={`desktop-sidebar fixed inset-y-0 right-0 z-40 hidden flex-col border-l transition-[width] duration-200 lg:flex ${collapsed ? "nav-collapsed w-[76px]" : "w-[264px]"}`}
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        aria-label="ناوبری اصلی"
      >
        {/* Brand + collapse — برند «توازن» */}
        <div className={`flex items-center gap-2 px-4 pb-2 pt-4 ${collapsed ? "justify-center !px-2" : "justify-between"}`}>
          <Link
            href="/"
            className={`flex items-center gap-2.5 rounded-[10px] px-1 py-1 ${collapsed ? "justify-center" : ""}`}
            style={{ touchAction: "manipulation" }}
            aria-label="توازن — صفحه اصلی"
          >
            <BrandMark size={36} framed />
            {!collapsed && (
              <span className="leading-tight">
                <BrandWordmark className="block text-[length:var(--fs-md)]" />
                <span className="muted block text-[length:var(--fs-xs)]">سیستم‌عامل ثروت شخصی</span>
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
            className={`flex w-full items-center gap-2 rounded-[10px] border px-3 py-2 text-[length:var(--fs-xs)] transition-colors ${
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
              className={`btn btn-primary min-w-0 flex-1 !px-2 !text-[length:var(--fs-xs)] ${collapsed ? "!w-11 !px-0" : ""}`}
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
      {!hideAppNav && (
      <header
        className="app-topbar sticky top-0 z-30 flex items-center justify-between px-4 py-2.5 backdrop-blur-xl lg:hidden"
        style={{
          background: "color-mix(in oklab, var(--bg) 82%, transparent)",
          borderBottom: "1px solid var(--border)",
          paddingTop: "max(0.625rem, env(safe-area-inset-top))",
        }}
      >
        <Link href="/" className="flex items-center gap-2" style={{ touchAction: "manipulation" }} aria-label="توازن">
          <BrandMark size={28} framed />
          <BrandWordmark className="text-[length:var(--fs-md)]" />
        </Link>
        <div className="flex items-center gap-1">
          <button type="button" className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="جستجو و فرمان" style={{ touchAction: "manipulation" }}>
            <Icon name="search" size={18} />
          </button>
          <AccountLink user={authUser} compact />
          <ThemeToggle />
          <Link href="/new" className="btn btn-primary !px-3 !text-[length:var(--fs-sm)]" aria-label="ثبت تراکنش جدید" style={{ touchAction: "manipulation" }}>
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
            ? "app-main app-main-public w-full max-w-none p-0"
            : `app-main mx-auto w-full max-w-[1180px] px-4 pt-4 transition-[padding] duration-200 sm:px-6 ${
                isAuthRoute ? "pb-8 lg:pb-10 lg:px-6 lg:pt-8" : "pb-28 lg:pb-16 lg:pl-10 lg:pr-[var(--nav-w)] lg:pt-7"
              }`
        }
      >
        {children}
        {pwa.show && !isAuthRoute && !isMarketing && (isLanding ? pwa.canPrompt : !isPublicChrome) && (
          <InstallPromotion
            ios={pwa.ios}
            canPrompt={pwa.canPrompt}
            onInstall={() => void pwa.install()}
            onDismiss={pwa.dismiss}
            publicPlacement={isLanding}
          />
        )}
      </main>

      {/* ───────────── Mobile record action ─────────────
          The primary transaction action: a raised 56px target centred above
          the tab bar. It opens the quick-action Sheet, which previously had
          no way of being opened at all. */}
      {!hideAppNav && (
        <button
          type="button"
          onClick={() => setQuickOpen(true)}
          aria-label="ثبت تراکنش جدید"
          aria-haspopup="dialog"
          aria-expanded={quickOpen}
          className="record-fab lg:hidden"
        >
          <Icon name="plus" size={24} strokeWidth={2.1} />
        </button>
      )}

      {/* ───────────── Mobile bottom nav (app only — never on landing/auth/legal) ───────────── */}
      {!hideAppNav && (
      <nav
        className="app-bottom-nav fixed inset-x-0 bottom-0 z-40 lg:hidden"
        aria-label="ناوبری اصلی موبایل"
        style={{
          background: "color-mix(in oklab, var(--surface) 92%, transparent)",
          backdropFilter: "blur(16px)",
          borderTop: "1px solid var(--border)",
          paddingBottom: "max(0.35rem, env(safe-area-inset-bottom))",
          touchAction: "manipulation",
        }}
      >
        {/* One row, always. The column count follows the real item count
            (tabs + «بیشتر»); a hard-coded 5 made the sixth item wrap onto a
            second row that fell below the bottom of the screen on iOS PWA. */}
        <div className="tab-row" style={{ gridTemplateColumns: `repeat(${MOBILE_TABS.length + 1}, minmax(0, 1fr))` }}>
          {MOBILE_TABS.map((t) => {
            const active = t.match!.some((m) => (m === "/" ? pathname === "/" : isNavActive(pathname, m)));
            return (
              <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`tab-item ${active ? "tab-active" : ""}`} style={{ touchAction: "manipulation" }}>
                <Icon name={t.icon as IconName} size={20} strokeWidth={active ? 2 : 1.7} />
                <span className="tab-label">{t.label}</span>
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
            <Icon name="more" size={20} />
            <span className="tab-label">بیشتر</span>
          </button>
        </div>
      </nav>
      )}

      {!hideAppNav && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} authUser={authUser} />}
      {!hideAppNav && (
        <Sheet open={quickOpen} onClose={() => setQuickOpen(false)} title="ثبت تراکنش">
          <nav className="grid grid-cols-1 gap-1 px-3 py-3" aria-label="اقدامات سریع">
            {QUICK_ACTIONS.filter((a) => a.href.startsWith("/new?type=")).map((a) => (
              <Link
                key={a.href}
                href={a.href}
                onClick={() => setQuickOpen(false)}
                className="flex min-h-12 items-center gap-3 rounded-[var(--r-md)] px-3 py-2.5 text-[length:var(--fs-sm)] font-medium"
                style={{ color: "var(--text)", touchAction: "manipulation" }}
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-[10px]"
                  style={{ background: "var(--action-soft)", color: "var(--action)" }}
                >
                  <Icon name={a.icon} size={16} />
                </span>
                {a.label}
              </Link>
            ))}
          </nav>
        </Sheet>
      )}
      {!hideAppNav && <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
