"use client";
// AccountListItem.tsx — one account inside a multi-account wallet (presentation only).
//
// The server passes already-formatted strings. A formatter FUNCTION must never
// cross the server/client boundary — that used to crash «پول → حساب‌ها» with
// "Functions cannot be passed directly to Client Components".
import FormattedMoney from "@/components/ui/FormattedMoney";
import { persianAssetName } from "@/lib/format";
import AssetLogo from "@/components/ui/AssetLogo";
import DeleteAccountButton from "@/components/accounts/DeleteAccountButton";

interface AccountListItemProps {
  accountId: string;
  name: string | null;
  /** Full account identity for the delete button and confirmation. */
  accountName?: string | null;
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
  /** Shows «حذف حساب» on this row (with its own confirmation box). */
  deletable?: boolean;
}

export default function AccountListItem({
  accountId,
  name,
  accountName,
  symbol,
  balanceLabel,
  valuationLabel,
  baseValueLabel,
  logoUrl,
  assetClassName,
  brandName,
  coingeckoId,
  deletable,
}: AccountListItemProps) {
  // A trailing separator left in a stored name («بانک سامان ·») would render
  // as a lone dot next to the title.
  const safeName = persianAssetName(symbol, name ?? "").replace(/^[\s·•\-—–|,]+|[\s·•\-—–|,]+$/g, "").trim() || "بدون نام";

  // valuation exists (USDT/USD/crypto) → Toman valuation first, exact quantity
  // second («۹۴۶.۴۸ تتر»); otherwise the Toman balance with its «≈» dollar line.
  const primary = valuationLabel ?? balanceLabel;
  const secondary = valuationLabel ? balanceLabel : baseValueLabel ? `≈ ${baseValueLabel}` : null;

  return (
    <li className="list-row accounts-balance-row">
      <span className="acct-icon flex shrink-0">
        <AssetLogo
          symbol={symbol ?? "USD"}
          name={safeName}
          logoUrl={logoUrl}
          assetClassName={assetClassName}
          brandName={brandName}
          coingeckoId={coingeckoId}
          size={32}
          radius={13}
        />
      </span>
      <p className="acct-title accounts-identity min-w-0 text-sm font-medium">{safeName}</p>
      <div className="acct-amount accounts-row-amount">
        <p className="accounts-primary" dir="rtl">
          <FormattedMoney value={primary} />
        </p>
        {secondary && (
          <p className="acct-secondary accounts-secondary" dir="rtl">
            <FormattedMoney value={secondary} />
          </p>
        )}
      </div>
      {deletable && <DeleteAccountButton accountId={accountId} accountName={accountName?.trim() || safeName} compact />}
    </li>
  );
}
