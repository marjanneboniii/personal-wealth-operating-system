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
const STABLECOIN_SYMBOLS = new Set(["USDT", "USDC", "USDS", "USDE", "USDG", "DAI", "FDUSD"]);
/** Tokenised metal, surfaced as gold rather than as a generic coin. */
const METAL_SYMBOLS = new Set(["XAUT", "PAXG"]);

function kindOf(symbol: string): QuoteKind {
  if (METAL_SYMBOLS.has(symbol)) return "gold";
  if (STABLECOIN_SYMBOLS.has(symbol)) return "stablecoin";
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

export type WallexProviderOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  timeoutMs?: number;
  now?: () => Date;
};

export class WallexProvider implements PriceProvider {
  readonly id = "wallex";
  readonly displayName = "والکس";
  readonly kinds: readonly QuoteKind[] = ["crypto", "stablecoin", "gold"];
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
      const displayName = str(row.faBaseAsset);
      if (!symbol || !displayName) continue;
      out.push({
        ref: market,
        symbol,
        displayName,
        latinName: str(row.enBaseAsset) ?? symbol,
        kind: kindOf(symbol),
        logoUrl: str(row.baseAsset_svg_icon) ?? str(row.baseAsset_png_icon),
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
