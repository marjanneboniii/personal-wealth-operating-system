import type { ReactNode } from "react";
import DisclosurePanel from "@/components/ui/DisclosurePanel";

/**
 * «ثبت بدهی یا طلب» — the ONE way an obligation is added. The header button
 * and the empty state (`#new`) open it, in a sheet over the page.
 */
export default function NewObligationPanel({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  return (
    <DisclosurePanel anchor="new" label="ثبت بدهی یا طلب" defaultOpen={defaultOpen} sheet>
      {children}
    </DisclosurePanel>
  );
}
