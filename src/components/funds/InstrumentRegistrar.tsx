"use client";

/**
 * جستجو → انتخاب → پیش‌نمایش → ثبت نهایی — the flow the brief specifies for
 * every searchable category (بخش ۲).
 *
 * TWO FAMILIES, ONE FLOW. The registrar now covers صندوق AND سهام بورسی.
 * `InstrumentKind` already had `"stock"`, `ensureInstrumentClassId` already
 * seeded a «سهام» asset class, and the onboarding checklist already sent
 * «سهام بورسی» here — but the UI could only ever register `"fund"`, so that
 * checklist item led to a page that did not do the thing it promised. The
 * family switch below is that missing half, not a new subsystem.
 *
 * The preview step is not decoration. Registering the wrong instrument is easy
 * — «زر» and «زرفام» differ by three letters, «فارس» is a petrochemical while
 * «پارس» is another one entirely — and a mis-registered identity later carries
 * real transactions, so the confirmation names it in full and states plainly
 * what registration does and does not do. A user who thinks this step recorded
 * their holding would go on believing their net worth is complete when it is
 * not.
 *
 * Search is client-side against a bundled catalogue: it is a few dozen entries
 * per family, so a round trip per keystroke would be slower and would not
 * survive the unreliable connections this audience actually has.
 */
import { useMemo, useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import { registerInstrumentAction } from "@/app/actions/funds";
import { FUND_KIND_MARKS } from "@/components/ui/AssetTypeMarks";
import {
  FUND_KIND_LABELS,
  STOCK_SECTOR_LABELS,
  searchFunds,
  searchStocks,
  type FundKind,
  type StockSector,
} from "@/features/funds/search";

/** Which family the user is registering. Decides catalogue, tabs and copy. */
type Family = "fund" | "stock";

const FUND_TABS: { key: FundKind | "all"; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "gold", label: FUND_KIND_LABELS.gold },
  { key: "fixed_income", label: FUND_KIND_LABELS.fixed_income },
  { key: "etf", label: FUND_KIND_LABELS.etf },
  { key: "commodity", label: FUND_KIND_LABELS.commodity },
];

const STOCK_TABS: { key: StockSector | "all"; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "banking", label: STOCK_SECTOR_LABELS.banking },
  { key: "metals", label: STOCK_SECTOR_LABELS.metals },
  { key: "refining", label: STOCK_SECTOR_LABELS.refining },
  { key: "auto", label: STOCK_SECTOR_LABELS.auto },
  { key: "tech", label: STOCK_SECTOR_LABELS.tech },
  { key: "pharma", label: STOCK_SECTOR_LABELS.pharma },
  { key: "holding", label: STOCK_SECTOR_LABELS.holding },
  { key: "other", label: STOCK_SECTOR_LABELS.other },
];

type Registered = { symbol: string; name: string; created: boolean; family: Family };

/** One row of either catalogue, flattened so the list renders once. */
type Row = { symbol: string; name: string; groupLabel: string; kind?: FundKind };

/** Plate-wrapped kind mark, so every row shares one 30px silhouette. */
function FundKindMark({ kind, size }: { kind: FundKind; size: number }) {
  const Mark = FUND_KIND_MARKS[kind];
  if (!Mark) return null;
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden="true"
    >
      <Mark size={size} />
    </span>
  );
}

/**
 * سهام — a single mark for the whole family, on the same white plate and at
 * the same optical weight as the fund marks (see AssetTypeMarks' design
 * contract). Deliberately NOT a per-company logo: no Tehran-exchange emblem
 * exists in this repo, and scraping ninety trademarked marks to render them at
 * 30px would break the one thing that makes a mixed list readable.
 */
function StockMark({ size }: { size: number }) {
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="12" fill="#FFFFFF" />
        {/* A rising line with its two turning points marked — the only chart
            shape that still reads as «سهم» rather than «نمودار» at 24px. */}
        <path
          d="M12.5 31.5l7.5-7.8 5.6 4.9 10.4-11.4"
          stroke="#4B4DC4"
          strokeWidth="4.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
        <circle cx="20" cy="23.7" r="2.6" fill="#4B4DC4" />
        <circle cx="25.6" cy="28.6" r="2.6" fill="#4B4DC4" />
      </svg>
    </span>
  );
}

export default function InstrumentRegistrar() {
  const [family, setFamily] = useState<Family>("fund");
  const [fundKind, setFundKind] = useState<FundKind | "all">("all");
  const [sector, setSector] = useState<StockSector | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [custom, setCustom] = useState("");
  const [done, setDone] = useState<Registered[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const isStock = family === "stock";

  // Both catalogues are flattened to one row shape so the result list, the
  // preview and the confirm path exist once rather than twice.
  const results = useMemo<Row[]>(() => {
    if (isStock) {
      return searchStocks(query, {
        sector: sector === "all" ? undefined : sector,
        limit: 12,
      }).map((s) => ({ symbol: s.symbol, name: s.name, groupLabel: s.sectorLabel }));
    }
    return searchFunds(query, {
      kind: fundKind === "all" ? undefined : fundKind,
      limit: 12,
    }).map((f) => ({ symbol: f.symbol, name: f.name, groupLabel: f.kindLabel, kind: f.kind }));
  }, [isStock, query, fundKind, sector]);

  const switchFamily = (next: Family) => {
    setFamily(next);
    setSelected(null);
    setQuery("");
    setCustom("");
    setError(null);
  };

  const confirm = (symbol: string, name: string) => {
    setError(null);
    startSaving(() => {
      registerInstrumentAction(family, symbol, name)
        .then((res) => {
          if (!res.ok) {
            setError(res.message ?? "ثبت ناموفق بود.");
            return;
          }
          setDone((prev) => [{ symbol, name, created: res.created ?? false, family }, ...prev]);
          // Straight back to an empty search — «افزودن مورد دیگر از همین
          // دسته» is the default, not a secondary action.
          setSelected(null);
          setQuery("");
          setCustom("");
        })
        .catch(() => setError("ثبت ناموفق بود. دوباره تلاش کنید."));
    });
  };

  const noun = isStock ? "سهم" : "صندوق";

  return (
    <div className="space-y-4">
      {error && (
        <div
          role="alert"
          className="card p-3 text-[length:var(--fs-sm)]"
          style={{ borderColor: "var(--negative)", color: "var(--negative)" }}
        >
          {error}
        </div>
      )}

      {done.length > 0 && (
        <ul className="space-y-1.5">
          {done.map((d) => (
            <li
              key={`${d.family}-${d.symbol}`}
              className="card flex items-center gap-2 p-3 text-[length:var(--fs-xs)]"
              style={{ color: "var(--positive)" }}
            >
              <Icon name="check" size={15} />
              <span>
                <strong>{d.name}</strong> {d.created ? "ثبت شد" : "از قبل ثبت شده بود"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Family switch — the first decision, because every label and every
             tab below depends on the answer. ── */}
      {!selected && (
        <div className="seg" role="group" aria-label="نوع دارایی">
          <button
            type="button"
            onClick={() => switchFamily("fund")}
            className={family === "fund" ? "seg-on" : ""}
            aria-pressed={family === "fund"}
          >
            صندوق سرمایه‌گذاری
          </button>
          <button
            type="button"
            onClick={() => switchFamily("stock")}
            className={family === "stock" ? "seg-on" : ""}
            aria-pressed={family === "stock"}
          >
            سهام بورسی
          </button>
        </div>
      )}

      {/* ── Step 3: preview and confirm ── */}
      {selected ? (
        <div className="card space-y-3 p-4">
          <p className="muted text-[length:var(--fs-xs)]">پیش‌نمایش پیش از ثبت</p>
          <div className="flex items-center gap-3">
            {selected.kind ? <FundKindMark kind={selected.kind} size={36} /> : <StockMark size={36} />}
            <div className="min-w-0">
              <p className="text-[length:var(--fs-md)] font-bold">{selected.name}</p>
              <p className="muted mt-1 text-[length:var(--fs-xs)]">
                نماد <strong>{selected.symbol}</strong> · {selected.groupLabel}
              </p>
            </div>
          </div>
          <p className="muted text-[length:var(--fs-xs)] leading-6">
            با ثبت، این {noun} به فهرست دارایی‌های شما اضافه می‌شود ولی هنوز{" "}
            <strong>مقدار یا خریدی</strong> برایش ثبت نشده است. خرید را از بخش تراکنش‌ها با تاریخ و
            مبلغ واقعی وارد کنید تا در ارزش خالص حساب شود.
          </p>
          <p className="muted text-[length:var(--fs-xs)] leading-6">
            قیمت این {noun} فعلاً <strong>دستی</strong> به‌روزرسانی می‌شود؛ اتصال زندهٔ{" "}
            {isStock ? "قیمت بورس" : "NAV"} هنوز برقرار نیست.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn btn-primary !min-h-11"
              disabled={saving}
              onClick={() => confirm(selected.symbol, selected.name)}
            >
              تأیید و ثبت نهایی
            </button>
            <button
              type="button"
              className="btn btn-ghost !min-h-11"
              disabled={saving}
              onClick={() => setSelected(null)}
            >
              انصراف
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Step 1: search, filtered by sub-group ── */}
          <div className="flex flex-wrap gap-1.5">
            {isStock
              ? STOCK_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={sector === tab.key}
                    className={
                      sector === tab.key
                        ? "btn btn-primary !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                        : "btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                    }
                    onClick={() => setSector(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))
              : FUND_TABS.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    aria-pressed={fundKind === tab.key}
                    className={
                      fundKind === tab.key
                        ? "btn btn-primary !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                        : "btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                    }
                    onClick={() => setFundKind(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              isStock
                ? "جست‌وجوی نماد یا نام شرکت: فولاد، شستا، وبملت…"
                : "جست‌وجوی نماد یا نام صندوق: عیار، کهربا، اعتماد…"
            }
            className="field"
            aria-label={isStock ? "جست‌وجوی سهام" : "جست‌وجوی صندوق"}
          />

          {/* ── Step 2: select from results ── */}
          <ul className="space-y-1.5">
            {results.map((row) => (
              <li key={row.symbol}>
                <button
                  type="button"
                  className="card flex w-full items-center gap-3 p-3 text-right hover:bg-[color:var(--hover)]"
                  onClick={() => setSelected(row)}
                >
                  {/* For a fund the mark says what it HOLDS — the distinction a
                      reader actually needs when scanning. No issuer logo
                      conveys it, and none exists for these funds anyway. */}
                  {row.kind ? <FundKindMark kind={row.kind} size={30} /> : <StockMark size={30} />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--fs-sm)] font-semibold">
                      {row.name}
                    </span>
                    <span className="muted block text-[length:var(--fs-xs)]">{row.groupLabel}</span>
                  </span>
                  <span className="chip shrink-0 text-[length:var(--fs-xs)]">{row.symbol}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="muted card p-4 text-center text-[length:var(--fs-xs)] leading-6">
                {noun}ی با این نام در فهرست نیست. اگر نماد را می‌دانید، پایین وارد کنید.
              </li>
            )}
          </ul>

          {/* The catalogue is a seed, not an authority — an instrument that is
              not in it must still be registrable, the way the vehicle catalogue
              lets a user type a model it does not know. */}
          <details className="card p-3">
            <summary className="cursor-pointer text-[length:var(--fs-xs)] font-semibold">
              نمادم در فهرست نیست
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder={isStock ? "نماد، مثلاً: وساپا" : "نماد، مثلاً: عیار"}
                className="field min-w-0 flex-1"
                aria-label="نماد دلخواه"
              />
              <button
                type="button"
                className="btn btn-primary !min-h-11"
                disabled={saving || custom.trim().length === 0}
                onClick={() => confirm(custom.trim(), custom.trim())}
              >
                ثبت نماد
              </button>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
