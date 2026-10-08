// Screenshot every route of a running preview server in four views.
//
//   node capture.mjs <baseUrl> <outDir> <route> [<route> …]
//
// Views: desktop (1440×900, web), phone (iPhone 14 size, web, light),
// phone-dark (same, dark theme) and pwa (phone, installed-app mode: standalone
// display mode and a 47px notch safe area, as on an iPhone home-screen app).
// Uses the installed Google Chrome with a throwaway profile (no extensions,
// none of your cookies); signs in through the preview-only login route first.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [base, out, ...routes] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const views = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  "phone-dark": { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark" },
  pwa: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, standalone: true },
};

// Installed-app mode: report display-mode standalone to scripts and CSS, and
// give the page the iPhone notch inset that env(safe-area-inset-top) reads.
const standaloneScript = () => {
  const original = window.matchMedia.bind(window);
  window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? Object.defineProperty(original("(min-width:0px)"), "media", { value: q }) : original(q));
  Object.defineProperty(navigator, "standalone", { get: () => true });
};

const PUBLIC = new Set(["/about", "/privacy", "/terms", "/login", "/register", "/forgot-password", "/update-password", "/offline"]);

// Sign in with a plain request (no page navigation to interrupt). The context's
// request client shares its cookie jar, so every page after this is signed in.
async function signIn(context) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await context.request.get(`${base}/api/dev-preview-login`, { maxRedirects: 0, timeout: 240_000 });
      const cookies = await context.cookies(base);
      if (cookies.some((c) => c.name === "pwos_session")) return;
      console.log(`sign-in attempt ${attempt}: status ${res.status()}, no session cookie yet`);
    } catch (error) {
      console.log(`sign-in attempt ${attempt} failed: ${error.message.split("\n")[0]}`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("Could not sign in to the preview server.");
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-extensions"] });
for (const [name, { standalone, ...options }] of Object.entries(views)) {
  fs.mkdirSync(path.join(out, name), { recursive: true });
  const context = await browser.newContext({ ...options, colorScheme: options.colorScheme ?? "light", locale: "fa-IR", reducedMotion: "reduce" });
  if (standalone) await context.addInitScript(standaloneScript);
  const page = await context.newPage();
  // Public pages first, signed out; then sign in for everything else.
  const ordered = [...routes.filter((r) => PUBLIC.has(r)), "LOGIN", ...routes.filter((r) => !PUBLIC.has(r))];
  if (standalone) {
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "display-mode", value: "standalone" }] }).catch(() => {});
    await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets: { top: 47, bottom: 34, left: 0, right: 0 } }).catch(() => {});
  }
  for (const route of ordered) {
    if (route === "LOGIN") {
      await signIn(context);
      continue;
    }
    const file = (route === "/" ? "home" : route.slice(1).replaceAll("/", "_")) + ".png";
    try {
      await page.goto(base + route, { waitUntil: "networkidle", timeout: 240_000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(out, name, file), fullPage: true });
      console.log(`${name.padEnd(10)} ${route}`);
    } catch (error) {
      console.log(`${name.padEnd(10)} ${route}  FAILED: ${error.message.split("\n")[0]}`);
    }
  }
  await context.close();
}
await browser.close();
