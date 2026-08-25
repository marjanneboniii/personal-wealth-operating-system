// TomanIcon.tsx
import React from "react";

interface TomanIconProps {
  size?: number;
  bgColor?: string;
  letterColor?: string;
}

const TomanIcon: React.FC<TomanIconProps> = ({
  size = 48,
  bgColor = "#B8F4E8",
  letterColor = "#0D3B36",
}) => {
  const d =
    "M15 22 C15 30 19 32 24 32 " +
    "C29 32 33 30 33 22 " +
    "C33 19 26.4 17 22 17";

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill={bgColor} />
      <g transform="scale(-1,1) translate(-48,0)">
        <path d={d} stroke={letterColor} strokeWidth="3.2" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
};

export default TomanIcon;
