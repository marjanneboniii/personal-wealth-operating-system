/**
 * Two PWA defects that only show on a real phone, pinned so they cannot
 * silently return.
 *
 * 1. Install colours drifted from the palette. `background_color` paints
 *    Android's splash and `theme_color` paints the standalone title bar, so a
 *    stale value means the OS chrome does not match the app it frames. Both
 *    still carried #F7F7FB from the retired violet palette, and the dark
 *    viewport colour carried #12131C, while the app renders #f5f7fa / #080b11.
 *
 * 2. Fixed bottom chrome ignored the software keyboard. `position: fixed` is
 *    anchored to the LAYOUT viewport, which Android Chrome does not shrink when
 *    the keyboard opens, so the 56px record button and the tab bar sat on top
 *    of the keyboard — or the field being typed into — on every form.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

/**
 * Reads a custom property out of one CSS block, following a single level of
 * `var()` indirection (`--bg: var(--paper-100)` → `#edf0f2`).
 *
 * The install-colour test used to hard-code the palette's hex values. That
 * made a CORRECT palette migration — every surface moved together from
 * #f5f7fa to #edf0f2 — look like a regression, while saying nothing about the
 * property the test exists to protect: that the manifest, the theme-color
 * meta and the stylesheet all name the SAME colour. Deriving the expected
 * value from the stylesheet asserts that agreement at any palette.
 */
function cssToken(css: string, selector: RegExp, name: string): string {
  const block = css.match(selector)?.[0] ?? "";
  const read1 = (prop: string) =>
    block.match(new RegExp(`--${prop}:\\s*([^;]+)`))?.[1]?.trim() ?? "";
  const raw = read1(name);
  const indirect = raw.match(/^var\(--([\w-]+)\)$/)?.[1];
  return (indirect ? read1(indirect) : raw).toLowerCase();
}

test("install colours match the palette the app actually renders", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  const css = read("src/app/globals.css");
  const layout = read("src/app/layout.tsx");

  // The page background the app actually paints, light and dark.
  const lightBg = cssToken(css, /:root\s*\{[\s\S]*?\n\}/, "bg");
  const darkBg = cssToken(css, /\.dark[^{]*\{[\s\S]*?\n\}/, "bg");
  assert.match(lightBg, /^#[0-9a-f]{6}$/, `light --bg must resolve to a hex colour, got ${lightBg}`);
  assert.match(darkBg, /^#[0-9a-f]{6}$/, `dark --bg must resolve to a hex colour, got ${darkBg}`);
  assert.notEqual(lightBg, darkBg, "light and dark backgrounds must differ");

  // background_color paints Android's splash, theme_color the standalone title
  // bar. Both hand over to the light page background, so they must equal it.
  assert.equal(manifest.background_color.toLowerCase(), lightBg);
  assert.equal(manifest.theme_color.toLowerCase(), lightBg);

  // Both retired values must be gone from every install surface.
  assert.doesNotMatch(JSON.stringify(manifest), /f7f7fb/i);
  assert.doesNotMatch(layout, /#F7F7FB/i);
  assert.doesNotMatch(layout, /#12131C/i);

  // The status bar has to match the page background it sits above, per scheme.
  assert.ok(
    layout.includes(lightBg) || layout.includes(lightBg.toUpperCase()),
    `layout must declare the light theme-color ${lightBg}`,
  );
  assert.ok(
    layout.includes(darkBg) || layout.includes(darkBg.toUpperCase()),
    `layout must declare the dark theme-color ${darkBg}`,
  );
});

test("manifest keeps the fields installability depends on", () => {
  const m = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(m.display, "standalone");
  assert.equal(m.lang, "fa");
  assert.equal(m.dir, "rtl");
  assert.ok(m.start_url && m.scope && m.id);
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  assert.ok(sizes.includes("192x192") && sizes.includes("512x512"));
  assert.ok(
    m.icons.some((i: { purpose?: string }) => i.purpose?.includes("maskable")),
    "Android needs a maskable icon or it letterboxes the mark",
  );
});

test("fixed bottom chrome yields to the software keyboard", () => {
  const css = read("src/app/globals.css");

  const rule = css
    .split("\n")
    .find((l) => l.includes(":has(") && l.includes("app-bottom-nav") && l.includes("display: none"));
  assert.ok(rule, "the keyboard rule must exist");
  assert.match(rule!, /display:\s*none/);

  // The 56px record button used to be a separate floating FAB that the rule
  // had to name alongside the tab bar. It is now the centre slot OF the tab
  // bar, so hiding .app-bottom-nav hides it too — one element to hide instead
  // of two. Pin that, or a future FAB could float back over the keyboard
  // without this test noticing.
  assert.doesNotMatch(css, /\.record-fab\b/, "the floating record FAB must not come back");
  assert.match(css, /\.tab-record\b/, "the record action lives inside the tab bar");

  // Text entry only: a checkbox or a button must never hide the navigation.
  assert.match(rule!, /input:not\(\[type="checkbox"\]\)/);
  assert.match(rule!, /:not\(\[type="button"\]\)/);
  assert.match(rule!, /:not\(\[type="submit"\]\)/);
  assert.match(rule!, /textarea:focus/);

  // It must stay on ONE line: the minifier mis-parsed the wrapped form and
  // emitted a stray paren, which killed the rule without any build error.
  assert.ok(rule!.trim().endsWith("}"), "the rule must be written on a single line");
});

test("iOS Home Screen support is declared", () => {
  const layout = read("src/app/layout.tsx");
  assert.match(layout, /appleWebApp/);
  assert.match(layout, /statusBarStyle/);
  assert.match(layout, /viewportFit:\s*"cover"/);
  // black-translucent + viewport-fit=cover is what lets content sit under the
  // Dynamic Island while safe-area insets keep it clear.
  assert.match(layout, /black-translucent/);
});

test("the service worker never caches API or private pages", () => {
  const sw = read("public/sw.js");
  assert.match(sw, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(sw, /req\.mode === "navigate"/);
  assert.match(sw, /PURGE_CACHES/);
  assert.doesNotMatch(sw, /cache\.put\(req[^)]*\)\s*;?\s*\/\/\s*navigation/i);
});
