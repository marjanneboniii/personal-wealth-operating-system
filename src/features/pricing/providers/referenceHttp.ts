/**
 * One HTTP GET for the reference-price sources (BrsAPI, Gold API) — timeout,
 * a small number of retries with growing gaps for TRANSIENT failures only,
 * and an outcome that is a code, never a message.
 *
 * WHY A CODE AND NOT THE ERROR
 * BrsAPI authenticates with `?key=` in the URL. Node's fetch errors, a
 * response body echoing the request, or a stack trace can all carry that URL,
 * and anything returned from here may end up in the database status row or on
 * a screen. So the only things that leave this module are the HTTP status, the
 * body text (on success) and a `PriceFailureCode`. The URL never does.
 *
 * WHAT IS RETRIED
 *   • timeout, network failure, HTTP 5xx          → retried, with a growing gap
 *   • HTTP 429 / a «limit» refusal                → NOT retried: `quota_exhausted`
 *   • any other 4xx (bad key, bad parameter)      → NOT retried: `rejected_request`
 * BrsAPI's terms say repeated requests with wrong parameters get a key
 * banned, so a refusal must stop the loop, not feed it.
 *
 * Pure I/O. No database, no ledger.
 */
import type { PriceFailureCode } from "./types";

export type HttpOutcome =
  | { ok: true; status: number; body: string }
  | { ok: false; status: number | null; code: PriceFailureCode };

export type ReferenceHttpOptions = {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra attempts after the first, for transient failures only. */
  retries?: number;
  /** Gap before retry n (0-based) is `baseDelayMs × 3ⁿ`. */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  headers?: Record<string, string>;
  /** Called once per HTTP request actually sent, retries included — the quota's unit. */
  onAttempt?: () => void;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Body text that says the allowance is spent, whatever status carried it. */
const QUOTA_BODY_RE = /limit|quota|too many|exceed|سقف|محدودیت/i;

export async function referenceGet(url: string, options: ReferenceHttpOptions = {}): Promise<HttpOutcome> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = Math.max(0, Math.min(options.retries ?? 2, 4));
  const baseDelayMs = options.baseDelayMs ?? 700;
  const sleep = options.sleep ?? defaultSleep;

  let last: HttpOutcome = { ok: false, status: null, code: "network_failure" };
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(baseDelayMs * 3 ** (attempt - 1));
    options.onAttempt?.();
    last = await once(fetchImpl, url, timeoutMs, options.headers);
    if (last.ok) return last;
    const transient = last.code === "timeout" || last.code === "network_failure" || last.code === "upstream_error";
    if (!transient) return last;
  }
  return last;
}

async function once(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
  headers: Record<string, string> | undefined,
): Promise<HttpOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.text();
    if (response.ok) return { ok: true, status: response.status, body };
    if (response.status === 429 || QUOTA_BODY_RE.test(body)) {
      return { ok: false, status: response.status, code: "quota_exhausted" };
    }
    if (response.status >= 500) return { ok: false, status: response.status, code: "upstream_error" };
    return { ok: false, status: response.status, code: "rejected_request" };
  } catch (error) {
    // Deliberately not inspected beyond its kind: the message may hold the URL.
    const aborted = (error as { name?: unknown } | null)?.name === "AbortError";
    return { ok: false, status: null, code: aborted ? "timeout" : "network_failure" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The shortest exact decimal for a price the source sent, or null.
 *
 * Accepts only a plain non-negative decimal («6214700», «3395.52»). An
 * exponent, a sign, a comma or an empty value is refused rather than coerced:
 * `Number("1e-5")` is valid JavaScript and a wrong price. Zero is refused too —
 * no instrument here trades at zero, so a zero is a missing value.
 */
export function exactPositiveDecimal(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw.trim() : typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const trimmed = text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text.replace(/^0+(?=\d)/, "");
  if (/^0*(\.0*)?$/.test(trimmed)) return null;
  return trimmed;
}

/**
 * JSON.parse, with the listed numeric fields read as their SOURCE TEXT.
 *
 * TSETMC instrument ids are 17 digits (46348559193224090). JavaScript numbers
 * are exact only to 2⁵³ ≈ 9.0×10¹⁵, and BrsAPI sends some ids as numbers and
 * some as strings in the same response (148 of 1,188 in the official sample).
 * A parsed number would silently become a DIFFERENT instrument id. Prices get
 * the same treatment so «0.00001477» never passes through a float.
 */
export function parseJsonKeepingDigits(text: string, fields: readonly string[]): unknown {
  if (fields.length === 0) return JSON.parse(text);
  const names = fields.map((f) => f.replace(/[^A-Za-z0-9_]/g, "")).join("|");
  const re = new RegExp(`("(?:${names})"\\s*:\\s*)(-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)(?=\\s*[,}\\]])`, "g");
  return JSON.parse(text.replace(re, '$1"$2"'));
}
