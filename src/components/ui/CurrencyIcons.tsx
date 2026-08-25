// CurrencyIcons.tsx - React components for currency logos
import React from "react";
import TomanIcon from "./TomanIcon";
import UsdtIcon from "./UsdtIcon";

interface CurrencyIconProps {
  symbol: string;
  size?: number;
}

export const CurrencyIcon: React.FC<CurrencyIconProps> = ({ symbol, size = 48 }) => {
  const s = symbol.toUpperCase();
  
  if (s === "IRT" || s === "IRR") {
    return <TomanIcon size={size} />;
  }
  
  if (s === "USDT") {
    return <UsdtIcon size={size} />;
  }
  
  if (s === "USD") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="12" fill="#1d4ed8"/>
        <circle cx="24" cy="24" r="15" fill="none" stroke="#dbeafe" strokeWidth="1.6"/>
        <text x="24" y="29.5" textAnchor="middle" fontFamily="Georgia, serif" fontSize="20" fontWeight="700" fill="#dbeafe">$</text>
      </svg>
    );
  }
  
  if (s === "BTC") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="22" fill="#f7931a"/>
        <text x="24" y="30" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="18" fill="white">₿</text>
      </svg>
    );
  }
  
  if (s === "ETH") {
    return (
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="24" cy="24" r="22" fill="#627eea"/>
        <text x="24" y="30" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="18" fill="white">Ξ</text>
      </svg>
    );
  }
  
  // Default fallback
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#6e6ff0"/>
      <path d="M24 10 L36 18 L36 38 L12 38 L12 18 Z" fill="white" opacity="0.9"/>
      <rect x="20" y="28" width="8" height="10" fill="#6e6ff0"/>
    </svg>
  );
};

export { TomanIcon, UsdtIcon };
