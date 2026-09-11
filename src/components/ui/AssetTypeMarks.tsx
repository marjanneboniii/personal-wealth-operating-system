/**
 * Asset-type marks — the dedicated logos for the two REAL-WORLD asset classes
 * the app registers by hand: خودرو (vehicle) and ملک (real estate).
 *
 * WHY THESE ARE INLINE SVG, NOT FILES
 * They follow the TomanIcon precedent. An asset list renders dozens of logos
 * at once; every `<img>` is a separate request, and on a slow or throttled
 * connection those are exactly the requests that arrive last and make the list
 * flash. Inline marks cost zero requests, cannot 404, render identically
 * offline in the PWA, and are ~0.4 KB of gzipped markup each.
 *
 * DESIGN CONTRACT
 *   • One 48×48 grid, one plate radius, one optical weight — the two marks are
 *     a designed PAIR and must read as siblings when stacked in a list.
 *   • WHITE plate + dark mark in the class hue — the same plate the brand
 *     emblems sit on. A saturated plate was tried and rejected: beside a real
 *     ایران‌خودرو or سایپا emblem it read LOUDER than the brand it stands in
 *     for, which is backwards for a fallback, and a column of full-bleed colour
 *     blocks is heavy in aggregate. Sharing the brand plate also gives a mixed
 *     list one silhouette instead of two.
 *   • Each mark keeps the HUE the app already used for that asset class
 *     (amber for خودرو, teal for ملک), so this reads as the same product
 *     drawn properly — not as a rebrand that strands existing users.
 *   • Legibility is judged at 24-28px — the size an asset row actually renders.
 *     That budget is why each mark is 2-3 shapes and never carries a detail
 *     that collapses into mush (no window grids, no door handles, no grille).
 *
 * PRESENTATION ONLY — no financial data, no valuation, no side effects.
 */
import React from "react";

type MarkProps = {
  size?: number;
  /** Plate (background) colour. Overridable for previews and brand tests. */
  plate?: string;
  /** Mark (foreground) colour. */
  ink?: string;
  className?: string;
};

/* The pair shares one plate so the two marks are visually interchangeable in
   a list: same square, same radius, same inset for the artwork. */
const PLATE_RADIUS = 12;

function Plate({ fill }: { fill: string }) {
  return <rect width="48" height="48" rx={PLATE_RADIUS} fill={fill} />;
}

/**
 * خودرو — a side profile, the only car view that survives 24px, drawn as a
 * SILHOUETTE ONLY. Every interior detail (glass, grille, door line) was tried
 * and removed: below ~40px it turns to noise, and above it, it competes with
 * the outline that is doing the actual work.
 */
export function VehicleMark({
  size = 48,
  plate = "#FFFFFF",
  ink = "#A25A12",
  className = "",
}: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <Plate fill={plate} />
      {/* Drawn INSIDE a 12px margin, not edge to edge. The mark reads as a
          quiet glyph on the plate the way a brand emblem does, instead of a
          silhouette pressed against the corners. */}
      <path
        d="M11.4 29.9v-2.5c0-1.3.7-2.2 2-2.6l3.7-1.1 2.6-3.2c.7-.9 1.7-1.4 2.9-1.4h4.5c1.2 0 2.3.4 3.1 1.2l3.5 3.4 2.9 1.1c1.2.5 1.9 1.3 1.9 2.6v2.5c0 .9-.7 1.6-1.6 1.6H13c-.9 0-1.6-.7-1.6-1.6z"
        fill={ink}
      />
      <circle cx="18.4" cy="30.6" r="3.3" fill={plate} />
      <circle cx="29.6" cy="30.6" r="3.3" fill={plate} />
      <circle cx="18.4" cy="30.6" r="2" fill={ink} />
      <circle cx="29.6" cy="30.6" r="2" fill={ink} />
    </svg>
  );
}

/**
 * ملک — two masses on one baseline. An apartment block, not a cottage: in this
 * market a property is far more often a واحد than a detached house, and the
 * stepped pair also reads as "portfolio of property" rather than "my home".
 * Exactly three windows survive the 24px budget; a full grid does not.
 */
export function RealEstateMark({
  size = 48,
  plate = "#FFFFFF",
  ink = "#0F6B62",
  className = "",
}: MarkProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <Plate fill={plate} />
      {/* Flat-topped tower (the mark is not mirrored in RTL — a logo is an
          image, not text). */}
      <rect x="13.4" y="16.6" width="9.6" height="18.8" rx="1.8" fill={ink} />
      {/* Pitched-roof mass. The single diagonal is load-bearing: without it
          two flat blocks read as a BAR CHART, which is a genuine ambiguity in
          an app whose every other screen is a chart. */}
      <path
        d="M29.4 19.9c.4-.3 1-.3 1.4 0l4 3.3c.4.3.6.8.6 1.3v9.2c0 1-.8 1.7-1.7 1.7h-7.2c-1 0-1.7-.8-1.7-1.7v-9.2c0-.5.2-1 .6-1.3z"
        fill={ink}
      />
      {/* Three windows — the most detail that survives 24px. */}
      <rect x="16.2" y="19.8" width="4" height="4" rx="0.9" fill={plate} />
      <rect x="16.2" y="26.2" width="4" height="4" rx="0.9" fill={plate} />
      <rect x="28.4" y="26.6" width="4" height="4" rx="0.9" fill={plate} />
    </svg>
  );
}
