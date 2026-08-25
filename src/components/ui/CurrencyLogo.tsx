"use client";
// CurrencyLogo.tsx - Client component for rendering currency icons
import { CurrencyIcon } from "./CurrencyIcons";

interface CurrencyLogoProps {
  symbol: string;
  size?: number;
  className?: string;
}

export default function CurrencyLogo({ symbol, size = 24, className = "" }: CurrencyLogoProps) {
  return (
    <span className={`inline-flex shrink-0 rounded-[7px] overflow-hidden ${className}`} style={{ width: size, height: size }}>
      <CurrencyIcon symbol={symbol} size={size} />
    </span>
  );
}
