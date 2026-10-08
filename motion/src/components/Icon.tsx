import type { JSX } from "react";

/** Subset of the product icon system (24px grid, 1.7 stroke, round joins). */
const PATHS = {
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" /><rect x="4" y="7.5" width="16" height="12" rx="2.5" /><path d="M15.5 13.5h.2" /></>,
  installments: <><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" /><path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" /></>,
  portfolio: <><path d="M12 3.5 3.8 8.2v7.6L12 20.5l8.2-4.7V8.2z" /><path d="M12 12 3.8 7.3M12 12l8.2-4.7M12 12v8.5" /></>,
  budgets: <><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" /><path d="M12 12 19 5.5" /><path d="M14.5 3.5h5v5" /></>,
  debts: <><path d="M6 3.5h12V20.5l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" /><path d="M9.5 9h5M9.5 12.5h3.5" /></>,
  networth: <><path d="m4 16.5 4.5-5 3.5 3 6-7" /><path d="M15 7.5h3.8v3.8" /><path d="M4 20.5h16" /></>,
  crypto: <><circle cx="12" cy="12" r="8.2" /><path d="M9.5 8.5h3.7a1.85 1.85 0 0 1 0 3.7H9.5zm0 3.7h4.2a1.85 1.85 0 0 1 0 3.7H9.5z" /><path d="M10.8 6.8v1.7M13.6 6.8v1.7M10.8 15.5v1.7M13.6 15.5v1.7" /></>,
  coins: <><ellipse cx="9" cy="7.5" rx="5.5" ry="3" /><path d="M3.5 7.5v5c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-5" /></>,
  shield: <path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6z" />,
  check: <path d="m5.5 12.5 4 4 9-9.5" />,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  "trend-up": <path d="M20 7.5 12.5 15l-4-4L3.5 16M15 7.5h5V12.5" />,
  "arrow-start": <path d="M20 12H5M10 6.5 4.5 12l5.5 5.5" />,
  sparkle: <path d="m12 4 1.8 5.2L19 11l-5.2 1.8L12 18l-1.8-5.2L5 11l5.2-1.8z" />,
  bank: <><path d="M3.5 9.5 12 4l8.5 5.5z" /><path d="M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5M3.5 20h17" /></>,
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 40, stroke = 1.7, tint = "currentColor" }: { name: IconName; size?: number; stroke?: number; tint?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={tint} strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {PATHS[name]}
    </svg>
  );
}
