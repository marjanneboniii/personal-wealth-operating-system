"use client";
// CurrencyLogo.tsx — currency / asset mark for a symbol.
//
// Delegates to the central resolver so a symbol renders the SAME image
// everywhere: Toman and USD use their local currency marks, while every
// crypto symbol (USDT, BTC, ETH, USDC, …) uses its official CoinGecko logo
// instead of a hand-drawn approximation.
import AssetLogo from "@/components/ui/AssetLogo";

interface CurrencyLogoProps {
  symbol: string;
  size?: number;
  className?: string;
  /** Stored logo of the underlying asset, when the caller has it. */
  logoUrl?: string | null;
  coingeckoId?: string | null;
  name?: string | null;
}

export default function CurrencyLogo({
  symbol,
  size = 24,
  className = "",
  logoUrl,
  coingeckoId,
  name,
}: CurrencyLogoProps) {
  return (
    <AssetLogo
      symbol={symbol}
      name={name ?? symbol}
      logoUrl={logoUrl}
      coingeckoId={coingeckoId}
      size={size}
      radius={7}
      className={className}
    />
  );
}
