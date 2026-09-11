/**
 * Asset-type marks — the dedicated logos for the asset classes the app
 * registers by hand: خودرو, ملک, the four صندوق kinds, and سهام.
 *
 * WHY KINDS AND NOT BRANDS, FOR THE FUNDS
 * There are 58 funds in the catalogue across 21 issuers, and no fund logo
 * exists in this repo — nor could one be fetched, since the Iranian sources
 * are unreachable from where this was built. Scraping 58 trademarked marks to
 * render them at 28px would also break the one thing that makes a mixed asset
 * list readable: a single visual system. So a fund is drawn by WHAT IT HOLDS
 * — طلا, درآمد ثابت, سهام, کالا — which is the distinction a user actually
 * needs when scanning a portfolio, and which no issuer logo conveys anyway.
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
 *     drawn properly — not as a rebrand that strands existing users. The fund
 *     kinds take their hue from the thing they hold: gold amber, fixed income
 *     a calm slate (it is the boring one, and should look it), equity the
 *     brand indigo, commodity a saffron red.
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

/* ══════════════════════════════════════════════════════════════════════
   صندوق‌ها و سهام — drawn by what the instrument HOLDS.
   Same 48 grid, same white plate, same 12px margin as the pair above, so a
   portfolio row of mixed asset types reads as one system.
   ══════════════════════════════════════════════════════════════════════ */

/** صندوق طلا — stacked bullion. Three bars survive 24px; a coin pile does not. */
export function GoldFundMark({ size = 48, plate = "#FFFFFF", ink = "#A25A12", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Trapezoids, not rectangles: the taper is what says "ingot". */}
      <path d="M19.4 15.2h9.2c.5 0 .9.3 1.1.8l1.6 4.2H16.7l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <path d="M14.2 23.4h9.2c.5 0 .9.3 1.1.8l1.6 4.2H11.5l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <path d="M24.6 23.4h9.2c.5 0 .9.3 1.1.8l1.6 4.2H21.9l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
      <path d="M19.4 31.6h9.2c.5 0 .9.3 1.1.8l1.6 4.2H16.7l1.6-4.2c.2-.5.6-.8 1.1-.8z" fill={ink} />
    </svg>
  );
}

/**
 * صندوق درآمد ثابت — a flat line that steps up once. Deliberately the dullest
 * mark in the set: the product's whole promise is that it does not move much,
 * and a dramatic chart here would misrepresent it.
 */
export function FixedIncomeFundMark({ size = 48, plate = "#FFFFFF", ink = "#44506B", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Thicker than it looks like it needs. The first version used a 3.4
          stroke and simply vanished at 20-24px — a stepped line is mostly
          empty space, so it has to carry far more weight than a filled mark
          to survive the same size. */}
      <path d="M12.6 30.8h7.4v-5.2h7.4v-5.2h7.8" stroke={ink} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <rect x="12.6" y="35.2" width="22.6" height="4" rx="2" fill={ink} opacity="0.4" />
    </svg>
  );
}

/** صندوق سهامی (ETF) — three columns with real variance, the opposite reading. */
export function EquityFundMark({ size = 48, plate = "#FFFFFF", ink = "#4B4DC4", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <rect x="12.4" y="26.4" width="6.4" height="11.2" rx="1.8" fill={ink} opacity="0.45" />
      <rect x="20.8" y="19.6" width="6.4" height="18" rx="1.8" fill={ink} opacity="0.7" />
      <rect x="29.2" y="12.8" width="6.4" height="24.8" rx="1.8" fill={ink} />
    </svg>
  );
}

/** صندوق کالایی — زعفران و مشابه. A stigma-and-petals mark, not a chart. */
export function CommodityFundMark({ size = 48, plate = "#FFFFFF", ink = "#B23A48", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      {/* Three saffron threads from one root — the crop's actual signature. */}
      <path d="M24 37V22.4" stroke={ink} strokeWidth="4" strokeLinecap="round" />
      <path d="M24 24.6c-3.4-1.2-5.6-4.2-5.8-8 3.4.4 5.8 3.2 5.8 8z" fill={ink} />
      <path d="M24 24.6c3.4-1.2 5.6-4.2 5.8-8-3.4.4-5.8 3.2-5.8 8z" fill={ink} />
      <path d="M24 21.8c0-4 1.4-7 3.4-9.4-2.8-.6-5.6 3-5.6 9.4z" fill={ink} opacity="0.55" />
    </svg>
  );
}

/**
 * سهام — a single certificate with a corner fold. A share is a document, not a
 * chart: every fund kind above already uses chart language, so reusing it here
 * would make the one non-fund instrument indistinguishable from the funds.
 */
export function StockMark({ size = 48, plate = "#FFFFFF", ink = "#1F6F5C", className = "" }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true" focusable="false">
      <Plate fill={plate} />
      <path d="M14.4 13.6c0-1.1.9-2 2-2h10.3c.5 0 1 .2 1.4.6l5.1 5.1c.4.4.6.9.6 1.4v15.7c0 1.1-.9 2-2 2H16.4c-1.1 0-2-.9-2-2z" fill={ink} />
      {/* The fold — punched back to the plate so it needs no third tone. */}
      <path d="M27.2 11.9l6 6h-4.6c-.8 0-1.4-.6-1.4-1.4z" fill={plate} />
      <rect x="18.6" y="24.2" width="10.8" height="2.6" rx="1.3" fill={plate} />
      <rect x="18.6" y="29.4" width="7.2" height="2.6" rx="1.3" fill={plate} />
    </svg>
  );
}

/** The fund kinds, keyed the way features/funds/catalogData.ts keys them. */
export const FUND_KIND_MARKS = {
  gold: GoldFundMark,
  fixed_income: FixedIncomeFundMark,
  etf: EquityFundMark,
  commodity: CommodityFundMark,
} as const;
