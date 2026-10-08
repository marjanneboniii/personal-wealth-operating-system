import type { ReactNode } from "react";
import ModuleTabs, { MONEY_TABS } from "@/components/ui/ModuleTabs";

/**
 * «پول» page head — one title row and one navigation row.
 *
 * On a phone the module tabs are the only way between the five money pages, so
 * they stay, as one scrollable pill strip. From `lg` up the sidebar already
 * lists the same five pages under «پول», and a second copy above the content
 * only pushed the figures down — so the strip is hidden there (money.css).
 */
export default function MoneyHeader({
  title,
  active,
  actions,
}: {
  title: string;
  /** The MONEY_TABS href of this page. */
  active: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mny-head">
      <div className="mny-head-row">
        <h1 className="mny-title">{title}</h1>
        {actions && <div className="mny-head-actions">{actions}</div>}
      </div>
      <div className="mny-tabs">
        <ModuleTabs tabs={MONEY_TABS} active={active} label="بخش‌های پول" />
      </div>
    </header>
  );
}
