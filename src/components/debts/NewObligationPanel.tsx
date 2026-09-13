import type { ReactNode } from "react";
import DisclosurePanel from "@/components/ui/DisclosurePanel";

/** «ثبت بدهی یا طلب» — opens from the header button and the empty state (`#new`). */
export default function NewObligationPanel({ children }: { children: ReactNode }) {
  return (
    <DisclosurePanel anchor="new" label="ثبت بدهی یا طلب">
      {children}
    </DisclosurePanel>
  );
}
