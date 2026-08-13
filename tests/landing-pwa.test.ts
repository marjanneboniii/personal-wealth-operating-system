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

test("PWA — install prompt is wired and captured before the app chrome mounts", () => {
  const promo = read("src/components/pwa/InstallPromotion.tsx");
  assert.match(promo, /usePwaInstallState/);
  assert.match(promo, /beforeinstallprompt/);
  assert.match(promo, /Add to Home Screen/);

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

test("Landing/PWA changes do not import ledger or accounting services", () => {
  const files = [
    "src/components/landing/LandingPage.tsx",
    "src/components/landing/LandingChrome.tsx",
    "src/components/pwa/InstallPromotion.tsx",
    "src/lib/publicEntry.ts",
  ];
  for (const file of files) {
    const src = read(file);
    assert.doesNotMatch(src, /@\/features\/ledger/);
    assert.doesNotMatch(src, /@\/domain\/accounting/);
    assert.doesNotMatch(src, /recordIncome|recordExpense|postEntry/);
  }
});
