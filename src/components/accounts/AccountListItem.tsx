"use client";
// AccountListItem.tsx — one account inside a multi-account wallet (presentation only).
//
// The server passes already-formatted strings. A formatter FUNCTION must never
// cross the server/client boundary — that used to crash «پول → حساب‌ها» with
// "Functions cannot be passed directly to Client Components".
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
  // A trailing separator left in a stored name («بانک سامان ·») would render
  // as a lone dot next to the title.
  const safeName = (name ?? "").replace(/^[\s·•\-—–|,]+|[\s·•\-—–|,]+$/g, "").trim() || "بدون نام";

  // valuation exists (USDT/USD/crypto) → Toman valuation first, exact quantity
  // second («۹۴۶.۴۸ تتر»); otherwise the Toman balance with its «≈» dollar line.
  const primary = valuationLabel ?? balanceLabel;
  const secondary = valuationLabel ? balanceLabel : baseValueLabel ? `≈ ${baseValueLabel}` : null;

  return (
    <li className="list-row">
      <span className="acct-icon flex shrink-0">
        <AssetLogo
          symbol={symbol ?? "USD"}
          name={safeName}
          logoUrl={logoUrl}
          assetClassName={assetClassName}
          brandName={brandName}
          coingeckoId={coingeckoId}
          size={26}
          radius={13}
        />
      </span>
      <p className="acct-title min-w-0 flex-1 text-[length:var(--fs-xs)] font-medium sm:text-[length:var(--fs-sm)]">{safeName}</p>
      <div className="acct-amount shrink-0 text-left">
        <p className="num money-nowrap text-[length:var(--fs-xs)] font-semibold sm:text-[length:var(--fs-sm)]" dir="rtl">
          {primary}
        </p>
        {secondary && (
          <p className="acct-secondary muted num money-nowrap text-[length:var(--fs-xs)]" dir="rtl">
            {secondary}
          </p>
        )}
      </div>
    </li>
  );
}
