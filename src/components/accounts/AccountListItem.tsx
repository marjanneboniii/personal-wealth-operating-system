"use client";
// AccountListItem.tsx - Client component for rendering account list items with currency icons
import CurrencyLogo from "@/components/ui/CurrencyLogo";
import { formatMoney, formatQty, currencyLabel } from "@/lib/format";

interface AccountListItemProps {
  accountId: string;
  name: string | null;
  symbol: string | null;
  quantity: string | null;
  assetDecimals?: number | null;
  baseValue: string | null;
  walletName?: string | null;
  toIrt: (usd: string | number) => string | null;
}

export default function AccountListItem({
  accountId,
  name,
  symbol,
  quantity,
  assetDecimals,
  baseValue,
  walletName,
  toIrt,
}: AccountListItemProps) {
  const safeName = name ?? "بدون نام";
  const safeSymbol = symbol ?? "USD";
  const safeQuantity = quantity ?? "0";
  const safeBaseValue = baseValue ?? "0";

  const canonicalBalance = () => {
    if (safeSymbol === "IRT") return formatMoney(Math.abs(Number(safeQuantity)).toFixed(0), "IRT");
    if (safeSymbol === "IRR") return formatMoney(Math.abs(Number(safeQuantity) / 10).toFixed(0), "IRT");
    if (safeSymbol === "USDT") return formatMoney(Math.abs(Number(safeQuantity)).toString(), "USDT");
    if (safeSymbol === "USD") return formatMoney(Math.abs(Number(safeQuantity)).toString(), "USD");
    return formatMoney(Math.abs(Number(safeQuantity)).toString(), safeSymbol || "USD");
  };

  const valuationToman = () => {
    if (safeSymbol === "IRT" || safeSymbol === "IRR") return null;
    if (safeSymbol === "USDT" || safeSymbol === "USD") {
      return toIrt(Math.abs(Number(safeQuantity)).toString()) ?? formatMoney(Math.abs(Number(safeBaseValue)).toString(), "IRT");
    }
    return toIrt(safeBaseValue) ?? null;
  };

  const bal = canonicalBalance();
  const val = valuationToman();

  return (
    <li className="flex items-center justify-between gap-3 px-4 py-2.5">
      <div className="min-w-0 flex items-center gap-2.5">
        <CurrencyLogo symbol={safeSymbol} size={24} />
        <div className="min-w-0">
          <p className="truncate text-[12.5px] font-medium">{safeName}</p>
          <p className="muted num text-[10px]" dir="rtl">
            {formatQty(safeQuantity, assetDecimals ?? undefined)} {currencyLabel(safeSymbol)} — مانده اصلی
          </p>
        </div>
      </div>
      <div className="shrink-0 text-left">
        <p className="num text-[11px] sm:text-[12px] font-bold money-nowrap" dir="rtl">
          {bal}
        </p>
        {val && (
          <p className="muted num text-[10.5px]" style={{ color: "var(--text-2)" }}>ارزش: {val}</p>
        )}
        {safeSymbol !== "IRT" && safeSymbol !== "IRR" && !val && toIrt(safeBaseValue) && (
          <p className="muted num text-[10.5px]" style={{ color: "var(--text-2)" }}>≈ {formatMoney(safeBaseValue)}</p>
        )}
      </div>
    </li>
  );
}
