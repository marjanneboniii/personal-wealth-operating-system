/**
 * Asset Logo Resolver — the single, deterministic source of truth for which
 * image represents an asset, account or wallet in the UI.
 *
 * ─────────────────────────── Resolution priority ───────────────────────────
 *   1. User selected / uploaded logo   (an explicit choice always wins)
 *   2. Stored asset logo metadata      (assets.logo_url as recorded at
 *                                       registration time)
 *   3. PersianLabs brand mapping       (vehicle / bank / company / gateway)
 *   4. CoinGecko crypto logo           (official token artwork)
 *   5. Default placeholder
 *
 * Rules 1 and 2 exist to make the display STABLE: once an asset has a logo,
 * later changes to the brand tables can never repaint an existing user asset
 * (a Toyota Camry keeps its vehicle logo and can never become a stock or
 * crypto mark).
 *
 * PRESENTATION ONLY — this module is pure and side-effect free. It performs no
 * database, network or filesystem access and never touches the general ledger,
 * journal entries, FIFO lots, cost basis, audit trail, transactions or asset
 * valuation. Given the same input it always returns the same output.
 */

import {
  DEFAULT_ASSET_LOGO,
  DEFAULT_AUTO_LOGO,
  DEFAULT_INSTITUTION_LOGO,
  REAL_ESTATE_LOGO,
  TOMAN_LOGO,
  USD_LOGO,
  getAutomobileLogo,
  getBankLogo,
  getCryptoLogo,
  getCryptoLogoByCoinGeckoId,
  getInsuranceLogo,
  getIranianBrandLogo,
  getPaymentGatewayLogo,
} from "./persianIcons";

/* ─────────────────────────── Types ─────────────────────────── */

/** Product-level classification used to pick the right brand table. */
export type AssetLogoType =
  | "vehicle"
  | "real_estate"
  | "bank"
  | "company"
  | "payment"
  | "insurance"
  | "crypto"
  | "fiat"
  | "commodity"
  | "unknown";

/**
 * Everything the resolver may look at. Every field is optional so any call
 * site (portfolio row, account row, wallet header, form preview) can pass
 * whatever it happens to have.
 */
export type AssetLogoInput = {
  /** 1 — an explicit user choice (uploaded file or picked icon). */
  userLogoUrl?: string | null;
  /** 2 — logo persisted on the asset record (assets.logo_url). */
  logoUrl?: string | null;
  /** Ticker / short code, e.g. "USDT", "BTC", "IRT". */
  symbol?: string | null;
  /** Human name of the asset ("تویوتا کمری (۲۰۲۰)"). */
  name?: string | null;
  /** Brand of a real asset — vehicle marque, bank, issuer. */
  brandName?: string | null;
  /** Accounting asset-class name, e.g. "رمزارز" / "نقد و بانک". */
  className?: string | null;
  /** Explicit product type; inferred from the other fields when absent. */
  assetType?: AssetLogoType | null;
  /** CoinGecko identity when known — beats symbol for crypto. */
  coingeckoId?: string | null;
};

export type ResolvedAssetLogo = {
  /** The image to render. Never empty. */
  src: string;
  /** Which rule produced `src` — useful for tests and debugging. */
  source:
    | "user"
    | "stored"
    | "persianlabs"
    | "coingecko"
    | "fiat"
    | "real-estate"
    | "default";
  /** The type the resolver settled on. */
  assetType: AssetLogoType;
};

/* ─────────────────────────── Classification ─────────────────────────── */

const VEHICLE_CLASS_RE = /خودرو|وسیله نقلیه|vehicle|automobile|car/i;
const REAL_ESTATE_CLASS_RE = /املاک|مستغلات|ملک|مسکن|real.?estate|property/i;
const CRYPTO_CLASS_RE = /رمزارز|ارز دیجیتال|استیبل|crypto|stable|token/i;
const CASH_CLASS_RE = /نقد|بانک|cash|bank|fiat/i;
const COMMODITY_CLASS_RE = /طلا|کالا|فلز|gold|commodity|metal/i;
const REAL_ESTATE_NAME_RE = /ملک|آپارتمان|خانه|زمین|ویلا|مغازه|دفتر کار/;

/** Fiat currency codes rendered with a dedicated currency mark. */
const FIAT_SYMBOLS = new Set(["IRT", "IRR", "USD", "EUR", "GBP", "AED", "TRY", "CNY", "JPY", "CAD", "AUD"]);

/**
 * Best-effort product type for an asset. Pure and deterministic: an explicit
 * `assetType` always wins, then the strongest structural signal.
 */
export function classifyAssetType(input: AssetLogoInput): AssetLogoType {
  if (input.assetType) return input.assetType;

  const className = input.className ?? "";
  const name = input.name ?? "";
  const symbol = (input.symbol ?? "").trim().toUpperCase();

  // A vehicle brand is only meaningful for a vehicle, so it is a strong signal.
  if (VEHICLE_CLASS_RE.test(className)) return "vehicle";
  if (REAL_ESTATE_CLASS_RE.test(className) || REAL_ESTATE_NAME_RE.test(name)) return "real_estate";
  if (CRYPTO_CLASS_RE.test(className)) return "crypto";
  if (COMMODITY_CLASS_RE.test(className)) return "commodity";
  if (FIAT_SYMBOLS.has(symbol)) return "fiat";
  if (input.coingeckoId) return "crypto";
  if (CASH_CLASS_RE.test(className)) return "bank";
  if (input.brandName && getAutomobileLogo(input.brandName)) return "vehicle";
  if (getCryptoLogo(symbol)) return "crypto";
  return "unknown";
}

/* ─────────────────────────── Helpers ─────────────────────────── */

function clean(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Fiat currency mark — Toman and USD have first-class artwork. */
function fiatLogo(symbol: string): string | null {
  if (symbol === "IRT" || symbol === "IRR") return TOMAN_LOGO;
  if (symbol === "USD") return USD_LOGO;
  return null;
}

/**
 * PersianLabs brand mark for a non-crypto asset. Each type consults only the
 * tables that can legitimately describe it, so a bank name can never leak onto
 * a vehicle (or vice versa).
 */
function persianLabsLogo(type: AssetLogoType, input: AssetLogoInput): string | null {
  const brand = clean(input.brandName);
  const name = clean(input.name);

  switch (type) {
    case "vehicle":
      return getAutomobileLogo(brand) ?? getAutomobileLogo(name);
    case "bank":
      return (
        getBankLogo(brand) ??
        getBankLogo(name) ??
        getIranianBrandLogo(brand) ??
        getIranianBrandLogo(name)
      );
    case "company":
      return (
        getIranianBrandLogo(brand) ??
        getIranianBrandLogo(name) ??
        getBankLogo(brand) ??
        getBankLogo(name)
      );
    case "payment":
      return getPaymentGatewayLogo(brand) ?? getPaymentGatewayLogo(name);
    case "insurance":
      return getInsuranceLogo(brand) ?? getInsuranceLogo(name);
    default:
      return null;
  }
}

/** Type-appropriate placeholder — never another asset's artwork. */
function fallbackFor(type: AssetLogoType): string {
  switch (type) {
    case "vehicle":
      return DEFAULT_AUTO_LOGO;
    case "real_estate":
      return REAL_ESTATE_LOGO;
    case "bank":
    case "payment":
    case "insurance":
      return DEFAULT_INSTITUTION_LOGO;
    default:
      return DEFAULT_ASSET_LOGO;
  }
}

/* ─────────────────────────── Resolver ─────────────────────────── */

/**
 * Resolve the logo of an asset, with the full provenance of the decision.
 *
 * ```
 * if (userUploadedLogo) return userUploadedLogo;
 * else if (assetStoredLogo) return assetStoredLogo;
 * else if (vehicle | bank | company) return PersianLabsLogo;
 * else if (crypto) return CoinGeckoLogo;
 * else return DefaultAssetIcon;
 * ```
 */
export function resolveAssetLogoDetailed(input: AssetLogoInput): ResolvedAssetLogo {
  const assetType = classifyAssetType(input);

  // 1 ── An explicit user choice always wins.
  const userLogo = clean(input.userLogoUrl);
  if (userLogo) return { src: userLogo, source: "user", assetType };

  // 2 ── Logo stored on the asset record. This is what keeps an existing
  //      user asset visually stable across releases.
  const storedLogo = clean(input.logoUrl);
  if (storedLogo) return { src: storedLogo, source: "stored", assetType };

  const symbol = (clean(input.symbol) ?? "").toUpperCase();

  // 3 ── PersianLabs brand mapping for real-world / Iranian assets.
  if (assetType !== "crypto") {
    const brandLogo = persianLabsLogo(assetType, input);
    if (brandLogo) return { src: brandLogo, source: "persianlabs", assetType };
  }

  // Fiat currency marks (Toman / USD) — before the generic placeholder.
  if (assetType === "fiat" || FIAT_SYMBOLS.has(symbol)) {
    const fiat = fiatLogo(symbol);
    if (fiat) return { src: fiat, source: "fiat", assetType };
  }

  // 4 ── CoinGecko is the ONLY source of crypto artwork. The CoinGecko id is
  //      preferred over the symbol because symbols are not unique.
  const coinLogo =
    getCryptoLogoByCoinGeckoId(input.coingeckoId) ??
    (assetType === "crypto" || assetType === "unknown" ? getCryptoLogo(symbol) : null);
  if (coinLogo) return { src: coinLogo, source: "coingecko", assetType };

  if (assetType === "real_estate") {
    return { src: REAL_ESTATE_LOGO, source: "real-estate", assetType };
  }

  // 5 ── Deterministic placeholder.
  return { src: fallbackFor(assetType), source: "default", assetType };
}

/** Convenience wrapper returning just the image URL. Always non-empty. */
export function resolveAssetLogo(input: AssetLogoInput): string {
  return resolveAssetLogoDetailed(input).src;
}
