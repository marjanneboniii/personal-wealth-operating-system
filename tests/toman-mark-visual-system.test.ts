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

test("the glyph carries enough weight to survive 20-28px", () => {
  const src = read(COMPONENT);
  const stroke = src.match(/strokeWidth="(\d+(?:\.\d+)?)"/);
  assert.ok(stroke, "the glyph's bowl is a stroked path");
  assert.ok(
    Number(stroke![1]) >= 4,
    `a ${stroke![1]}px stroke on a 48 grid must be heavy enough at 20px — the old 1.7 was invisible`,
  );
  // The three dots are what make it «ت» rather than a generic cup, and they
  // must resolve as three separate marks rather than merging into a smudge.
  const dots = src.match(/<circle cx="[\d.]+" cy="15\.4" r="2\.2"/g) ?? [];
  assert.equal(dots.length, 3, "three dots, at a radius that stays legible small");
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
  const componentPath = src.match(/d="([^"]+)"/);
  assert.ok(svgPath && componentPath, "both render a glyph path");
  assert.equal(svgPath![1], componentPath![1], "the two Toman marks draw the identical glyph");

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
