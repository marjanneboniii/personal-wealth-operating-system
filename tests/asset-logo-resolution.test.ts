/**
 * Asset Logo Resolution — display-layer regression suite.
 *
 * Pins the behaviour the logo system must guarantee:
 *   1. PersianLabs marks are used for Iranian banks / vehicles / companies.
 *   2. A user's existing asset NEVER changes logo (user > stored > everything).
 *   3. Crypto artwork comes from CoinGecko only — Tether included.
 *   4. Resolution is deterministic and always yields a usable image.
 *
 * Pure display assertions: no ledger, journal, FIFO or valuation code is
 * exercised or mutated here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";

import {
  classifyAssetType,
  resolveAssetLogo,
  resolveAssetLogoDetailed,
} from "../src/features/branding/assetLogo";
import {
  CRYPTO_LOGOS,
  DEFAULT_ASSET_LOGO,
  DEFAULT_AUTO_LOGO,
  REAL_ESTATE_LOGO,
  TOMAN_LOGO,
  getAutomobileLogo,
  getBankLogo,
  getCryptoLogo,
  getIranianBrandLogo,
  getPaymentGatewayLogo,
} from "../src/features/branding/persianIcons";
import { SUPPORTED_CRYPTO_ASSETS } from "../src/features/pricing/supportedAssets";

const PUBLIC_DIR = path.join(process.cwd(), "public");

function localFileExists(url: string): boolean {
  return fs.existsSync(path.join(PUBLIC_DIR, url.replace(/^\//, "")));
}

/* ─────────────── 1. PersianLabs — banks ─────────────── */

test("banks resolve to their PersianLabs mark (Persian and English names)", () => {
  const cases: Array<[string, string]> = [
    ["بانک ملت", "/ir-icons/banks/mellat.svg"],
    ["بانک ملی", "/ir-icons/banks/melli.svg"],
    ["بانک سامان", "/ir-icons/banks/saman.svg"],
    ["بانک پاسارگاد", "/ir-icons/banks/pasargad.svg"],
    ["بانک تجارت", "/ir-icons/banks/tejarat.svg"],
    ["Bank Mellat", "/ir-icons/banks/mellat.svg"],
    ["Bank Melli", "/ir-icons/banks/melli.svg"],
    ["Bank Saman", "/ir-icons/banks/saman.svg"],
  ];
  for (const [name, expected] of cases) {
    assert.equal(getBankLogo(name), expected, `${name} → ${expected}`);
    assert.ok(localFileExists(expected), `${expected} exists on disk`);
  }
});

test("bank names survive Arabic/Persian spelling variants", () => {
  // ك (Arabic kaf) and ي (Arabic ya) must normalise to ک / ی.
  assert.equal(getBankLogo("بانك ملت"), "/ir-icons/banks/mellat.svg");
  assert.equal(getBankLogo("  بانک   ملت  "), "/ir-icons/banks/mellat.svg");
});

test("every bank slug referenced by the map exists in public/ir-icons/banks", () => {
  const names = [
    "بانک ملت", "بانک ملی", "بانک سامان", "بانک پاسارگاد", "بانک تجارت",
    "بانک صادرات", "بانک سپه", "بانک کشاورزی", "بانک مسکن", "بانک رفاه",
    "بانک آینده", "بانک دی", "بانک سینا", "بانک کوثر", "بانک خاورمیانه",
    "بانک گردشگری", "بانک ایران زمین", "بانک سرمایه", "بانک ملل", "بانک نور",
    "بلوبانک", "بانکینو", "پست بانک", "بانک مرکزی",
  ];
  for (const name of names) {
    const logo = getBankLogo(name);
    assert.ok(logo, `${name} maps to a logo`);
    assert.ok(localFileExists(logo!), `${logo} exists on disk`);
  }
});

/* ─────────────── 2. PersianLabs — vehicles & brands ─────────────── */

test("Iranian automakers resolve to their PersianLabs vehicle mark", () => {
  const cases: Array<[string, string]> = [
    ["ایران‌خودرو", "/ir-icons/automobiles/iran-khodro.svg"],
    ["ایران خودرو", "/ir-icons/automobiles/iran-khodro.svg"],
    ["Iran Khodro", "/ir-icons/automobiles/iran-khodro.svg"],
    ["سایپا", "/ir-icons/automobiles/saipa.svg"],
    ["بهمن موتور", "/ir-icons/automobiles/bahman.svg"],
    ["کرمان موتور", "/ir-icons/automobiles/kerman-motor.svg"],
    ["زامیاد", "/ir-icons/automobiles/zamyad.svg"],
  ];
  for (const [name, expected] of cases) {
    assert.equal(getAutomobileLogo(name), expected, `${name} → ${expected}`);
    assert.ok(localFileExists(expected));
  }
});

test("payment gateways and Iranian brands resolve to their own marks", () => {
  assert.equal(getPaymentGatewayLogo("زرین‌پال"), "/ir-icons/payment-gateways/zarrinpal.svg");
  assert.equal(getPaymentGatewayLogo("shaparak"), "/ir-icons/payment-gateways/shaparak.svg");
  assert.equal(getIranianBrandLogo("نوبیتکس"), "/ir-icons/brands/nobitex.svg");
  assert.equal(getIranianBrandLogo("دیجی کالا"), "/ir-icons/brands/digikala.svg");
  for (const url of [
    "/ir-icons/payment-gateways/zarrinpal.svg",
    "/ir-icons/payment-gateways/shaparak.svg",
    "/ir-icons/brands/nobitex.svg",
    "/ir-icons/brands/digikala.svg",
  ]) {
    assert.ok(localFileExists(url), `${url} exists on disk`);
  }
});

/* ─────────────── 3. Vehicles use vehicle logos — never stock/crypto ─────────────── */

test("a vehicle asset gets a VEHICLE logo, never a stock or crypto mark", () => {
  // Toyota has no PersianLabs marque → must fall back to the vehicle icon.
  const camry = resolveAssetLogoDetailed({
    name: "تویوتا کمری (۲۰۲۰)",
    brandName: "تویوتا",
    className: "خودرو",
    symbol: "V-12",
  });
  assert.equal(camry.assetType, "vehicle");
  assert.equal(camry.src, DEFAULT_AUTO_LOGO);
  assert.notEqual(camry.source, "coingecko");

  for (const brand of ["BMW", "Mercedes-Benz", "مرسدس بنز", "تویوتا"]) {
    const logo = resolveAssetLogo({ brandName: brand, className: "خودرو", name: `${brand} X` });
    assert.equal(logo, DEFAULT_AUTO_LOGO, `${brand} keeps a vehicle icon`);
  }

  // A domestic marque gets its real brand logo.
  const samand = resolveAssetLogoDetailed({
    name: "ایران خودرو دنا پلاس (۱۴۰۲)",
    brandName: "ایران‌خودرو",
    className: "خودرو",
  });
  assert.equal(samand.source, "persianlabs");
  assert.equal(samand.src, "/ir-icons/automobiles/iran-khodro.svg");
});

test("a vehicle whose name contains a coin-like symbol is still a vehicle", () => {
  // Regression: RWA assets get short symbols; they must not hit crypto lookup.
  const resolved = resolveAssetLogoDetailed({
    symbol: "ETH", // deliberately hostile input
    brandName: "تویوتا",
    className: "خودرو",
    name: "تویوتا کمری",
  });
  assert.equal(resolved.assetType, "vehicle");
  assert.notEqual(resolved.source, "coingecko");
});

/* ─────────────── 4. Stability — an existing asset never changes ─────────────── */

test("a user-selected logo always wins over every other source", () => {
  const resolved = resolveAssetLogoDetailed({
    userLogoUrl: "/uploads/my-car.png",
    logoUrl: "/ir-icons/automobiles/saipa.svg",
    brandName: "ایران‌خودرو",
    symbol: "BTC",
    className: "خودرو",
  });
  assert.equal(resolved.src, "/uploads/my-car.png");
  assert.equal(resolved.source, "user");
});

test("a stored asset logo wins over brand and CoinGecko mapping", () => {
  const resolved = resolveAssetLogoDetailed({
    logoUrl: "/ir-icons/automobiles/iran-khodro.svg",
    brandName: "سایپا",
    symbol: "USDT",
    className: "خودرو",
  });
  assert.equal(resolved.src, "/ir-icons/automobiles/iran-khodro.svg");
  assert.equal(resolved.source, "stored");
});

test("blank/whitespace logo metadata does not shadow the brand mapping", () => {
  const resolved = resolveAssetLogoDetailed({
    logoUrl: "   ",
    userLogoUrl: "",
    brandName: "بانک ملت",
    assetType: "bank",
  });
  assert.equal(resolved.source, "persianlabs");
  assert.equal(resolved.src, "/ir-icons/banks/mellat.svg");
});

/* ─────────────── 5. Crypto comes from CoinGecko ─────────────── */

test("crypto logos are the official CoinGecko URLs", () => {
  const expectations: Array<[string, string]> = [
    ["BTC", "bitcoin"],
    ["ETH", "ethereum"],
    ["USDT", "tether"],
    ["USDC", "usd-coin"],
  ];
  for (const [symbol, coingeckoId] of expectations) {
    const registry = SUPPORTED_CRYPTO_ASSETS.find((a) => a.symbol === symbol);
    assert.ok(registry, `${symbol} is a supported asset`);
    assert.equal(registry!.coingeckoId, coingeckoId);

    const resolved = resolveAssetLogoDetailed({ symbol, className: "رمزارز" });
    assert.equal(resolved.source, "coingecko", `${symbol} resolves via CoinGecko`);
    assert.equal(resolved.src, registry!.logoUrl);
    assert.match(resolved.src, /^https:\/\/(coin-images|assets)\.coingecko\.com\//);
  }
});

test("USDT shows the original Tether logo — not a network, exchange or wrapped mark", () => {
  const tether = SUPPORTED_CRYPTO_ASSETS.find((a) => a.symbol === "USDT")!;
  assert.equal(tether.coingeckoId, "tether");
  assert.match(tether.logoUrl, /Tether/i);

  const resolved = resolveAssetLogoDetailed({ symbol: "USDT", className: "استیبل‌کوین" });
  assert.equal(resolved.src, tether.logoUrl);
  assert.equal(resolved.source, "coingecko");

  // Must never be the TRON/ETH network mark, an exchange mark, or a wrapped token.
  const wrong = [
    CRYPTO_LOGOS.TRX,
    CRYPTO_LOGOS.ETH,
    CRYPTO_LOGOS.WBTC,
    CRYPTO_LOGOS.XAUT, // Tether Gold — a DIFFERENT asset
    "/ir-icons/brands/nobitex.svg",
    "/ir-icons/crypto/usdt.png",
  ];
  for (const bad of wrong) {
    assert.notEqual(resolved.src, bad, `USDT must not use ${bad}`);
  }

  // Tether Gold keeps its own distinct artwork.
  const xaut = resolveAssetLogo({ symbol: "XAUT", className: "رمزارز" });
  assert.notEqual(xaut, tether.logoUrl, "XAUT is a separate asset with its own logo");
});

test("a distinct crypto asset (e.g. USDT0-style) keeps its own identity", () => {
  // An unknown token must NOT borrow Tether's logo just because it looks alike.
  const resolved = resolveAssetLogoDetailed({ symbol: "USDT0", className: "رمزارز" });
  assert.notEqual(resolved.src, CRYPTO_LOGOS.USDT);
  assert.equal(resolved.src, DEFAULT_ASSET_LOGO);

  // With its own stored CoinGecko identity it uses that asset's logo.
  const withOwnLogo = resolveAssetLogoDetailed({
    symbol: "USDT0",
    className: "رمزارز",
    logoUrl: "https://coin-images.coingecko.com/coins/images/53705/large/usdt0.jpg",
  });
  assert.equal(withOwnLogo.source, "stored");
});

test("the CoinGecko id beats the symbol when both are present", () => {
  const resolved = resolveAssetLogoDetailed({ symbol: "BTC", coingeckoId: "tether" });
  assert.equal(resolved.src, CRYPTO_LOGOS.USDT);
  assert.equal(resolved.source, "coingecko");
});

test("every supported crypto asset exposes an https CoinGecko logo", () => {
  for (const asset of SUPPORTED_CRYPTO_ASSETS) {
    assert.match(
      asset.logoUrl,
      /^https:\/\/(coin-images|assets)\.coingecko\.com\//,
      `${asset.symbol} uses a CoinGecko URL`,
    );
    assert.equal(getCryptoLogo(asset.symbol), asset.logoUrl);
  }
});

/* ─────────────── 6. Fiat, real estate and fallbacks ─────────────── */

test("fiat currencies use their local currency mark", () => {
  assert.equal(resolveAssetLogo({ symbol: "IRT", className: "نقد و بانک" }), TOMAN_LOGO);
  assert.equal(resolveAssetLogo({ symbol: "IRR", className: "نقد و بانک" }), TOMAN_LOGO);
  assert.ok(localFileExists(TOMAN_LOGO));
});

test("real estate falls back to the building mark", () => {
  const resolved = resolveAssetLogoDetailed({ name: "آپارتمان تهران", className: "املاک" });
  assert.equal(resolved.assetType, "real_estate");
  assert.equal(resolved.src, REAL_ESTATE_LOGO);
  assert.ok(localFileExists(REAL_ESTATE_LOGO));
});

test("an unknown asset gets the neutral placeholder, never another asset's logo", () => {
  const resolved = resolveAssetLogoDetailed({ symbol: "ZZZZ", name: "چیز ناشناخته" });
  assert.equal(resolved.src, DEFAULT_ASSET_LOGO);
  assert.equal(resolved.source, "default");
  assert.ok(localFileExists(DEFAULT_ASSET_LOGO));
  // The old code fell back to the Tether PNG for unknown crypto — never again.
  assert.notEqual(resolved.src, CRYPTO_LOGOS.USDT);
});

test("resolution is deterministic and always returns a non-empty image", () => {
  const inputs = [
    { symbol: "BTC", className: "رمزارز" },
    { brandName: "بانک ملت", assetType: "bank" as const },
    { brandName: "تویوتا", className: "خودرو" },
    { symbol: "IRT", className: "نقد و بانک" },
    {},
  ];
  for (const input of inputs) {
    const first = resolveAssetLogo(input);
    for (let i = 0; i < 5; i++) {
      assert.equal(resolveAssetLogo(input), first, "same input → same output");
    }
    assert.ok(first.length > 0);
  }
});

test("classification recognises the product families the UI relies on", () => {
  assert.equal(classifyAssetType({ className: "خودرو" }), "vehicle");
  assert.equal(classifyAssetType({ className: "املاک" }), "real_estate");
  assert.equal(classifyAssetType({ className: "رمزارز" }), "crypto");
  assert.equal(classifyAssetType({ className: "استیبل‌کوین" }), "crypto");
  assert.equal(classifyAssetType({ className: "نقد و بانک", symbol: "IRT" }), "fiat");
  assert.equal(classifyAssetType({ assetType: "company" }), "company");
});

/* ─────────────── 7. Local asset integrity ─────────────── */

test("all locally-served logo directories are populated", () => {
  for (const dir of ["banks", "automobiles", "payment-gateways", "brands", "insurance", "defaults"]) {
    const full = path.join(PUBLIC_DIR, "ir-icons", dir);
    assert.ok(fs.existsSync(full), `${dir} exists`);
    assert.ok(fs.readdirSync(full).length > 0, `${dir} is not empty`);
  }
});
