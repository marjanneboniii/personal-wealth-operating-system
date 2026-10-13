// Screenshot every route of a running preview server, and audit each page.
//
//   VIEWS=desktop,phone node capture.mjs <baseUrl> <outDir> <route> [<route> …]
//
// VIEWS picks from the device list below (default: the four core views; "all"
// for every device). Besides a full-page screenshot, each page is audited for
// what breaks on real screens: content wider than the screen, elements poking
// past its edges, and tap targets smaller than 40px on touch devices. Findings
// go to <outDir>/audit.json and a readable <outDir>/audit.md.
//
// Uses the installed Google Chrome with a throwaway profile (no extensions,
// none of your cookies); signs in through the preview-only login route first.
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const [base, out, ...routes] = process.argv.slice(2);
const CHROME = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const touch = { isMobile: true, hasTouch: true };
const DEVICES = {
  // Core review set.
  desktop: { label: "دسکتاپ ۱۴۴۰", viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  phone: { label: "آیفون ۱۴ (۶٫۱ اینچ)", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...touch },
  "phone-dark": { label: "آیفون ۱۴، تم تیره", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...touch, colorScheme: "dark" },
  pwa: { label: "اپ نصب‌شده، آیفون ۱۴", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, ...touch, standalone: true },
  // Device matrix.
  "iphone-se": { label: "آیفون SE (۴٫۷ اینچ)", viewport: { width: 375, height: 667 }, deviceScaleFactor: 2, ...touch },
  "iphone-plus": { label: "آیفون ۸ پلاس (۵٫۵ اینچ)", viewport: { width: 414, height: 736 }, deviceScaleFactor: 3, ...touch },
  "iphone-max": { label: "آیفون Pro Max (۶٫۷ اینچ)", viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, ...touch, standalone: true },
  "android-small": { label: "اندروید کوچک (۳۶۰)", viewport: { width: 360, height: 780 }, deviceScaleFactor: 3, ...touch },
  "android": { label: "گلکسی (۴۱۲)", viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.6, ...touch },
  "phone-landscape": { label: "گوشی افقی", viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, ...touch },
  "ipad-mini": { label: "آیپد مینی", viewport: { width: 744, height: 1133 }, deviceScaleFactor: 2, ...touch },
  "ipad": { label: "آیپد عمودی", viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, ...touch, standalone: true },
  "ipad-landscape": { label: "آیپد افقی", viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, ...touch },
  "android-tablet": { label: "تبلت اندروید", viewport: { width: 800, height: 1280 }, deviceScaleFactor: 2, ...touch },
};
const CORE = ["desktop", "phone", "phone-dark", "pwa"];
const wanted = (process.env.VIEWS ?? CORE.join(",")).trim();
const views = Object.fromEntries(
  (wanted === "all" ? Object.keys(DEVICES) : wanted.split(",")).map((k) => [k, DEVICES[k.trim()]]).filter(([, v]) => v),
);

// Installed-app mode: report display-mode standalone to scripts, and give the
// page the iPhone notch inset that env(safe-area-inset-top) reads.
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

// Runs inside the page: what would look broken on this screen.
const auditPage = (isTouch) => {
  const vw = document.documentElement.clientWidth;
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 30);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` «${text}»` : ""}`;
  };
  // Elements that poke past the screen edge, outside any horizontal scroller.
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  const overflow = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if ((r.right > vw + 2 || r.left < -2) && !inScroller(el) && getComputedStyle(el).position !== "fixed") {
      overflow.push({ el: describe(el), by: Math.round(Math.max(r.right - vw, -r.left)) });
    }
  }
  // Keep only the outermost offenders (their children overflow with them).
  overflow.sort((a, b) => b.by - a.by);
  const small = [];
  if (isTouch) {
    for (const el of document.querySelectorAll("a[href], button, [role='button'], input:not([type='hidden']), select, summary")) {
      const r = el.getBoundingClientRect();
      // Skip visually-hidden helpers (the skip link is 1×1 until focused).
      if (r.width <= 2 || r.height <= 2 || getComputedStyle(el).visibility === "hidden") continue;
      if (r.width < 40 || r.height < 40) small.push(`${describe(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return {
    pageWiderThanScreen: document.documentElement.scrollWidth > vw + 1 ? document.documentElement.scrollWidth - vw : 0,
    overflow: overflow.slice(0, 5),
    smallTargets: small.length,
    smallExamples: small.slice(0, 4),
  };
};

const report = [];
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ["--disable-extensions"] });
for (const [name, { standalone, label, ...options }] of Object.entries(views)) {
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
      // A dev-server restart drops the in-memory session: sign in again and retry once.
      if (!PUBLIC.has(route) && new URL(page.url()).pathname === "/login") {
        await signIn(context);
        await page.goto(base + route, { waitUntil: "networkidle", timeout: 240_000 });
      }
      await page.waitForTimeout(400);
      const audit = await page.evaluate(auditPage, Boolean(options.hasTouch));
      report.push({ view: name, label, route, ...audit });
      await page.screenshot({ path: path.join(out, name, file), fullPage: true, timeout: 90_000 });
      const flag = audit.pageWiderThanScreen || audit.overflow.length ? `  ⚠ overflow ${audit.pageWiderThanScreen || audit.overflow[0]?.by}px` : "";
      console.log(`${name.padEnd(15)} ${route}${flag}`);
    } catch (error) {
      console.log(`${name.padEnd(15)} ${route}  FAILED: ${error.message.split("\n")[0]}`);
    }
  }
  await context.close();
}
await browser.close();

fs.writeFileSync(path.join(out, "audit.json"), JSON.stringify(report, null, 2));
const broken = report.filter((r) => r.pageWiderThanScreen || r.overflow.length);
const lines = ["# گزارش بررسی خودکار", "", `${report.length} صفحه‌ـدستگاه بررسی شد؛ ${broken.length} مورد بیرون‌زدگی از صفحه.`, ""];
for (const r of broken) {
  lines.push(`- **${r.label}** — \`${r.route}\`: ${r.pageWiderThanScreen ? `صفحه ${r.pageWiderThanScreen}px پهن‌تر از نمایشگر` : "بیرون‌زدگی"}`);
  for (const o of r.overflow.slice(0, 3)) lines.push(`  - ${o.el} (${o.by}px)`);
}
const tiny = report.filter((r) => r.smallTargets);
lines.push("", `## دکمه‌های کوچک‌تر از ۴۰px (دستگاه‌های لمسی)`, "");
for (const r of tiny) lines.push(`- ${r.label} — \`${r.route}\`: ${r.smallTargets} مورد، مثل ${r.smallExamples.slice(0, 2).join("؛ ")}`);
fs.writeFileSync(path.join(out, "audit.md"), lines.join("\n") + "\n");
console.log(`audit: ${broken.length} overflow findings, ${tiny.length} pages with small targets → ${path.join(out, "audit.md")}`);
