"use client";
// AccountListItem.tsx — one account inside a multi-account wallet (presentation only).
//
// The server passes already-formatted strings. A formatter FUNCTION must never
// cross the server/client boundary — that used to crash «پول → حساب‌ها» with
// "Functions cannot be passed directly to Client Components".
import FormattedMoney from "@/components/ui/FormattedMoney";
import { persianAssetName } from "@/lib/format";
import AssetLogo from "@/components/ui/AssetLogo";
import Link from "next/link";
import DeleteAccountButton from "@/components/accounts/DeleteAccountButton";
import RowMenu from "@/components/money/RowMenu";
import Icon from "@/components/ui/Icon";

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
    <li className="mny-acct-row mny-acct-subrow">
      <span className="acct-icon flex shrink-0">
        <AssetLogo
          symbol={symbol ?? "USD"}
          name={safeName}
          logoUrl={logoUrl}
          assetClassName={assetClassName}
          brandName={brandName}
          coingeckoId={coingeckoId}
          size={28}
          radius={10}
        />
      </span>
      <div className="mny-acct-id">
        <p className="mny-acct-name">{safeName}</p>
      </div>
      <div className="mny-acct-amount">
        <p className="mny-acct-primary" dir="rtl">
          <FormattedMoney value={primary} />
        </p>
        {secondary && (
          <p className="mny-acct-secondary" dir="rtl">
            <FormattedMoney value={secondary} />
          </p>
        )}
      </div>
      <RowMenu label={`گزینه‌های ${accountName?.trim() || safeName}`}>
        <Link href={`/transactions?account=${accountId}`} className="mny-menu-item">
          <Icon name="transactions" size={15} />
          تراکنش‌های این حساب
        </Link>
        {deletable && <DeleteAccountButton accountId={accountId} accountName={accountName?.trim() || safeName} variant="menu" />}
      </RowMenu>
    </li>
  );
}
