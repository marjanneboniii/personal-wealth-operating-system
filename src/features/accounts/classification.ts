/**
 * Account-family classification — Liquid vs Investment.
 *
 * PRODUCT RULE (this is the single source of truth for the separation):
 *   • Liquid_Account   → bank / cash box / fund AND stablecoin (USDT, USDC, …)
 *                        hot/cold wallets. Rendered in the Money module
 *                        («پول → حساب‌ها») and selectable as the payment
 *                        source/destination of daily income & expense forms.
 *   • Investment_Asset → volatile crypto (BTC/ETH/SOL…), equities, funds,
 *                        gold & physical commodities, real estate, vehicles.
 *                        Rendered ONLY in the Assets module
 *                        («دارایی‌ها → /assets, /portfolio, /asset-registry»)
 *                        and reachable from the Buy/Sell/Trade workflows.
 *
 * PURE MODULE: no database, no Next, no Drizzle — importable from both server
 * read models and client components. It classifies presentation only; it never
 * touches the accounting core, postings, lots or balances.
 */

export type AccountFamily = "liquid" | "investment";

/** Fiat units (incl. IRR/Rial) and USD-pegged stablecoins used as money. */
export const LIQUID_SYMBOLS: ReadonlySet<string> = new Set([
  "IRT",
  "IRR",
  "USD",
  "USDT",
  "USDC",
  "USDG",
  "USDE",
  "USDS",
  "BUSD",
  "DAI",
  "USDD",
  "FDUSD",
  "EUR",
  "AED",
  "TRY",
  "GBP",
]);

/** Asset-class codes that denote money containers, not tradable positions. */
export const LIQUID_CLASS_CODES: ReadonlySet<string> = new Set(["cash", "stable", "stablecoin", "fiat", "money"]);

/** Asset-class codes that are investment positions by definition. */
export const INVESTMENT_CLASS_CODES: ReadonlySet<string> = new Set([
  "crypto",
  "stock",
  "security",
  "equity",
  "etf",
  "mutualfund",
  "fund",
  "gold",
  "commodity",
  "preciousmetal",
  "realestate",
  "property",
  "vehicle",
  "automobile",
  "rwa",
  "collectible",
]);

/** Persian/English class names used by the seeded & setup charts of accounts. */
const LIQUID_CLASS_NAMES: ReadonlySet<string> = new Set([
  "نقد و بانک",
  "نقد",
  "استیبل‌کوین",
  "استیبل کوین",
  "cash",
  "stablecoin",
  "fiat",
]);

const INVESTMENT_CLASS_NAMES: ReadonlySet<string> = new Set([
  "رمزارز",
  "رمز ارز",
  "سهام",
  "سهامی",
  "صندوق سرمایه‌گذاری",
  "صندوق سرمایه گذاری",
  "صندوق",
  "طلا",
  "سکه",
  "کالا",
  "دارایی واقعی",
  "املاک",
  "ملک",
  "خودرو",
  "rwa",
  "crypto",
  "stock",
  "gold",
  "commodity",
  "real estate",
  "realestate",
  "vehicle",
]);

/** Wallet kinds whose whole purpose is to hold money, not positions. */
const MONEY_WALLET_KINDS: ReadonlySet<string> = new Set(["bank", "cash", "fund"]);

const normalizeCode = (value: string | null | undefined) =>
  (value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");

const normalizeName = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

export type AccountFamilyInput = {
  /** `assets.symbol` of the account denomination (IRT, USD, USDT, BTC, …). */
  symbol?: string | null;
  /** `asset_classes.code` — the accounting classification of that asset. */
  classCode?: string | null;
  /** `asset_classes.name` — used when a legacy row has no stable code. */
  className?: string | null;
  /** `wallets.kind` — bank | cash | exchange | hot | cold | fund. */
  walletKind?: string | null;
};

/**
 * First match wins. Order is deliberate: the concrete denomination (symbol)
 * beats the class, the class code beats the display name, and only when every
 * signal is unknown does the ISO-4217-shaped heuristic apply. Unknown is
 * resolved to `investment` so nothing silently disappears from the Assets
 * module — an unclassified position is still an asset, never "money".
 */
export function classifyAccountFamily(input: AccountFamilyInput): AccountFamily {
  const symbol = (input.symbol ?? "").trim().toUpperCase();
  if (LIQUID_SYMBOLS.has(symbol)) return "liquid";

  const classCode = normalizeCode(input.classCode);
  if (LIQUID_CLASS_CODES.has(classCode)) return "liquid";
  if (INVESTMENT_CLASS_CODES.has(classCode)) return "investment";

  const className = normalizeName(input.className);
  if (LIQUID_CLASS_NAMES.has(className)) return "liquid";
  if (INVESTMENT_CLASS_NAMES.has(className)) return "investment";

  // Nothing matched. An unknown ticker is a POSITION — unless it lives in a
  // dedicated money container (a bank, a cash box or a fund/brokerage
  // wallet), which is what makes e.g. a legacy "EUR box" money without having
  // to keep an exhaustive fiat list here. A coin sitting on an exchange or a
  // hot wallet is never promoted to money by this rule.
  const kind = (input.walletKind ?? "").trim().toLowerCase();
  if (symbol && MONEY_WALLET_KINDS.has(kind)) return "liquid";

  return "investment";
}

export const isLiquidAccount = (input: AccountFamilyInput): boolean =>
  classifyAccountFamily(input) === "liquid";

export const isInvestmentAccount = (input: AccountFamilyInput): boolean =>
  classifyAccountFamily(input) === "investment";

/**
 * Whether an account may be used as the payment source/destination of a
 * DAILY flow (expense, income, debt repayment). Investment positions are
 * excluded by rule — they only ever move through Buy/Sell/Transfer.
 */
export function isUsableForDailyFlow(input: AccountFamilyInput): boolean {
  return isLiquidAccount(input);
}

/** Human label for the two families (Persian UI copy). */
export const ACCOUNT_FAMILY_LABELS: Record<AccountFamily, string> = {
  liquid: "حساب نقد",
  investment: "دارایی سرمایه‌گذاری",
};
