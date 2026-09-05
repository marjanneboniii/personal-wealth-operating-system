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
//
// UI CLEANUP (front-end only, ledger/FIFO untouched):
//   • Redundant labels («— مانده اصلی», «ارزش:») removed — the row shows the
//     primary amount + a single muted secondary line, no explanatory suffix.
//   • Amounts reuse the server's formatMoney strings (Persian digits, max 2
//     decimals, RLI…PDI bidi isolates), so crypto tickers (ETH…) keep the
//     number-first order and never flip in RTL.
//   • Title is never truncated to «…» — it wraps and uses the free space.
//   • Icon is vertically centred with the title; padding/line-height are
//     balanced so the two columns can never overlap.
import AssetLogo from "@/components/ui/AssetLogo";

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
  balanceLabel,
  valuationLabel,
  baseValueLabel,
  logoUrl,
  assetClassName,
  brandName,
  coingeckoId,
}: AccountListItemProps) {
  // A trailing separator left in a stored account name («بانک سامان ·»)
  // otherwise renders as a lone dot next to the title.
  const safeName = (name ?? "").replace(/^[\s·•\-—–|,]+|[\s·•\-—–|,]+$/g, "").trim() || "بدون نام";
  const safeSymbol = symbol ?? "USD";

  // Display-only mapping (no recalculation — strings come from the server):
  //   • valuation exists (USDT/USD/crypto) → primary is the Toman valuation,
  //     secondary is the exact canonical quantity (e.g. «۹۴۶.۴۸ تتر»).
  //   • otherwise (IRT) → primary is the Toman balance, secondary is the
  //     approximate USD equivalent («≈ … دلار»).
  const primary = valuationLabel ?? balanceLabel;
  const exactSecondary = valuationLabel ? balanceLabel : null;
  const approxSecondary = !valuationLabel && baseValueLabel ? baseValueLabel : null;

  return (
    <li className="acct-row flex items-center justify-between gap-3 px-4 py-3.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="acct-icon flex shrink-0 self-center">
          <AssetLogo
            symbol={safeSymbol}
            name={safeName}
            logoUrl={logoUrl}
            assetClassName={assetClassName}
            brandName={brandName}
            coingeckoId={coingeckoId}
            size={28}
            radius={14}
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="acct-title text-[12.5px] font-semibold sm:text-[13px]">{safeName}</p>
        </div>
      </div>
      <div className="acct-amount max-w-[48%] shrink-0 text-left">
        <p className="num money-nowrap text-[12px] font-bold leading-6 sm:text-[13px]" dir="rtl">
          {primary}
        </p>
        {exactSecondary && (
          <p className="acct-secondary muted num money-nowrap mt-0.5 text-[10.5px] leading-5" dir="rtl">
            {exactSecondary}
          </p>
        )}
        {!exactSecondary && approxSecondary && (
          <p className="acct-secondary muted num money-nowrap mt-0.5 text-[10.5px] leading-5" dir="rtl">
            ≈ {approxSecondary}
          </p>
        )}
      </div>
    </li>
  );
}
