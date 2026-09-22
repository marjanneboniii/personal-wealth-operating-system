"use client";

import { parseTags } from "@/features/tags/normalize";

/**
 * Free-text hashtag field: «#سفر #شمال». What will be stored is previewed as
 * chips, and the user's own tags are offered one tap away.
 */
export default function TagInput({
  value,
  onChange,
  suggestions = [],
  id,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The user's tags, most used first. */
  suggestions?: string[];
  id?: string;
  autoFocus?: boolean;
}) {
  const current = parseTags(value);
  const offer = suggestions.filter((t) => !current.includes(t)).slice(0, 8);
  const add = (tag: string) => onChange([...current, tag].map((t) => `#${t}`).join(" ") + " ");

  return (
    <div className="space-y-1.5">
      <input
        id={id}
        className="field"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="#سفر #تعمیر_خانه"
        autoComplete="off"
        autoFocus={autoFocus}
        aria-describedby={id ? `${id}-hint` : undefined}
      />
      {current.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="برچسب‌هایی که ذخیره می‌شوند">
          {current.map((t) => (
            <span key={t} className="tag-chip">#{t}</span>
          ))}
        </div>
      )}
      {offer.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="muted text-[length:var(--fs-xs)]">برچسب‌های شما:</span>
          {offer.map((t) => (
            <button key={t} type="button" className="chip !py-1" onClick={() => add(t)}>
              #{t}
            </button>
          ))}
        </div>
      )}
      {id && (
        <p id={`${id}-hint`} className="muted text-[length:var(--fs-xs)]">
          با فاصله جدا کنید؛ برای چندکلمه‌ای از «_» استفاده کنید.
        </p>
      )}
    </div>
  );
}
