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

test("install colours match the palette the app actually renders", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  const css = read("src/app/globals.css");
  const layout = read("src/app/layout.tsx");

  // --bg-page (light) is the surface the splash hands over to.
  assert.match(css, /--bg-page:\s*#f5f7fa/i);
  assert.equal(manifest.background_color.toLowerCase(), "#f5f7fa");
  assert.equal(manifest.theme_color.toLowerCase(), "#f5f7fa");

  // Both retired values must be gone from every install surface.
  assert.doesNotMatch(JSON.stringify(manifest), /f7f7fb/i);
  assert.doesNotMatch(layout, /#F7F7FB/i);
  assert.doesNotMatch(layout, /#12131C/i);

  // The dark status bar has to match the dark page background.
  assert.match(css, /\.dark\s*\{[\s\S]*?--bg:\s*#080b11/);
  assert.match(layout, /prefers-color-scheme: dark\).*#080b11/);
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
    .find((l) => l.includes(":has(") && l.includes("record-fab") && l.includes("app-bottom-nav"));
  assert.ok(rule, "the keyboard rule must exist");
  assert.match(rule!, /display:\s*none/);

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
