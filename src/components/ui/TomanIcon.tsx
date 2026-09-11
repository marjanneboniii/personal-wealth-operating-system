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
 * So: the same plate, the same 12px artwork margin, the same optical weight as
 * its siblings, and a glyph built from FILLED shapes rather than a hairline —
 * the lesson `FixedIncomeFundMark` already recorded, that a mark carried by
 * line work needs far more weight than a filled one to survive the same size.
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
        «ت» — the initial of تومان, drawn inside the same 12px margin the other
        marks use.

        The bowl is a STROKE at weight 5 (the weight FixedIncomeFundMark had to
        settle on for the same reason) rather than the 1.7 hairline it was, and
        it opens upward like the letter does. The three dots above it are what
        make the glyph unambiguously «ت» rather than a generic cup; they are
        radius 2.2 — the smallest disc that still resolves to three separate
        marks at 20px instead of merging into one smudge.
      */}
      <path
        d="M14 22.4v3.2c0 5.2 4.4 8.6 10 8.6s10-3.4 10-8.6v-3.2"
        stroke={letterColor}
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="18.2" cy="15.4" r="2.2" fill={letterColor} />
      <circle cx="24" cy="15.4" r="2.2" fill={letterColor} />
      <circle cx="29.8" cy="15.4" r="2.2" fill={letterColor} />
    </svg>
  );
};

export default TomanIcon;
