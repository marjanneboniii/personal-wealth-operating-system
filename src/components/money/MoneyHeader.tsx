import type { ReactNode } from "react";
import ModuleHeader from "@/components/money/ModuleHeader";
import { MONEY_TABS } from "@/components/ui/ModuleTabs";

/** «پول» page head: ModuleHeader with the five money tabs. */
export default function MoneyHeader({ title, active, actions }: { title: string; active: string; actions?: ReactNode }) {
  return <ModuleHeader title={title} tabs={MONEY_TABS} active={active} label="بخش‌های پول" actions={actions} />;
}
