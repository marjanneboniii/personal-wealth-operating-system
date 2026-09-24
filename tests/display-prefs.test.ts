/**
 * Theme («مثل دستگاه» included) and privacy mode, before first paint.
 *
 * The boot script runs before React: it must pick the stored theme, fall back
 * to the OS preference for «system» (or anything unknown), restore privacy
 * mode — and never throw when storage is blocked.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DISPLAY_BOOT_SCRIPT } from "../src/lib/displayPrefs";

function boot(stored: Record<string, string>, osDark: boolean, storageThrows = false) {
  const classes = new Set<string>();
  const attrs = new Set<string>();
  const documentElement = {
    classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) },
    setAttribute: (a: string) => attrs.add(a),
  };
  const localStorage = {
    getItem: (k: string) => {
      if (storageThrows) throw new Error("blocked");
      return stored[k] ?? null;
    },
  };
  vm.runInNewContext(DISPLAY_BOOT_SCRIPT, {
    localStorage,
    document: { documentElement },
    window: { matchMedia: () => ({ matches: osDark }) },
  });
  return { dark: classes.has("dark"), privacy: attrs.has("data-privacy") };
}

test("boot script: theme and privacy before paint", () => {
  assert.deepEqual(boot({}, true), { dark: true, privacy: false }, "nothing stored → follow the OS");
  assert.deepEqual(boot({ "pwos-theme": "system" }, false), { dark: false, privacy: false });
  assert.deepEqual(boot({ "pwos-theme": "dark" }, false), { dark: true, privacy: false }, "an explicit choice outranks the OS");
  assert.deepEqual(boot({ "pwos-theme": "light" }, true), { dark: false, privacy: false });
  assert.deepEqual(boot({ "pwos-theme": "sepia" }, true), { dark: true, privacy: false }, "an unknown value is «system»");
  assert.deepEqual(boot({ "pwos-privacy": "on" }, false), { dark: false, privacy: true }, "privacy survives a reload");
  assert.doesNotThrow(() => boot({}, false, true), "blocked storage never breaks the page");
});

test("privacy mode blurs amounts but never a form field", () => {
  const css = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
  const rule = css.match(/html\[data-privacy\] :is\(([^)]*)\):not\(([^)]*)\)/);
  assert.ok(rule, "the privacy rule exists");
  for (const cls of [".num", ".money-nowrap", ".metric-value", ".overview-hero-value", ".plan-amount"]) assert.ok(rule![1].includes(cls), cls);
  for (const el of ["input", ".field"]) assert.ok(rule![2].includes(el), `${el} stays readable`);
});
