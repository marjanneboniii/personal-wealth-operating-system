"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "@/components/ui/Icon";
import { faCount } from "@/lib/format";

export const REMINDERS_CHANGED_EVENT = "pwos-reminders-changed";

/**
 * The bell: a link to /notifications with the unread count. The count is
 * fetched after paint, so no page ever waits on it, and refreshed on
 * navigation and whenever the reminders page marks items seen.
 */
export default function ReminderBell({ className = "icon-btn" }: { className?: string }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch("/api/notifications", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : { unread: 0 }))
        .then((d: { unread?: number }) => {
          if (!cancelled) setUnread(typeof d.unread === "number" ? d.unread : 0);
        })
        .catch(() => {});
    void load();
    window.addEventListener(REMINDERS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(REMINDERS_CHANGED_EVENT, load);
    };
  }, [pathname]);

  const label = unread > 0 ? `یادآورها — ${faCount(unread)} مورد تازه` : "یادآورها";
  return (
    <Link href="/notifications" className={`${className} relative`} aria-label={label} title={label} style={{ touchAction: "manipulation" }}>
      <Icon name="bell" size={18} />
      {unread > 0 && (
        <span className="bell-badge num" aria-hidden="true">
          {unread > 9 ? "۹+" : faCount(unread)}
        </span>
      )}
    </Link>
  );
}
