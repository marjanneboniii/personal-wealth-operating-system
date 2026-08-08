"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { ALL_NAV_ITEMS, QUICK_ACTIONS } from "@/lib/nav";

type Cmd = {
  href: string;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
  hint?: string;
  group: string;
  keywords: string;
};

const COMMANDS: Cmd[] = [
  ...QUICK_ACTIONS.map((a) => ({
    href: a.href,
    label: a.label,
    icon: a.icon,
    hint: a.hint || "اقدام",
    group: "اقدامات",
    keywords: a.keywords.join(" "),
  })),
  ...ALL_NAV_ITEMS.map((n) => ({
    href: n.href,
    label: n.label,
    icon: n.icon,
    hint: n.question,
    group: "رفتن به",
    keywords: (n.keywords ?? []).join(" "),
  })),
];

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/‌/g, " ")
    .trim();
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // "Adjust state during render" — reset whenever the palette is opened
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => norm(`${c.label} ${c.hint ?? ""} ${c.keywords} ${c.group}`).includes(q));
  }, [query]);

  // Items with group headers woven in — computed once, no render mutation
  const items = useMemo(() => {
    const out: ({ kind: "header"; label: string } | { kind: "cmd"; cmd: Cmd; idx: number })[] = [];
    let lastGroup = "";
    results.forEach((cmd, idx) => {
      if (cmd.group !== lastGroup) {
        out.push({ kind: "header", label: cmd.group });
        lastGroup = cmd.group;
      }
      out.push({ kind: "cmd", cmd, idx });
    });
    return out;
  }, [results]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(results.length - 1, i + 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        const cmd = results[index] ?? results[0];
        if (cmd) {
          onClose();
          router.push(cmd.href);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, results, index, onClose, router]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: "nearest" });
  }, [index]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="مرکز فرمان">
      <button
        aria-label="بستن"
        className="fade-in absolute inset-0 cursor-default"
        style={{ background: "rgba(10,12,16,0.45)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />
      <div
        className="pop-in absolute inset-x-3 top-[12dvh] mx-auto flex max-h-[66dvh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--r-xl)] border sm:inset-x-0"
        style={{ background: "var(--surface-elev)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-lg)" }}
      >
        <div className="flex items-center gap-2 border-b px-4" style={{ borderColor: "var(--border)" }}>
          <Icon name="search" size={17} className="shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="جستجو یا رفتن به… (مثلاً «تراکنش»، «دفترکل»، «ثبت هزینه»)"
            className="h-12 w-full bg-transparent text-[14px] outline-none placeholder:opacity-40"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[index] ? `cmd-${index}` : undefined}
          />
          <kbd className="kbd shrink-0">esc</kbd>
        </div>

        <div ref={listRef} id="cmdk-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="muted px-4 py-10 text-center text-[13px]">
              چیزی پیدا نشد.
              <div className="mt-1 text-[11px]">نام صفحه یا اقدام را جستجو کنید — مثلاً «ارزش خالص» یا «ثبت درآمد».</div>
            </div>
          )}
          {items.map((item) =>
            item.kind === "header" ? (
              <div key={"h-" + item.label} className="nav-group-label !pb-1 !pt-2.5">
                {item.label}
              </div>
            ) : (
              <button
                key={item.cmd.href + item.cmd.label}
                id={`cmd-${item.idx}`}
                data-idx={item.idx}
                role="option"
                aria-selected={item.idx === index}
                onMouseEnter={() => setIndex(item.idx)}
                onClick={() => {
                  onClose();
                  router.push(item.cmd.href);
                }}
                className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-right"
                style={{ background: item.idx === index ? "var(--brand-soft)" : "transparent" }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
                  style={{
                    background: item.idx === index ? "var(--brand)" : "var(--sunken)",
                    color: item.idx === index ? "var(--on-brand)" : "var(--text-2)",
                  }}
                >
                  <Icon name={item.cmd.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium" style={{ color: item.idx === index ? "var(--brand)" : "var(--text)" }}>
                    {item.cmd.label}
                  </span>
                  {item.cmd.hint && <span className="muted block truncate text-[11px]">{item.cmd.hint}</span>}
                </span>
                {item.idx === index && <kbd className="kbd shrink-0">↵</kbd>}
              </button>
            ),
          )}
        </div>

        <div
          className="muted flex items-center justify-between border-t px-4 py-2 text-[10.5px]"
          style={{ borderColor: "var(--border)", background: "var(--sunken)" }}
        >
          <span className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd>
              حرکت
            </span>
            <span className="flex items-center gap-1">
              <kbd className="kbd">↵</kbd>
              انتخاب
            </span>
          </span>
          <span className="flex items-center gap-1" dir="ltr">
            <kbd className="kbd">⌘</kbd>
            <kbd className="kbd">K</kbd>
          </span>
        </div>
      </div>
    </div>
  );
}
