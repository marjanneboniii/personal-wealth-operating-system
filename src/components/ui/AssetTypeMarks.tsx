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
 *   • SATURATED plate + light mark. A pale plate with a dark mark was tried
 *     first and lost the side-by-side test at 20-24px: the silhouette is only
 *     ~14px of artwork at that size, and it needs the full contrast range to
 *     hold. A mid-deep plate also stays legible on BOTH themes — it is lighter
 *     than the near-black dark surface and darker than the light one.
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
  plate = "#C86A10",
  ink = "#FFF6E9",
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
      {/* One silhouette, faceted rather than bubbled: a short rear deck, a low
          flat roof, a raked windscreen and a long bonnet. v1 was a toy because
          the greenhouse was tall and round; v2 still carried a floating glass
          cut that read as a notch at every size. Both are gone — at 24px the
          only thing that survives is the outline, so the outline is the whole
          design. */}
      <path
        d="M7.9 31.4v-3.1c0-1.6.9-2.7 2.5-3.2l4.6-1.4 3.2-4c.9-1.1 2.1-1.7 3.6-1.7h5.6c1.5 0 2.8.5 3.9 1.5l4.3 4.2 3.6 1.4c1.5.6 2.3 1.6 2.3 3.2v3.1c0 1.1-.9 2-2 2H9.9c-1.1 0-2-.9-2-2z"
        fill={ink}
      />
      {/* Shallow arches: they notch the sill without cutting the body in half,
          so the silhouette still reads as one object at 20px. */}
      <circle cx="16.6" cy="32.2" r="4.1" fill={plate} />
      <circle cx="33.4" cy="32.2" r="4.1" fill={plate} />
      <circle cx="16.6" cy="32.2" r="2.5" fill={ink} />
      <circle cx="33.4" cy="32.2" r="2.5" fill={ink} />
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
  plate = "#115E59",
  ink = "#ECFDF5",
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
      <rect x="10.8" y="14.2" width="11.8" height="23.4" rx="2.2" fill={ink} />
      {/* Pitched-roof mass. The single diagonal is load-bearing: without it
          two flat blocks read as a BAR CHART, which is a genuine ambiguity in
          an app whose every other screen is a chart. */}
      <path
        d="M30.6 18.1c.5-.4 1.2-.4 1.7 0l5 4.1c.5.4.8 1 .8 1.6v11.6c0 1.2-1 2.2-2.2 2.2h-8.9c-1.2 0-2.2-1-2.2-2.2V23.8c0-.6.3-1.2.8-1.6z"
        fill={ink}
      />
      {/* Three windows — the most detail that survives 24px. */}
      <rect x="14.3" y="18.4" width="4.8" height="4.8" rx="1.1" fill={plate} />
      <rect x="14.3" y="26.2" width="4.8" height="4.8" rx="1.1" fill={plate} />
      <rect x="29.1" y="26.4" width="4.8" height="4.8" rx="1.1" fill={plate} />
    </svg>
  );
}
