/**
 * قیمت گرم طلای ۱۸ عیار — derived, and labelled as derived.
 *
 * THE PROBLEM
 * طلای آب‌شده is bought from closed commercial apps (ملی‌گلد، میلی، طلاسی،
 * تکنوگلد، دیجی‌کالا گلد، طلاین). None publishes a documented public API, and
 * the general Iranian price feeds (tgju, brsapi, alanchand, milli) either do
 * not resolve from outside Iran or redirect in a loop — every one was probed.
 *
 * THE SOLUTION THE BRIEF ITSELF SANCTIONS (بخش ۳)
 * Show an ESTIMATE from a verified public gold source, tell the user it is an
 * estimate, and let them override it with the price their own platform quotes.
 *
 * تترگلد (XAUT) is exactly that source, and it is already reachable: Wallex
 * quotes it in Toman, and one XAUT token is one troy ounce of gold. So
 *
 *     گرم ۲۴ عیار = XAUT_TMN ÷ 31.1034768
 *     گرم ۱۸ عیار = گرم ۲۴ عیار × 0.750
 *
 * WHY THIS IS AN ESTIMATE AND NOT A PRICE
 * It is the *parity* value of the metal — what the gold in a gram is worth at
 * the global price and the market's own dollar rate. The domestic آب‌شده
 * market trades at a premium or discount to that (حباب), and each platform
 * adds its own spread and fee on top. The number is therefore right to anchor
 * on and wrong to trust to the Rial, which is why every consumer of it is
 * handed `isEstimate: true` and the timestamp it came from.
 *
 * No ledger, holdings or accounting imports.
 */
import { D } from "@/domain/decimal";
import { WallexProvider } from "./providers/wallex";

/** Grams in a troy ounce — the unit XAUT is denominated in. */
export const GRAMS_PER_TROY_OUNCE = "31.1034768";

/** 18 carat is 18 parts gold in 24 — 750 per mille, the Iranian ۷۵۰ stamp. */
export const CARAT_18_PURITY = "0.750";

/** Wallex market that quotes one troy ounce of gold in Toman. */
const GOLD_OUNCE_MARKET = "XAUTTMN";
/** Fallback: پکس گلد is the same instrument from a different issuer. */
const GOLD_OUNCE_FALLBACK = "PAXGTMN";

export type GoldGramEstimate = {
  /** Toman per gram, 18 carat. Exact decimal string, rounded to whole Toman. */
  tomanPerGram18: string;
  /** Toman per gram, 24 carat — the intermediate, kept for transparency. */
  tomanPerGram24: string;
  /** Toman per troy ounce, as quoted by the source. */
  tomanPerOunce: string;
  /** Which market it came from, for «بر اساس …». */
  source: string;
  observedAt: string;
  /**
   * ALWAYS true. The domestic آب‌شده market carries a حباب and each platform
   * its own spread, so this is a parity anchor, never a dealt price.
   */
  isEstimate: true;
};

export type GoldGramOptions = { provider?: WallexProvider; now?: () => Date };

/**
 * Best-effort estimate. Returns null rather than a guess when no gold market
 * answers — the caller then shows the user's own last manual price, or asks
 * for one.
 */
export async function estimateGoldGramToman(
  options: GoldGramOptions = {},
): Promise<GoldGramEstimate | null> {
  const provider = options.provider ?? new WallexProvider();
  const now = options.now ?? (() => new Date());

  const { quotes } = await provider.fetchQuotes([GOLD_OUNCE_MARKET, GOLD_OUNCE_FALLBACK]);
  const ounce =
    quotes.get(GOLD_OUNCE_MARKET) ?? quotes.get(GOLD_OUNCE_FALLBACK) ?? null;
  if (!ounce) return null;

  const perOunce = D(ounce.price);
  if (!perOunce.gt(0)) return null;

  // Exact decimal throughout: an ounce of gold is over a billion Toman, and a
  // gram is tens of millions. Neither belongs anywhere near a float.
  const gram24 = perOunce.div(D(GRAMS_PER_TROY_OUNCE));
  const gram18 = gram24.mul(D(CARAT_18_PURITY));

  return {
    tomanPerGram18: gram18.toFixed(0),
    tomanPerGram24: gram24.toFixed(0),
    tomanPerOunce: perOunce.toFixed(0),
    source: quotes.has(GOLD_OUNCE_MARKET) ? "تترگلد (والکس)" : "پکس گلد (والکس)",
    observedAt: ounce.observedAt || now().toISOString(),
    isEstimate: true,
  };
}

/**
 * Value a holding of melted gold at the estimate. Quantity is in GRAMS, which
 * is how every Iranian platform sells it (سوت = milligram, so 1000 سوت = 1g;
 * convert before calling).
 */
export function valueGoldGrams(grams: string | number, estimate: GoldGramEstimate): string {
  return D(grams).mul(D(estimate.tomanPerGram18)).toFixed(0);
}
