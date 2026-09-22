"use client";

import { useEffect } from "react";
import { markRemindersReadAction } from "@/app/actions/notifications";
import { REMINDERS_CHANGED_EVENT } from "@/components/notifications/ReminderBell";

/**
 * Opening the reminders page is seeing them. Done after render, from the
 * browser — the page itself stays a pure read.
 */
export default function MarkRemindersSeen({ keys }: { keys: string[] }) {
  const joined = keys.join("\n");
  useEffect(() => {
    if (!joined) return;
    void markRemindersReadAction(joined.split("\n")).then(() => window.dispatchEvent(new Event(REMINDERS_CHANGED_EVENT)));
  }, [joined]);
  return null;
}
