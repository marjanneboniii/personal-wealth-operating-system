import type { ReactNode } from "react";
import ModuleTabs, { type ModuleTab } from "@/components/ui/ModuleTabs";

/**
 * Module page head — one title row and one navigation row, shared by «پول»,
 * «دارایی‌ها» and «تعهدات مالی».
 *
 * On a phone the module tabs are the only way between a module's pages, so
 * they stay, as one scrollable pill strip. From `lg` up the sidebar already
 * lists the same pages under the module, and a second copy above the content
 * only pushed the figures down — so the strip is hidden there (money.css).
 */
export default function ModuleHeader({
  title,
  tabs,
  active,
  label,
  actions,
}: {
  title: string;
  tabs?: ModuleTab[];
  /** The tab href of this page. */
  active?: string;
  /** Accessible name of the tab strip («بخش‌های پول»). */
  label?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mny-head">
      <div className="mny-head-row">
        <h1 className="mny-title">{title}</h1>
        {actions && <div className="mny-head-actions">{actions}</div>}
      </div>
      {tabs && active && (
        <div className="mny-tabs">
          <ModuleTabs tabs={tabs} active={active} label={label ?? title} />
        </div>
      )}
    </header>
  );
}
