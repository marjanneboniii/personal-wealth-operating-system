"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  refreshWallexCatalogAction,
  registerWallexAssetAction,
  searchWallexCatalogAction,
  type WallexCatalogActionResult,
} from "@/app/actions/pricing";
import type { WallexCatalogResult } from "@/features/pricing/wallexCatalog";
import AssetLogo from "@/components/ui/AssetLogo";
import { formatMoney, toFaDigits } from "@/lib/format";

type Props = {
  /**
   * Called after an asset is registered. The caller decides what happens next —
   * the purchase form selects the new account, the standalone page just lists
   * it. The picker itself never navigates.
   */
  onRegistered?: (result: { symbol: string; displayName: string; accountId?: string }) => void;
  /** Restrict to one family, e.g. "gold" for the tokenised metals. */
  kind?: string;
  /** Rows to show. The list is scrollable; this only bounds the fetch. */
  limit?: number;
};

const KIND_TABS: { key: string; label: string }[] = [
  { key: "all", label: "همه" },
  { key: "crypto", label: "رمزارز" },
  { key: "stablecoin", label: "استیبل‌کوین" },
  { key: "gold", label: "فلز توکنیزه" },
];

/**
 * انتخاب دارایی از کاتالوگ والکس — با نام فارسی و هر دو قیمت.
 *
 * WHY BOTH PRICES ARE ON EVERY ROW
 * «قیمت تومانی» is what the purchase actually costs, and «قیمت تتری» is how
 * this market talks about value. A user checks the first to know what they are
 * spending and the second to compare against the global market without doing
 * FX arithmetic in their head. The two come from two different markets on the
 * exchange and NEITHER is computed from the other — a Toman market carries its
 * own premium, so a derived figure would match neither screen the user is
 * comparing against. A row that trades in only one market shows one price and
 * says «—» for the other rather than inventing it.
 *
 * SELECTING IS REGISTERING, NOT BUYING. A click creates the asset identity and
 * the tenant's asset account, opening at zero. No entry, no posting, no lot, no
 * balance — the purchase form remains the only path that touches accounting.
 */
export default function WallexAssetPicker({ onRegistered, kind, limit = 100 }: Props) {
  const [query, setQuery] = useState("");
  const [activeKind, setActiveKind] = useState<string>(kind ?? "all");
  const [rows, setRows] = useState<WallexCatalogResult[]>([]);
  const [status, setStatus] = useState<WallexCatalogActionResult | null>(null);
  const [searching, setSearching] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /**
   * «آخرین به‌روزرسانی …» is resolved WHEN THE RESPONSE ARRIVES, not during
   * render: reading the clock while rendering is impure and makes the output
   * depend on when React happened to re-run the component.
   */
  const [syncedLabel, setSyncedLabel] = useState<string | null>(null);

  // The search is debounced and the response is guarded by a sequence number:
  // a slow early request must never overwrite the results of a later one the
  // user is already looking at.
  const seq = useRef(0);

  /** Relative age of a sync timestamp, evaluated once against the clock. */
  const describeSync = useCallback((iso: string | null): string | null => {
    if (!iso) return null;
    const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
    if (minutes < 1) return "همین الان";
    return `${toFaDigits(String(minutes))} دقیقه پیش`;
  }, []);

  useEffect(() => {
    const mine = ++seq.current;
    const timer = window.setTimeout(async () => {
      setSearching(true);
      const effectiveKind = kind ?? (activeKind === "all" ? undefined : activeKind);
      const response = await searchWallexCatalogAction(query.trim(), effectiveKind);
      if (mine !== seq.current) return;
      setRows(response.assets.slice(0, limit));
      setStatus(response);
      setSyncedLabel(describeSync(response.syncedAt));
      setSearching(false);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, activeKind, kind, limit, describeSync]);

  const refresh = async () => {
    setRefreshing(true);
    setMessage(null);
    const response = await refreshWallexCatalogAction();
    setRows(response.assets.slice(0, limit));
    setStatus(response);
    setSyncedLabel(describeSync(response.syncedAt));
    setMessage(response.message ?? null);
    setRefreshing(false);
  };

  const register = async (asset: WallexCatalogResult) => {
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
      });
    }
  };

  return (
    <div className="space-y-3" dir="rtl">
      {!kind && (
        <div className="seg flex-wrap" role="group" aria-label="نوع دارایی">
          {KIND_TABS.map((tab) => (
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
        type="text"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="جست‌وجو: بیت‌کوین، تتر، تترگلد، BTC…"
        className="field"
        aria-label="جست‌وجوی دارایی در کاتالوگ والکس"
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
          {status ? `${toFaDigits(String(status.total))} دارایی` : "…"}
          {syncedLabel ? ` · آخرین به‌روزرسانی ${syncedLabel}` : ""}
          {searching ? " · در حال جست‌وجو…" : ""}
        </span>
      </div>

      {/* A stale price is disclosed, never quietly shown as current. */}
      {status?.freshness === "stale" && (
        <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="status">
          اتصال به والکس برقرار نشد؛ قیمت‌های زیر آخرین مقادیر ذخیره‌شده‌اند و ممکن است به‌روز نباشند.
        </p>
      )}
      {status?.freshness === "unavailable" && (
        <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="status">
          کاتالوگ والکس هنوز دریافت نشده است. «به‌روزرسانی قیمت‌ها» را بزنید؛ اگر باز هم خالی ماند،
          دسترسی شبکهٔ سرور به <span dir="ltr">api.wallex.ir</span> را بررسی کنید.
        </p>
      )}

      <ul className="max-h-80 space-y-1.5 overflow-y-auto rounded-[var(--r-md)] border p-2" style={{ borderColor: "var(--border)" }}>
        {rows.map((asset) => (
          <li key={asset.symbol}>
            <button
              type="button"
              disabled={registering !== null}
              onClick={() => register(asset)}
              className="flex w-full min-h-12 items-center gap-2.5 rounded-[var(--r-sm)] px-2.5 py-2 text-start hover:bg-[var(--hover)] disabled:opacity-60"
            >
              <AssetLogo
                symbol={asset.symbol}
                name={asset.displayName}
                logoUrl={asset.logoUrl}
                size={30}
                radius={9}
              />
              <span className="min-w-0 flex-1">
                <b className="flex flex-wrap items-center gap-1.5 truncate text-xs">
                  {asset.displayName}
                  <span className="muted num" dir="ltr">{asset.symbol}</span>
                  <span className="chip text-[length:var(--fs-xs)]">{asset.kindLabel}</span>
                </b>
                {/* Two markets, two figures, each labelled with the market it
                    came from — so the user is never left guessing which unit a
                    bare number is in. */}
                <small className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[length:var(--fs-xs)]">
                  <span className="num" dir="rtl">
                    <span className="muted">تومانی: </span>
                    {asset.priceTmn ? (
                      <b>{formatMoney(asset.priceTmn, "IRT")}</b>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                  <span className="num" dir="rtl">
                    <span className="muted">تتری: </span>
                    {asset.priceUsdt ? (
                      <b>{formatMoney(asset.priceUsdt, "USDT")}</b>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </span>
                </small>
              </span>
              <span className="chip shrink-0">{registering === asset.symbol ? "…" : "ثبت"}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="muted p-3 text-center text-[length:var(--fs-xs)]">
            {searching ? "در حال جست‌وجو…" : "دارایی‌ای با این نام پیدا نشد."}
          </li>
        )}
      </ul>

      {message && (
        <p className="text-[length:var(--fs-xs)] leading-5" role="status">
          {message}
        </p>
      )}

      <p className="muted text-[length:var(--fs-xs)] leading-5">
        با ثبت، این دارایی به فهرست شما اضافه می‌شود ولی هنوز <strong>مقدار یا ارزشی ندارد</strong>؛
        برای ورود به دارایی‌ها، خرید را با مقدار و قیمت واقعی ثبت کنید.
      </p>
    </div>
  );
}
