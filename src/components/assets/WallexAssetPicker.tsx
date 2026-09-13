"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { registerWallexAssetAction, type MarketCatalogLoadResult, type RegisterMarketAssetResult } from "@/app/actions/pricing";
import { rankMarketRows, type MarketRow } from "@/features/pricing/marketSearch";
import { MARKET_KIND_ORDER, WALLEX_KIND_LABELS } from "@/features/pricing/wallexKinds";
import AssetLogo from "@/components/ui/AssetLogo";
import { formatMoney, toFaDigits } from "@/lib/format";
import { loadMarketCatalog, refreshMarketCatalog, subscribeMarketCatalog } from "./marketCatalogClient";

type Props = {
  /**
   * Called after an asset is registered. The caller decides what happens next —
   * the purchase form selects the new account, the standalone page just lists
   * it. The picker itself never navigates.
   */
  onRegistered?: (result: {
    symbol: string;
    displayName: string;
    accountId?: string;
    account?: RegisterMarketAssetResult["account"];
    /** The market row that was picked — name, logo and both prices. */
    row: MarketRow;
  }) => void;
  /**
   * Called INSTEAD of registering, when the caller only needs the pick — the
   * setup wizard registers inside its own transaction at the very end, so a
   * click there must not write anything yet.
   */
  onPick?: (asset: MarketRow) => void;
  /** Restrict to one family, e.g. "gold" for the tokenised metals. */
  kind?: string;
  /** Restrict the tabs to these families. */
  kinds?: readonly string[];
  /** Symbols to leave out — e.g. the ones already on a wizard list. */
  exclude?: readonly string[];
  /** Label on each row's button. */
  actionLabel?: string;
  /** Hide the «registration is not purchase» footnote where it does not apply. */
  hideFootnote?: boolean;
  /** Rows rendered at once. Search covers everything; this bounds the DOM. */
  limit?: number;
};

/**
 * انتخاب دارایی از بازار — نام فارسی، نماد، و هر دو قیمت.
 *
 * FAST BY CONSTRUCTION
 * The catalogue is loaded once per session (marketCatalogClient) and every
 * keystroke is ranked in memory by the same function the server uses. No
 * request per keystroke, no debounce to wait out. `useDeferredValue` keeps the
 * input itself responsive while a long list re-renders.
 *
 * NO EXCHANGE NAMES. A row shows the asset — its name, symbol, kind and two
 * prices — never where the quote came from.
 *
 * SELECTING IS REGISTERING, NOT BUYING. A click creates the asset identity and
 * the tenant's asset account, opening at zero. The purchase form remains the
 * only path that touches accounting.
 */
export default function WallexAssetPicker({
  onRegistered,
  onPick,
  kind,
  kinds,
  exclude,
  actionLabel = "ثبت",
  hideFootnote = false,
  limit = 60,
}: Props) {
  const [catalog, setCatalog] = useState<MarketCatalogLoadResult | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [activeKind, setActiveKind] = useState<string>(kind ?? "all");
  const [refreshing, setRefreshing] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadMarketCatalog().then((result) => {
      if (alive) setCatalog(result);
    });
    const unsubscribe = subscribeMarketCatalog((result) => setCatalog(result));
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  const rows = useMemo(() => catalog?.rows ?? [], [catalog]);
  // A stable string key, so a caller passing a fresh array literal on every
  // render does not re-rank the list.
  const kindsKey = kinds ? kinds.join(",") : "";
  const allowed = useMemo(
    () => (kind ? [kind] : kindsKey ? kindsKey.split(",") : null),
    [kind, kindsKey],
  );

  /** Tabs for the kinds that actually have rows, in the product's order. */
  const tabs = useMemo(() => {
    const present = new Set(rows.map((r) => r.kind));
    return MARKET_KIND_ORDER.filter((k) => present.has(k) && (!allowed || allowed.includes(k))).map((k) => ({
      key: k as string,
      label: WALLEX_KIND_LABELS[k],
    }));
  }, [rows, allowed]);

  const matches = useMemo(() => {
    const effective = activeKind === "all" ? allowed ?? undefined : [activeKind];
    const excluded = exclude?.length ? new Set(exclude) : null;
    const ranked = rankMarketRows(rows, deferredQuery, { kinds: effective });
    return excluded ? ranked.filter((r) => !excluded.has(r.symbol)) : ranked;
  }, [rows, deferredQuery, activeKind, allowed, exclude]);
  const visible = matches.slice(0, limit);

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    const result = await refreshMarketCatalog();
    if (result.rows.length > 0) setCatalog(result);
    setMessage(result.message ?? null);
    setRefreshing(false);
  };

  const register = async (asset: MarketRow) => {
    if (onPick) {
      onPick(asset);
      return;
    }
    setRegistering(asset.symbol);
    setMessage(null);
    const response = await registerWallexAssetAction(asset.symbol);
    setMessage(response.message ?? null);
    setRegistering(null);
    if (response.ok) {
      onRegistered?.({
        symbol: asset.symbol,
        displayName: asset.displayName,
        accountId: response.account?.id,
        account: response.account,
        row: asset,
      });
    }
  };

  const loading = catalog === null;

  return (
    <div className="space-y-3" dir="rtl">
      {!kind && tabs.length > 1 && (
        <div className="seg max-w-full flex-wrap" role="group" aria-label="نوع دارایی">
          {[{ key: "all", label: "همه" }, ...tabs].map((tab) => (
            <button
              key={tab.key}
              type="button"
              aria-pressed={activeKind === tab.key}
              className={activeKind === tab.key ? "seg-on" : ""}
              onClick={() => setActiveKind(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="جست‌وجو: بیت‌کوین، دوج، اپل، S&P، نفت، BTC…"
        className="field"
        aria-label="جست‌وجوی نماد"
        autoComplete="off"
      />

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={refresh}
          disabled={refreshing}
          className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
        >
          {refreshing ? "در حال به‌روزرسانی…" : "به‌روزرسانی قیمت‌ها"}
        </button>
        <span className="muted text-[length:var(--fs-xs)]">
          {loading ? "در حال بارگذاری…" : `${toFaDigits(String(matches.length))} نماد`}
        </span>
      </div>

      {/* A stale price is disclosed, never quietly shown as current. */}
      {catalog?.freshness === "stale" && (
        <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="status">
          قیمت‌ها در حال به‌روزرسانی‌اند؛ تا آن زمان آخرین قیمت ذخیره‌شده نمایش داده می‌شود.
        </p>
      )}
      {catalog?.freshness === "unavailable" && (
        <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="status">
          فهرست بازار هنوز دریافت نشده است. «به‌روزرسانی قیمت‌ها» را بزنید.
        </p>
      )}

      <ul className="max-h-80 space-y-1.5 overflow-y-auto rounded-[var(--r-md)] border p-2" style={{ borderColor: "var(--border)" }}>
        {visible.map((asset) => (
          <li key={asset.symbol}>
            <button
              type="button"
              disabled={registering !== null}
              onClick={() => register(asset)}
              className="flex w-full min-h-12 items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-start hover:bg-[var(--hover)] disabled:opacity-60"
            >
              <AssetLogo symbol={asset.symbol} name={asset.displayName} logoUrl={asset.logoUrl} size={30} radius={9} />
              <span className="min-w-0 flex-1">
                <b className="flex flex-wrap items-center gap-1.5 truncate text-xs">
                  {asset.displayName}
                  <span className="muted num" dir="ltr">{asset.symbol}</span>
                  <span className="chip text-[length:var(--fs-xs)]">{asset.kindLabel}</span>
                </b>
                <small className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[length:var(--fs-xs)]">
                  <span className="num" dir="rtl">
                    <span className="muted">تومانی: </span>
                    {asset.priceTmn ? <b>{formatMoney(asset.priceTmn, "IRT")}</b> : <span className="muted">—</span>}
                  </span>
                  <span className="num" dir="rtl">
                    <span className="muted">تتری: </span>
                    {asset.priceUsdt ? <b>{formatMoney(asset.priceUsdt, "USDT")}</b> : <span className="muted">—</span>}
                  </span>
                </small>
              </span>
              <span className="chip shrink-0">{registering === asset.symbol ? "…" : actionLabel}</span>
            </button>
          </li>
        ))}
        {!loading && visible.length === 0 && (
          <li className="muted p-3 text-center text-[length:var(--fs-xs)]">نمادی با این نام پیدا نشد.</li>
        )}
        {loading && <li className="muted p-3 text-center text-[length:var(--fs-xs)]">در حال بارگذاری…</li>}
        {matches.length > visible.length && (
          <li className="muted p-2 text-center text-[length:var(--fs-xs)]">
            {toFaDigits(String(matches.length - visible.length))} نماد دیگر — برای یافتن، نام یا نماد را جست‌وجو کنید.
          </li>
        )}
      </ul>

      {message && (
        <p className="text-[length:var(--fs-xs)] leading-5" role="status">
          {message}
        </p>
      )}

      {!hideFootnote && (
        <p className="muted text-[length:var(--fs-xs)] leading-5">
          با ثبت، این دارایی به فهرست شما اضافه می‌شود ولی هنوز <strong>مقدار یا ارزشی ندارد</strong>؛
          برای ورود به دارایی‌ها، خرید را با مقدار و قیمت واقعی ثبت کنید.
        </p>
      )}
    </div>
  );
}
