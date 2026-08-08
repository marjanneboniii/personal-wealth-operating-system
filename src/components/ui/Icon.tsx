import type { JSX, SVGProps } from "react";

/**
 * PWOS Icon System — 24px grid, 1.7 stroke, round caps/joins.
 * One visual language: quiet, precise, geometric. No emoji.
 */

const PATHS: Record<string, JSX.Element> = {
  // Navigation
  overview: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  transactions: (
    <>
      <path d="M7 4v13" />
      <path d="m4 14 3 3 3-3" />
      <path d="M17 20V7" />
      <path d="m20 10-3-3-3 3" />
    </>
  ),
  accounts: (
    <>
      <path d="M3.5 9.5 12 4l8.5 5.5" />
      <path d="M5.5 10v7.5M10 10v7.5M14 10v7.5M18.5 10v7.5" />
      <path d="M3.5 20h17" />
    </>
  ),
  cashflow: (
    <>
      <path d="M4 8.5h13" />
      <path d="m14 5.5 3 3-3 3" />
      <path d="M20 15.5H7" />
      <path d="m10 18.5-3-3 3-3" />
    </>
  ),
  ledger: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v16.5H6.5A1.5 1.5 0 0 0 5 21z" />
      <path d="M5 19.5V4.5" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  portfolio: (
    <>
      <path d="M12 3.5 3.8 8.2v7.6L12 20.5l8.2-4.7V8.2z" />
      <path d="M12 12 3.8 7.3M12 12l8.2-4.7M12 12v8.5" />
    </>
  ),
  crypto: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M9.5 8.5h3.7a1.85 1.85 0 0 1 0 3.7H9.5zm0 3.7h4.2a1.85 1.85 0 0 1 0 3.7H9.5z" />
      <path d="M10.8 6.8v1.7M13.6 6.8v1.7M10.8 15.5v1.7M13.6 15.5v1.7" />
    </>
  ),
  networth: (
    <>
      <path d="m4 16.5 4.5-5 3.5 3 6-7" />
      <path d="M15 7.5h3.8v3.8" />
      <path d="M4 20.5h16" />
    </>
  ),
  budgets: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" />
      <path d="M12 12 19 5.5" />
      <path d="M14.5 3.5h5v5" />
    </>
  ),
  goals: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <circle cx="12" cy="12" r="4.8" />
      <circle cx="12" cy="12" r="1.4" />
    </>
  ),
  debts: (
    <>
      <path d="M6 3.5h12V20.5l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z" />
      <path d="M9.5 9h5M9.5 12.5h3.5" />
    </>
  ),
  installments: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
      <path d="M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2" />
    </>
  ),
  reports: (
    <>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8.5h5" />
      <path d="M9 13h6M9 16.5h6M9 9.5h2" />
    </>
  ),
  audit: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.3 3 7.7 7 9 4-1.3 7-4.7 7-9V6z" />
      <path d="m9 11.8 2.2 2.2 4-4.2" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.8v2M12 18.2v2M4.9 6.9l1.4 1.4M17.7 15.7l1.4 1.4M3.8 12h2M18.2 12h2M4.9 17.1l1.4-1.4M17.7 8.3l1.4-1.4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </>
  ),
  command: (
    <>
      <path d="M9 8.5V6a2.5 2.5 0 1 0-2.5 2.5zm0 0v6m0-6h6m-6 6H6A2.5 2.5 0 1 0 8.5 17v-2.5zm0 0V17a2.5 2.5 0 1 0 2.5-2.5zm6 0H17a2.5 2.5 0 1 0-2.5 2.5v-2.5zm0-6V6a2.5 2.5 0 1 1 2.5 2.5z" opacity="0" />
      <circle cx="6.5" cy="6.5" r="2.5" />
      <circle cx="17.5" cy="6.5" r="2.5" />
      <circle cx="6.5" cy="17.5" r="2.5" />
      <circle cx="17.5" cy="17.5" r="2.5" />
      <path d="M9 6.5h6M9 17.5h6M6.5 9v6M17.5 9v6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle cx="6" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.15" fill="currentColor" stroke="none" />
    </>
  ),

  // Status & meta
  "check-circle": (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="m8.5 12.2 2.4 2.4 4.8-5" />
    </>
  ),
  check: <path d="m5.5 12.5 4 4 9-9.5" />,
  alert: (
    <>
      <path d="M12 4 3.8 18.5h16.4z" />
      <path d="M12 10v4M12 16.8v.2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5M12 7.8v.2" />
    </>
  ),
  xcircle: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="m9.2 9.2 5.6 5.6M14.8 9.2l-5.6 5.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.5V12l3 2.5" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.5-5.8" />
      <path d="M20 3.8v4h-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10.5" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  upload: (
    <>
      <path d="M12 19.5V9" />
      <path d="m7.5 12.5 4.5-4.5 4.5 4.5" />
      <path d="M4.5 4.5h15" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  "arrow-start": <path d="M20 12H5M10 6.5 4.5 12l5.5 5.5" />,
  external: (
    <>
      <path d="M10 5.5H5.5V18.5H18.5V14" />
      <path d="M13.5 5h5.5v5.5" />
      <path d="M18.5 5.5 11 13" />
    </>
  ),
  link: (
    <>
      <path d="M10 14.5a3.8 3.8 0 0 0 5.6.3l2.7-2.7a3.9 3.9 0 0 0-5.5-5.5L11.5 8" />
      <path d="M14 9.5a3.8 3.8 0 0 0-5.6-.3l-2.7 2.7a3.9 3.9 0 0 0 5.5 5.5L12.5 16" />
    </>
  ),

  // Financial direction — NEVER rely on color alone
  "trend-up": <path d="M20 7.5 12.5 15l-4-4L3.5 16M15 7.5h5V12.5" />,
  "trend-down": <path d="M20 16.5 12.5 9l-4 4-5-5M15 16.5h5V11.5" />,
  "arrow-up": <path d="M12 19.5v-15M6.5 10 12 4.5 17.5 10" />,
  "arrow-down": <path d="M12 4.5v15M6.5 14 12 19.5 17.5 14" />,

  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M4.6 4.6 6 6M18 18l1.4 1.4M3 12h2M19 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  dot: <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />,

  wallet: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3" />
      <rect x="4" y="7.5" width="16" height="12" rx="2.5" />
      <path d="M15.5 13.5h.2" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="9" cy="7.5" rx="5.5" ry="3" />
      <path d="M3.5 7.5v5c0 1.7 2.5 3 5.5 3s5.5-1.3 5.5-3v-5" />
      <path d="M14.5 9.6c3 .3 6 1.5 6 3.4 0 1.7-2.5 3-5.5 3-1 0-2-.1-2.7-.4" />
      <path d="M3.5 12.5v4c0 1.7 2.5 3 5.5 3 1 0 1.9-.1 2.7-.4" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 9.5h18M6.5 14.5h4" />
    </>
  ),
  pie: (
    <>
      <path d="M12 3.5a8.5 8.5 0 1 1-8.5 8.5" />
      <path d="M12 3.5V12l8.5 2.8" />
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 11.3" opacity="0.7" />
    </>
  ),
  swap: (
    <>
      <path d="M7 4v13M4 14l3 3 3-3M17 20V7M20 10l-3-3-3 3" opacity="0" />
      <path d="M4 7h11M11.5 3.5 15 7l-3.5 3.5" />
      <path d="M20 17H9M12.5 13.5 9 17l3.5 3.5" />
    </>
  ),
  scale: (
    <>
      <path d="M12 4v15M8.5 20h7" />
      <path d="M4 7h16" />
      <path d="m6.5 7-2.6 6a2.9 2.9 0 0 0 5.2 0L6.5 7zM17.5 7l-2.6 6a2.9 2.9 0 0 0 5.2 0L17.5 7z" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" />
    </>
  ),
  home: (
    <>
      <path d="m4 11 8-7 8 7" />
      <path d="M6.5 9.5V20h11V9.5" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3.5 8.5 4.7-8.5 4.7-8.5-4.7z" />
      <path d="m4.5 12.5 7.5 4.2 7.5-4.2M4.5 16.5l7.5 4.2 7.5-4.2" opacity="0.6" />
    </>
  ),
  send: <path d="m4.5 11 15-6.5-4 15-4.5-6zM11 13.5l8-9" opacity="1" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4M12 3.8c2.5 2.3 3.8 5.1 3.8 8.2s-1.3 5.9-3.8 8.2c-2.5-2.3-3.8-5.1-3.8-8.2S9.5 6.1 12 3.8z" />
    </>
  ),
  lock: (
    <>
      <rect x="5.5" y="10.5" width="13" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      <path d="M12 14.5v2" />
    </>
  ),
  note: (
    <>
      <path d="M5.5 3.5h9L19 8v12.5H5.5z" />
      <path d="M14 3.5V8.5h5M8.5 12h7M8.5 15.5h5" />
    </>
  ),
  snapshot: (
    <>
      <rect x="3.5" y="6.5" width="17" height="13.5" rx="2.5" />
      <circle cx="12" cy="13" r="3.5" />
      <path d="M8.5 6.5 9.5 4h5l1 2.5" />
    </>
  ),
  import: (
    <>
      <path d="M12 3.5V12" />
      <path d="m8 8.5 4 4 4-4" />
      <path d="M4.5 15.5V18A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5v-2.5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6.5 9.5h.2M10 9.5h.2M13.5 9.5h.2M17 9.5h.2M6.5 12.5h.2M10 12.5h.2M13.5 12.5h.2M17 12.5h.2M8 15.5h8" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export default function Icon({
  name,
  size = 20,
  strokeWidth = 1.7,
  className = "",
  ...rest
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
} & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {PATHS[name] ?? null}
    </svg>
  );
}
