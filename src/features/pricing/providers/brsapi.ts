/**
 * BrsAPI — Iranian gold, coin and currency rates, global commodities, and the
 * Tehran exchange (بورس، فرابورس، صندوق‌های قابل معامله، حق‌تقدم).
 *
 * WHAT WAS VERIFIED, AND HOW (2026-09-24)
 *   • api.brsapi.ir resolves and answers: without a key it returns HTTP 400
 *     {"successful":false,"status":"missing_param",…}. No request WITH a key
 *     has been made from this codebase — none exists yet.
 *   • The three response shapes below are the provider's OFFICIAL SAMPLES
 *     (brsapi.ir/Api/Market/Sample/FreeApi_Gold_Currency.json,
 *     …/FreeApi_Commodity.json, brsapi.ir/Api/Tsetmc/Sample/
 *     Api_FreeBourseWebService.json) and its documentation tables. The parser
 *     is tested against those samples. The samples are months old and are
 *     NEVER shown as prices — they live under tests/fixtures only.
 *
 * HOST AND QUOTA — CONFIRMED BY BrsAPI SUPPORT (2026-09-24)
 * The terms forbid the free tier on «Google Sheets, Cloudflare Workers and
 * similar». Asked directly (Telegram/Bale @BrsApi) about this app on Vercel —
 * server-side only, no proxy, ≤ 864 requests a day — support answered that
 * the use is allowed, and that the daily quota is ONE allowance SHARED by all
 * routes. The adapter is therefore on whenever a key is set; the shared quota
 * is enforced across feeds in referenceQuotes.ts. Support was told the app has
 * few users today; if that changes, the allowance should be asked about again.
 *
 * UNITS — READ FROM EVERY ROW, NEVER ASSUMED
 *   • Free gold/currency rows say `unit: "تومان"`; the Pro endpoint says
 *     «ریال» for the same symbols. Each row's own unit decides IRT vs IRR, and
 *     a row with any other unit is rejected.
 *   • «یکصد ین ژاپن»: the JPY rate is for ONE HUNDRED yen. The multiplier is
 *     read from the name and must match the expected table below; if BrsAPI
 *     ever changes JPY to a per-yen rate (or quotes another currency per 100)
 *     without the name agreeing, the row is rejected instead of being off by
 *     a factor of 100.
 *   • USDT_IRT «دلار تتر» is a stablecoin rate, not the US dollar. It is kept
 *     under its own id and never stands in for USD.
 *   • Currency rates are the FREE-MARKET rate — support declined to say, so
 *     it is checked on every response instead: the dollar must sit within 5%
 *     of «دلار تتر» (the official/Nima rates sit tens of percent below the
 *     street). In the official sample they differ by 0.4%. If a response
 *     fails the check, every currency row falls back to "unspecified". Bid
 *     vs ask is not stated anywhere and is not claimed.
 *   • «طلای آب‌شده نقدی» is ONE مثقال (4.6083 g) at عیار ۷۰۵ — the domestic
 *     «آب‌شده» convention. Support declined to confirm, so it is checked on
 *     every response: its price ÷ the 18K gram must be 4.6083 × 705/750 =
 *     4.3318 within 2% (the official sample: −0.14%; an independent market
 *     app's «مثقال طلا» screenshot: −0.30%). Otherwise it is rejected.
 *   • Commodity prices are in dollars. Whether Brent/WTI are spot or a
 *     futures contract is not documented: basis "unspecified".
 *   • TSETMC prices (pl, pc, py) are in RIAL, which is how tsetmc.com itself
 *     publishes them; the sample is consistent (z × pc = mv for every row).
 *
 * TEHRAN EXCHANGE ROWS
 * Identity is the ISIN (stable, published by TSETMC), with the internal
 * instrument id kept as a STRING — it is 17 digits, past what a JS number
 * holds exactly. Classification is by ISIN prefix, never by name:
 *   IRO1 بورس · IRO3 فرابورس · IRO7 بازار پایه · IRO5 سهام (بازار نامشخص)
 *   IRR* حق‌تقدم — never presented as an ordinary share
 *   IRT1 / IRT3 / IRTK صندوق قابل معامله
 * The last trade (pl), the closing price (pc) and yesterday's close (py) are
 * kept as SEPARATE figures. The free feed carries no NAV: a fund's price here
 * is its trading price, never its صدور/ابطال NAV.
 * The feed's `time` is a clock time with no date; the date is inferred (the
 * last Tehran trading day at or before now) and flagged `observedAtInferred`.
 *
 * Pure I/O plus parsing. No database, no ledger.
 */
import {
  exactPositiveDecimal,
  parseJsonKeepingDigits,
  referenceGet,
  type ReferenceHttpOptions,
} from "./referenceHttp";
import type { PriceFailureCode, PriceProvider, PriceQuote, ProviderResult, QuoteKind } from "./types";
import { D } from "@/domain/decimal";

export const BRSAPI_BASE_URL = "https://api.brsapi.ir";

export type BrsFeed = "gold_currency" | "commodity" | "tsetmc";
export const BRS_FEEDS: readonly BrsFeed[] = ["gold_currency", "commodity", "tsetmc"];

const FEED_PATH: Record<BrsFeed, string> = {
  gold_currency: "/Market/Gold_Currency.php",
  commodity: "/Market/Commodity.php",
  tsetmc: "/Tsetmc/AllSymbols.php",
};

/** `ref` = `<feed>:<source id>` — e.g. «gold_currency:IR_GOLD_18K», «tsetmc:IRO1FOLD0001». */
export function brsRef(feed: BrsFeed, id: string): string {
  return `${feed}:${id}`;
}

function splitRef(ref: string): { feed: BrsFeed; id: string } | null {
  const at = ref.indexOf(":");
  if (at < 0) return null;
  const feed = ref.slice(0, at) as BrsFeed;
  return BRS_FEEDS.includes(feed) ? { feed, id: ref.slice(at + 1) } : null;
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

const CURRENCY_OF_UNIT: Record<string, "IRT" | "IRR" | "USD"> = {
  "تومان": "IRT",
  "ریال": "IRR",
  "دلار": "USD",
};

/** What one gold/coin price buys. Symbols not listed here are not stored. */
const GOLD_UNITS: Record<string, string> = {
  IR_GOLD_18K: "gram",
  IR_GOLD_24K: "gram",
  IR_COIN_EMAMI: "coin",
  IR_COIN_BAHAR: "coin",
  IR_COIN_HALF: "coin",
  IR_COIN_QUARTER: "coin",
  IR_COIN_1G: "coin",
  // IR_GOLD_MELTED is handled separately: its basis is CHECKED per response.
};

/** Grams in one Iranian مثقال. */
const MESGHAL_GRAMS = "4.6083";
/** «آب‌شده» is quoted at عیار ۷۰۵; the 18K gram is ۷۵۰. */
const MELTED_PURITY_RATIO = "0.94"; // 705 / 750
/** melted ÷ 18K gram must land within this share of the expected 4.3318. */
const MELTED_TOLERANCE = "0.02";
/** The dollar may sit at most this far from «دلار تتر» to count as the free-market rate. */
const FREE_MARKET_TOLERANCE = "0.05";

function withinShare(actual: string, expected: string, share: string): boolean {
  const diff = D(actual).sub(D(expected));
  const abs = diff.isNegative() ? diff.neg() : diff;
  return !abs.gt(D(expected).mul(D(share)));
}

/**
 * Currencies quoted for MORE than one unit. Everything else must be quoted
 * per ONE unit, and the name must agree either way.
 */
const PER_MANY: Record<string, string> = { JPY: "100" };

function multiplierInName(name: string): string {
  if (/یکصد|\b100\b|۱۰۰/.test(name)) return "100";
  if (/یک ?هزار|\b1000\b|۱۰۰۰/.test(name)) return "1000";
  return "1";
}

/** Global commodities: what one dollar price buys. */
const COMMODITY_UNITS: Record<string, string> = {
  BRENT: "barrel",
  WTI: "barrel",
  XAUUSD: "troy_ounce",
  XAGUSD: "troy_ounce",
};

/** A timestamp more than this far ahead of our clock is broken, not early. */
const MAX_FUTURE_SKEW_MS = 10 * 60 * 1000;

function unixToIso(raw: unknown, fetchedAt: Date): string | null {
  const text = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{9,11}$/.test(text)) return null;
  const ms = Number(text) * 1000;
  if (ms > fetchedAt.getTime() + MAX_FUTURE_SKEW_MS) return null;
  return new Date(ms).toISOString();
}

/* ------------------------------------------------------------------ */
/* Parsers — exported for tests                                        */
/* ------------------------------------------------------------------ */

export type FeedParse = {
  quotes: Map<string, PriceQuote>;
  /** Rows the feed carried but that failed validation, by ref. */
  rejected: Map<string, PriceFailureCode>;
};

/** A body that is BrsAPI's own error envelope → the failure it means. */
export function brsEnvelopeFailure(data: unknown): PriceFailureCode | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const env = data as Record<string, unknown>;
  if (env.successful !== false) return null;
  const said = `${String(env.status ?? "")} ${String(env.message_error ?? "")}`;
  if (/limit|quota|exceed|too many|سقف|محدودیت/i.test(said)) return "quota_exhausted";
  return "rejected_request";
}

type Row = Record<string, unknown>;

function rowsOf(data: unknown, section: string): Row[] {
  if (!data || typeof data !== "object") return [];
  const list = (data as Record<string, unknown>)[section];
  return Array.isArray(list) ? list.filter((r): r is Row => !!r && typeof r === "object") : [];
}

export function parseGoldCurrency(body: string, fetchedAt: Date): FeedParse | { failure: PriceFailureCode } {
  let data: unknown;
  try {
    data = parseJsonKeepingDigits(body, ["price", "time_unix"]);
  } catch {
    return { failure: "invalid_response" };
  }
  const envelope = brsEnvelopeFailure(data);
  if (envelope) return { failure: envelope };

  const quotes = new Map<string, PriceQuote>();
  const rejected = new Map<string, PriceFailureCode>();
  const fetchedIso = fetchedAt.toISOString();

  const take = (row: Row, quantityUnit: string, basis: string) => {
    const symbol = typeof row.symbol === "string" ? row.symbol.trim() : "";
    if (!symbol) return;
    const ref = brsRef("gold_currency", symbol);
    const currency = CURRENCY_OF_UNIT[String(row.unit ?? "").trim()];
    const raw = exactPositiveDecimal(row.price);
    const observedAt = unixToIso(row.time_unix, fetchedAt);
    if (!currency || currency === "USD" || !raw || !observedAt) {
      rejected.set(ref, "invalid_response");
      return;
    }
    let perUnit = raw;
    let sourceUnitQuantity = "1";
    if (quantityUnit === "currency_unit") {
      const expected = PER_MANY[symbol] ?? "1";
      const stated = multiplierInName(String(row.name ?? ""));
      if (stated !== expected) {
        // The name and the table disagree about how many units the price is
        // for — refusing is the only answer that cannot be off by 100×.
        rejected.set(ref, "invalid_response");
        return;
      }
      sourceUnitQuantity = expected;
      if (expected !== "1") perUnit = D(raw).div(D(expected)).toString();
    }
    quotes.set(ref, {
      price: perUnit,
      currency,
      observedAt,
      fetchedAt: fetchedIso,
      source: "brsapi",
      meta: { instrumentId: symbol, quantityUnit, sourceUnitQuantity, basis },
    });
  };

  const goldRows = rowsOf(data, "gold");
  for (const row of goldRows) {
    const unit = GOLD_UNITS[String(row.symbol ?? "")];
    if (unit) take(row, unit, "market_rate");
  }

  // Melted gold: stored as ONE مثقال at ۷۰۵ only when its own ratio to the
  // 18K gram in THIS response says so.
  const meltedRow = goldRows.find((r) => r.symbol === "IR_GOLD_MELTED");
  if (meltedRow) {
    take(meltedRow, "mesghal_705", "market_rate");
    const melted = quotes.get("gold_currency:IR_GOLD_MELTED");
    const gram18 = quotes.get("gold_currency:IR_GOLD_18K");
    const expected = D(MESGHAL_GRAMS).mul(D(MELTED_PURITY_RATIO));
    const consistent =
      melted && gram18 && melted.currency === gram18.currency &&
      withinShare(D(melted.price).div(D(gram18.price)).toString(), expected.toString(), MELTED_TOLERANCE);
    if (melted && !consistent) {
      quotes.delete("gold_currency:IR_GOLD_MELTED");
      rejected.set("gold_currency:IR_GOLD_MELTED", "invalid_response");
    }
  }

  // USDT_IRT is a stablecoin's Toman price; it is stored under its own id like
  // any other row and is never read as the dollar. It is used here only as the
  // yardstick that tells a free-market dollar from an official one.
  for (const row of rowsOf(data, "currency")) take(row, "currency_unit", "unspecified");
  const usd = quotes.get("gold_currency:USD");
  const usdt = quotes.get("gold_currency:USDT_IRT");
  if (usd && usdt && usd.currency === usdt.currency && withinShare(usd.price, usdt.price, FREE_MARKET_TOLERANCE)) {
    for (const [ref, q] of quotes) {
      if (q.meta?.quantityUnit === "currency_unit" && ref !== "gold_currency:USDT_IRT") {
        quotes.set(ref, { ...q, meta: { ...q.meta, basis: "free_market" } });
      }
    }
  }
  if (quotes.size === 0 && rejected.size === 0) return { failure: "invalid_response" };
  return { quotes, rejected };
}

export function parseCommodity(body: string, fetchedAt: Date): FeedParse | { failure: PriceFailureCode } {
  let data: unknown;
  try {
    data = parseJsonKeepingDigits(body, ["price", "time_unix"]);
  } catch {
    return { failure: "invalid_response" };
  }
  const envelope = brsEnvelopeFailure(data);
  if (envelope) return { failure: envelope };

  const quotes = new Map<string, PriceQuote>();
  const rejected = new Map<string, PriceFailureCode>();
  for (const section of ["metal_precious", "energy"]) {
    for (const row of rowsOf(data, section)) {
      const symbol = typeof row.symbol === "string" ? row.symbol.trim() : "";
      const quantityUnit = COMMODITY_UNITS[symbol];
      if (!quantityUnit) continue;
      const ref = brsRef("commodity", symbol);
      const currency = CURRENCY_OF_UNIT[String(row.unit ?? "").trim()];
      const price = exactPositiveDecimal(row.price);
      const observedAt = unixToIso(row.time_unix, fetchedAt);
      if (currency !== "USD" || !price || !observedAt) {
        rejected.set(ref, "invalid_response");
        continue;
      }
      quotes.set(ref, {
        price,
        currency,
        observedAt,
        fetchedAt: fetchedAt.toISOString(),
        source: "brsapi",
        meta: { instrumentId: symbol, quantityUnit, sourceUnitQuantity: "1", basis: "unspecified" },
      });
    }
  }
  if (quotes.size === 0 && rejected.size === 0) return { failure: "invalid_response" };
  return { quotes, rejected };
}

/** What a Tehran-exchange row IS, from its ISIN alone. */
export type TseClass = { kind: "stock" | "right" | "etf"; board: "bourse" | "farabourse" | "base" | null };

export function classifyIsin(isin: string): TseClass | null {
  if (/^IRR/.test(isin)) return { kind: "right", board: null };
  if (/^IRT[13K]/.test(isin)) return { kind: "etf", board: null };
  if (/^IRO1/.test(isin)) return { kind: "stock", board: "bourse" };
  if (/^IRO3/.test(isin)) return { kind: "stock", board: "farabourse" };
  if (/^IRO7/.test(isin)) return { kind: "stock", board: "base" };
  if (/^IRO5/.test(isin)) return { kind: "stock", board: null };
  return null;
}

/** Iran Standard Time is UTC+03:30 all year (daylight saving ended in 2022). */
const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

/**
 * The instant a TSETMC `HH:MM:SS` most plausibly refers to: that clock time on
 * the latest Tehran TRADING day (Saturday–Wednesday) not after `now`. Public
 * holidays are not known here, so on the day after one this is still the
 * holiday's date — which is why the result is always flagged as inferred.
 */
export function inferTehranSessionInstant(hhmmss: string, now: Date): Date | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmmss.trim());
  if (!m) return null;
  const [h, min, sec] = [Number(m[1]), Number(m[2]), Number(m[3] ?? "0")];
  if (h > 23 || min > 59 || sec > 59) return null;

  const tehranNow = new Date(now.getTime() + TEHRAN_OFFSET_MS); // read with getUTC*
  const day = new Date(Date.UTC(tehranNow.getUTCFullYear(), tehranNow.getUTCMonth(), tehranNow.getUTCDate()));
  const secondsNow = tehranNow.getUTCHours() * 3600 + tehranNow.getUTCMinutes() * 60 + tehranNow.getUTCSeconds();
  if (h * 3600 + min * 60 + sec > secondsNow + 300) day.setUTCDate(day.getUTCDate() - 1);
  // Thursday (4) and Friday (5) are not trading days.
  while (day.getUTCDay() === 4 || day.getUTCDay() === 5) day.setUTCDate(day.getUTCDate() - 1);
  return new Date(day.getTime() + (h * 3600 + min * 60 + sec) * 1000 - TEHRAN_OFFSET_MS);
}

const TSE_DIGIT_FIELDS = ["id", "pl", "pc", "py", "tno", "time_unix"] as const;

export function parseTsetmc(body: string, fetchedAt: Date): FeedParse | { failure: PriceFailureCode } {
  let data: unknown;
  try {
    data = parseJsonKeepingDigits(body, TSE_DIGIT_FIELDS);
  } catch {
    return { failure: "invalid_response" };
  }
  const envelope = brsEnvelopeFailure(data);
  if (envelope) return { failure: envelope };
  if (!Array.isArray(data)) return { failure: "invalid_response" };

  const quotes = new Map<string, PriceQuote>();
  const rejected = new Map<string, PriceFailureCode>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const row = item as Row;
    const isin = typeof row.isin === "string" ? row.isin.trim().toUpperCase() : "";
    if (!/^IR[A-Z0-9]{10}$/.test(isin)) continue; // no stable identity → never stored
    const cls = classifyIsin(isin);
    if (!cls) continue;
    const ref = brsRef("tsetmc", isin);

    const last = exactPositiveDecimal(row.pl);
    const observed = typeof row.time === "string" ? inferTehranSessionInstant(row.time, fetchedAt) : null;
    const insCode = typeof row.id === "string" && /^\d+$/.test(row.id) ? row.id : null;
    const symbol = typeof row.l18 === "string" ? row.l18.trim() : "";
    if (!last || !observed || !insCode || !symbol) {
      rejected.set(ref, "invalid_response");
      continue;
    }
    const extra: Record<string, string> = {
      kind: cls.kind,
      symbol,
      name: typeof row.l30 === "string" ? row.l30.trim() : symbol,
      insCode,
    };
    if (cls.board) extra.board = cls.board;
    const close = exactPositiveDecimal(row.pc);
    const yesterday = exactPositiveDecimal(row.py);
    if (close) extra.close = close;
    if (yesterday) extra.yesterdayClose = yesterday;
    const trades = typeof row.tno === "string" && /^\d+$/.test(row.tno) ? row.tno : null;
    if (trades) extra.tradesToday = trades;

    quotes.set(ref, {
      price: last,
      currency: "IRR",
      observedAt: observed.toISOString(),
      fetchedAt: fetchedAt.toISOString(),
      source: "brsapi",
      meta: {
        instrumentId: isin,
        quantityUnit: cls.kind === "etf" ? "fund_unit" : "share",
        sourceUnitQuantity: "1",
        basis: "last_trade",
        observedAtInferred: true,
        extra,
      },
    });
  }
  if (quotes.size === 0) return { failure: "invalid_response" };
  return { quotes, rejected };
}

const PARSERS: Record<BrsFeed, (body: string, fetchedAt: Date) => FeedParse | { failure: PriceFailureCode }> = {
  gold_currency: parseGoldCurrency,
  commodity: parseCommodity,
  tsetmc: parseTsetmc,
};

/* ------------------------------------------------------------------ */
/* Provider                                                            */
/* ------------------------------------------------------------------ */

export type BrsApiProviderOptions = ReferenceHttpOptions & {
  /** Server-side only. Never logged, never returned, never stored. */
  apiKey: string;
  baseUrl?: string;
  now?: () => Date;
};

export type FeedResult = FeedParse | { failure: PriceFailureCode };

export class BrsApiProvider implements PriceProvider {
  readonly id = "brsapi";
  readonly displayName = "BrsAPI";
  readonly kinds: readonly QuoteKind[] = ["gold", "fx", "commodity", "stock", "fund"];
  readonly quoteCurrency = "IRT";

  constructor(private readonly options: BrsApiProviderOptions) {}

  /**
   * One request for a whole feed — the unit of quota and of freshness.
   * `onAttempt` fires per HTTP request actually sent (retries included), so
   * the caller can charge each one to the shared daily budget.
   */
  async fetchFeed(feed: BrsFeed, hooks: { onAttempt?: () => void } = {}): Promise<FeedResult> {
    if (!this.options.apiKey) return { failure: "missing_configuration" };
    const now = this.options.now ?? (() => new Date());
    const url = new URL(FEED_PATH[feed], this.options.baseUrl ?? BRSAPI_BASE_URL);
    url.searchParams.set("key", this.options.apiKey);
    if (feed === "tsetmc") url.searchParams.set("type", "1");
    const outcome = await referenceGet(url.toString(), {
      ...this.options,
      onAttempt: hooks.onAttempt ?? this.options.onAttempt,
      // The provider's own docs: a default client User-Agent is blocked by
      // its firewall. This names the app honestly; it does not impersonate.
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Tavazon/1.0)", ...this.options.headers },
    });
    if (!outcome.ok) return { failure: outcome.code };
    return PARSERS[feed](outcome.body, now());
  }

  async fetchQuotes(refs: readonly string[]): Promise<ProviderResult> {
    const quotes = new Map<string, PriceQuote>();
    const failures = new Map<string, PriceFailureCode>();
    const byFeed = new Map<BrsFeed, string[]>();
    for (const ref of new Set(refs)) {
      const parts = splitRef(ref);
      if (!parts) {
        failures.set(ref, "asset_not_found");
        continue;
      }
      byFeed.set(parts.feed, [...(byFeed.get(parts.feed) ?? []), ref]);
    }
    // Feeds one after another: the terms cap concurrent requests per IP.
    for (const [feed, wanted] of byFeed) {
      const result = await this.fetchFeed(feed);
      for (const ref of wanted) {
        if ("failure" in result) failures.set(ref, result.failure);
        else if (result.quotes.has(ref)) quotes.set(ref, result.quotes.get(ref)!);
        else failures.set(ref, result.rejected.get(ref) ?? "asset_not_found");
      }
    }
    return { quotes, failures };
  }
}
