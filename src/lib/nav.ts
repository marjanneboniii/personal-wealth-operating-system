import type { IconName } from "@/components/ui/Icon";

/**
 * Information Architecture — single source of truth.
 * Two conceptual layers are kept visually apart:
 *   HUMAN FINANCE LAYER  → تراکنش‌ها (human, simple)
 *   ACCOUNTING TRUTH     → دفترکل + حسابرسی (precise, audited)
 */

export type NavItem = {
  href: string;
  label: string;
  icon: IconName;
  /** the financial question this page answers */
  question: string;
  /** command-palette keywords (fa/en) */
  keywords?: string[];
};

export type NavGroup = {
  id: string;
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "wealth",
    label: "ثروت",
    items: [
      {
        href: "/",
        label: "نمای کلی",
        icon: "overview",
        question: "وضعیت مالی من چگونه است؟",
        keywords: ["home", "dashboard", "overview", "خانه", "داشبورد"],
      },
    ],
  },
  {
    id: "money",
    label: "پول",
    items: [
      {
        href: "/transactions",
        label: "تراکنش‌ها",
        icon: "transactions",
        question: "",
        keywords: ["transactions", "activity", "تراکنش", "فعالیت"],
      },
      {
        href: "/accounts",
        label: "حساب‌ها",
        icon: "accounts",
        question: "",
        keywords: ["accounts", "wallets", "حساب", "کیف", "بانک"],
      },
      {
        href: "/cash-flow",
        label: "جریان نقدی",
        icon: "cashflow",
        question: "پول از کجا می‌آید و به کجا می‌رود؟",
        keywords: ["cashflow", "income", "expense", "جریان", "درآمد", "هزینه"],
      },
      {
        href: "/ledger",
        label: "دفترکل",
        icon: "ledger",
        question: "دقیقاً چه چیزی در سوابق حسابداری ثبت شده است؟",
        keywords: ["ledger", "journal", "accounting", "دفتر", "سند", "حسابداری"],
      },
    ],
  },
  {
    id: "assets",
    label: "دارایی‌ها",
    items: [
      {
        href: "/portfolio",
        label: "سبد دارایی",
        icon: "portfolio",
        question: "",
        keywords: ["portfolio", "holdings", "سبد", "سرمایه"],
      },
      {
        href: "/crypto",
        label: "رمزارزها",
        icon: "crypto",
        question: "",
        keywords: ["crypto", "bitcoin", "رمز", "بیت", "تتر", "ارز دیجیتال"],
      },
      {
        href: "/net-worth",
        label: "ارزش خالص",
        icon: "networth",
        question: "",
        keywords: ["net worth", "wealth", "ارزش خالص", "ثروت"],
      },
      {
        href: "/asset-registry",
        label: "دارایی واقعی و کالا",
        icon: "portfolio",
        question: "ارزش دارایی واقعی و هزینه کالاهای من چیست؟",
        keywords: ["rwa", "real estate", "vehicle", "commodity", "ملک", "خودرو", "کالا", "ارزش‌گذاری"],
      },
    ],
  },
  {
    id: "planning",
    label: "برنامه‌ریزی",
    items: [
      {
        href: "/planning",
        label: "پیش‌بینی مالی",
        icon: "goals",
        question: "",
        keywords: ["planning", "forecast", "برنامه", "پیش‌بینی"],
      },
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
        question: "",
        keywords: ["goals", "funds", "هدف", "صندوق", "پس‌انداز"],
      },
      {
        href: "/debts",
        label: "بدهی‌ها",
        icon: "debts",
        question: "",
        keywords: ["debt", "loan", "بدهی", "وام"],
      },
      {
        href: "/installments",
        label: "اقساط",
        icon: "installments",
        question: "",
        keywords: ["installment", "قسط", "اقساط"],
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
        question: "",
        keywords: ["reports", "گزارش"],
      },
      {
        href: "/audit",
        label: "حسابرسی",
        icon: "audit",
        question: "",
        keywords: ["audit", "integrity", "حسابرسی", "یکپارچگی"],
      },
    ],
  },
];

/** Pinned at the bottom of the sidebar, and inside mobile "More". */
export const SECONDARY_ITEMS: NavItem[] = [
  {
    href: "/settings",
    label: "تنظیمات",
    icon: "settings",
    question: "",
    keywords: ["settings", "backup", "تنظیمات", "پشتیبان"],
  },
];

export const ALL_NAV_ITEMS: NavItem[] = [...NAV_GROUPS.flatMap((g) => g.items), ...SECONDARY_ITEMS];

/** Mobile bottom navigation — 5 top-level destinations only. */
export const MOBILE_TABS: { href: string; label: string; icon: IconName; match?: string[] }[] = [
  { href: "/", label: "خانه", icon: "home", match: ["/"] },
  { href: "/portfolio", label: "دارایی‌ها", icon: "portfolio", match: ["/portfolio", "/crypto", "/net-worth"] },
  { href: "/transactions", label: "تراکنش‌ها", icon: "transactions", match: ["/transactions", "/cash-flow", "/ledger"] },
  { href: "/planning", label: "برنامه‌ریزی", icon: "goals", match: ["/planning", "/budgets", "/goals", "/debts", "/installments"] },
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

export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
