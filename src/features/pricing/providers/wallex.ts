/**
 * والکس — live Toman quotes and a Persian-named catalogue.
 *
 * VERIFIED against the real endpoint, not against documentation:
 *   GET https://api.wallex.ir/v1/markets  →  HTTP 200, ~440 KB,
 *   `result.symbols` = 385 markets, 193 of them quoted in TMN.
 *
 * Why this is the first provider wired up, ahead of the others in the plan:
 *
 *   • It publishes `faName` / `faBaseAsset`, so «بیت‌کوین» and «تترگلد» come
 *     from the source itself. Every other crypto catalogue in this codebase
 *     needs a hand-maintained Persian name; this one does not.
 *   • It quotes directly in TOMAN. No USD→IRT conversion step, so no second
 *     rounding and no dependency on the FX rate being fresh.
 *   • Its icons are served from api.wallex.ir — an Iranian host. The existing
 *     CoinGecko artwork sits on an external CDN that is slow or unreachable
 *     from Iran, which is exactly the audience this app has.
 *   • It covers tokenised metals (XAUT «تترگلد», PAXG «پکس گلد») in the same
 *     feed, which the product wants searchable alongside coins.
 *
 * One endpoint answers both quotes and catalogue, so a catalogue refresh costs
 * nothing extra beyond the same cached call.
 *
 * No database, ledger or valuation imports — this is pure I/O plus parsing.
 */
import { isCuratedCrypto, isMemeSymbol } from "../wallexKinds";
import type {
  PriceFailureCode,
  PriceProvider,
  PriceQuote,
  ProviderCatalogEntry,
  ProviderResult,
  QuoteKind,
} from "./types";

const DEFAULT_BASE_URL = "https://api.wallex.ir/v1";
const DEFAULT_TIMEOUT_MS = 8_000;

/** Coins that are a claim on a fiat unit. Kept in step with setup/service.ts. */
import { withIssuerTag } from "@/features/pricing/wallexKinds";

const STABLECOIN_SYMBOLS = new Set(["USDT", "USDC", "USDS", "USDE", "USDG", "PYUSD", "DAI", "FDUSD"]);
/** Tokenised metal, surfaced as gold rather than as a generic coin. */
const METAL_SYMBOLS = new Set(["XAUT", "PAXG"]);

/*
 * Real-world assets Wallex lists alongside coins. VERIFIED against the live
 * feed on 2026-09-13: seven US stocks («اپل استاک» AAPLX … «تسلا استاک»
 * TSLAX) and five Ondo-tokenised commodity funds («گواهی نفت دیجیتال» USOON,
 * «گواهی نقره دیجیتال» SLVON, …). No index token was listed on that date.
 *
 * The explicit sets pin what was seen; the name patterns below catch the
 * next listing of the same family without a code change. Both read the
 * source's own Latin name, never a guess about the ticker's shape.
 */
const COMMODITY_SYMBOLS = new Set(["USOON", "UNGON", "SLVON", "PPLTON", "COPXON"]);
const TOKENIZED_STOCK_SYMBOLS = new Set(["AAPLX", "AMZNX", "COINX", "HOODX", "METAX", "NVDAX", "TSLAX"]);
// Name patterns cover the three tokenisation families seen on آبان‌تتر too:
// «SP500 tokenized ETF (xStock)», «Invesco QQQ Tokenized ETF (Ondo)»,
// «iShares MSCI South Korea ETF Tokenized bStocks», «Netflix stock price».
const INDEX_NAME_RE = /S&P\s*500|\bSP\s?500\b|Nasdaq|\bQQQ\b|\bMSCI\b|Dow Jones|Russell\s*2000|\bindex\b/i;
const BOND_NAME_RE = /\b(treasury|bond)\b/i;
const COMMODITY_NAME_RE = /\b(oil|natural gas|silver|copper|platinum|palladium|gold|commodit\w*)\b/i;
const TOKENIZED_STOCK_NAME_RE = /tokeni[sz]ed|\(ondo\b|\bxstock\b|\bbstocks\b|\bstock price\b/i;


/**
 * What reaches the market list: never a meme coin, and a plain «crypto» coin
 * only when it is on the curated list. Stablecoins, tokenised gold, stocks,
 * indices, bonds and commodities are not affected by the curation.
 */
export function isListed(symbol: string, kind: QuoteKind): boolean {
  if (kind === "meme") return false;
  if (kind === "crypto") return isCuratedCrypto(symbol);
  return true;
}

/** Exported for tests: classification is the whole contract of this step. */
export function kindOf(symbol: string, latinName = ""): QuoteKind {
  if (METAL_SYMBOLS.has(symbol)) return "gold";
  if (STABLECOIN_SYMBOLS.has(symbol)) return "stablecoin";
  if (isMemeSymbol(symbol)) return "meme";
  if (COMMODITY_SYMBOLS.has(symbol)) return "commodity";
  if (TOKENIZED_STOCK_SYMBOLS.has(symbol)) return "tokenized_stock";
  // Only a name that says it is TOKENISED enters this branch, so a coin that
  // merely calls itself «Silver» can never be mistaken for the metal. Inside,
  // order matters: a gas fund's Latin name literally says «Tokenized Stock»,
  // so the narrower family wins.
  if (TOKENIZED_STOCK_NAME_RE.test(latinName)) {
    // A leveraged or single-stock ETF («Semicon Bull 3X», «2X Long INTC») is
    // a trade on shares, not the index — only a plain index fund is «شاخص».
    // «ProShares UltraPro QQQ» (TQQQ) states no multiple, so the fund-family
    // words count as leverage too.
    const leveraged = /\b\d+X\b|\bUltra(Pro)?\b|\bBull\b|\bBear\b|\bInverse\b/i.test(latinName);
    if (BOND_NAME_RE.test(latinName)) return "bond";
    if (COMMODITY_NAME_RE.test(latinName)) return "commodity";
    if (INDEX_NAME_RE.test(latinName) && !leveraged) return "index";
    return "tokenized_stock";
  }
  return "crypto";
}

type WallexSymbol = {
  symbol?: unknown;
  baseAsset?: unknown;
  quoteAsset?: unknown;
  faName?: unknown;
  enName?: unknown;
  faBaseAsset?: unknown;
  enBaseAsset?: unknown;
  stats?: { lastPrice?: unknown } | null;
  baseAsset_svg_icon?: unknown;
  baseAsset_png_icon?: unknown;
};

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Wallex sends prices as «235997.0000000000000000». Trailing zeros are dropped
 * so the stored string is the shortest EXACT representation — the value is
 * never parsed through a float, because a Toman price of تترگلد is already
 * 1,020,804,123 and the fractional part would not survive.
 */
function normalisePrice(raw: unknown): string | null {
  const text = str(raw);
  if (text === null) return null;
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const trimmed = text.includes(".")
    ? text.replace(/0+$/, "").replace(/\.$/, "")
    : text;
  if (trimmed === "" || /^0+$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * One tradable asset on Wallex, with both of its quotes.
 *
 * `priceTmn` is Toman per unit and `priceUsdt` is Tether per unit, each read
 * from the market that quotes it. Either may be null — a thin asset can trade
 * in only one of the two — and neither is ever derived from the other.
 */
export type WallexMarketEntry = {
  /** Stable instrument symbol, e.g. "BTC". */
  symbol: string;
  /** Persian display name from the source itself, e.g. «بیت‌کوین». */
  displayName: string;
  latinName: string;
  kind: QuoteKind;
  logoUrl: string | null;
  priceTmn: string | null;
  priceUsdt: string | null;
  fetchedAt: string;
};

export type WallexProviderOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
};

export class WallexProvider implements PriceProvider {
  readonly id = "wallex";
  readonly displayName = "والکس";
  readonly kinds: readonly QuoteKind[] = [
    "crypto",
    "meme",
    "stablecoin",
    "gold",
    "tokenized_stock",
    "commodity",
    "index",
  ];
  readonly quoteCurrency = "IRT";

  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly now: () => Date;

  constructor(options: WallexProviderOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.now = options.now ?? (() => new Date());
  }

  /**
   * A reference is the Wallex market symbol, e.g. «BTCTMN». A bare asset
   * symbol («BTC») is accepted too and read as its Toman market, because that
   * is the only market this app values against.
   */
  private static marketOf(ref: string): string {
    const upper = ref.trim().toUpperCase();
    return upper.endsWith("TMN") ? upper : `${upper}TMN`;
  }

  async fetchQuotes(refs: readonly string[]): Promise<ProviderResult> {
    const quotes = new Map<string, PriceQuote>();
    const failures = new Map<string, PriceFailureCode>();
    if (refs.length === 0) return { quotes, failures };

    let symbols: Record<string, WallexSymbol>;
    try {
      symbols = await this.loadSymbols();
    } catch (error) {
      const code: PriceFailureCode =
        error instanceof Error && error.name === "AbortError" ? "timeout" : "network_failure";
      for (const ref of refs) failures.set(ref, code);
      return { quotes, failures };
    }

    const fetchedAt = this.now().toISOString();
    for (const ref of refs) {
      const row = symbols[WallexProvider.marketOf(ref)];
      if (!row) {
        failures.set(ref, "asset_not_found");
        continue;
      }
      const price = normalisePrice(row.stats?.lastPrice);
      if (price === null) {
        // The market exists but has no usable last trade — a real state for a
        // thin market, and not the same thing as an unknown symbol.
        failures.set(ref, "invalid_response");
        continue;
      }
      quotes.set(ref, {
        price,
        currency: this.quoteCurrency,
        // Wallex publishes no per-symbol observation time on this endpoint, so
        // the fetch time is the honest upper bound for both.
        observedAt: fetchedAt,
        fetchedAt,
        source: this.id,
      });
    }
    return { quotes, failures };
  }

  /** Every Toman market, Persian-named, for the search box. */
  async fetchCatalog(): Promise<ProviderCatalogEntry[]> {
    const symbols = await this.loadSymbols();
    const out: ProviderCatalogEntry[] = [];
    for (const [market, row] of Object.entries(symbols)) {
      if (str(row.quoteAsset)?.toUpperCase() !== "TMN") continue;
      const symbol = str(row.baseAsset)?.toUpperCase();
      const persianName = str(row.faBaseAsset);
      if (!symbol || !persianName) continue;
      const latinName = str(row.enBaseAsset) ?? "";
      const kind = kindOf(symbol, latinName);
      if (!isListed(symbol, kind)) continue;
      out.push({
        ref: market,
        symbol,
        displayName: withIssuerTag(persianName, symbol, kind, latinName),
        latinName: latinName || symbol,
        kind,
        logoUrl: str(row.baseAsset_svg_icon) ?? str(row.baseAsset_png_icon),
      });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "fa"));
  }

  /**
   * The catalogue with BOTH quotes an Iranian user actually reads.
   *
   * WHY TWO PRICES AND NOT ONE
   * «قیمت تومانی» is what the money is spent in, and «قیمت تتری» is how this
   * market talks about value — a user checks the Toman price to know what a
   * purchase costs and the Tether price to compare against the global market
   * without doing the FX arithmetic in their head. Reducing that to one figure
   * and deriving the other through a USD/IRT rate would produce a third number
   * that matches neither screen the user is comparing against, because a
   * Toman market carries its own premium.
   *
   * So both are read from the SAME `/markets` payload, each from the market
   * that actually quotes it, and neither is ever computed from the other.
   *
   * One upstream call answers both, plus the whole catalogue — the endpoint
   * returns every market with its `stats.lastPrice` already attached.
   */
  async fetchMarketCatalog(): Promise<WallexMarketEntry[]> {
    const symbols = await this.loadSymbols();
    const fetchedAt = this.now().toISOString();

    /** symbol → the row of each quote market it trades in. */
    const byAsset = new Map<string, { tmn?: WallexSymbol; usdt?: WallexSymbol }>();
    for (const row of Object.values(symbols)) {
      const base = str(row.baseAsset)?.toUpperCase();
      const quote = str(row.quoteAsset)?.toUpperCase();
      if (!base || !quote) continue;
      if (quote !== "TMN" && quote !== "USDT") continue;
      const slot = byAsset.get(base) ?? {};
      if (quote === "TMN") slot.tmn = row;
      else slot.usdt = row;
      byAsset.set(base, slot);
    }

    const out: WallexMarketEntry[] = [];
    for (const [symbol, markets] of byAsset) {
      const named = markets.tmn ?? markets.usdt;
      // The Persian name is the whole point of preferring this source, so a row
      // that has no `faBaseAsset` is skipped rather than shown in Latin.
      const displayName = str(named?.faBaseAsset);
      if (!displayName) continue;

      // Meme coins and coins outside the curated list are not market rows.
      const kind = kindOf(symbol, str(named?.enBaseAsset) ?? "");
      if (!isListed(symbol, kind)) continue;

      const priceTmn = normalisePrice(markets.tmn?.stats?.lastPrice);
      const priceUsdt = normalisePrice(markets.usdt?.stats?.lastPrice);
      // A row quoted in neither market has nothing to show and nothing to
      // value against.
      if (priceTmn === null && priceUsdt === null) continue;

      out.push({
        symbol,
        // A tokenised asset carries its issuer: «انویدیا استاک ایکس».
        displayName: withIssuerTag(displayName, symbol, kind, str(named?.enBaseAsset) ?? ""),
        latinName: str(named?.enBaseAsset) ?? symbol,
        kind,
        logoUrl: str(named?.baseAsset_svg_icon) ?? str(named?.baseAsset_png_icon),
        priceTmn,
        priceUsdt,
        fetchedAt,
      });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName, "fa"));
  }

  private async loadSymbols(): Promise<Record<string, WallexSymbol>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/markets`, {
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        throw new Error(`wallex markets responded ${response.status}`);
      }
      const body = (await response.json()) as { result?: { symbols?: unknown } };
      const symbols = body?.result?.symbols;
      if (!symbols || typeof symbols !== "object") {
        throw new Error("wallex markets payload has no result.symbols");
      }
      return symbols as Record<string, WallexSymbol>;
    } finally {
      clearTimeout(timer);
    }
  }
}
