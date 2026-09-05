"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import Icon from "@/components/ui/Icon";
import { faCount } from "@/lib/format";

/*
 * ──────────────────────────────────────────────────────────────────────────
 * AdvancedFilter — the ONE unified, collapsible filter bar for the whole app
 * (Global System Directive §4: «فیلترهای متعدد بالای صفحات … به یک کامپوننت
 * کشویی/Advanced Filter یکپارچه تبدیل شوند»).
 *
 * Every list page renders its filters through this single component instead of
 * ad-hoc rows of selects:
 *   • one always-visible search box (keyboard «/» shortcut built in),
 *   • all other controls collapse behind a «فیلترها» chip that shows the
 *     number of active filters,
 *   • identical layout, RTL order and clear-all affordance everywhere.
 *
 * The component is purely presentational: it owns NO data and never mutates
 * any state itself — every change flows through the caller's callbacks
 * (URL state, server components, whatever the module uses).
 * ──────────────────────────────────────────────────────────────────────────
 */

export type FilterOption = { value: string; label: string };

export type FilterSelectField = {
  key: string;
  label: string;
  value: string;
  placeholder: string;
  /** flat option list */
  options?: FilterOption[];
  /** grouped options (rendered as <optgroup>) */
  groups?: { label: string; options: FilterOption[] }[];
  maxWidthClass?: string;
  onChange: (value: string) => void;
};

export type FilterChipField = {
  key: string;
  label: string;
  activeLabel?: string;
  active: boolean;
  onClick: () => void;
};

export default function AdvancedFilter({
  search,
  selects = [],
  chips = [],
  isFiltered = false,
  onClear,
  children,
  searchRef,
}: {
  search?: {
    value: string;
    placeholder: string;
    ariaLabel: string;
    onChange: (value: string) => void;
  };
  selects?: FilterSelectField[];
  chips?: FilterChipField[];
  isFiltered?: boolean;
  onClear?: () => void;
  children?: ReactNode;
  searchRef?: RefObject<HTMLInputElement | null>;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = searchRef ?? localRef;
  const [query, setQuery] = useState(search?.value ?? "");
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in sync when the filter state changes from outside
  // (browser back/forward, clear-all).
  const [lastValue, setLastValue] = useState(search?.value ?? "");
  if ((search?.value ?? "") !== lastValue) {
    setLastValue(search?.value ?? "");
    setQuery(search?.value ?? "");
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") {
        e.preventDefault();
        ref.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ref]);

  const onQuery = (v: string) => {
    setQuery(v);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => search?.onChange(v), 350);
  };

  const activeCount =
    selects.filter((s) => s.value && s.value !== s.placeholder && s.value !== "m3").length +
    chips.filter((c) => c.active).length +
    (search?.value ? 1 : 0);

  const hasCollapsible = selects.length > 0 || chips.length > 0 || !!children;

  return (
    <div className="advanced-filter card sticky top-[52px] z-20 space-y-2 p-2 lg:top-0" style={{ touchAction: "manipulation" }}>
      <div className="advanced-filter-row flex flex-wrap items-center gap-2">
        {search && (
          <div className="advanced-filter-search relative min-w-[180px] flex-1">
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-40">
              <Icon name="search" size={15} />
            </span>
            <input
              ref={ref}
              value={query}
              onChange={(e) => onQuery(e.target.value)}
              placeholder={search.placeholder}
              aria-label={search.ariaLabel}
              className="field !min-h-9 !py-1.5 pr-9 text-[13px]"
            />
          </div>
        )}
        {hasCollapsible && (
          <details className="advanced-filter-details group">
            <summary className="chip cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <Icon name="filter" size={12} />
              فیلترها
              {activeCount > 0 && (
                <span className="num badge badge-brand mr-1 !px-1.5 !py-0 !text-[10px]" dir="rtl">
                  {faCount(activeCount)}
                </span>
              )}
            </summary>
            <div className="advanced-filter-panel mt-2 flex flex-wrap items-center gap-2">
              {selects.map((f) => (
                <select
                  key={f.key}
                  value={f.value}
                  onChange={(e) => f.onChange(e.target.value)}
                  className={`field !min-h-9 !w-auto !py-1.5 text-[12.5px] ${f.maxWidthClass ?? ""}`}
                  aria-label={f.label}
                >
                  <option value="">{f.placeholder}</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                  {f.groups?.map((g) => (
                    <optgroup key={g.label} label={g.label}>
                      {g.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ))}
              {chips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={c.onClick}
                  className={`chip ${c.active ? "chip-on" : ""}`}
                  aria-pressed={c.active}
                >
                  {c.active && c.activeLabel ? c.activeLabel : c.label}
                </button>
              ))}
              {children}
            </div>
          </details>
        )}
        {isFiltered && onClear && (
          <button type="button" className="btn btn-ghost !min-h-8 !px-2 !py-1 text-[11.5px]" onClick={onClear}>
            <Icon name="x" size={13} />
            پاک کردن
          </button>
        )}
      </div>
    </div>
  );
}
