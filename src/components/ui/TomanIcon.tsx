/**
 * Currency mark for تومان. The existing glyph and 48px plate are preserved;
 * plate and ink now use the shared paper/ink palette in both themes.
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
  bgColor = "var(--paper-000)",
  letterColor = "var(--ink-700)",
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
