/**
 * Market kind vocabulary — PURE, so client components can import it without
 * pulling the database-backed catalogue module into the browser bundle.
 *
 * PRODUCT RULE: a market row is shown by WHAT IT IS, never by which exchange
 * quoted it. No label, chip, placeholder or message names a source.
 */

export const WALLEX_KIND_LABELS: Record<string, string> = {
  crypto: "رمزارز",
  meme: "میم‌کوین",
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
  "meme",
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
