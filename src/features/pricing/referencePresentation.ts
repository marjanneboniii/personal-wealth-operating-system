/**
 * Stored reference prices → what a market row shows. PURE: no database, no
 * network; the page hands it what was stored, the source status and a clock.
 *
 * FOUR DIFFERENT KINDS OF «NOT NOW», KEPT APART
 *   live           — the source's own time is recent for that market.
 *   market_closed  — the market is outside its hours (a weekend for world
 *                    metals and oil, Friday for Iran's gold and currency
 *                    market, outside the Tehran session); the figure is the
 *                    last one it made.
 *   delayed        — the market should be open but the source's figure is old.
 *   source_down    — our last request to the source failed after this figure
 *                    was stored; it is the last VALID price, shown as such.
 * A Tehran instrument with no trade in its session is flagged separately
 * (`noTrades`): the feed does not say whether a symbol is HALTED, so the app
 * never claims it is.
 *
 * Freshness is measured from `observedAt` — the SOURCE's time — never from
 * when it was fetched, so fetching an old figure again cannot make it fresh.
 *
 * Rial is converted to Toman by dividing by ten, exactly, and only for a
 * source whose unit is documented as rial. Dollars stay dollars: a USD price
 * is never shown as Tether.
 */
import { D } from "@/domain/decimal";
import { CATALOG_ISIN } from "@/features/funds/tseIsinData";
import type { MarketRow } from "./marketSearch";
import { REFERENCE_QUOTE_REFS } from "./referenceMarketRows";
import type { SourceStatusView, StoredReferenceQuote } from "./referenceQuotes";
import { WALLEX_KIND_LABELS } from "./wallexKinds";

export type ReferenceState = "live" | "delayed" | "market_closed" | "source_down";

export type ReferenceQuoteView = {
  /** Exact decimal, per ONE unit, in `currency`. */
  amount: string;
  currency: "IRT" | "USD";
  /** «هر گرم», «هر اونس», «هر بشکه»… */
  unitLabel: string;
  /** What kind of price, when it is not self-evident — «آخرین معامله», «نوع نرخ اعلام نشده». */
  basisLabel: string | null;
  /** Other figures of the same instrument, never merged into `amount`. */
  secondary: Array<{ label: string; amount: string; currency: "IRT" | "USD" }>;
  /** The data provider, as the user should see it credited. */
  attribution: string;
  observedAt: string;
  /** The date part of `observedAt` was inferred (the source sent a clock time only). */
  observedAtInferred: boolean;
  state: ReferenceState;
  /** Tehran exchange: the instrument made no trade in the session shown. */
  noTrades: boolean;
  /** Tehran exchange: «بورس» / «فرابورس» / «بازار پایه». */
  boardLabel: string | null;
};

const UNIT_LABELS: Record<string, string> = {
  gram: "هر گرم",
  mesghal_705: "هر مثقال (عیار ۷۰۵)",
  troy_ounce: "هر اونس",
  coin: "هر سکه",
  currency_unit: "هر واحد",
  barrel: "هر بشکه",
  share: "هر سهم",
  fund_unit: "هر واحد صندوق",
};

const BASIS_LABELS: Record<string, string | null> = {
  last_trade: "آخرین معامله",
  market_rate: null,
  free_market: "بازار آزاد",
  spot: null,
  unspecified: "نوع نرخ را منبع اعلام نکرده",
};

const BOARD_LABELS: Record<string, string> = { bourse: "بورس", farabourse: "فرابورس", base: "بازار پایه" };

const ATTRIBUTION: Record<string, string> = { brsapi: "BrsAPI", "gold-api": "Gold API" };

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;
const MIN = 60_000;
const HOUR = 60 * MIN;

type MarketClock = "global" | "iran_otc" | "tehran_exchange";

function marketOf(q: StoredReferenceQuote): MarketClock {
  if (q.ref.startsWith("tsetmc:")) return "tehran_exchange";
  if (q.ref.startsWith("gold_currency:")) return "iran_otc";
  return "global";
}

/** How old a figure may be and still be «live», per market. */
const LIVE_WINDOW: Record<MarketClock, number> = {
  global: 30 * MIN,
  iran_otc: 60 * MIN,
  tehran_exchange: 20 * MIN,
};

function isClosed(market: MarketClock, now: Date, q: StoredReferenceQuote): boolean {
  if (market === "global") {
    // World metals and oil pause from Friday evening to Sunday evening (UTC).
    const day = now.getUTCDay();
    const hour = now.getUTCHours();
    return day === 6 || (day === 5 && hour >= 21) || (day === 0 && hour < 22);
  }
  const t = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  const day = t.getUTCDay();
  const minutes = t.getUTCHours() * 60 + t.getUTCMinutes();
  if (market === "iran_otc") return day === 5; // Friday
  // Tehran exchange: Saturday–Wednesday. Shares 09:00–12:30; exchange-traded
  // funds keep trading into the afternoon (the feed shows gold funds at 17:59).
  if (day === 4 || day === 5) return true;
  const close = q.extra?.kind === "etf" ? 18 * 60 : 12 * 60 + 30;
  return minutes < 9 * 60 || minutes > close;
}

export function referenceState(q: StoredReferenceQuote, status: SourceStatusView | undefined, now: Date): ReferenceState {
  if (status?.failing && status.lastErrorAt && new Date(status.lastErrorAt) > new Date(q.fetchedAt)) {
    return "source_down";
  }
  const market = marketOf(q);
  const age = now.getTime() - new Date(q.observedAt).getTime();
  if (age <= LIVE_WINDOW[market]) return "live";
  // A closed market explains an old figure only for so long — a week-old
  // «last close» is a source problem, whatever the calendar says.
  if (isClosed(market, now, q) && age <= 4 * 24 * HOUR) return "market_closed";
  return "delayed";
}

function toDisplay(amount: string, currency: StoredReferenceQuote["currency"]): { amount: string; currency: "IRT" | "USD" } {
  if (currency === "IRR") return { amount: D(amount).div(D("10")).toString(), currency: "IRT" };
  return { amount, currency };
}

function statusFor(q: StoredReferenceQuote, statuses: readonly SourceStatusView[]): SourceStatusView | undefined {
  const source = q.source === "gold-api" ? "gold-api" : `brsapi:${q.ref.slice(0, q.ref.indexOf(":"))}`;
  return statuses.find((s) => s.source === source);
}

export function toQuoteView(q: StoredReferenceQuote, statuses: readonly SourceStatusView[], now: Date): ReferenceQuoteView {
  const main = toDisplay(q.price, q.currency);
  const secondary: ReferenceQuoteView["secondary"] = [];
  if (q.extra?.close) secondary.push({ label: "قیمت پایانی", ...toDisplay(q.extra.close, q.currency) });
  return {
    ...main,
    unitLabel: UNIT_LABELS[q.quantityUnit] ?? "هر واحد",
    basisLabel: BASIS_LABELS[q.basis] ?? null,
    secondary,
    attribution: ATTRIBUTION[q.source] ?? q.source,
    observedAt: q.observedAt,
    observedAtInferred: q.observedAtInferred,
    state: referenceState(q, statusFor(q, statuses), now),
    noTrades: q.extra?.tradesToday === "0",
    boardLabel: q.extra?.board ? BOARD_LABELS[q.extra.board] ?? null : null,
  };
}

export const rowKey = (row: Pick<MarketRow, "kind" | "symbol">) => `${row.kind}:${row.symbol}`;

/**
 * Attach a stored price to every row that has one, by the source's own
 * instrument id: REFERENCE_QUOTE_REFS for gold/coins/currencies/commodities,
 * the catalogue ISIN for Tehran funds and stocks.
 */
export function referenceViewsFor(
  rows: readonly MarketRow[],
  quotes: ReadonlyMap<string, StoredReferenceQuote>,
  statuses: readonly SourceStatusView[],
  now: Date,
): Record<string, ReferenceQuoteView> {
  const out: Record<string, ReferenceQuoteView> = {};
  for (const row of rows) {
    let stored: StoredReferenceQuote | undefined;
    if (row.kind === "ir_fund" || row.kind === "ir_stock" || row.kind === "ir_right") {
      const isin = CATALOG_ISIN.get(row.symbol) ?? (/^IR[A-Z0-9]{10}$/.test(row.latinName) ? row.latinName : null);
      if (isin) stored = quotes.get(`brsapi|tsetmc:${isin}`);
    } else {
      for (const ref of REFERENCE_QUOTE_REFS[row.symbol] ?? []) {
        stored = quotes.get(`${ref.source}|${ref.ref}`);
        if (stored) break;
      }
    }
    if (stored) out[rowKey(row)] = toQuoteView(stored, statuses, now);
  }
  return out;
}

/**
 * Tehran-exchange instruments the feed carries that the hand-kept catalogue
 * does not — listed so the whole market is searchable. Their latin name is the
 * ISIN, which is how `referenceViewsFor` finds their price again. Classified
 * by ISIN: a حق‌تقدم is its own kind, never an ordinary share.
 */
export function tseRowsFromQuotes(
  quotes: ReadonlyMap<string, StoredReferenceQuote>,
  /** `rowKey`s already listed — a same-ticker row of ANOTHER kind is still added. */
  knownKeys: ReadonlySet<string>,
): MarketRow[] {
  const listedIsins = new Set(CATALOG_ISIN.values());
  const rows: MarketRow[] = [];
  for (const q of quotes.values()) {
    if (q.source !== "brsapi" || !q.ref.startsWith("tsetmc:")) continue;
    if (listedIsins.has(q.instrumentId)) continue;
    const symbol = q.extra?.symbol;
    if (!symbol) continue;
    const kind = q.extra?.kind === "etf" ? "ir_fund" : q.extra?.kind === "right" ? "ir_right" : "ir_stock";
    if (knownKeys.has(rowKey({ kind, symbol }))) continue;
    rows.push({
      symbol,
      displayName: q.extra?.name || symbol,
      latinName: q.instrumentId,
      kind,
      kindLabel: WALLEX_KIND_LABELS[kind],
      logoUrl: kind === "ir_fund" ? "mark:fund" : "mark:stock",
      priceTmn: null,
      priceUsdt: null,
    });
  }
  return rows.sort((a, b) => a.symbol.localeCompare(b.symbol, "fa"));
}

/**
 * Everything «نمای بازار» lists beyond the exchange catalogue, with the
 * hand-kept Tehran rows joined to the live feed.
 *
 * A catalogue row whose ISIN is not on record (see funds/tseIsinData) takes
 * the ISIN of the feed row with the SAME kind and ticker — the feed's own
 * identity, never a name match — and that feed row is not listed a second
 * time. Same ticker, different kind (the catalogue's fund «نوین» vs the
 * feed's بیمه نوین) never joins: both are listed, apart.
 */
export function supplementalMarketRows(
  referenceRows: readonly MarketRow[],
  catalogRows: readonly MarketRow[],
  quotes: ReadonlyMap<string, StoredReferenceQuote>,
  exchangeKeys: ReadonlySet<string>,
): MarketRow[] {
  const isTse = (r: MarketRow) => r.kind === "ir_fund" || r.kind === "ir_stock" || r.kind === "ir_right";
  const unmapped = new Set(catalogRows.filter((r) => isTse(r) && !CATALOG_ISIN.has(r.symbol)).map(rowKey));
  const known = new Set(
    [...exchangeKeys, ...[...referenceRows, ...catalogRows].map(rowKey)].filter((k) => !unmapped.has(k)),
  );
  const feed = tseRowsFromQuotes(quotes, known);
  const isinByKey = new Map(feed.filter((r) => unmapped.has(rowKey(r))).map((r) => [rowKey(r), r.latinName]));
  const joined = catalogRows.map((r) => {
    const isin = isinByKey.get(rowKey(r));
    return isin ? { ...r, latinName: isin } : r;
  });
  return [...referenceRows, ...joined, ...feed.filter((r) => !isinByKey.has(rowKey(r)))];
}
