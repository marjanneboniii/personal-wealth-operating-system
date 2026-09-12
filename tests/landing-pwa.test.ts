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

test("Landing — Persian RTL conversion page with primary CTA شروع رایگان", () => {
  const landing = read("src/components/landing/LandingPage.tsx");
  const chrome = read("src/components/landing/LandingChrome.tsx");
  const layout = read("src/app/layout.tsx");

  assert.match(layout, /lang=\"fa\"/);
  assert.match(layout, /dir=\"rtl\"/);
  assert.match(landing, /تمام ثروت شما، یک تصویر روشن/);
  assert.match(landing, /سیستم‌عامل ثروت شخصی/);
  assert.match(
    landing,
    /دیگر لازم نیست بین اکسل، اپلیکیشن بانک و یادداشت‌های پراکنده سرگردان باشید/,
  );
  assert.match(landing, /شروع رایگان/);
  // «ورود» stays visually secondary (ghost) next to the single primary CTA.
  assert.match(landing, /btn-ghost/);
  // iOS install lives in the header chrome, not in the hero CTA row.
  assert.doesNotMatch(landing, /DownloadIosButton/);
  assert.match(landing, /href=\"\/login\"/);
  assert.match(landing, /href=\"\/register\"/);
  assert.match(chrome, /href=\"\/login\"/);
  assert.match(chrome, /href=\"\/register\"/);
  assert.match(chrome, /ایجاد حساب/);
  assert.match(chrome, /ورود/);
  assert.match(chrome, /DownloadIosButton/);
  assert.match(chrome, /سیستم‌عامل ثروت شخصی/);

  assert.doesNotMatch(landing, /قابلیت‌هایی که همین حالا در محصول هست/);
  assert.doesNotMatch(landing, /حریم خصوصی، مالکیت و کنترل/);
  assert.doesNotMatch(landing, /Double-entry|FIFO|journal posting|lot consumption/i);
  assert.doesNotMatch(landing, /دفترکل و حسابرسی/);
  assert.doesNotMatch(landing, /Download iOS/);
  assert.doesNotMatch(chrome, /Download iOS/);
  assert.doesNotMatch(landing, /ورود به سیستم/);
  assert.doesNotMatch(chrome, /ورود به سیستم/);
});

test("Landing — four primary outcomes, how-it-works, FAQ, and final CTA copy", () => {
  const landing = read("src/components/landing/LandingPage.tsx");

  assert.match(landing, /هر عدد، یک تصمیم بهتر/);
  assert.match(landing, /ارزش خالص/);
  assert.match(landing, /بدانید امسال واقعاً ثروتمندتر شده‌اید یا نه/);
  assert.match(landing, /دارایی‌ها/);
  assert.match(landing, /از حساب بانکی تا ملک و طلا، همه‌جا یک‌جا/);
  assert.match(landing, /بدهی‌ها/);
  assert.match(landing, /هیچ قسط یا بدهی‌ای از چشمتان دور نمی‌ماند/);
  assert.match(landing, /نقدینگی/);
  assert.match(landing, /همین امروز بدانید چقدر پول واقعی در دست دارید/);
  assert.match(landing, /خصوصی، شفاف، تحت کنترل شما/);
  assert.match(landing, /همین امروز تصویر مالی‌تان را روشن کنید/);
  assert.match(landing, /ثبت‌نام ساده است و نیازی به کارت بانکی ندارد/);

  // New sections: how-it-works (3 steps) and FAQ accordion (4 questions).
  assert.match(landing, /شروع، ساده‌تر از یک فایل اکسل/);
  assert.match(landing, /دارایی‌ها و بدهی‌هایتان را اضافه کنید/);
  assert.match(landing, /توازن خودش حساب می‌کند/);
  assert.match(landing, /با یک نگاه تصمیم بگیرید/);
  assert.match(landing, /سؤالات متداول/);
  assert.match(landing, /آیا استفاده از توازن رایگان است؟/);
  assert.match(landing, /آیا باید حساب بانکی‌ام را وصل کنم؟/);
  assert.match(landing, /اطلاعات مالی من کجا ذخیره می‌شود و چقدر امن است؟/);
  assert.match(landing, /آیا می‌توانم انواع دارایی را کنار هم داشته باشم/);
  assert.match(landing, /<details/);
  assert.match(landing, /<summary/);

  // Hero trust note and demo caption.
  assert.match(landing, /بدون نیاز به اتصال حساب بانکی/);
  // The preview card is labelled «نمونه نمایشی»; calling it «واقعی» as well
  // contradicted that badge, so the caption is now neutral.
  assert.match(landing, /نمایی از داشبورد توازن/);
  assert.doesNotMatch(landing, /نمونه واقعی/);

  assert.doesNotMatch(landing, /title: \"تراکنش‌ها\"/);
  assert.doesNotMatch(landing, /title: \"نقد\"/);
  assert.doesNotMatch(landing, /label: \"نقد\"/);
  assert.doesNotMatch(landing, /آنچه در یک نگاه می‌بینید/);
  assert.doesNotMatch(landing, /تصویر مالی‌تان را یکجا ببینید/);
});

test("Landing — product preview uses static Toman samples with Persian digits", () => {
  const landing = read("src/components/landing/LandingPage.tsx");

  assert.match(landing, /نمونه نمایشی/);
  // The four demo figures, and the identity that makes them a believable
  // balance sheet rather than four unrelated numbers: assets − debts = net worth.
  assert.match(landing, /۱۲۵٬۰۰۰٬۰۰۰ تومان/, "net worth");
  assert.match(landing, /۱۸۰٬۰۰۰٬۰۰۰ تومان/, "assets");
  assert.match(landing, /۵۵٬۰۰۰٬۰۰۰ تومان/, "debts");
  assert.match(landing, /۳۵٬۰۰۰٬۰۰۰ تومان/, "liquidity");
  assert.match(landing, /PREVIEW_SAMPLE/);

  // The landing is the first number a visitor sees, so it must obey the app's
  // own number standard: ٪ AFTER the digits, and an ASCII "." decimal mark —
  // src/lib/format.ts bans the Persian ٫ because it reads as a slash.
  assert.match(landing, /deltaPct: "۳\.۵٪"/, "percent sign follows the digits");

  assert.doesNotMatch(landing, /\$184/);
  assert.doesNotMatch(landing, /184,240 USD/);
  assert.doesNotMatch(landing, /184,240 دلار/);
  assert.doesNotMatch(landing, /IRR 184240/);
  assert.doesNotMatch(landing, /@\/features\/ledger/);
  assert.doesNotMatch(landing, /@\/db/);
  assert.doesNotMatch(landing, /fetch\(/);
  assert.doesNotMatch(landing, /formatMoney/);
  assert.doesNotMatch(landing, /getNetWorth/);
});

test("Landing — the install guide covers every platform and stays accessible", () => {
  const guide = read("src/components/pwa/IosInstallGuide.tsx");
  assert.match(guide, /\"use client\"/);

  // The iOS walkthrough is still the headline case, and still names the three
  // real steps. The exact sentences were reworded when the guide grew to cover
  // every platform, so this asserts the STEPS rather than the old phrasing.
  assert.match(guide, /نصب توازن روی آیفون/);
  assert.match(guide, /Share/);
  assert.match(guide, /Add to Home Screen/);
  assert.match(guide, /متوجه شدم/);
  assert.match(guide, /نصب روی آیفون/);

  // …and the other platforms now get their own real route instead of being shown
  // iPhone instructions or nothing at all.
  assert.match(guide, /نصب توازن روی اندروید/, "Android has its own steps");
  assert.match(guide, /نصب توازن روی رایانه/, "desktop Chromium has its own steps");
  assert.match(
    guide,
    /این مرورگر نصب را پشتیبانی نمی‌کند/,
    "a browser that cannot install says so plainly instead of showing a dead walkthrough",
  );

  // Accessibility contract — unchanged.
  assert.match(guide, /role=\"dialog\"/);
  assert.match(guide, /aria-modal=\"true\"/);
  assert.match(guide, /aria-labelledby/);
  assert.match(guide, /Escape/);
  assert.match(guide, /aria-label=\"بستن\"/);
  assert.match(guide, /min-h-12/);
  assert.doesNotMatch(guide, /Download iOS/);
});

test("Landing — the install dialog is PORTALLED out of the header", () => {
  const guide = read("src/components/pwa/IosInstallGuide.tsx");
  const css = read("src/app/globals.css");

  // THE BUG THIS PINS. `.landing-header` carries `backdrop-filter`, which makes
  // it a CONTAINING BLOCK for `position: fixed` descendants — so the dialog,
  // rendered as a sibling of the button inside that header, was laid out
  // relative to a 3.5rem-tall bar instead of the viewport, and trapped inside
  // the header's z-index: 30 stacking context. The same header also carries
  // `.landing-ink`, whose token remap the dialog inherited down the DOM tree,
  // painting it in landing colours over an app-themed page.
  //
  // Portalling to <body> is what fixes all three at once.
  assert.match(guide, /createPortal/, "the dialog escapes its DOM parent");
  assert.match(guide, /createPortal\(dialog, document\.body\)/, "…specifically to <body>");
  assert.match(css, /backdrop-filter: blur\(var\(--l-blur\)\)/, "the header really does create one");

  // A portalled node is rendered client-side only; the guard must exist or the
  // server pass would dereference `document`.
  assert.match(guide, /!open \|\| !mounted/, "no portal is attempted during SSR");
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
  assert.match(promo, /نصب روی آیفون/);
});

test("PWA — install prompt is wired and captured before the app chrome mounts", () => {
  const promo = read("src/components/pwa/InstallPromotion.tsx");
  assert.match(promo, /usePwaInstallState/);
  assert.match(promo, /beforeinstallprompt/);
  assert.match(promo, /Add to Home Screen/);
  assert.match(promo, /افزودن به صفحه اصلی/);
  assert.match(promo, /فعلاً نه/);

  const sw = read("public/sw.js");
  assert.match(sw, /req\.mode === \"navigate\"/);
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
  assert.match(sw, /req\.method !== \"GET\"/);
  assert.match(sw, /No API mutations are ever cached/);
  assert.match(sw, /\/api\//);
  assert.match(sw, /\/offline/);
  assert.ok(!/if \(req\.mode === \"navigate\"\)[\s\S]{0,500}cache\.put/.test(sw), "navigations are never written to Cache Storage");
});

test("Offline page — honest copy, retry, no cached financial data", () => {
  const offline = read("src/app/offline/page.tsx");
  assert.match(offline, /توازن/);
  assert.match(offline, /اتصال اینترنت برقرار نیست/);
  assert.match(offline, /اطلاعات مالی شما عمداً در حافظه آفلاین ذخیره نشده است/);
  assert.match(offline, /تلاش دوباره/);
});

test("Accessibility — iOS dialog, 44px targets, keyboard close", () => {
  const guide = read("src/components/pwa/IosInstallGuide.tsx");
  const css = read("src/app/globals.css");
  const sheet = read("src/components/ui/Sheet.tsx");

  assert.match(guide, /aria-modal=\"true\"/);
  assert.match(guide, /aria-labelledby/);
  assert.match(guide, /focus/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /overflow-x: clip/);
  assert.match(sheet, /aria-labelledby/);
  assert.match(sheet, /aria-modal=\"true\"/);
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

test("Tavazon brand tokens — one palette shared by landing and app", () => {
  const css = read("src/app/globals.css");
  const mark = read("src/components/layout/BrandMark.tsx");
  const chrome = read("src/components/landing/LandingChrome.tsx");

  // Palette primitives are declared exactly once and referenced everywhere.
  assert.match(css, /--sky-400:\s*#38bdf8/i);
  assert.match(css, /--sky-700:\s*#0369a1/i);
  assert.match(css, /--emerald-400:\s*#34d399/i);
  assert.match(css, /--amber-400:\s*#fbbf24/i);
  assert.match(css, /--lavender-300:\s*#c4b5fd/i);

  // Sky/cyan is the interaction accent: cyan-700 on light (AA), sky-400 on dark.
  assert.match(css, /--color-accent:\s*var\(--sky-700\)/i);
  assert.match(css, /--color-accent:\s*var\(--sky-400\)/i);
  assert.match(css, /--color-module-wealth:\s*var\(--sky-700\)/i);

  // Emerald = positive, amber/red = negative. Never decorative.
  assert.match(css, /--color-positive:\s*var\(--emerald-(400|700)\)/i);
  assert.match(css, /--color-danger:\s*var\(--red-(400|600)\)/i);
  assert.match(css, /--color-warning:\s*var\(--amber-(400|700)\)/i);

  // Lavender stays a tertiary investment-only accent.
  assert.match(css, /--investment:\s*var\(--lavender-(300|ink)\)/i);
  assert.match(css, /--asset-investment:\s*var\(--lavender-(300|ink)\)/i);

  // The retired violet identity must not come back as the brand colour.
  assert.doesNotMatch(css, /--color-accent:\s*#6e6ff0/i);
  assert.doesNotMatch(css, /--brand:\s*#(6e6ff0|8b8cf5)/i);
  assert.doesNotMatch(css, /--color-module-wealth:\s*#6e6ff0/i);
  // the flat cyan-700 accent was replaced for being the least chromatic passing option
  assert.doesNotMatch(css, /--color-accent:\s*var\(--cyan-700\)/i);

  assert.match(css, /\.brand-wordmark/);
  // The wordmark is Bold, not Black. Vazirmatn Black was a fifth 49.8 KB font
  // file loaded on every page for the single word «توازن», and at the sizes the
  // wordmark actually renders (17px header, 14px footer) it is indistinguishable
  // from Bold — so the weight, the @font-face and the file were all dropped.
  assert.match(css, /\.brand-wordmark \{\s*\n\s*font-weight: 700;/);
  assert.doesNotMatch(css, /font-weight: 900/, "no rule may ask for the retired Black weight");
  assert.doesNotMatch(css, /Vazirmatn-Black/, "the Black @font-face is gone");
  assert.match(mark, /توازن/);
  assert.match(chrome, /توازن/);
  assert.doesNotMatch(chrome, /وِزان/);
});

test("Application currency system is unchanged — تومان، دلار، تتر remain", () => {
  const format = read("src/lib/format.ts");
  const moneyForm = read("src/components/forms/MoneyAccountForm.tsx");
  const dual = read("src/components/ui/DualMoney.tsx");
  const fx = read("src/components/settings/FxSettings.tsx");
  const landing = read("src/components/landing/LandingPage.tsx");

  assert.match(format, /USD: \"دلار\"/);
  assert.match(format, /USDT: \"تتر\"/);
  assert.match(format, /IRT: \"تومان\"/);
  assert.match(format, /export function formatMoney/);
  assert.match(format, /export function formatNumber/);
  assert.match(format, /export function currencyLabel/);
  assert.match(format, /export function irtToUsd/);
  assert.match(format, /export function usdToIrt/);

  assert.match(moneyForm, /\"IRT\" \| \"USD\" \| \"USDT\"/);
  assert.match(moneyForm, /تومان/);
  assert.match(moneyForm, /دلار/);
  assert.match(moneyForm, /تتر/);
  // DualMoney renders through the shared formatter — via the dual helpers,
  // which are the only correct entry point for a two-currency figure.
  assert.match(dual, /formatDualMoneyFrom(Irt|Usd)/);
  assert.match(fx, /نرخ مرجع تتر/, "the FX panel names the rate it actually sets");

  assert.doesNotMatch(landing, /\$184,240/);
  assert.doesNotMatch(landing, /184,240 USD/);
});
