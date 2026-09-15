import type { ReactNode } from "react";
import DisclosurePanel from "@/components/ui/DisclosurePanel";

/**
 * «ثبت بدهی یا طلب» — the ONE way an obligation is added. The header button
 * (`#new`) opens it; with nothing registered yet it is simply open.
 */
export default function NewObligationPanel({ children, defaultOpen = false }: { children: ReactNode; defaultOpen?: boolean }) {
  return (
    <DisclosurePanel anchor="new" label="ثبت بدهی یا طلب" defaultOpen={defaultOpen}>
      {children}
    </DisclosurePanel>
  );
}
