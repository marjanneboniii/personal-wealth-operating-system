/**
 * BrandMark — نشان «توازن»: ترازوی هندسی متقارن
 * (تیر افقی، تکیه‌گاه مثلثی، دو حلقهٔ هم‌سطح).
 *
 * صرفاً تزئینی است؛ هیچ منطق مالی/حسابداری ندارد.
 */
import type { CSSProperties } from "react";

/**
 * The pans are FILLED bowls rather than hollow rings, and the column carries
 * the weight instead of a triangle. The previous outline version collapsed
 * into an unreadable blob at 20px — the size it is actually used at in the
 * mobile top bar and the footer.
 */
function ScaleGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
    >
      {/* column, beam, foot */}
      <path d="M32 12 v34" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M14 18 H50" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path d="M22 46 h20" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      {/* the two pans, level with each other — the balance itself */}
      <path d="M6 24 a10 10 0 0 0 20 0 z" fill="currentColor" />
      <path d="M38 24 a10 10 0 0 0 20 0 z" fill="currentColor" />
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
        <span className={`block text-[length:var(--fs-xs)] ${onDark ? "landing-on-primary-muted" : "muted"}`}>{subtitle}</span>
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
