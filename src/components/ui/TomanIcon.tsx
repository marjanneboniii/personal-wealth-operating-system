/**
 * TomanIcon — the تومان currency mark.
 *
 * WHY THIS WAS REDRAWN RATHER THAN REPLACED
 * The mark existed and was already wired everywhere (`AssetLogo` intercepts
 * TOMAN_LOGO and renders this component inline), so a second Toman icon would
 * have been a parallel truth, not a fix. What it was NOT doing was belonging to
 * the app's mark system, on three counts that are all visible in a mixed asset
 * list:
 *
 *   1. SHAPE — it was a CIRCLE while every other hand-drawn mark
 *      (VehicleMark, RealEstateMark, the four صندوق kinds, سهام) sits on a
 *      48×48 plate with rx=12, and so do the fetched brand emblems. One round
 *      token in a column of rounded squares reads as a foreign object.
 *   2. PLATE — it was a saturated mint fill (#B8F4E8) where the system's plate
 *      is WHITE. A coloured plate makes the mark LOUDER than the currency marks
 *      and brand emblems beside it, which is backwards: تومان is the app's most
 *      frequent unit and should be the quietest, not the most shouted.
 *   3. WEIGHT — the glyph was a 1.7px stroke on a 48 grid. At the sizes an
 *      asset row actually renders (20 / 24 / 28px) that is a third of a device
 *      pixel of ink and it simply disappeared, leaving a coloured blob.
 *
 * So: the same white plate and radius as its siblings, and the stroke taken to
 * a weight that survives an asset row.
 *
 * THE GLYPH ITSELF IS NOT REDESIGNED. It is the product's original Toman curve,
 * unchanged. A revision once swapped it for a bowl with three dots — which is
 * «ث», not «ت» — and was reverted: the letterform was never the problem.
 *
 * THEME. Plate and ink are plain props with light-theme defaults, exactly like
 * the other marks, and the component is wrapped by `AssetLogo` in a rounded,
 * clipped span. The white plate is the constant across both themes by design:
 * every brand emblem in the list carries its own white ground, so a mark that
 * inverted in dark mode would be the only one that did.
 *
 * PRESENTATION ONLY — no data, no valuation, no side effects.
 */
import React from "react";

interface TomanIconProps {
  size?: number;
  /** Plate (background) colour. Kept as `bgColor` — existing callers pass it. */
  bgColor?: string;
  /** Glyph colour. */
  letterColor?: string;
  className?: string;
}

/** The one plate radius shared by every mark in the system (AssetTypeMarks). */
const PLATE_RADIUS = 12;

/**
 * The Toman glyph, unchanged since the mark was first drawn. Kept as a named
 * constant so it is obvious at a glance that this curve is the product's own
 * letterform and not something to be re-invented.
 */
const GLYPH =
  "M15 22 C15 27.5 19 29.5 24 29.5 " +
  "C29 29.5 33 27.5 33 22 " +
  "C33 21.4 25.8 21 21 21";

const TomanIcon: React.FC<TomanIconProps> = ({
  size = 48,
  bgColor = "#FFFFFF",
  // The teal the app already used for Toman, taken to full ink strength so it
  // holds at 20px. The old #0D3B36 was nearly black and read as "no colour".
  letterColor = "#0F6B62",
  className = "",
}) => {
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
      <rect width="48" height="48" rx={PLATE_RADIUS} fill={bgColor} />
      {/*
        THE ORIGINAL TOMAN GLYPH, restored exactly.

        An earlier revision of this file replaced it with a bowl and THREE dots,
        which does not read as «ت» at all — three dots is «ث». The mark is the
        one the product has always used, and redrawing the letterform was never
        what needed fixing: the plate and the weight were.

        So the path below is byte-for-byte the original, still mirrored by the
        same transform. Only the WEIGHT changed — from 1.7 to 3.6 — because at
        1.7 on a 48 grid the stroke renders about 0.85px at the 24px an asset
        row actually uses, and simply disappeared, leaving a coloured blob. 3.6
        is as heavy as this curve takes before the bowl starts closing up.
      */}
      <g transform="scale(-1,1) translate(-48,0)">
        <path
          d={GLYPH}
          stroke={letterColor}
          strokeWidth="3.6"
          strokeLinecap="round"
          fill="none"
        />
      </g>
    </svg>
  );
};

export default TomanIcon;
