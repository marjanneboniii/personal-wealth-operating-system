"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import Sheet from "./Sheet";
import Icon from "./Icon";
import { foldPersian } from "@/features/funds/search";
import { faCount } from "@/lib/format";

export type CatalogOption = { id: string; label: string; detail?: string; searchText?: string; mark?: ReactNode };

/** Catalogue selection only. Search narrows existing options; it never creates a name. */
export default function CatalogPicker({ label, options, value, onSelect, disabled = false, emptyText = "گزینه‌ای در فهرست موجود نیست.", placeholder }: {
  label: string; options: CatalogOption[]; value?: string; onSelect: (id: string) => void;
  disabled?: boolean; emptyText?: string; placeholder?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(24);
  const selected = options.find(option => option.id === value);
  const matches = useMemo(() => {
    const tokens = query.split(/\s+/).map(foldPersian).filter(Boolean);
    return options.filter(option => tokens.every(token => foldPersian(`${option.label} ${option.detail ?? ""} ${option.searchText ?? ""}`).includes(token)));
  }, [options, query]);
  return <div className="catalog-control">
    <span className="label" id={`${id}-label`}>{label}</span>
    <button type="button" className="catalog-trigger" disabled={disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" aria-expanded={open} onClick={() => {setQuery("");setLimit(24);setOpen(true);}}>
      <span className="catalog-mark">{selected?.mark ?? <Icon name="wallet" size={20} />}</span>
      <span className="catalog-copy"><b id={`${id}-value`}>{selected?.label ?? placeholder ?? "انتخاب از فهرست"}</b><small>{selected?.detail ?? "فهرست را باز کنید و انتخاب کنید"}</small></span>
      <Icon name="chevronDown" size={18} />
    </button>
    <Sheet open={open} onClose={() => setOpen(false)} title={label} wide>
      <div className="catalog-panel" dir="rtl">
        <label className="catalog-search"><Icon name="search" size={18} /><input type="search" value={query} onChange={event => {setQuery(event.target.value);setLimit(24);}} placeholder="جست‌وجو در فهرست (اختیاری)" aria-label={`جست‌وجو در ${label}`} /></label>
        <p className="muted text-xs" role="status">{faCount(matches.length)} گزینه</p>
        <div className="catalog-options" role="group" aria-label={`گزینه‌های ${label}`}>
          {matches.slice(0, limit).map(option => <button key={option.id} type="button" className="catalog-option" aria-pressed={value === option.id} onClick={() => {onSelect(option.id);setOpen(false);}}>
            {option.mark && <span className="catalog-mark">{option.mark}</span>}
            <span className="catalog-copy"><b>{option.label}</b>{option.detail && <small>{option.detail}</small>}</span>
            <Icon name={value === option.id ? "check" : "plus"} size={16} />
          </button>)}
        </div>
        {!matches.length && <p className="expense-note" role="status">{query ? "گزینه‌ای با این نام پیدا نشد؛ جست‌وجو را تغییر دهید." : emptyText}</p>}
        {matches.length > limit && <button type="button" className="btn btn-ghost w-full" onClick={() => setLimit(n => n + 24)}>نمایش گزینه‌های بیشتر</button>}
      </div>
    </Sheet>
  </div>;
}
