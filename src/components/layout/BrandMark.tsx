/**
 * BrandMark — نشان «توازن»: ترازوی هندسی متقارن
 * (تیر افقی، تکیه‌گاه مثلثی، دو حلقهٔ هم‌سطح).
 *
 * صرفاً تزئینی است؛ هیچ منطق مالی/حسابداری ندارد.
 */
import type { CSSProperties } from "react";

function ScaleGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="14" cy="22" r="7" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="50" cy="22" r="7" stroke="currentColor" strokeWidth="2.4" />
      <line
        x1="14"
        y1="22"
        x2="50"
        y2="22"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M32 24.5 L22.5 50 H41.5 Z" fill="currentColor" />
    </svg>
  );
}

export default function BrandMark({
  size = 24,
  style,
  className,
  framed = false,
}: {
  size?: number;
  style?: CSSProperties;
  className?: string;
  /** کاشی نیلی با خطوط طلایی — برای هدر اپ روی پس‌زمینه روشن */
  framed?: boolean;
}) {
  if (framed) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: Math.max(8, Math.round(size * 0.22)),
          background: "var(--color-primary)",
          color: "var(--color-accent)",
          flexShrink: 0,
          ...style,
        }}
        aria-hidden="true"
      >
        <ScaleGlyph size={Math.round(size * 0.72)} />
      </span>
    );
  }

  return (
    <span className={className} style={{ color: "currentColor", display: "inline-flex", ...style }} aria-hidden="true">
      <ScaleGlyph size={size} />
    </span>
  );
}

/** وردمارک «توازن» — Vazirmatn Black */
export function BrandWordmark({ className = "" }: { className?: string }) {
  return <span className={`brand-wordmark ${className}`.trim()}>توازن</span>;
}

/** قفل لوگو: نشان + وردمارک، افقی یا عمودی */
export function BrandLockup({
  variant = "horizontal",
  markSize = 28,
  framed = false,
  subtitle,
  onDark = false,
}: {
  variant?: "horizontal" | "stacked";
  markSize?: number;
  framed?: boolean;
  subtitle?: string;
  onDark?: boolean;
}) {
  const color = onDark ? "var(--color-accent)" : "var(--color-primary)";
  const word = (
    <span className="leading-tight">
      <BrandWordmark className="block text-[15px] tracking-tight" />
      {subtitle && (
        <span className={`block text-[10px] ${onDark ? "landing-on-primary-muted" : "muted"}`}>{subtitle}</span>
      )}
    </span>
  );

  if (variant === "stacked") {
    return (
      <span className="inline-flex flex-col items-center gap-2 text-center" style={{ color }}>
        <BrandMark size={markSize} framed={framed} style={framed ? undefined : { color }} />
        {word}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2.5" style={{ color }}>
      <BrandMark size={markSize} framed={framed} style={framed ? undefined : { color }} />
      {word}
    </span>
  );
}
