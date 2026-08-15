/**
 * BrandMark — لوگوی «وِزان» (مارک: تیرک و کفه‌های ترازو — نشانه توازن).
 *
 * صرفاً یک نشان تزئینی است؛ هیچ منطق مالی/حسابداری ندارد.
 * رنگ از طریق `color` یا `currentColor` تنظیم می‌شود.
 */
import type { CSSProperties } from "react";

export default function BrandMark({
  size = 24,
  style,
  className,
}: {
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={className}
      style={style}
    >
      <rect x="7.5" y="21.5" width="49" height="5" rx="2.5" fill="currentColor" />
      <rect x="29.5" y="24" width="5" height="19.5" rx="2.5" fill="currentColor" />
      <rect x="26" y="42" width="12" height="4" rx="2" fill="currentColor" />
      <circle cx="16" cy="33.5" r="3.5" fill="currentColor" />
      <circle cx="48" cy="33.5" r="3.5" fill="currentColor" />
    </svg>
  );
}
