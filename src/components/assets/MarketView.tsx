"use client";

/**
 * نمای بازار — sections by kind, instant search, both prices per row.
 *
 * The server hands over every row once; everything after that — section
 * switching, typing, «نمایش بیشتر» — is in-memory work in the browser. The
 * shared catalogue copy is primed from here, so a picker opened later in the
 * session loads nothing.
 *
 * No exchange name appears anywhere on this screen.
 */
import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { MarketCatalogLoadResult } from "@/app/actions/pricing";
import { rankMarketRows } from "@/features/pricing/marketSearch";
import { MARKET_KIND_ORDER, WALLEX_KIND_LABELS } from "@/features/pricing/wallexKinds";
import AssetLogo from "@/components/ui/AssetLogo";
import { formatMoney, toFaDigits } from "@/lib/format";
import { primeMarketCatalog, refreshMarketCatalog } from "./marketCatalogClient";

const PAGE = 50;

export default function MarketView({ initial }: { initial: MarketCatalogLoadResult }) {
  const [catalog, setCatalog] = useState(initial);
  const [section, setSection] = useState<string>("all");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [shown, setShown] = useState(PAGE);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => primeMarketCatalog(initial), [initial]);

  const counts = useMemo(() => {
    const out = new Map<string, number>();
    for (const row of catalog.rows) out.set(row.kind, (out.get(row.kind) ?? 0) + 1);
    return out;
  }, [catalog.rows]);

  const sections = MARKET_KIND_ORDER.filter((k) => (counts.get(k) ?? 0) > 0);

  const matches = useMemo(
    () => rankMarketRows(catalog.rows, deferredQuery, { kinds: section === "all" ? undefined : [section] }),
    [catalog.rows, deferredQuery, section],
  );

  const pick = (next: string) => {
    setSection(next);
    setShown(PAGE);
  };

  const refresh = async () => {
    setRefreshing(true);
    const result = await refreshMarketCatalog();
    if (result.rows.length > 0) setCatalog(result);
    setMessage(result.message ?? null);
    setRefreshing(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="seg max-w-full flex-wrap" role="group" aria-label="بخش بازار">
        <button type="button" aria-pressed={section === "all"} className={section === "all" ? "seg-on" : ""} onClick={() => pick("all")}>
          همه <span className="muted num">{toFaDigits(String(catalog.rows.length))}</span>
        </button>
        {sections.map((k) => (
          <button key={k} type="button" aria-pressed={section === k} className={section === k ? "seg-on" : ""} onClick={() => pick(k)}>
            {WALLEX_KIND_LABELS[k]} <span className="muted num">{toFaDigits(String(counts.get(k) ?? 0))}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setShown(PAGE);
          }}
          placeholder="جست‌وجوی نام یا نماد: بیت‌کوین، مونرو، اپل، S&P، نفت…"
          className="field min-w-0 flex-1"
          aria-label="جست‌وجوی نماد"
          autoComplete="off"
        />
        <button type="button" onClick={refresh} disabled={refreshing} className="btn btn-ghost shrink-0">
          {refreshing ? "در حال به‌روزرسانی…" : "به‌روزرسانی قیمت‌ها"}
        </button>
      </div>

      {catalog.freshness === "stale" && (
        <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="status">
          قیمت‌ها در حال به‌روزرسانی‌اند؛ تا آن زمان آخرین قیمت ذخیره‌شده نمایش داده می‌شود.
        </p>
      )}
      {catalog.freshness === "unavailable" && (
        <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="status">
          فهرست بازار هنوز دریافت نشده است. «به‌روزرسانی قیمت‌ها» را بزنید.
        </p>
      )}
      {message && (
        <p className="text-[length:var(--fs-xs)] leading-5" role="status">
          {message}
        </p>
      )}

      <ul className="card divide-y overflow-hidden" style={{ borderColor: "var(--border)" }}>
        {matches.slice(0, shown).map((row) => (
          <li key={row.symbol} className="flex min-h-14 items-center gap-3 px-3 py-2.5">
            <AssetLogo symbol={row.symbol} name={row.displayName} logoUrl={row.logoUrl} size={32} radius={9} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <b className="truncate text-[length:var(--fs-sm)]">{row.displayName}</b>
                <span className="muted num text-[length:var(--fs-xs)]" dir="ltr">{row.symbol}</span>
              </div>
              <span className="chip mt-0.5 text-[length:var(--fs-xs)]">{row.kindLabel}</span>
            </div>
            <div className="shrink-0 text-end text-[length:var(--fs-xs)] leading-5">
              <div className="num" dir="rtl">
                {row.priceTmn ? <b>{formatMoney(row.priceTmn, "IRT")}</b> : <span className="muted">—</span>}
              </div>
              <div className="num muted" dir="rtl">
                {row.priceUsdt ? formatMoney(row.priceUsdt, "USDT") : "—"}
              </div>
            </div>
          </li>
        ))}
        {matches.length === 0 && (
          <li className="muted p-6 text-center text-[length:var(--fs-sm)]">نمادی با این نام پیدا نشد.</li>
        )}
      </ul>

      {matches.length > shown && (
        <button type="button" className="btn btn-ghost w-full" onClick={() => setShown((n) => n + PAGE)}>
          نمایش بیشتر ({toFaDigits(String(matches.length - shown))} نماد دیگر)
        </button>
      )}

      <p className="muted text-[length:var(--fs-xs)] leading-6">
        این صفحه فقط قیمت بازار را نشان می‌دهد. برای ثبت خرید یا فروش به{" "}
        <Link href="/new?type=buy" className="font-medium">
          ثبت تراکنش
        </Link>{" "}
        بروید.
      </p>
    </div>
  );
}
