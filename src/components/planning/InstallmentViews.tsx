"use client";

import { useId, useState, type ReactNode } from "react";
import { faCount } from "@/lib/format";
import Icon from "@/components/ui/Icon";

/** Both views share the same server-rendered financial rows. */
export default function InstallmentViews({ pending, paid, pendingCount, paidCount }: {
  pending: ReactNode; paid: ReactNode; pendingCount: number; paidCount: number;
}) {
  const [view, setView] = useState(pendingCount === 0 && paidCount > 0 ? "paid" : "pending");
  const id = useId();
  const tabs = [{ key: "pending", label: "پیش‌رو", count: pendingCount }, { key: "paid", label: "پرداخت‌شده", count: paidCount }];
  return <div className="inst-views space-y-5">
    <div className="inst-view-tabs" role="tablist" aria-label="وضعیت اقساط">
      {tabs.map((tab, index) => <button key={tab.key} id={`${id}-${tab.key}`} type="button" role="tab" aria-selected={view === tab.key} aria-controls={`${id}-panel-${tab.key}`} tabIndex={view === tab.key ? 0 : -1} onClick={() => setView(tab.key)} onKeyDown={(e) => {
        const next = e.key === "ArrowLeft" || e.key === "ArrowRight" ? 1 - index : e.key === "Home" ? 0 : e.key === "End" ? 1 : null;
        if (next == null) return;
        e.preventDefault(); setView(tabs[next].key); document.getElementById(`${id}-${tabs[next].key}`)?.focus();
      }}><Icon name={tab.key === "paid" ? "check-circle" : "installments"} size={17} />{tab.label}<span className="num">{faCount(tab.count)}</span></button>)}
    </div>
    <div id={`${id}-panel-pending`} role="tabpanel" aria-labelledby={`${id}-pending`} tabIndex={0} hidden={view !== "pending"}>{pending}</div>
    <div id={`${id}-panel-paid`} role="tabpanel" aria-labelledby={`${id}-paid`} tabIndex={0} hidden={view !== "paid"}>{paid}</div>
  </div>;
}
