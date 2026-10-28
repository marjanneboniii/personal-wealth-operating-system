import type { ReactNode } from "react";
import { formatJalaliIso } from "@/lib/format";

export type TimelineItem = {
  key: string;
  title: ReactNode;
  /** ISO date; shown in Jalali, with the exact day in <time datetime>. */
  date?: string | null;
  tone?: "neutral" | "positive" | "negative" | "warning" | "upcoming";
  content?: ReactNode;
};

/**
 * «خط زمانی» — what happened to one record, in order (Kashi «Timeline»):
 * a marker per event, its title, its Jalali date and an optional note. An
 * ordered list, so screen readers announce how many events and in what order.
 * A future date (a due date not reached yet) is drawn hollow.
 */
export default function Timeline({ items, label }: { items: TimelineItem[]; label: string }) {
  return (
    <ol className="timeline" aria-label={label}>
      {items.map((it) => (
        <li key={it.key} className="timeline-item" data-tone={it.tone ?? "neutral"}>
          <span className="timeline-dot" aria-hidden="true" />
          <span className="timeline-body">
            <span className="timeline-title">{it.title}</span>
            {it.date && (
              <time className="timeline-date num" dateTime={it.date.slice(0, 10)}>
                {formatJalaliIso(it.date)}
              </time>
            )}
            {it.content && <span className="timeline-content">{it.content}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
