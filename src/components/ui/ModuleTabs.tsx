import Link from "next/link";

export type ModuleTab = { href: string; label: string };

/** «دارایی‌ها» — the same sub-navigation on every page of the module. */
export const ASSET_TABS: ModuleTab[] = [
  { href: "/assets", label: "همه" },
  { href: "/assets/financial", label: "مالی" },
  { href: "/asset-registry", label: "واقعی" },
  { href: "/portfolio", label: "سبد" },
];

/** «تعهدات مالی» — the same sub-navigation on every page of the module. */
export const DEBT_TABS: ModuleTab[] = [
  { href: "/debts", label: "بدهی و طلب" },
  { href: "/debts/loans", label: "وام‌ها" },
  { href: "/debts/installments", label: "اقساط" },
  { href: "/debts/obligations", label: "تعهدات آینده" },
  { href: "/debts/cheques", label: "چک‌ها" },
];

/** «پول» — the same sub-navigation on every page of the module. */
export const MONEY_TABS: ModuleTab[] = [
  { href: "/transactions", label: "تراکنش‌ها" },
  { href: "/accounts", label: "حساب‌ها" },
  { href: "/cash-flow", label: "جریان نقدی" },
];

/**
 * Module tab strip. Every tab is a real link (the active one too), so all tabs
 * share one hit area and one baseline — the old strip rendered the active tab
 * as a bare <span>, which `.seg` did not pad, and it sat lower than its siblings.
 */
export default function ModuleTabs({ tabs, active, label }: { tabs: ModuleTab[]; active: string; label: string }) {
  return (
    <nav className="module-tabs" aria-label={label}>
      {tabs.map((tab) => {
        const on = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={on ? "module-tab module-tab-on" : "module-tab"}
            aria-current={on ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
