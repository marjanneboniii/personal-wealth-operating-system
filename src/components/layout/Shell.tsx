"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import ReminderBell from "@/components/notifications/ReminderBell";
import Icon, { type IconName } from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import CommandPalette from "@/components/ui/CommandPalette";
import GuidedTour, { type TourStep } from "@/components/onboarding/GuidedTour";
import BrandMark, { BrandWordmark } from "@/components/layout/BrandMark";
import InstallPromotion, { usePwaInstallState } from "@/components/pwa/InstallPromotion";
import { paintTheme, readPrivacy, readThemeMode, setPrivacy, setThemeMode, subscribeDisplay } from "@/lib/displayPrefs";
import {
  NAV_GROUPS,
  SECONDARY_ITEMS,
  MOBILE_TABS,
  QUICK_ACTIONS,
  isNavActive,
  isGroupActive,
  newNavHrefs,
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

function ThemeToggle({ className = "icon-btn" }: { className?: string }) {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
  return (
    <button
      type="button"
      aria-label="تغییر حالت روشن و تاریک"
      title="حالت روشن / تاریک"
      className={className}
      style={{ touchAction: "manipulation" }}
      // One tap picks the opposite of what is on screen; «سیستم» lives in تنظیمات.
      onClick={() => setThemeMode(dark ? "light" : "dark")}
    >
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}

/** Privacy mode: every amount blurred on this device until tapped again. */
function PrivacyToggle({ className = "icon-btn" }: { className?: string }) {
  const on = useSyncExternalStore(subscribeDisplay, readPrivacy, () => false);
  return (
    <button
      type="button"
      aria-label={on ? "نمایش مبالغ" : "پنهان کردن مبالغ"}
      aria-pressed={on}
      title={on ? "نمایش مبالغ" : "پنهان کردن مبالغ"}
      className={className}
      style={{ touchAction: "manipulation" }}
      onClick={() => setPrivacy(!on)}
    >
      <Icon name={on ? "eye-off" : "eye"} size={18} />
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

/* ─────────────────── First-run tour ────────────────────── */

/** Four controls, one sentence each. Phone and desktop mark their own element with the same name. */
const TOUR_STEPS: TourStep[] = [
  { target: "record", title: "ثبت هر تراکنش", body: "هزینه، درآمد، انتقال یا خرید و فروش دارایی از همین دکمه ثبت می‌شود. پیش از ثبت، خلاصه را می‌بینید." },
  { target: "search", title: "جستجوی همه‌چیز", body: "صفحه‌ها و همین‌طور حساب، تراکنش، مبلغ، چک یا #برچسب خودتان را از اینجا پیدا کنید." },
  { target: "reminders", title: "یادآورها", body: "قسط، چک، حق بیمه، سود سپرده و اختلاف موجودی با بانک، به‌موقع اینجا می‌آید." },
  { target: "more", title: "همه‌ی بخش‌ها", body: "بیمه‌نامه‌ها، خودرو، پرداخت‌های تکراری، تطبیق با بانک و بقیه‌ی بخش‌ها اینجاست." },
];

/* ─────────────────── «جدید» badges ────────────────────── */

const SEEN_KEY = "pwos-seen-nav";

function readSeenRaw(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? "[]";
  } catch {
    return "[]";
  }
}

/**
 * Tiles to badge «جدید»: a new destination, or the tile that leads to it (a
 * new page nested under «حساب‌ها» badges «حساب‌ها»). Empty on the server, so
 * the first paint never disagrees with hydration.
 */
function useNewBadges(): ReadonlySet<string> {
  const raw = useSyncExternalStore(subscribeNav, readSeenRaw, () => "ssr");
  return useMemo(() => {
    if (raw === "ssr") return new Set<string>();
    let seen: string[] = [];
    try {
      seen = JSON.parse(raw);
    } catch {
      seen = [];
    }
    const fresh = newNavHrefs(new Date().toISOString().slice(0, 10), new Set(seen));
    const tiles = new Set<string>();
    for (const g of NAV_GROUPS) {
      for (const i of g.items) {
        if (fresh.includes(i.href) || (i.children ?? []).some((c) => fresh.includes(c.href))) tiles.add(i.href);
      }
    }
    return tiles;
  }, [raw]);
}

/** Opening a new destination retires its badge on this device. */
function markVisited(pathname: string) {
  const fresh = newNavHrefs(new Date().toISOString().slice(0, 10), new Set());
  const hit = fresh.filter((h) => isNavActive(pathname, h));
  if (!hit.length) return;
  try {
    const seen = new Set<string>(JSON.parse(readSeenRaw()));
    const before = seen.size;
    hit.forEach((h) => seen.add(h));
    if (seen.size === before) return;
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  } catch {
    return;
  }
  window.dispatchEvent(new CustomEvent(NAV_EVENT));
}

function NewBadge() {
  return <span className="new-badge">جدید</span>;
}

type ShellUser = {
  name: string;
  username: string | null;
  email: string | null;
  role: string;
};

function isAdminUser(user: ShellUser | null) {
  return !!user && (user.role === "owner" || user.role === "admin");
}

/** Admin panel as a quiet icon — where a text chip would crowd the row. */
function AdminIconLink({ user, className = "icon-btn" }: { user: ShellUser | null; className?: string }) {
  if (!isAdminUser(user)) return null;
  return (
    <Link href="/admin" className={className} aria-label="پنل مدیریت کاربران" title="پنل مدیریت کاربران" style={{ touchAction: "manipulation" }}>
      <Icon name="shield" size={17} />
    </Link>
  );
}

function AccountLink({ user, compact = false, showAdmin = true, className = "" }: { user: ShellUser | null; compact?: boolean; showAdmin?: boolean; className?: string }) {
  if (user) {
    const label = user.name || user.username || "حساب کاربری";
    const isAdmin = showAdmin && isAdminUser(user);
    return (
      <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
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
        className={`inline-flex min-w-0 items-center gap-1.5 rounded-[var(--r-md)] text-[length:var(--fs-xs)] font-medium ${compact ? "px-2 py-1.5" : "px-2.5 py-2"}`}
        style={{ background: "var(--action-soft)", color: "var(--action)", touchAction: "manipulation" }}
        aria-label={`حساب کاربری ${label}`}
        title={user.email || user.username || label}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[length:var(--fs-xs)] font-bold" style={{ background: "var(--action)", color: "var(--on-ink)" }}>
          {(user.username?.[0] || user.name?.[0] || "U").toUpperCase()}
        </span>
        {!compact && <span className="min-w-0 max-w-[110px] truncate">{label}</span>}
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

function SideLink({ item, active, collapsed, isNew = false }: { item: NavItem; active: boolean; collapsed: boolean; isNew?: boolean }) {
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
      {!collapsed && isNew && <NewBadge />}
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
  badges,
}: {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  badges: ReadonlySet<string>;
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
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed={collapsed} isNew={badges.has(n.href)} />
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
        {!open && group.items.some((i) => badges.has(i.href)) && <span className="new-dot" aria-label="جدید" />}
        <Icon name="chevronDown" size={14} className={`shrink-0 nav-chevron ${open ? "nav-chevron-open" : ""}`} />
      </button>
      {open && (
        <div id={panelId} className="space-y-0.5 pb-1">
          {group.items.map((n) => (
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed={false} isNew={badges.has(n.href)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────── Mobile More ───────────────────── */

function MoreSheet({ open, onClose, pathname, authUser, badges }: { open: boolean; onClose: () => void; pathname: string; authUser: ShellUser | null; badges: ReadonlySet<string> }) {
  return (
    <Sheet open={open} onClose={onClose} title="همه بخش‌ها">
      {/* Sections are tile grids, three across: the whole app fits in about
          one screen instead of a long list that had to be scrolled. */}
      <nav className="more-sheet" aria-label="همه بخش‌ها">
        <div className="more-profile">
          <AccountLink user={authUser} />
          {!authUser && <p className="muted min-w-0 flex-1 text-[length:var(--fs-xs)]">برای مدیریت داده‌ها وارد شوید</p>}
          <span className="ms-auto flex items-center gap-0.5">
            <PrivacyToggle />
            <ThemeToggle />
          </span>
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
          <section key={g.id} aria-label={g.label} className="more-group">
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
                      <span className="more-tile-label">{n.label}</span>
                      {badges.has(n.href) && <NewBadge />}
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
  showTour = false,
}: {
  children: ReactNode;
  authUser?: ShellUser | null;
  publicHome?: boolean;
  /** Setup is complete and this account has not finished or skipped the tour yet. */
  showTour?: boolean;
}) {
  const pathname = usePathname();
  const collapsed = useNavCollapsed();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const online = useOnline();
  const pwa = usePwaInstallState();
  const badges = useNewBadges();
  useEffect(() => markVisited(pathname), [pathname]);

  // «سیستم»: follow the OS when it switches between light and dark.
  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => {
      if (readThemeMode() === "system") paintTheme("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

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

  // PWA service worker: production builds only. In dev (localhost or a phone on
  // the LAN) a worker left behind serves stale CSS cache-first, so remove it.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => void r.unregister()));
      // Unregistering stops the worker but LEAVES its Cache Storage behind, and
      // a dev chunk filename gets reused — so the next worker to install could
      // find a stylesheet from an older build sitting under today's URL and
      // serve the app unstyled. Deleting the caches is what actually clears it,
      // and on an installed app it is the difference between "reload" and
      // "delete the app and add it again".
      void caches?.keys().then((keys) => keys.forEach((k) => void caches.delete(k)));
      return;
    }
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
  // «ثبت» sits in the middle of the tab bar: equal tabs on each side.
  const recordAt = Math.ceil(MOBILE_TABS.length / 2);
  const tabLink = (t: (typeof MOBILE_TABS)[number]) => {
    const active = t.match!.some((m) => (m === "/" ? pathname === "/" : isNavActive(pathname, m)));
    return (
      <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={`tab-item ${active ? "tab-active" : ""}`} style={{ touchAction: "manipulation" }}>
        <Icon name={t.icon as IconName} size={20} strokeWidth={active ? 2 : 1.7} />
        <span className="tab-label">{t.label}</span>
      </Link>
    );
  };

  const isAuthRoute = pathname === "/login" || pathname === "/register";
  const isMarketing = MARKETING_PATHS.has(pathname);
  const isLanding = pathname === "/" && publicHome;
  const isPublicChrome = isAuthRoute || isMarketing || isLanding;
  // Initial setup is mandatory and focused: no app navigation while on it.
  const hideAppNav = isPublicChrome || pathname === "/setup" || pathname.startsWith("/setup/");

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
              <BrandWordmark className="block text-[length:var(--fs-md)] leading-tight" />
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
            data-tour="search"
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
        <nav className="min-h-0 flex-1 overflow-y-auto pb-2" aria-label="بخش‌های اصلی" data-tour="more">
          {NAV_GROUPS.map((g) => (
            <NavGroupBlock key={g.id} group={g} pathname={pathname} collapsed={collapsed} badges={badges} />
          ))}
        </nav>

        {/* Bottom cluster */}
        <div className="border-t px-1.5 py-2" style={{ borderColor: "var(--border)" }}>
          {SECONDARY_ITEMS.map((n) => (
            <SideLink key={n.href} item={n} active={isNavActive(pathname, n.href)} collapsed={collapsed} />
          ))}
          {/* One primary action on its own row, then one quiet row of
              account + small icons — nothing competes for the button's width. */}
          <div className={`mt-1.5 px-1.5 ${collapsed ? "flex flex-col items-center gap-1" : "space-y-1.5"}`}>
            <Link
              href="/new"
              data-tour="record"
              className={`btn btn-primary whitespace-nowrap !text-[length:var(--fs-xs)] ${collapsed ? "!w-11 !min-w-11 !px-0" : "w-full"}`}
              aria-label="ثبت تراکنش جدید"
              title="ثبت تراکنش"
              style={{ touchAction: "manipulation" }}
            >
              <Icon name="plus" size={16} />
              {!collapsed && "ثبت تراکنش"}
            </Link>
            <div className={`flex items-center gap-0.5 ${collapsed ? "flex-col" : ""}`}>
              <AccountLink user={authUser} compact={collapsed} showAdmin={false} className={collapsed ? "" : "flex-1"} />
              <AdminIconLink user={authUser} className="icon-btn !min-h-10 !min-w-10" />
              <span data-tour="reminders" className="inline-flex">
                <ReminderBell className="icon-btn !min-h-10 !min-w-10" />
              </span>
              <PrivacyToggle className="icon-btn !min-h-10 !min-w-10" />
              <ThemeToggle className="icon-btn !min-h-10 !min-w-10" />
            </div>
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
        <Link href="/" className="flex min-w-0 items-center gap-2" style={{ touchAction: "manipulation" }} aria-label="توازن">
          <BrandMark size={28} framed />
          {/* The wordmark yields first on the narrowest phones. */}
          <BrandWordmark className="text-[length:var(--fs-md)] max-[359px]:hidden" />
        </Link>
        {/* Minimal: search, reminders, account. «ثبت تراکنش» is the «+» in the
            bottom bar; theme and admin live in «بیشتر», next to the profile. */}
        <div className="flex shrink-0 items-center gap-0.5">
          <button type="button" data-tour="search" className="icon-btn" onClick={() => setPaletteOpen(true)} aria-label="جستجو و فرمان" style={{ touchAction: "manipulation" }}>
            <Icon name="search" size={18} />
          </button>
          <PrivacyToggle />
          <span data-tour="reminders" className="inline-flex">
            <ReminderBell />
          </span>
          <AccountLink user={authUser} compact showAdmin={false} />
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
        {/* The record action lives INSIDE the bar: a floating button covered
            content on every page (and leaked onto desktop). */}
        <div
          className="tab-row tab-split"
        >
          {/* Two flex halves of equal width keep «+» at the exact centre,
              whatever the labels on either side measure. */}
          <div className="tab-half">{MOBILE_TABS.slice(0, recordAt).map(tabLink)}</div>
          <button
            type="button"
            onClick={() => setQuickOpen(true)}
            aria-label="ثبت تراکنش جدید"
            aria-haspopup="dialog"
            aria-expanded={quickOpen}
            data-tour="record"
            className="tab-record"
            data-active={pathname === "/new" || undefined}
          >
            <span className="tab-record-mark" aria-hidden="true">
              <Icon name="plus" size={20} strokeWidth={2.2} />
            </span>
          </button>
          <div className="tab-half">
            {MOBILE_TABS.slice(recordAt).map(tabLink)}
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              data-tour="more"
              aria-label="بیشتر"
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`tab-item ${moreActive ? "tab-active" : ""}`}
              style={{ touchAction: "manipulation" }}
            >
              <span className="relative inline-flex">
                <Icon name="more" size={20} />
                {badges.size > 0 && <span className="new-dot new-dot-corner" aria-label="بخش جدید" />}
              </span>
              <span className="tab-label">بیشتر</span>
            </button>
          </div>
        </div>
      </nav>
      )}

      {!hideAppNav && <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} pathname={pathname} authUser={authUser} badges={badges} />}
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
      {/* Home only, once per account: the tour points at controls, and the home page is where they all are. */}
      {!hideAppNav && showTour && pathname === "/" && !publicHome && <GuidedTour steps={TOUR_STEPS} />}
    </div>
  );
}
