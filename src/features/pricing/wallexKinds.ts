/**
 * Market kind vocabulary — PURE, so client components can import it without
 * pulling the database-backed catalogue module into the browser bundle.
 *
 * PRODUCT RULE: a market row is shown by WHAT IT IS, never by which exchange
 * quoted it. No label, chip, placeholder or message names a source.
 */

export const WALLEX_KIND_LABELS: Record<string, string> = {
  crypto: "رمزارز",
  stablecoin: "استیبل‌کوین",
  tokenized_stock: "سهام آمریکا",
  index: "شاخص",
  commodity: "کامودیتی",
  bond: "اوراق قرضه",
  gold: "فلز توکنیزه",
};

/** Section order on «نمای بازار» and in every picker's tabs. */
export const MARKET_KIND_ORDER = [
  "crypto",
  "stablecoin",
  "tokenized_stock",
  "index",
  "commodity",
  "bond",
  "gold",
] as const;

/**
 * The real-world families listed next to coins. Grouped because the setup
 * wizard offers them together, apart from crypto.
 */
export const WALLEX_RWA_KINDS = ["tokenized_stock", "index", "commodity", "bond"] as const;

export function wallexKindLabel(kind: string): string {
  return WALLEX_KIND_LABELS[kind] ?? "رمزارز";
}

/**
 * رمزارزهایی که در بازار نمایش داده می‌شوند — a CURATED list, not everything a
 * feed lists. The feed carried 149 coins and 26 meme coins on 2026-09-13; most
 * were recent, thinly traded or promotional. The product keeps four groups:
 *
 *   major    — the large, long-lived networks and their assets
 *   defi     — established DeFi protocols
 *   classic  — older projects that are still maintained and widely held
 *   privacy  — privacy coins
 *
 * A coin outside this list is not shown and cannot be newly picked. Nothing
 * already recorded is affected: a registered asset, its account and its
 * history stay exactly as they are.
 */
export const CRYPTO_GROUPS = {
  major: [
    "BTC", "ETH", "BNB", "SOL", "XRP", "ADA", "TRX", "TON", "AVAX", "DOT", "LINK", "LTC", "BCH",
    "XLM", "ATOM", "NEAR", "APT", "SUI", "HBAR", "ICP", "FIL", "ETC", "ALGO", "POL", "ARB",
    "HYPE", "TAO", "KAS", "WBTC", "MNT", "STRK",
  ],
  defi: [
    "UNI", "AAVE", "CRV", "CVX", "SNX", "1INCH", "SUSHI", "BAL", "YFI", "LRC", "DYDX", "CAKE",
    "JUP", "RAY", "ENA", "ETHFI", "MORPHO", "ONDO", "RUNE", "PYTH", "UMA", "ZRX", "BAND", "API3",
    "TRB", "SKY",
  ],
  classic: ["XTZ", "EGLD", "BAT", "FLOW", "QNT"],
  privacy: ["XMR", "ZEC", "DASH", "ZEN"],
} as const;

const CURATED_CRYPTO: ReadonlySet<string> = new Set(Object.values(CRYPTO_GROUPS).flat());

/** True when a coin of kind «crypto» belongs in the market list. */
export function isCuratedCrypto(symbol: string): boolean {
  return CURATED_CRYPTO.has(symbol.trim().toUpperCase());
}

/**
 * Meme coins — never shown, never offered for a new pick. Pinned by symbol,
 * because a meme coin's name rarely says so.
 */
export const MEME_SYMBOLS: ReadonlySet<string> = new Set([
  "DOGE", "SHIB", "PEPE", "FLOKI", "BONK", "WIF", "1BBABYDOGE", "BABYDOGE", "MEME", "ELON",
  "TURBO", "MOG", "NEIRO", "BOME", "PENGU", "TOSHI", "DOGS", "CAT", "CATS", "CATI", "HMSTR",
  "NOT", "MAJOR", "MEMEFI", "GIGGLE", "PUMP", "TRUMP", "BRETT", "POPCAT", "MEW", "PNUT",
  "GOAT", "SPX", "1000SATS", "PEOPLE", "BABY",
]);

export function isMemeSymbol(symbol: string): boolean {
  return MEME_SYMBOLS.has(symbol.trim().toUpperCase());
}
