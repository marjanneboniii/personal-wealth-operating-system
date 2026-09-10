/**
 * LIVE USDT/Toman rate — the app's reference rate.
 *
 * The settings rate is the TETHER rate (owner decision): in the Iranian market
 * «نرخ دلار» is quoted as USDT/Toman, so this module reads that pair from
 * public Iranian exchange endpoints.
 *
 * Contract:
 *   • READ-ONLY over the network. It never writes, never touches the ledger,
 *     FIFO, valuation or any user row, and returns null rather than guessing.
 *   • No API key, no account, no user data leaves the server — the request
 *     carries a symbol and nothing else.
 *   • A quote is only accepted if it parses to a finite, positive number inside
 *     a sanity band. A garbage or hostile response can therefore never become
 *     someone's exchange rate.
 *
 * Callers persist the result through the existing exchange-rate path and fall
 * back to the last stored rate when this returns null; nothing here decides
 * what happens on failure.
 */

const DEFAULT_TIMEOUT_MS = 6_000;

/**
 * A quote outside this band is refused. It is deliberately wide — it exists to
 * reject a broken payload (0, negative, a price in Rial, an HTML error page
 * that parsed to a number), not to second-guess the market.
 */
const MIN_PLAUSIBLE_TOMAN = 10_000;
const MAX_PLAUSIBLE_TOMAN = 10_000_000;

export type LiveRateQuote = {
  /** Toman per 1 USDT, as a decimal string. */
  rate: string;
  /** Which endpoint answered — surfaced to the user, never invented. */
  source: "wallex" | "bitpin";
  observedAt: string;
};

export type LiveRateOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

function plausible(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < MIN_PLAUSIBLE_TOMAN || n > MAX_PLAUSIBLE_TOMAN) return null;
  // Trim to whole Toman: sub-Toman precision on a market rate is noise.
  return String(Math.round(n));
}

async function getJson(url: string, opts: LiveRateOptions): Promise<unknown | null> {
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await doFetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wallex order-book depth for USDTTMN — ~5 KB, versus ~440 KB for the full
 * markets listing. The mid of best bid/ask is used when both sides exist, so a
 * one-sided book cannot skew the reference rate.
 */
async function fromWallex(opts: LiveRateOptions): Promise<LiveRateQuote | null> {
  const body = (await getJson("https://api.wallex.ir/v1/depth?symbol=USDTTMN", opts)) as
    | { result?: { ask?: { price?: string }[]; bid?: { price?: string }[] } }
    | null;
  const ask = plausible(body?.result?.ask?.[0]?.price);
  const bid = plausible(body?.result?.bid?.[0]?.price);
  if (!ask && !bid) return null;
  const rate =
    ask && bid ? String(Math.round((Number(ask) + Number(bid)) / 2)) : (ask ?? bid)!;
  return { rate, source: "wallex", observedAt: new Date().toISOString() };
}

/** Bitpin fallback — heavier payload, used only when Wallex does not answer. */
async function fromBitpin(opts: LiveRateOptions): Promise<LiveRateQuote | null> {
  const body = (await getJson("https://api.bitpin.ir/v1/mkt/markets/", opts)) as unknown;
  const rows: unknown[] = Array.isArray(body)
    ? body
    : ((body as { results?: unknown[] })?.results ?? []);
  for (const row of rows) {
    const r = row as { code?: string; price?: unknown };
    if (r?.code !== "USDT_IRT" && r?.code !== "USDT_TMN") continue;
    const rate = plausible(r.price);
    if (!rate) return null;
    return { rate, source: "bitpin", observedAt: new Date().toISOString() };
  }
  return null;
}

/**
 * Best available live quote, or null when no source answered with a plausible
 * number. Sources are tried in order and the first good answer wins.
 */
export async function fetchLiveUsdtRate(opts: LiveRateOptions = {}): Promise<LiveRateQuote | null> {
  return (await fromWallex(opts)) ?? (await fromBitpin(opts));
}
