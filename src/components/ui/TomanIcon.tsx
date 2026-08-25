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
    "M15 22 C15 27.5 19 29.5 24 29.5 " +
    "C29 29.5 33 27.5 33 22 " +
    "C33 21.4 25.8 21 21 21";

  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="24" cy="24" r="24" fill={bgColor} />
      <g transform="scale(-1,1) translate(-48,0)">
        <path d={d} stroke={letterColor} strokeWidth="1.7" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
};

export default TomanIcon;
