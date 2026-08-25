"use client";
// AccountListItem.tsx — one money-account row (presentation only).
//
// REGRESSION FIX: this component previously received `toIrt` — a FUNCTION —
// from the Accounts server component. React Server Components cannot serialise
// functions across the server/client boundary, so every render of a page that
// had at least one wallet threw
//   "Functions cannot be passed directly to Client Components"
// and the whole «پول → حساب‌ها» page fell into the global error boundary
// («مشکلی در نمایش این صفحه پیش آمد»).
//
// The fix is a display-layer contract change only: the server passes the
// already-formatted strings it computed with its own helpers. No balance,
// rate or valuation logic moved — the numbers are produced by exactly the
// same ledger/FX code paths as before.
import AssetLogo from "@/components/ui/AssetLogo";
import { currencyLabel, formatQty } from "@/lib/format";

interface AccountListItemProps {
  accountId: string;
  name: string | null;
  symbol: string | null;
  quantity: string | null;
  assetDecimals?: number | null;
  /** Canonical balance, pre-formatted on the server. */
  balanceLabel: string;
  /** Toman valuation, pre-formatted on the server (null when not applicable). */
  valuationLabel?: string | null;
  /** Base-currency equivalent, shown when no Toman valuation exists. */
  baseValueLabel?: string | null;
  walletName?: string | null;
  /** Stored asset logo — preserved so a user's asset never changes artwork. */
  logoUrl?: string | null;
  /** Accounting asset-class name, used to classify the logo. */
  assetClassName?: string | null;
  brandName?: string | null;
  coingeckoId?: string | null;
}

export default function AccountListItem({
  name,
  symbol,
  quantity,
  assetDecimals,
  balanceLabel,
  valuationLabel,
  baseValueLabel,
  logoUrl,
  assetClassName,
  brandName,
  coingeckoId,
}: AccountListItemProps) {
  const safeName = name ?? "بدون نام";
  const safeSymbol = symbol ?? "USD";
  const safeQuantity = quantity ?? "0";

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <AssetLogo
          symbol={safeSymbol}
          name={safeName}
          logoUrl={logoUrl}
          assetClassName={assetClassName}
          brandName={brandName}
          coingeckoId={coingeckoId}
          size={24}
          radius={12}
        />
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium">{safeName}</p>
          <p className="muted num text-[10px]" dir="rtl">
            {formatQty(safeQuantity, assetDecimals ?? undefined)} {currencyLabel(safeSymbol)} — مانده اصلی
          </p>
        </div>
      </div>
      <div className="shrink-0 text-left">
        <p className="num text-[11px] font-bold money-nowrap sm:text-[12px]" dir="rtl">
          {balanceLabel}
        </p>
        {valuationLabel && (
          <p className="muted num text-[10.5px]" style={{ color: "var(--text-2)" }}>
            ارزش: {valuationLabel}
          </p>
        )}
        {!valuationLabel && baseValueLabel && (
          <p className="muted num text-[10.5px]" style={{ color: "var(--text-2)" }}>
            ≈ {baseValueLabel}
          </p>
        )}
      </div>
    </li>
  );
}
