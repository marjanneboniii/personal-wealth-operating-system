/**
 * لوگوی تومان — the Toman mark must belong to the app's mark SYSTEM.
 *
 * The mark already existed and was already wired everywhere (AssetLogo
 * intercepts TOMAN_LOGO and renders the component inline), so this is a
 * REDRAW, not a second icon — and these assertions exist to stop it drifting
 * back out of the system, or a parallel Toman mark appearing beside it.
 *
 * What it was doing wrong, and what this file pins:
 *   • SHAPE  — a circle among rx=12 rounded-square plates read as a foreign
 *              object in a mixed asset list.
 *   • PLATE  — a saturated mint fill made it LOUDER than the brand emblems and
 *              currency marks beside it; the system's plate is white.
 *   • WEIGHT — a 1.7px stroke on a 48 grid is a fraction of a device pixel at
 *              the 20/24/28px an asset row actually renders, so the glyph
 *              vanished and left a coloured blob.
 *
 * The static SVG and the React component are asserted to be the SAME mark,
 * because they are two rendering paths for one logo.
 */
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";

const read = (p: string) => fs.readFileSync(path.resolve(process.cwd(), p), "utf-8");

const COMPONENT = "src/components/ui/TomanIcon.tsx";
const STATIC_SVG = "public/ir-icons/defaults/toman.svg";
const MARKS = "src/components/ui/AssetTypeMarks.tsx";

test("the Toman mark shares the system's plate: 48 grid, rx=12, white", () => {
  const src = read(COMPONENT);

  assert.ok(/viewBox="0 0 48 48"/.test(src), "the same 48×48 grid every other mark is drawn on");
  assert.ok(
    /<rect[^>]*width="48"[^>]*height="48"[^>]*rx=\{PLATE_RADIUS\}/.test(src),
    "a rounded-RECT plate, not the circle it used to be",
  );
  assert.ok(/const PLATE_RADIUS = 12/.test(src), "the one plate radius shared by the mark system");
  assert.ok(
    /bgColor = "#FFFFFF"/.test(src),
    "a WHITE plate — the saturated mint fill made it louder than the brand emblems beside it",
  );
  assert.ok(!/<circle[^>]*r="24"/.test(src), "the full-bleed circle plate is gone for good");

  // The plate radius must be the SAME constant the other hand-drawn marks use,
  // or the two families drift apart one redesign at a time.
  const marks = read(MARKS);
  const shared = marks.match(/const PLATE_RADIUS = (\d+)/);
  assert.ok(shared, "AssetTypeMarks declares the shared plate radius");
  assert.equal(shared![1], "12", "TomanIcon and AssetTypeMarks agree on the plate radius");
});

/** The original Toman curve — the letterform the product has always used. */
const ORIGINAL_GLYPH = "M15 22 C15 27.5 19 29.5 24 29.5 C29 29.5 33 27.5 33 22 C33 21.4 25.8 21 21 21";

/** The GLYPH constant from the component, with its string pieces joined. */
function componentGlyph(src: string): string | null {
  const m = src.match(/const GLYPH =([\s\S]*?);/);
  if (!m) return null;
  const pieces = [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  return pieces.join("").replace(/\s+/g, " ").trim();
}

test("the glyph is the ORIGINAL Toman curve — «ت», never «ث»", () => {
  const src = read(COMPONENT);

  // A revision once replaced the letterform with a bowl and THREE dots, which
  // reads as «ث». The glyph was never what needed fixing — only the plate and
  // the weight were — so it is pinned to the original curve, exactly.
  assert.equal(componentGlyph(src), ORIGINAL_GLYPH, "the product's own Toman curve, unchanged");
  assert.ok(!/<circle/.test(src), "no dots and no circle anywhere in the mark");
  assert.match(src, /scale\(-1,1\) translate\(-48,0\)/, "mirrored by the same transform as the original");

  // Weight: the original 1.7 rendered ~0.85px at 24px and vanished. At least
  // double that, but not so heavy the shallow bowl closes up.
  const stroke = src.match(/strokeWidth="(\d+(?:\.\d+)?)"/);
  assert.ok(stroke, "the glyph is a stroked path");
  const weight = Number(stroke![1]);
  assert.ok(weight >= 3.4 && weight <= 4.2, `stroke ${weight} must survive 20px without filling the bowl`);
});

test("the static SVG and the React component are the SAME mark, not two", () => {
  const svg = read(STATIC_SVG);
  const src = read(COMPONENT);

  // Plate.
  assert.ok(/<rect width="48" height="48" rx="12" fill="#FFFFFF"\/>/.test(svg), "same white rx=12 plate");
  assert.ok(!/<circle[^>]*r="24"/.test(svg), "the file no longer carries the old circle plate");

  // The bowl path and the ink colour must match the component character for
  // character — this is the assertion that catches a redraw of one and not the
  // other.
  const svgPath = svg.match(/<path d="([^"]+)"/);
  assert.ok(svgPath, "the static file renders a glyph path");
  assert.equal(
    svgPath![1].replace(/\s+/g, " ").trim(),
    componentGlyph(src),
    "the two Toman marks draw the identical glyph",
  );
  assert.ok(!/<circle/.test(svg), "and neither carries dots");

  const svgInk = svg.match(/stroke="(#[0-9A-Fa-f]{6})"/);
  const componentInk = src.match(/letterColor = "(#[0-9A-Fa-f]{6})"/);
  assert.ok(svgInk && componentInk, "both declare an ink colour");
  assert.equal(svgInk![1], componentInk![1], "…in the same hue");

  const svgStroke = svg.match(/stroke-width="(\d+(?:\.\d+)?)"/);
  const componentStroke = src.match(/strokeWidth="(\d+(?:\.\d+)?)"/);
  assert.equal(svgStroke![1], componentStroke![1], "…at the same weight");
});

test("there is exactly ONE Toman mark in the codebase", () => {
  // A second Toman icon is the failure mode the brief calls out explicitly:
  // the fix was to strengthen the existing mark, never to add a parallel one.
  const uiDir = path.resolve(process.cwd(), "src/components/ui");
  const tomanComponents = fs
    .readdirSync(uiDir)
    .filter((f) => /toman/i.test(f) && f.endsWith(".tsx"));
  assert.deepEqual(tomanComponents, ["TomanIcon.tsx"], "no parallel Toman component appeared");

  const tomanAssets = fs
    .readdirSync(path.resolve(process.cwd(), "public/ir-icons/defaults"))
    .filter((f) => /toman/i.test(f));
  assert.deepEqual(tomanAssets, ["toman.svg"], "no parallel Toman asset appeared");
});
