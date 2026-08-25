// UsdtIcon.tsx
import React from "react";

interface UsdtIconProps {
  size?: number;
}

const UsdtIcon: React.FC<UsdtIconProps> = ({
  size = 48,
}) => {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="22" fill="#26a17b"/>
      <text x="24" y="32" textAnchor="middle" fontFamily="Arial, sans-serif" fontWeight="bold" fontSize="20" fill="white">₮</text>
    </svg>
  );
};

export default UsdtIcon;
