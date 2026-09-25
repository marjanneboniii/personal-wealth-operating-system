/**
 * طلا، سکه، ارز، نقره و نفت — as rows of «نمای بازار».
 *
 * WHERE THEIR PRICES COME FROM
 * `REFERENCE_QUOTE_REFS` below names, per row, the exact source instrument
 * that prices it — by the source's own id, never by matching a name. A row
 * with no entry, or whose source has nothing stored yet, shows no price:
 *   • MESGHAL is priced from «طلای آب‌شده نقدی» only when that response's own
 *     ratio to the 18K gram proves it is one مثقال at ۷۰۵ (providers/brsapi).
 *   • SILVER999 — no verified source for the domestic gram of silver. The
 *     world ounce (XAG) is NOT converted into it: that would be an estimate of
 *     the metal, not the price a gram trades at here.
 *   • HKD, NOK, DKK — not in BrsAPI's free currency list.
 *   • OPEC — the basket is a DAILY figure published by OPEC, whose site
 *     refuses automated requests; there is no permitted feed.
 *   • The design-specific نیم/ربع rows — the source quotes ONE general
 *     نیم‌سکه and ربع‌سکه rate, which is shown on its own «نرخ عمومی» row
 *     rather than attributed to either design.
 * Prices are read in referenceQuotes.ts from what was stored; this module
 * stays pure data.
 *
 * MARKET VIEW ONLY. Not persisted in the market catalogue, so no transaction
 * picker offers them.
 */
import type { MarketRow } from "./marketSearch";
import { WALLEX_KIND_LABELS } from "./wallexKinds";

type Ref = readonly [symbol: string, displayName: string, latinName: string, mark: string];

/** طلای فیزیکی — by the units the domestic market quotes. */
const GOLD: readonly Ref[] = [
  ["GOLD18", "طلای ۱۸ عیار (گرم)", "Gold 18K per gram", "gold"],
  ["GOLD24", "طلای ۲۴ عیار (گرم)", "Gold 24K per gram", "gold"],
  ["MESGHAL", "مثقال طلا", "Gold mesghal", "gold"],
  ["XAU", "اونس طلا", "Gold troy ounce", "gold"],
];

/**
 * سکه — named by design, not «طرح جدید / قدیم»: طرح جدید IS امامی and طرح
 * قدیم IS بهار آزادی, and the design name is what a user finds on the coin.
 */
const COINS: readonly Ref[] = [
  ["EMAMI", "سکه امامی", "Emami gold coin (new design)", "coin"],
  ["BAHAR", "سکه بهار آزادی", "Bahar Azadi gold coin (old design)", "coin"],
  ["NIM-EMAMI", "نیم‌سکه امامی", "Half Emami coin (new design)", "coin-half"],
  ["NIM-BAHAR", "نیم‌سکه بهار آزادی", "Half Bahar Azadi coin (old design)", "coin-half"],
  ["ROB-EMAMI", "ربع‌سکه امامی", "Quarter Emami coin (new design)", "coin-quarter"],
  ["ROB-BAHAR", "ربع‌سکه بهار آزادی", "Quarter Bahar Azadi coin (old design)", "coin-quarter"],
  // The market's single quoted rate for each fraction, design unstated.
  ["NIM", "نیم‌سکه (نرخ عمومی)", "Half coin (general market rate)", "coin-half"],
  ["ROB", "ربع‌سکه (نرخ عمومی)", "Quarter coin (general market rate)", "coin-quarter"],
  ["GERAMI", "سکه گرمی", "One-gram gold coin", "coin-gram"],
];

const SILVER: readonly Ref[] = [
  ["SILVER999", "نقره ۹۹۹ (گرم)", "Silver 999 per gram", "silver"],
  ["XAG", "اونس نقره", "Silver troy ounce", "silver"],
];

/** ارز — most-held first; the list is shown in this order until a search. */
const FIAT: readonly Ref[] = [
  ["USD", "دلار آمریکا", "US Dollar", "fiat-USD"],
  ["EUR", "یورو", "Euro", "fiat-EUR"],
  ["AED", "درهم امارات", "UAE Dirham", "fiat-AED"],
  ["GBP", "پوند انگلیس", "British Pound", "fiat-GBP"],
  ["TRY", "لیر ترکیه", "Turkish Lira", "fiat-TRY"],
  ["CNY", "یوان چین", "Chinese Yuan", "fiat-CNY"],
  ["CAD", "دلار کانادا", "Canadian Dollar", "fiat-CAD"],
  ["AUD", "دلار استرالیا", "Australian Dollar", "fiat-AUD"],
  ["CHF", "فرانک سوئیس", "Swiss Franc", "fiat-CHF"],
  ["JPY", "ین ژاپن", "Japanese Yen", "fiat-JPY"],
  ["IQD", "دینار عراق", "Iraqi Dinar", "fiat-IQD"],
  ["OMR", "ریال عمان", "Omani Rial", "fiat-OMR"],
  ["KWD", "دینار کویت", "Kuwaiti Dinar", "fiat-KWD"],
  ["SAR", "ریال عربستان", "Saudi Riyal", "fiat-SAR"],
  ["RUB", "روبل روسیه", "Russian Ruble", "fiat-RUB"],
  ["INR", "روپیه هند", "Indian Rupee", "fiat-INR"],
  ["AZN", "منات آذربایجان", "Azerbaijani Manat", "fiat-AZN"],
  ["AMD", "درام ارمنستان", "Armenian Dram", "fiat-AMD"],
  ["AFN", "افغانی افغانستان", "Afghan Afghani", "fiat-AFN"],
  ["THB", "بات تایلند", "Thai Baht", "fiat-THB"],
  ["MYR", "رینگیت مالزی", "Malaysian Ringgit", "fiat-MYR"],
  ["HKD", "دلار هنگ‌کنگ", "Hong Kong Dollar", "fiat-HKD"],
  ["SEK", "کرون سوئد", "Swedish Krona", "fiat-SEK"],
  ["NOK", "کرون نروژ", "Norwegian Krone", "fiat-NOK"],
  ["DKK", "کرون دانمارک", "Danish Krone", "fiat-DKK"],
];

/** انرژی — the benchmarks every oil headline quotes. */
const ENERGY: readonly Ref[] = [
  ["BRENT", "نفت برنت", "Brent crude oil", "oil"],
  ["WTI", "نفت وست تگزاس (WTI)", "WTI crude oil", "oil"],
  ["OPEC", "سبد نفتی اوپک", "OPEC reference basket", "oil"],
];

export const REFERENCE_GROUPS = {
  gold_bullion: GOLD,
  gold_coin: COINS,
  silver_bullion: SILVER,
  fiat: FIAT,
  energy: ENERGY,
} as const;

export function referenceMarketRows(): MarketRow[] {
  return Object.entries(REFERENCE_GROUPS).flatMap(([kind, refs]) =>
    refs.map(([symbol, displayName, latinName, mark]) => ({
      symbol,
      displayName,
      latinName,
      kind,
      kindLabel: WALLEX_KIND_LABELS[kind],
      logoUrl: `mark:${mark}`,
      priceTmn: null,
      priceUsdt: null,
    })),
  );
}

/** A stored reference price: `source` is the provider id, `ref` its instrument ref. */
export type QuoteRef = { source: "gold-api" | "brsapi"; ref: string };

const brs = (ref: string): QuoteRef => ({ source: "brsapi", ref });

/**
 * Row symbol → the source instruments that price it, most preferred first.
 * Only a later entry fills in when an earlier one has nothing stored.
 */
export const REFERENCE_QUOTE_REFS: Readonly<Record<string, readonly QuoteRef[]>> = {
  GOLD18: [brs("gold_currency:IR_GOLD_18K")],
  GOLD24: [brs("gold_currency:IR_GOLD_24K")],
  MESGHAL: [brs("gold_currency:IR_GOLD_MELTED")],
  XAU: [{ source: "gold-api", ref: "XAU" }, brs("commodity:XAUUSD")],
  XAG: [{ source: "gold-api", ref: "XAG" }, brs("commodity:XAGUSD")],
  EMAMI: [brs("gold_currency:IR_COIN_EMAMI")],
  BAHAR: [brs("gold_currency:IR_COIN_BAHAR")],
  GERAMI: [brs("gold_currency:IR_COIN_1G")],
  NIM: [brs("gold_currency:IR_COIN_HALF")],
  ROB: [brs("gold_currency:IR_COIN_QUARTER")],
  BRENT: [brs("commodity:BRENT")],
  WTI: [brs("commodity:WTI")],
  ...Object.fromEntries(
    ["USD", "EUR", "AED", "GBP", "TRY", "CNY", "CAD", "AUD", "CHF", "JPY", "IQD", "OMR", "KWD", "SAR", "RUB", "INR", "AZN", "AMD", "AFN", "THB", "MYR", "SEK"].map(
      (code) => [code, [brs(`gold_currency:${code}`)]],
    ),
  ),
};
