import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

test("Landing — signed-out home renders the public marketing page", () => {
  const page = read("src/app/page.tsx");
  assert.match(page, /LandingPage/);
  assert.match(page, /resolveHomeMode/);
  assert.match(page, /OverviewDashboard/);
});

test("Landing — logout returns to / so the marketing page is visible", () => {
  const actions = read("src/lib/auth-actions.ts");
  assert.match(actions, /redirect\("\/"\)/);
  assert.doesNotMatch(actions, /redirect\("\/login"\)/);

  const panel = read("src/components/settings/UserPanel.tsx");
  assert.match(panel, /router\.push\("\/"\)/);
  assert.doesNotMatch(panel, /router\.push\("\/login"\)/);
});

test("Landing — Shell paints standalone public chrome without app nav", () => {
  const shell = read("src/components/layout/Shell.tsx");
  assert.match(shell, /publicHome/);
  assert.match(shell, /pathname === "\/" && publicHome/);
  assert.match(shell, /!isPublicChrome && \(/);
  assert.match(shell, /isLanding \|\| isMarketing/);
  assert.match(shell, /InstallPromotion/);
  assert.match(shell, /usePwaInstallState/);
});

test("Landing — concise conversion page with login, register, and Download iOS", () => {
  const landing = read("src/components/landing/LandingPage.tsx");
  const chrome = read("src/components/landing/LandingChrome.tsx");

  assert.match(landing, /تمام ثروت شما، یک تصویر روشن/);
  assert.match(landing, /ورود به سیستم/);
  assert.match(landing, /ایجاد حساب/);
  assert.match(landing, /Download iOS/);
  assert.match(landing, /DownloadIosButton/);
  assert.match(landing, /href="\/login"/);
  assert.match(landing, /href="\/register"/);
  assert.match(chrome, /href="\/login"/);
  assert.match(chrome, /href="\/register"/);
  assert.match(chrome, /Download iOS|DownloadIosButton/);

  assert.doesNotMatch(landing, /قابلیت‌هایی که همین حالا در محصول هست/);
  assert.doesNotMatch(landing, /حریم خصوصی، مالکیت و کنترل/);
  assert.doesNotMatch(landing, /Double-entry|FIFO|journal posting|lot consumption/i);
  assert.doesNotMatch(landing, /دفترکل و حسابرسی/);
});

test("Landing — iOS install guide opens, closes, and uses the exact Persian copy", () => {
  const guide = read("src/components/pwa/IosInstallGuide.tsx");
  assert.match(guide, /"use client"/);
  assert.match(guide, /نصب وزان روی آیفون/);
  assert.match(guide, /برای تجربه بهتر، وزان را به صفحه اصلی گوشی اضافه کنید/);
  assert.match(guide, /در Safari روی دکمه Share بزنید/);
  assert.match(guide, /از منو گزینه "Add to Home Screen" را انتخاب کنید/);
  assert.match(guide, /در مرحله آخر روی "Add" بزنید/);
  assert.match(guide, /متوجه شدم/);
  assert.match(guide, /Download iOS/);
  assert.match(guide, /role="dialog"/);
  assert.match(guide, /aria-modal="true"/);
  assert.match(guide, /aria-labelledby/);
  assert.match(guide, /Escape/);
  assert.match(guide, /aria-label="بستن"/);
  assert.match(guide, /min-h-12/);
});

test("iOS detection — Safari vs Chrome/Firefox/Edge iOS, plus standalone", () => {
  const guide = read("src/components/pwa/IosInstallGuide.tsx");
  const promo = read("src/components/pwa/InstallPromotion.tsx");

  assert.match(guide, /isIosSafari/);
  assert.match(guide, /isStandalone/);
  assert.match(guide, /iPad\|iPhone\|iPod/);
  assert.match(guide, /MacIntel/);
  assert.match(guide, /maxTouchPoints/);
  assert.match(guide, /WebKit/);
  assert.match(guide, /CriOS\|FxiOS\|EdgiOS/);
  assert.match(guide, /navigator\.standalone/);
  assert.match(guide, /display-mode: standalone/);
  assert.match(promo, /isIosSafari/);
  assert.match(promo, /isStandalone/);
  assert.match(promo, /beforeinstallprompt/);
  assert.match(promo, /Add to Home Screen/);
  assert.match(promo, /IosInstallGuide/);
});

test("PWA — install prompt is wired and captured before the app chrome mounts", () => {
  const promo = read("src/components/pwa/InstallPromotion.tsx");
  assert.match(promo, /usePwaInstallState/);
  assert.match(promo, /beforeinstallprompt/);
  assert.match(promo, /Add to Home Screen/);
  assert.match(promo, /افزودن به صفحه اصلی/);
  assert.match(promo, /فعلاً نه/);

  const sw = read("public/sw.js");
  assert.match(sw, /req\.mode === "navigate"/);
  assert.match(sw, /network only|NETWORK-ONLY/i);
  assert.doesNotMatch(sw, /cache\.put\(req.*navigate/i);

  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.dir, "rtl");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 2);
});

test("PWA — manifest RTL standalone icons shortcuts; SW never caches API or private pages", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.lang, "fa");
  assert.equal(manifest.dir, "rtl");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.scope, "/");
  assert.ok(manifest.icons.some((i: { sizes: string }) => i.sizes === "192x192"));
  assert.ok(manifest.icons.some((i: { sizes: string }) => i.sizes === "512x512"));
  assert.ok(manifest.icons.some((i: { purpose?: string }) => String(i.purpose).includes("maskable")));
  assert.ok(Array.isArray(manifest.shortcuts) && manifest.shortcuts.length >= 3);

  const sw = read("public/sw.js");
  assert.match(sw, /VERSION/);
  assert.match(sw, /pwos-v4/);
  assert.match(sw, /PURGE_CACHES/);
  assert.match(sw, /req\.method !== "GET"/);
  assert.match(sw, /No API mutations are ever cached/);
  assert.match(sw, /\/api\//);
  assert.match(sw, /\/offline/);
  assert.ok(!/if \(req\.mode === "navigate"\)[\s\S]{0,500}cache\.put/.test(sw), "navigations are never written to Cache Storage");
});

test("Offline page — honest copy, retry, no cached financial data", () => {
  const offline = read("src/app/offline/page.tsx");
  assert.match(offline, /وِزان/);
  assert.match(offline, /اتصال اینترنت برقرار نیست/);
  assert.match(offline, /اطلاعات مالی شما عمداً در حافظه آفلاین ذخیره نشده است/);
  assert.match(offline, /تلاش دوباره/);
});

test("Accessibility — iOS dialog, 44px targets, keyboard close", () => {
  const guide = read("src/components/pwa/IosInstallGuide.tsx");
  const css = read("src/app/globals.css");
  const sheet = read("src/components/ui/Sheet.tsx");

  assert.match(guide, /aria-modal="true"/);
  assert.match(guide, /aria-labelledby/);
  assert.match(guide, /focus/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(sheet, /aria-labelledby/);
  assert.match(sheet, /aria-modal="true"/);
});

test("Design tokens — no undefined --surface-2; asset-class tokens exist", () => {
  const css = read("src/app/globals.css");
  const tx = read("src/components/transactions/TransactionsView.tsx");
  const form = read("src/components/forms/TransactionForm.tsx");
  const nw = read("src/app/net-worth/page.tsx");

  assert.match(css, /--asset-cash/);
  assert.match(css, /--asset-investment/);
  assert.match(css, /--asset-crypto/);
  assert.match(css, /--asset-other/);
  assert.doesNotMatch(css, /--surface-2\s*:/);
  assert.doesNotMatch(tx, /var\(--surface-2\)/);
  assert.doesNotMatch(form, /var\(--surface-2\)/);
  assert.match(nw, /ASSET_CLASS_TOKENS/);
  assert.doesNotMatch(nw, /#3d8bfd/);
  assert.doesNotMatch(nw, /#7048e8/);
});

test("Landing/PWA changes do not import ledger or accounting services", () => {
  const files = [
    "src/components/landing/LandingPage.tsx",
    "src/components/landing/LandingChrome.tsx",
    "src/components/pwa/InstallPromotion.tsx",
    "src/components/pwa/IosInstallGuide.tsx",
    "src/lib/publicEntry.ts",
  ];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /@\/features\/ledger/);
    assert.doesNotMatch(src, /@\/domain\/accounting/);
    assert.doesNotMatch(src, /recordIncome|recordExpense|postEntry/);
  }
});
