/**
 * آبان‌تتر — the widest public catalogue of tokenised US stocks, index / bond /
 * gold ETFs and commodity funds reachable from here.
 *
 * WHY THIS SOURCE, VERIFIED RATHER THAN ASSUMED
 * Compared live on 2026-09-13, counting tokenised real-world assets only:
 *   • آبان‌تتر  GET https://api.abantether.com/manager/coins/data → 87
 *     (xStock, Ondo and bStocks families; SPY, QQQ, MSCI, Treasury bonds, gold)
 *   • تبدیل    GET https://api1.tabdeal.org/r/api/v1/exchangeInfo → 17
 *   • والکس    GET https://api.wallex.ir/v1/markets → 12
 *   • رمزینکس  GET https://publicapi.ramzinex.com/…/exchange/pairs → 5
 *   • صراف     GET https://api.saraf.app/v3/prices/crypto → 4 (commodities)
 * Aban's list contains essentially every symbol the other four carry. It is
 * public, needs no key, and answered a plain Node `fetch` (HTTP 200, ~1 MB).
 *
 * PRICES, AND WHAT THEY ARE
 * Each coin carries `tether_price` and a Toman `price_buy` / `price_sell`
 * quote. There is no last-trade field, so the Toman figure stored is the
 * MIDPOINT of the two sides — computed in exact decimal, never through a
 * float — and the Tether price is taken as published. Neither is derived from
 * the other through an FX rate. `is_buy_active: false` is common (the desk
 * pauses buying) but the quotes stay live, and valuing a holding is a
 * different question from whether Aban will sell more of it today.
 *
 * WHAT IS NOT TAKEN
 * Only tokenised real-world assets are read. Aban's ~900 coins overlap the
 * Wallex crypto catalogue, and a second copy of BTC under a different price
 * would give one symbol two meanings in the same search box.
 *
 * LOGOS
 * Aban publishes only an opaque icon id with no reachable image host, and the
 * tokenised-stock artwork on other hosts is a hatched placeholder rather than
 * the brand. So rows carry a `mark:` reference and render the app's own drawn
 * mark on the white plate — see AssetLogo.
 *
 * Pure I/O plus parsing: no database, ledger or valuation imports.
 */
import { D } from "@/domain/decimal";
import { kindOf, type WallexMarketEntry } from "./wallex";
import type { PriceFailureCode, PriceProvider, PriceQuote, ProviderResult, QuoteKind } from "./types";

const DEFAULT_URL = "https://api.abantether.com/manager/coins/data";
/** The payload is ~1 MB and was seen taking 15 s from a slow route. */
const DEFAULT_TIMEOUT_MS = 25_000;

/** A tokenised real-world asset, by the source's own Latin name. */
const RWA_NAME_RE = /tokeni[sz]ed|\(xstock\)|bstocks|\(ondo\)|\bstock price\b/i;

/**
 * Stablecoins taken from this feed because والکس does not list them (verified
 * 2026-09-13), each with the Persian name the rest of the app uses. Anything
 * else coin-shaped stays out: a second copy of a coin Wallex already quotes
 * would give one symbol two prices.
 */
const STABLECOIN_PICKS: Readonly<Record<string, string>> = {
  USDE: "اتنا یو‌اس‌دی‌ای",
  PYUSD: "پی‌پل یو‌اس‌دی",
};

type AbanCoin = {
  symbol?: unknown;
  name?: unknown;
  persian_name?: unknown;
  is_active?: unknown;
  tether_price?: unknown;
  price_buy?: unknown;
  price_sell?: unknown;
};

export type AbanMarketEntry = WallexMarketEntry & { source: "abantether" };

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function positive(raw: unknown): string | null {
  const text = str(raw);
  if (!text || !/^\d+(\.\d+)?$/.test(text)) return null;
  const value = D(text);
  return value.gt(0) ? value.toString() : null;
}

/**
 * Drawn mark per kind. Commodities with a dedicated symbol mark (oil, gas,
 * silver…) get it from AssetLogo's symbol table, which is checked first.
 */
function markFor(kind: QuoteKind, latinName: string): string {
  if (kind === "commodity" && /gold/i.test(latinName)) return "mark:gold";
  if (kind === "commodity") return "mark:commodity";
  if (kind === "index") return "mark:index";
  if (kind === "bond") return "mark:bond";
  return "mark:stock";
}

export class AbanTetherProvider implements PriceProvider {
  readonly id = "abantether";
  readonly displayName = "آبان‌تتر";
  readonly kinds: readonly QuoteKind[] = ["tokenized_stock", "commodity", "index", "bond", "stablecoin"];
  readonly quoteCurrency = "IRT";

  private readonly fetchImpl: typeof fetch;
  private readonly url: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(
    options: { fetchImpl?: typeof fetch; url?: string; timeoutMs?: number; now?: () => Date } = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.url = options.url ?? DEFAULT_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /** Every tokenised real-world asset with a usable price. */
  async fetchMarketCatalog(): Promise<AbanMarketEntry[]> {
    const coins = await this.loadCoins();
    const fetchedAt = this.now().toISOString();
    const out: AbanMarketEntry[] = [];

    for (const coin of coins) {
      const symbol = str(coin.symbol)?.toUpperCase();
      const latinName = str(coin.name) ?? "";
      const stablecoinName = symbol ? STABLECOIN_PICKS[symbol] : undefined;
      if (!symbol || (!stablecoinName && !RWA_NAME_RE.test(latinName))) continue;
      if (coin.is_active === false) continue;
      const persian = str(coin.persian_name);
      if (!persian) continue;

      const buy = positive(coin.price_buy);
      const sell = positive(coin.price_sell);
      const priceTmn = buy && sell ? D(buy).add(sell).div(2).toString() : buy ?? sell;
      const priceUsdt = positive(coin.tether_price);
      if (priceTmn === null && priceUsdt === null) continue;

      const kind = stablecoinName ? "stablecoin" : kindOf(symbol, latinName);

      out.push({
        symbol,
        // The asset's own Persian name, never tagged with an issuer or
        // tokenisation family: the symbol shown beside it (TSLAX vs TSLAON)
        // is what tells two tokens of one company apart.
        displayName: stablecoinName ?? persian,
        latinName,
        kind: kind === "crypto" ? "tokenized_stock" : kind,
        logoUrl: stablecoinName ? null : markFor(kind, latinName),
        priceTmn,
        priceUsdt,
        fetchedAt,
        source: "abantether",
      });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "fa"));
  }

  async fetchQuotes(refs: readonly string[]): Promise<ProviderResult> {
    const quotes = new Map<string, PriceQuote>();
    const failures = new Map<string, PriceFailureCode>();
    if (refs.length === 0) return { quotes, failures };

    let entries: AbanMarketEntry[];
    try {
      entries = await this.fetchMarketCatalog();
    } catch (error) {
      const code: PriceFailureCode =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network_failure";
      for (const ref of refs) failures.set(ref, code);
      return { quotes, failures };
    }
    const bySymbol = new Map(entries.map((e) => [e.symbol, e]));
    for (const ref of refs) {
      const entry = bySymbol.get(ref.trim().toUpperCase());
      if (!entry?.priceTmn) {
        failures.set(ref, entry ? "invalid_response" : "asset_not_found");
        continue;
      }
      quotes.set(ref, {
        price: entry.priceTmn,
        currency: this.quoteCurrency,
        observedAt: entry.fetchedAt,
        fetchedAt: entry.fetchedAt,
        source: this.id,
      });
    }
    return { quotes, failures };
  }

  private async loadCoins(): Promise<AbanCoin[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.url, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(`abantether coins responded ${response.status}`);
      const body = (await response.json()) as { data?: unknown };
      if (!Array.isArray(body?.data)) throw new Error("abantether payload has no data[]");
      return body.data as AbanCoin[];
    } finally {
      clearTimeout(timer);
    }
  }
}
