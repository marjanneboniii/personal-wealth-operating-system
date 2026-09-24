"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteTemplateAction } from "@/app/actions/templates";
import Icon from "@/components/ui/Icon";

export type ShortcutChip = { id: string; label: string; amountLabel: string | null; type: "expense" | "income" | "transfer" };

const ICON = { expense: "arrow-down", income: "arrow-up", transfer: "swap" } as const;

/**
 * Saved shortcuts («نان از کارت ملت») on the home screen. A tap opens the
 * pre-filled form — it never posts by itself. Removing one needs «ویرایش»
 * first, so a stray tap on a phone cannot delete it.
 */
export default function ShortcutChips({ items }: { items: ShortcutChip[] }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  if (!items.length) return null;
  return (
    <nav className="shortcut-row" aria-label="میان‌برهای ثبت">
      {items.map((t) =>
        editing ? (
          <button
            key={t.id}
            type="button"
            className="shortcut-chip is-editing"
            disabled={pending}
            aria-label={`حذف میان‌بر ${t.label}`}
            onClick={() =>
              start(async () => {
                await deleteTemplateAction(t.id);
                router.refresh();
              })
            }
          >
            <Icon name="x" size={13} />
            <span className="truncate">{t.label}</span>
          </button>
        ) : (
          <Link key={t.id} href={`/new?template=${t.id}`} className="shortcut-chip">
            <Icon name={ICON[t.type]} size={13} />
            <span className="truncate">{t.label}</span>
            {t.amountLabel && (
              <span className="num muted" dir="rtl">
                {t.amountLabel}
              </span>
            )}
          </Link>
        ),
      )}
      <button type="button" className="shortcut-edit" aria-pressed={editing} onClick={() => setEditing((e) => !e)}>
        {editing ? "تمام" : "ویرایش"}
      </button>
    </nav>
  );
}
