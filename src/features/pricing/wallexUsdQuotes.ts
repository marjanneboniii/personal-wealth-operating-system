/**
 * والکس as a USD quote source for valuation.
 *
 * WHY A TOMAN EXCHANGE CAN PRICE IN DOLLARS
 * Wallex quotes everything against TMN, but the valuation path wants USD. The
 * conversion does NOT reach for an external FX rate — it uses Wallex's own
 * USDT/TMN market from the SAME response:
 *
 *     priceUsd(BTC) = lastPrice(BTCTMN) ÷ lastPrice(USDTTMN)
 *
 * Both legs come out of one snapshot, so the result is internally consistent
 * by construction: it cannot drift because an FX rate was fetched a minute
 * apart from the coin price, and it needs no rate to be configured at all.
 * USDT is the de-facto dollar unit of this market, which is the right
 * denominator for these users rather than an interbank rate they never trade at.
 *
 * WHY THIS SOURCE AT ALL
 * CoinGecko and the Binance spot fallback are both foreign hosts that are
 * routinely slow or unreachable from Iran — the audience this app has. Wallex
 * is reachable, and when the two foreign sources fail this is what stands
 * between a portfolio and a page of «قیمت نامشخص».
 *
 * It implements the existing `LiveQuoteClient` seam, so it slots into the
 * refresh chain without valuation code changing at all.
 *
 * Read-only market data. No ledger, holdings, quantities or accounting.
 */
import { D } from "@/domain/decimal";
import { SUPPORTED_CRYPTO_ASSETS } from "./supportedAssets";
import { WallexProvider } from "./providers/wallex";
import type { LiveQuoteClient } from "./service";

/** CoinGecko id → Wallex base symbol, derived from the one supported registry. */
const WALLEX_SYMBOL_BY_COINGECKO_ID: Record<string, string> = Object.fromEntries(
  SUPPORTED_CRYPTO_ASSETS.map((asset) => [asset.coingeckoId, asset.symbol]),
);

/** The market that defines the dollar for this source. */
const USD_REF_MARKET = "USDTTMN";

/**
 * USD decimals. Eight is enough for a sub-cent altcoin and far more than the
 * two the book ever displays; the division is exact decimal arithmetic, never
 * a float, because a Toman numerator is routinely 10-11 digits.
 */
const USD_SCALE = 8;

export type WallexUsdQuoteClientOptions = {
  provider?: WallexProvider;
  now?: () => Date;
};

export class WallexUsdQuoteClient implements LiveQuoteClient {
  private readonly provider: WallexProvider;
  private readonly now: () => Date;

  constructor(options: WallexUsdQuoteClientOptions = {}) {
    this.provider = options.provider ?? new WallexProvider();
    this.now = options.now ?? (() => new Date());
  }

  async fetchUsdPrices(
    ids: string[],
  ): Promise<Map<string, { priceUsd: string; observedAt: string }>> {
    const out = new Map<string, { priceUsd: string; observedAt: string }>();

    // Only ids this source can actually price; asking for the rest wastes the
    // call and produces failures the caller has to filter anyway.
    const wanted = ids
      .map((id) => ({ id, symbol: WALLEX_SYMBOL_BY_COINGECKO_ID[id] }))
      .filter((entry): entry is { id: string; symbol: string } => Boolean(entry.symbol));
    if (wanted.length === 0) return out;

    const refs = [USD_REF_MARKET, ...wanted.map((w) => `${w.symbol}TMN`)];
    const { quotes } = await this.provider.fetchQuotes(refs);

    const usdtToman = quotes.get(USD_REF_MARKET);
    if (!usdtToman) {
      // Without the dollar leg every conversion would be a guess. Returning
      // nothing lets the chain fall through to last-known, which is honest.
      return out;
    }
    const denominator = D(usdtToman.price);
    if (!denominator.gt(0)) return out;

    const observedAt = this.now().toISOString();
    for (const { id, symbol } of wanted) {
      if (symbol === "USDT") {
        // The reference market priced against itself is exactly 1 by
        // definition; dividing it by itself would just invite rounding noise.
        out.set(id, { priceUsd: "1", observedAt });
        continue;
      }
      const toman = quotes.get(`${symbol}TMN`);
      if (!toman) continue;
      const priceUsd = D(toman.price).div(denominator).toFixed(USD_SCALE);
      if (!D(priceUsd).gt(0)) continue;
      out.set(id, { priceUsd, observedAt });
    }
    return out;
  }
}
