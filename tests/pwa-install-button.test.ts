/**
 * Which device gets which install affordance.
 *
 * Two opposite bugs are pinned here:
 *
 *   1. The header button rendered «نصب روی آیفون» for EVERYONE, because it
 *      checked only `isStandalone()` and never the device. An Android user was
 *      told to install on an iPhone. The detection helpers already existed in
 *      that same file — the button just never called them.
 *
 *   2. The header wrapped the button in `hidden sm:inline-flex`, so it vanished
 *      below 640px: hidden on the phone, which is the one device where
 *      installing a PWA is the point.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { isIosDevice, isIosSafari } from "../src/components/pwa/IosInstallGuide";

function withUserAgent(ua: string, maxTouchPoints: number, run: () => void) {
  const platform = ua.includes("Macintosh") ? "MacIntel" : ua.includes("Windows") ? "Win32" : "Linux";
  const previous = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: ua, platform, maxTouchPoints },
    configurable: true,
    writable: true,
  });
  try {
    run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "navigator", previous);
  }
}

const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1",
  iphoneFirefox:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
};

test("an Android phone is never told to install on an iPhone", () => {
  // The bug that prompted this: Android saw «نصب روی آیفون».
  withUserAgent(UA.androidChrome, 5, () => {
    assert.equal(isIosDevice(), false);
    assert.equal(isIosSafari(), false);
  });
});

test("a desktop browser is not an iOS device either", () => {
  withUserAgent(UA.windowsChrome, 0, () => {
    assert.equal(isIosDevice(), false);
    assert.equal(isIosSafari(), false);
  });
  // macOS Safari shares WebKit with iOS but is not a touch device.
  withUserAgent(UA.macSafari, 0, () => {
    assert.equal(isIosDevice(), false);
    assert.equal(isIosSafari(), false);
  });
});

test("iPhone Safari is the one case that gets the Share walkthrough", () => {
  withUserAgent(UA.iphoneSafari, 5, () => {
    assert.equal(isIosDevice(), true);
    assert.equal(isIosSafari(), true);
  });
});

test("Chrome and Firefox ON iOS are iOS devices but cannot install", () => {
  // They are iOS, so there is no beforeinstallprompt — but the Share →
  // Add to Home Screen route does not exist in them either, so offering the
  // walkthrough would send the user somewhere that does not work.
  for (const ua of [UA.iphoneChrome, UA.iphoneFirefox]) {
    withUserAgent(ua, 5, () => {
      assert.equal(isIosDevice(), true);
      assert.equal(isIosSafari(), false, "never treated as Safari");
    });
  }
});

test("an iPad in desktop mode is still an iPad", () => {
  // iPadOS reports itself as MacIntel; touch points are what give it away.
  withUserAgent(UA.macSafari, 5, () => {
    assert.equal(isIosDevice(), true);
    assert.equal(isIosSafari(), true);
  });
});

test("the install button is not hidden on phones", () => {
  const header = readFileSync(
    new URL("../src/components/landing/LandingChrome.tsx", import.meta.url),
    "utf8",
  );
  const line = header.split("\n").find((l) => l.includes("DownloadIosButton") && l.includes("<"));
  assert.ok(line, "the header still renders the install button");
  assert.doesNotMatch(
    header,
    /hidden sm:inline-flex[\s\S]{0,120}DownloadIosButton/,
    "the button must not be hidden below the sm breakpoint — that is the phone",
  );
});

test("the button decides by device, not by breakpoint", () => {
  const src = readFileSync(
    new URL("../src/components/pwa/IosInstallGuide.tsx", import.meta.url),
    "utf8",
  );
  // It must consult the device and the install event, not just standalone.
  assert.match(src, /isIosSafari\(\)/, "device detection is actually called");
  assert.match(src, /beforeinstallprompt/, "the Chromium install event is handled");
  // A device that cannot install renders nothing rather than a dead button.
  assert.match(src, /kind === "none"\) return null/);
});
