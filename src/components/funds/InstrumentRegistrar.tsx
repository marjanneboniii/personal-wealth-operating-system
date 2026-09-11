"use client";

/**
 * جستجو → انتخاب → پیش‌نمایش → ثبت نهایی — the flow the brief specifies for
 * every searchable category (بخش ۲).
 *
 * The preview step is not decoration. Registering the wrong fund is easy —
 * «زر» and «زرفام» differ by three letters — and a mis-registered identity
 * later carries real transactions, so the confirmation names the fund in full
 * and states plainly what registration does and does not do. A user who thinks
 * this step recorded their holding would go on believing their net worth is
 * complete when it is not.
 *
 * Search is client-side against a bundled catalogue: it is a few dozen entries,
 * so a round trip per keystroke would be slower and would not survive the
 * unreliable connections this audience actually has.
 */
import { useMemo, useState, useTransition } from "react";
import Icon from "@/components/ui/Icon";
import { registerInstrumentAction } from "@/app/actions/funds";
import { FUND_KIND_MARKS } from "@/components/ui/AssetTypeMarks";
import {
  FUND_KIND_LABELS,
  searchFunds,
  type FundKind,
  type FundSearchResult,
} from "@/features/funds/search";

const KIND_TABS: { key: FundKind | "all"; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "gold", label: FUND_KIND_LABELS.gold },
  { key: "fixed_income", label: FUND_KIND_LABELS.fixed_income },
  { key: "etf", label: FUND_KIND_LABELS.etf },
  { key: "commodity", label: FUND_KIND_LABELS.commodity },
];

type Registered = { symbol: string; name: string; created: boolean };

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

export default function InstrumentRegistrar() {
  const [kind, setKind] = useState<FundKind | "all">("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<FundSearchResult | null>(null);
  const [custom, setCustom] = useState("");
  const [done, setDone] = useState<Registered[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const results = useMemo(
    () => searchFunds(query, { kind: kind === "all" ? undefined : kind, limit: 12 }),
    [query, kind],
  );

  const confirm = (symbol: string, name: string) => {
    setError(null);
    startSaving(() => {
      registerInstrumentAction("fund", symbol, name)
        .then((res) => {
          if (!res.ok) {
            setError(res.message ?? "ثبت ناموفق بود.");
            return;
          }
          setDone((prev) => [{ symbol, name, created: res.created ?? false }, ...prev]);
          // Straight back to an empty search — «افزودن مورد دیگر از همین
          // دسته» is the default, not a secondary action.
          setSelected(null);
          setQuery("");
          setCustom("");
        })
        .catch(() => setError("ثبت ناموفق بود. دوباره تلاش کنید."));
    });
  };

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
              key={d.symbol}
              className="card flex items-center gap-2 p-3 text-[length:var(--fs-xs)]"
              style={{ color: "var(--positive)" }}
            >
              <Icon name="check" size={15} />
              <span>
                <strong>{d.name}</strong>{" "}
                {d.created ? "ثبت شد" : "از قبل ثبت شده بود"}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* ── Step 3: preview and confirm ── */}
      {selected ? (
        <div className="card space-y-3 p-4">
          <p className="muted text-[length:var(--fs-xs)]">پیش‌نمایش پیش از ثبت</p>
          <div>
            <p className="text-[length:var(--fs-md)] font-bold">{selected.name}</p>
            <p className="muted mt-1 text-[length:var(--fs-xs)]">
              نماد <strong>{selected.symbol}</strong> · {selected.kindLabel}
            </p>
          </div>
          <p className="muted text-[length:var(--fs-xs)] leading-6">
            با ثبت، این صندوق به فهرست دارایی‌های شما اضافه می‌شود ولی هنوز <strong>مقدار یا
            خریدی</strong> برایش ثبت نشده است. خرید را از بخش تراکنش‌ها با تاریخ و مبلغ واقعی وارد
            کنید تا در ارزش خالص حساب شود.
          </p>
          <p className="muted text-[length:var(--fs-xs)] leading-6">
            قیمت این صندوق فعلاً <strong>دستی</strong> به‌روزرسانی می‌شود؛ اتصال زندهٔ NAV هنوز
            برقرار نیست.
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
          {/* ── Step 1: search, filtered by sub-kind ── */}
          <div className="flex flex-wrap gap-1.5">
            {KIND_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                aria-pressed={kind === tab.key}
                className={
                  kind === tab.key
                    ? "btn btn-primary !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                    : "btn btn-ghost !min-h-9 !px-3 text-[length:var(--fs-xs)]"
                }
                onClick={() => setKind(tab.key)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجوی نماد یا نام صندوق: عیار، کهربا، اعتماد…"
            className="field"
            aria-label="جست‌وجوی صندوق"
          />

          {/* ── Step 2: select from results ── */}
          <ul className="space-y-1.5">
            {results.map((fund) => (
              <li key={fund.symbol}>
                <button
                  type="button"
                  className="card flex w-full items-center gap-3 p-3 text-right hover:bg-[color:var(--hover)]"
                  onClick={() => setSelected(fund)}
                >
                  {/* The mark says what the fund HOLDS — the distinction a
                      reader actually needs when scanning. No issuer logo
                      conveys it, and none exists for these 58 funds anyway. */}
                  <FundKindMark kind={fund.kind} size={30} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[length:var(--fs-sm)] font-semibold">
                      {fund.name}
                    </span>
                    <span className="muted block text-[length:var(--fs-xs)]">{fund.kindLabel}</span>
                  </span>
                  <span className="chip shrink-0 text-[length:var(--fs-xs)]">{fund.symbol}</span>
                </button>
              </li>
            ))}
            {results.length === 0 && (
              <li className="muted card p-4 text-center text-[length:var(--fs-xs)] leading-6">
                صندوقی با این نام در فهرست نیست. اگر نماد را می‌دانید، پایین وارد کنید.
              </li>
            )}
          </ul>

          {/* The catalogue is a seed, not an authority — a fund that is not in
              it must still be registrable, the way the vehicle catalogue lets a
              user type a model it does not know. */}
          <details className="card p-3">
            <summary className="cursor-pointer text-[length:var(--fs-xs)] font-semibold">
              نمادم در فهرست نیست
            </summary>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="text"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="نماد، مثلاً: فولاد"
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
