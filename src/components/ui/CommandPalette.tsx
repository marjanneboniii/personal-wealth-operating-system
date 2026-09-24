"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Icon from "@/components/ui/Icon";
import { ALL_NAV_ITEMS, QUICK_ACTIONS } from "@/lib/nav";
import { toLatinDigits } from "@/lib/format";
import { searchEverythingAction } from "@/app/actions/search";

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
  // Anchor duplicates of a parent page (paletteHidden) stay out of the palette
  // so the same destination is never offered twice.
  ...ALL_NAV_ITEMS.filter((n) => !n.paletteHidden).map((n) => ({
    href: n.href,
    label: n.label,
    icon: n.icon,
    hint: n.question,
    group: "رفتن به",
    keywords: (n.keywords ?? []).join(" "),
  })),
];

function norm(s: string) {
  return toLatinDigits(s)
    .toLowerCase()
    .replace(/[يى]/g, "ی")
    .replace(/[ك]/g, "ک")
    .replace(/[أإآ]/g, "ا")
    .replace(/[\u200c\u200e\u200f]/g, " ")
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

  // The user's own records (accounts, transactions, #tags, cheques, …) come
  // from the server after a short pause in typing; a slower, older answer
  // never overwrites a newer one.
  const [data, setData] = useState<{ query: string; hits: Cmd[] }>({ query: "", hits: [] });
  const [searching, setSearching] = useState(false);
  const latest = useRef("");
  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!open || norm(q).length < 2) return;
    const timer = setTimeout(() => {
      setSearching(true);
      searchEverythingAction(q)
        .then((hits) => {
          if (latest.current !== q) return;
          setData({ query: q, hits: hits.map((h) => ({ href: h.href, label: h.label, icon: h.icon, hint: h.hint, group: h.group, keywords: "" })) });
        })
        .catch(() => {})
        .finally(() => {
          if (latest.current === q) setSearching(false);
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, open]);

  const results = useMemo(() => {
    const q = norm(query);
    if (!q) return COMMANDS;
    const pages = COMMANDS.filter((c) => norm(`${c.label} ${c.hint ?? ""} ${c.keywords} ${c.group}`).includes(q));
    return data.query === query.trim() && q.length >= 2 ? [...pages, ...data.hits] : pages;
  }, [query, data]);

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
    <div className="command-palette fixed inset-0 z-[90]" role="dialog" aria-modal="true" aria-label="مرکز فرمان">
      <button
        aria-label="بستن"
        className="fade-in absolute inset-0 cursor-default"
        style={{ background: "var(--overlay)", backdropFilter: "blur(2px)" }}
        onClick={onClose}
      />
      <div
        className="command-palette-panel pop-in absolute inset-x-3 top-[12dvh] mx-auto flex max-h-[66dvh] w-full max-w-xl flex-col overflow-hidden rounded-[var(--r-lg)] border sm:inset-x-0"
        style={{ background: "var(--surface-elev)", borderColor: "var(--border-strong)", boxShadow: "var(--shadow-lg)" }}
      >
        <h2 id="cmdk-title" className="sr-only">
          مرکز فرمان
        </h2>
        <div className="flex items-center gap-2 border-b px-4" style={{ borderColor: "var(--border)" }}>
          <Icon name="search" size={17} className="shrink-0 opacity-50" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            placeholder="جستجوی صفحه، حساب، تراکنش، مبلغ، چک یا #برچسب…"
            className="h-12 w-full bg-transparent text-[length:var(--fs-sm)] outline-none placeholder:opacity-40"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={results[index] ? `cmd-${index}` : undefined}
          />
          <kbd className="kbd shrink-0">esc</kbd>
        </div>

        <div ref={listRef} id="cmdk-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {results.length === 0 && (
            <div className="muted px-4 py-10 text-center text-[length:var(--fs-sm)]" role="status" aria-live="polite">
              {searching ? "در حال جستجو…" : "چیزی پیدا نشد."}
              {!searching && (
                <div className="mt-1 text-[length:var(--fs-xs)]">نام صفحه، حساب، شرح تراکنش، مبلغ، طرف چک یا یک #برچسب را بنویسید.</div>
              )}
            </div>
          )}
          {items.map((item) =>
            item.kind === "header" ? (
              <div key={"h-" + item.label} className="nav-group-label !pb-1 !pt-2.5">
                {item.label}
              </div>
            ) : (
              <button
                key={`${item.cmd.group}-${item.idx}`}
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
                style={{ background: item.idx === index ? "var(--action-soft)" : "transparent" }}
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]"
                  style={{
                    background: item.idx === index ? "var(--action)" : "var(--sunken)",
                    color: item.idx === index ? "var(--on-ink)" : "var(--text-2)",
                  }}
                >
                  <Icon name={item.cmd.icon} size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--fs-sm)] font-medium" style={{ color: item.idx === index ? "var(--action)" : "var(--text)" }}>
                    {item.cmd.label}
                  </span>
                  {item.cmd.hint && <span className="muted block truncate text-[length:var(--fs-xs)]">{item.cmd.hint}</span>}
                </span>
                {item.idx === index && <kbd className="kbd shrink-0">↵</kbd>}
              </button>
            ),
          )}
        </div>

        <div
          className="muted flex items-center justify-between border-t px-4 py-2 text-[length:var(--fs-xs)]"
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
