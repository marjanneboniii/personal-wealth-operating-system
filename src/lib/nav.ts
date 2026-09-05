import type { IconName } from "@/components/ui/Icon";

/**
 * توازن — Product Information Architecture (single source of truth).
 *
 * Navigation is organised by USER INTENT, never by database table:
 *
 *   خانه · پول · دارایی‌ها · بدهی · ثروت · برنامه‌ریزی · بینش‌ها · گزارش‌ها · تنظیمات
 *
 * Two conceptual layers stay visually apart:
 *   HUMAN FINANCE LAYER  → تراکنش‌ها، دارایی‌ها، بدهی (human, simple)
 *   ACCOUNTING TRUTH     → «سوابق مالی» + «حسابرسی» (precise, audited)
 *
 * TERMINOLOGY RULE (UI vs TECHNICAL) — never mix the two:
 *   UI label      →  «سوابق مالی»
 *   Technical     →  Ledger / General Ledger / Journal Entry / Posting / Debit / Credit
 * Routes, features and services keep the technical name (`/ledger`,
 * `src/features/ledger`) so the accounting layer stays traceable in code.
 *
 * This module is PRESENTATION ONLY. It performs no data access, derives no
 * financial value and can never mutate financial state.
 */

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** the financial question this page answers */
  question: string;
  /** command-palette keywords (fa/en) */
  keywords?: string[];
  /** nested destinations of a domain — rendered inside the collapsible group */
  children?: NavItem[];
  /** keep out of the command palette (anchor duplicates of a parent page) */
  paletteHidden?: boolean;
};

export type NavModule = "expenses" | "commitments" | "wealth";

export type NavGroup = {
  id: string;
  label: string;
  /** the domain's own landing destination (used for active-state + header link) */
  href?: string;
  icon?: IconName;
  items: NavItem[];
  /** large domains collapse by default to keep cognitive load low */
  collapsible?: boolean;
  /** brand module color for nav + summaries */
  module?: NavModule;
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "home",
    label: "خانه",
    items: [
      {
        href: "/",
        label: "نمای کلی",
        icon: "overview",
        question: "وضعیت مالی من چگونه است؟",
        keywords: ["home", "dashboard", "overview", "خانه", "داشبورد", "نمای کلی"],
      },
    ],
  },
  {
    id: "money",
    label: "پول",
    icon: "wallet",
    module: "expenses",
    collapsible: true,
    items: [
      {
        href: "/transactions",
        label: "تراکنش‌ها",
        icon: "transactions",
        question: "چه چیزی ثبت شده است؟",
        keywords: ["transactions", "activity", "تراکنش", "فعالیت"],
      },
      {
        href: "/accounts",
        label: "حساب‌ها",
        icon: "accounts",
        question: "پول من کجاست؟",
        keywords: ["accounts", "wallets", "حساب", "کیف", "بانک"],
      },
      {
        href: "/cash-flow",
        label: "جریان نقدی",
        icon: "cashflow",
        question: "پول از کجا می‌آید و به کجا می‌رود؟",
        keywords: ["cashflow", "income", "expense", "جریان", "درآمد", "هزینه"],
      },
    ],
  },
  {
    id: "assets",
    label: "دارایی‌ها",
    icon: "portfolio",
    module: "wealth",
    collapsible: true,
    items: [
      {
        href: "/assets",
        label: "همه دارایی‌ها",
        icon: "layers",
        question: "چه دارایی‌هایی دارم؟",
        keywords: ["assets", "all assets", "دارایی", "همه دارایی‌ها"],
      },
      {
        href: "/assets/financial",
        label: "دارایی‌های مالی",
        icon: "coins",
        question: "نقد، رمزارز، سهام و صندوق من چقدر است؟",
        keywords: ["financial assets", "cash", "crypto", "fund", "مالی", "نقد", "رمزارز", "صندوق"],
        // Reachable from the command palette and from the page itself, but kept
        // out of the sidebar so the domain stays four items wide.
        children: [
          {
            href: "/crypto",
            label: "رمزارزها",
            icon: "crypto",
            question: "رمزارزهای من کجا نگهداری می‌شوند؟",
            keywords: ["crypto", "bitcoin", "رمز", "بیت", "تتر", "ارز دیجیتال"],
          },
        ],
      },
      {
        href: "/asset-registry",
        label: "دارایی‌های واقعی",
        icon: "home",
        question: "ارزش املاک، خودرو و طلای من چیست؟",
        keywords: ["rwa", "real estate", "vehicle", "gold", "ملک", "خودرو", "طلا", "ارزش‌گذاری"],
      },
      {
        href: "/portfolio",
        label: "سبد دارایی",
        icon: "pie",
        question: "دارایی‌ها را چگونه نگه داشته‌ام؟",
        keywords: ["portfolio", "holdings", "allocation", "سبد", "سرمایه", "ترکیب"],
      },
    ],
  },
  {
    id: "inflation",
    label: "تورم",
    icon: "scale",
    collapsible: true,
    items: [
      {
        href: "/inflation",
        label: "ردیاب تورم شخصی",
        icon: "scale",
        question: "قیمت کالاهای مصرفی من چقدر رشد کرده است؟",
        keywords: [
          "inflation",
          "prices",
          "groceries",
          "tracker",
          "تورم",
          "قیمت کالا",
          "سبد کالا",
          "گرانی",
          "ردیاب",
        ],
      },
    ],
  },
  {
    id: "debt",
    label: "بدهی",
    icon: "debts",
    module: "commitments",
    collapsible: true,
    items: [
      {
        href: "/debts",
        label: "بدهی‌ها",
        icon: "debts",
        question: "چقدر بدهکارم؟",
        keywords: ["debt", "liabilities", "بدهی"],
      },
      {
        href: "/debts/loans",
        label: "وام‌ها",
        icon: "card",
        question: "وام‌های من در چه وضعیتی هستند؟",
        keywords: ["loan", "credit", "وام", "تسهیلات", "لیزینگ"],
      },
      {
        href: "/debts/installments",
        label: "اقساط",
        icon: "installments",
        question: "چه زمانی چقدر باید بپردازم؟",
        keywords: ["installment", "schedule", "قسط", "اقساط", "سررسید"],
      },
      {
        href: "/debts/obligations",
        label: "تعهدات آینده",
        icon: "calendar",
        question: "چه پرداخت‌های دانسته‌ای در راه است؟",
        keywords: ["obligation", "future", "تعهد", "آینده", "پرداخت آینده"],
      },
    ],
  },
  {
    id: "wealth",
    label: "ثروت",
    icon: "networth",
    module: "wealth",
    collapsible: true,
    items: [
      {
        href: "/net-worth",
        label: "ارزش خالص",
        icon: "networth",
        question: "در مجموع چقدر ثروت دارم؟",
        keywords: ["net worth", "wealth", "ارزش خالص", "ثروت"],
      },
      {
        href: "/net-worth#wealth-growth",
        label: "رشد ثروت",
        icon: "trend-up",
        question: "ثروت من چگونه تغییر کرده است؟",
        keywords: ["growth", "change", "رشد", "تغییر"],
        paletteHidden: true,
      },
      {
        href: "/net-worth#wealth-composition",
        label: "ترکیب دارایی‌ها",
        icon: "pie",
        question: "ثروت من از چه تشکیل شده است؟",
        keywords: ["composition", "allocation", "ترکیب"],
        paletteHidden: true,
      },
      {
        href: "/net-worth#wealth-performance",
        label: "عملکرد ثروت",
        icon: "scale",
        question: "عملکرد ثروت من چگونه بوده است؟",
        keywords: ["performance", "return", "عملکرد", "بازده"],
        paletteHidden: true,
      },
    ],
  },
  {
    id: "planning",
    label: "برنامه‌ریزی",
    icon: "goals",
    collapsible: true,
    items: [
      {
        href: "/budgets",
        label: "بودجه‌ها",
        icon: "budgets",
        question: "آیا در چارچوب بودجه هستم؟",
        keywords: ["budget", "بودجه"],
      },
      {
        href: "/goals",
        label: "اهداف و صندوق‌ها",
        icon: "goals",
        question: "به اهدافم نزدیک می‌شوم؟",
        keywords: ["goals", "funds", "هدف", "صندوق", "پس‌انداز"],
      },
      {
        href: "/planning",
        label: "پیش‌بینی مالی",
        icon: "send",
        question: "ماه‌های آینده چگونه خواهد بود؟",
        keywords: ["planning", "forecast", "projection", "برنامه", "پیش‌بینی"],
      },
    ],
  },
  {
    id: "insights",
    label: "بینش‌ها",
    items: [
      {
        href: "/insights",
        label: "بینش‌ها",
        icon: "info",
        question: "سیستم چه چیزی در داده‌های من می‌بیند؟",
        keywords: ["insights", "health", "alerts", "بینش", "سلامت مالی", "هشدار", "تحلیل"],
      },
    ],
  },
  {
    id: "reports",
    label: "گزارش‌ها",
    items: [
      {
        href: "/reports",
        label: "گزارش‌های مالی",
        icon: "reports",
        question: "گزارش رسمی وضعیت مالی من چیست؟",
        keywords: ["reports", "گزارش"],
      },
    ],
  },
];

/** Pinned at the bottom of the sidebar, and inside mobile "More". */
export const SECONDARY_ITEMS: NavItem[] = [
  {
    href: "/setup",
    label: "راه‌اندازی اولیه",
    icon: "check",
    question: "ارز پایه و حساب‌های اولیه را چگونه آماده کنم؟",
    keywords: ["setup", "onboarding", "opening balance", "راه‌اندازی", "شروع", "سرمایه افتتاحیه", "3010"],
  },
  {
    href: "/settings",
    label: "تنظیمات",
    icon: "settings",
    question: "پیکربندی، امنیت و بخش پیشرفته",
    keywords: ["settings", "backup", "security", "تنظیمات", "پشتیبان", "امنیت"],
  },
];

/**
 * Advanced / accounting-grade destinations.
 *
 * Deliberately de-emphasised for the everyday user (§38): they live under
 * «تنظیمات → پیشرفته», stay reachable from the command palette, and are NOT
 * part of the primary sidebar. `/ledger` remains the canonical technical route;
 * `/financial-records` is the user-facing alias.
 */
export const ADVANCED_ITEMS: NavItem[] = [
  {
    href: "/financial-records",
    label: "سوابق مالی",
    icon: "ledger",
    question: "دقیقاً چه اثر مالی‌ای ثبت شده است؟",
    keywords: [
      "financial records",
      "ledger",
      "journal",
      "posting",
      "accounting",
      "سوابق مالی",
      "دفترکل",
      "سند",
      "حسابداری",
    ],
  },
  {
    href: "/audit",
    label: "حسابرسی",
    icon: "audit",
    question: "چه کسی چه چیزی را کِی تغییر داد؟",
    keywords: ["audit", "integrity", "history", "حسابرسی", "یکپارچگی", "تاریخچه تغییرات"],
  },
];

/** Flattened list of every navigable destination (groups → items → children). */
export const ALL_NAV_ITEMS: NavItem[] = [
  ...NAV_GROUPS.flatMap((g) => g.items.flatMap((i) => [i, ...(i.children ?? [])])),
  ...SECONDARY_ITEMS,
  ...ADVANCED_ITEMS,
];

/** Mobile bottom navigation — 5 top-level destinations only. */
export const MOBILE_TABS: { href: string; label: string; icon: IconName; match?: string[]; module?: NavModule }[] = [
  { href: "/", label: "خانه", icon: "home", match: ["/"] },
  {
    href: "/transactions",
    label: "پول",
    icon: "transactions",
    module: "expenses",
    match: ["/transactions", "/accounts", "/cash-flow"],
  },
  {
    href: "/assets",
    label: "دارایی‌ها",
    icon: "portfolio",
    module: "wealth",
    match: ["/assets", "/portfolio", "/crypto", "/asset-registry"],
  },
  { href: "/debts", label: "بدهی", icon: "debts", module: "commitments", match: ["/debts", "/installments"] },
  { href: "/net-worth", label: "ثروت", icon: "networth", module: "wealth", match: ["/net-worth"] },
];

/** Quick actions surfaced in the command palette and mobile "More". */
export const QUICK_ACTIONS: { href: string; label: string; icon: IconName; hint: string; keywords: string[] }[] = [
  { href: "/new?type=expense", label: "ثبت هزینه", icon: "arrow-down", hint: "سریع‌ترین مسیر", keywords: ["expense", "هزینه"] },
  { href: "/new?type=income", label: "ثبت درآمد", icon: "arrow-up", hint: "", keywords: ["income", "درآمد"] },
  { href: "/new?type=transfer", label: "انتقال بین حساب‌ها", icon: "swap", hint: "", keywords: ["transfer", "انتقال"] },
  { href: "/new?type=buy", label: "خرید دارایی", icon: "plus", hint: "", keywords: ["buy", "خرید"] },
  { href: "/new?type=sell", label: "فروش دارایی", icon: "arrow-down", hint: "", keywords: ["sell", "فروش"] },
  { href: "/new", label: "ثبت تراکنش جدید", icon: "plus", hint: "فرم کامل", keywords: ["new", "transaction", "تراکنش", "جدید", "ثبت"] },
];

/** Strip a `#anchor` so anchor items resolve against their parent page. */
function pagePath(href: string): string {
  const i = href.indexOf("#");
  return i === -1 ? href : href.slice(0, i);
}

export function isNavActive(pathname: string, href: string): boolean {
  const path = pagePath(href);
  if (path === "/") return pathname === "/";
  return pathname === path || pathname.startsWith(path + "/");
}

/** Is any destination inside this domain currently active? */
export function isGroupActive(pathname: string, group: NavGroup): boolean {
  return group.items.some(
    (i) => isNavActive(pathname, i.href) || (i.children ?? []).some((c) => isNavActive(pathname, c.href)),
  );
}
