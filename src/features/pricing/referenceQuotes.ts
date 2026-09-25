/**
 * Reference prices — gold, coins, currencies, commodities, the Tehran exchange.
 *
 * THE PATH, ONE SOURCE AT A TIME
 *
 *   claim the source's lease in Postgres ──► ask the provider (from the registry)
 *        │ someone else holds it / asked too recently / backing off / out of quota
 *        └──► do nothing; readers keep the last valid prices
 *   ──► validate ──► upsert rows whose SOURCE time is not older than what is stored
 *   ──► record success or failure (a code), release the lease
 *
 * WHY THE LEASE LIVES IN THE DATABASE
 * The app runs as several short-lived Vercel instances. A cache or a timer in
 * one process's memory controls nothing: ten cold instances would each ask
 * BrsAPI for the same feed. The lease row is claimed by a single atomic
 * INSERT … ON CONFLICT … WHERE … RETURNING, so across every instance exactly
 * one fetch per source per interval can happen, and the day's request count
 * (all BrsAPI feeds together) is shared.
 *
 * WHAT A READER GETS
 * Only what is stored: never a live call on the render path, never a sample,
 * never zero in place of a price. When a source fails, its last VALID prices
 * stay, carrying their own observation time, and the status says the source
 * is unreachable — which is different from a market that is closed, a source
 * that is late, or an instrument that did not trade.
 *
 * ISOLATION FROM THE BOOKS
 * This module writes exactly two tables — market_reference_quotes and
 * market_source_status — and imports no ledger, lot, price or asset table.
 * A reference price moving cannot change a journal entry, a cost basis, a
 * past transaction or a price a user entered by hand.
 */
import { after } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { marketReferenceQuotes, marketSourceStatus } from "@/db/schema";
import { bootstrapProviders, type ProviderRegistry } from "./providers";
import type { BrsApiProvider, BrsFeed, FeedResult } from "./providers/brsapi";
import type { GoldApiProvider } from "./providers/goldApi";
import type { PriceFailureCode, PriceQuote } from "./providers/types";
import {
  REFERENCE_SOURCES,
  disabledReason,
  readReferenceConfig,
  type ReferenceConfig,
  type ReferenceSourceId,
} from "./referenceConfig";

/** A fetch holds its lease this long at most; a crashed instance cannot block forever. */
const LEASE_MS = 60_000;
/** First retry gap after a transient failure; doubles per failure, capped. */
const BACKOFF_BASE_MS = 2 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;
/** A refused request (bad key or parameter) cannot fix itself; wait long. */
const REJECTED_BACKOFF_MS = 6 * 60 * 60_000;
/** Attempts one BrsAPI fetch can spend (1 + retries) — reserved before claiming. */
const MAX_ATTEMPTS_PER_FETCH = 3;
/** Rows per INSERT. */
const UPSERT_CHUNK = 200;

const TEHRAN_OFFSET_MS = 3.5 * 60 * 60 * 1000;

/** Tehran calendar day, «YYYY-MM-DD» — the quota's day. */
export function tehranDay(now: Date): string {
  return new Date(now.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

/** The next Tehran midnight — when a spent daily quota is assumed to reset. */
export function nextTehranMidnight(now: Date): Date {
  const t = new Date(now.getTime() + TEHRAN_OFFSET_MS);
  const midnight = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() + 1);
  return new Date(midnight - TEHRAN_OFFSET_MS);
}

/* ------------------------------------------------------------------ */
/* Lease and status                                                    */
/* ------------------------------------------------------------------ */

type Clock = { now?: () => Date };

async function brsRequestsToday(day: string): Promise<number> {
  const result = await db.execute(sql`
    select coalesce(sum(requests_today), 0)::int as n
    from market_source_status
    where source like 'brsapi:%' and quota_day = ${day}
  `);
  return Number((result as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0);
}

/**
 * Claim the right to fetch `source` now. True for exactly one caller across
 * all instances; false when another holds the lease, the last attempt was too
 * recent, the source is backing off, or its quota is spent.
 */
export async function claimSource(source: ReferenceSourceId, intervalMs: number, now: Date): Promise<boolean> {
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  const day = tehranDay(now);
  const result = await db.execute(sql`
    insert into market_source_status as s (source, lease_until, last_attempt_at, quota_day, requests_today)
    values (${source}, ${leaseUntil}::timestamptz, ${nowIso}::timestamptz, ${day}, 0)
    on conflict (source) do update set
      lease_until = excluded.lease_until,
      last_attempt_at = excluded.last_attempt_at,
      requests_today = case when s.quota_day = excluded.quota_day then s.requests_today else 0 end,
      quota_day = excluded.quota_day
    where (s.lease_until is null or s.lease_until <= ${nowIso}::timestamptz)
      and (s.last_attempt_at is null
           or s.last_attempt_at <= ${nowIso}::timestamptz - (${intervalMs}::int * interval '1 millisecond'))
      and (s.backoff_until is null or s.backoff_until <= ${nowIso}::timestamptz)
      and (s.quota_exhausted_until is null or s.quota_exhausted_until <= ${nowIso}::timestamptz)
    returning source
  `);
  return ((result as unknown as { rows: unknown[] }).rows ?? []).length > 0;
}

async function recordSuccess(
  source: ReferenceSourceId,
  now: Date,
  attempts: number,
  counts: { quotes: number; rejected: number },
): Promise<void> {
  await db
    .update(marketSourceStatus)
    .set({
      leaseUntil: null,
      lastSuccessAt: now,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastQuoteCount: counts.quotes,
      lastRejectedCount: counts.rejected,
      requestsToday: sql`${marketSourceStatus.requestsToday} + ${attempts}`,
    })
    .where(eq(marketSourceStatus.source, source));
}

async function recordFailure(source: ReferenceSourceId, now: Date, attempts: number, code: PriceFailureCode): Promise<void> {
  const nowIso = now.toISOString();
  const backoff =
    code === "rejected_request" || code === "missing_configuration"
      ? sql`${nowIso}::timestamptz + (${REJECTED_BACKOFF_MS}::int * interval '1 millisecond')`
      : sql`${nowIso}::timestamptz + (least(${BACKOFF_BASE_MS}::bigint * power(2, ${marketSourceStatus.consecutiveFailures})::bigint, ${BACKOFF_MAX_MS}::bigint) * interval '1 millisecond')`;
  await db
    .update(marketSourceStatus)
    .set({
      leaseUntil: null,
      lastErrorAt: now,
      lastErrorCode: code,
      consecutiveFailures: sql`${marketSourceStatus.consecutiveFailures} + 1`,
      backoffUntil: backoff,
      quotaExhaustedUntil: code === "quota_exhausted" ? nextTehranMidnight(now) : sql`${marketSourceStatus.quotaExhaustedUntil}`,
      requestsToday: sql`${marketSourceStatus.requestsToday} + ${attempts}`,
    })
    .where(eq(marketSourceStatus.source, source));
}

/* ------------------------------------------------------------------ */
/* Persist                                                             */
/* ------------------------------------------------------------------ */

/**
 * Upsert valid quotes. A stored row is replaced only by one whose SOURCE time
 * is the same or newer: a lagging response cannot roll a price backwards, and
 * a re-fetched old figure keeps its old observation time.
 */
export async function persistReferenceQuotes(source: string, quotes: ReadonlyMap<string, PriceQuote>): Promise<void> {
  const values = [...quotes].map(([ref, q]) => ({
    source,
    ref,
    instrumentId: q.meta?.instrumentId ?? ref,
    price: q.price,
    currency: q.currency,
    quantityUnit: q.meta?.quantityUnit ?? "unit",
    sourceUnitQuantity: q.meta?.sourceUnitQuantity ?? "1",
    basis: q.meta?.basis ?? "unspecified",
    observedAt: new Date(q.observedAt),
    observedAtInferred: q.meta?.observedAtInferred ?? false,
    fetchedAt: new Date(q.fetchedAt),
    extra: q.meta?.extra ?? null,
  }));
  for (let i = 0; i < values.length; i += UPSERT_CHUNK) {
    await db
      .insert(marketReferenceQuotes)
      .values(values.slice(i, i + UPSERT_CHUNK))
      .onConflictDoUpdate({
        target: [marketReferenceQuotes.source, marketReferenceQuotes.ref],
        set: {
          instrumentId: sql`excluded.instrument_id`,
          price: sql`excluded.price`,
          currency: sql`excluded.currency`,
          quantityUnit: sql`excluded.quantity_unit`,
          sourceUnitQuantity: sql`excluded.source_unit_quantity`,
          basis: sql`excluded.basis`,
          observedAt: sql`excluded.observed_at`,
          observedAtInferred: sql`excluded.observed_at_inferred`,
          fetchedAt: sql`excluded.fetched_at`,
          extra: sql`excluded.extra`,
        },
        setWhere: sql`excluded.observed_at >= ${marketReferenceQuotes.observedAt}`,
      });
  }
}

/* ------------------------------------------------------------------ */
/* Refresh                                                             */
/* ------------------------------------------------------------------ */

export type RefreshOutcome =
  | { source: ReferenceSourceId; status: "disabled"; reason: string }
  | { source: ReferenceSourceId; status: "skipped" }
  | { source: ReferenceSourceId; status: "ok"; quotes: number; rejected: number }
  | { source: ReferenceSourceId; status: "failed"; code: PriceFailureCode };

export type RefreshDeps = Clock & {
  config?: ReferenceConfig;
  registry?: ProviderRegistry;
};

/** The metals Gold API is asked for. */
const GOLD_API_REFS = ["XAU", "XAG"];

async function refreshOne(source: ReferenceSourceId, deps: Required<RefreshDeps>): Promise<RefreshOutcome> {
  const { config, registry } = deps;
  const reason = disabledReason(source, config);
  if (reason) return { source, status: "disabled", reason };

  const isBrs = source.startsWith("brsapi:");
  const provider = registry.get(isBrs ? "brsapi" : "gold-api");
  if (!provider) return { source, status: "disabled", reason: "منبع در این نمونهٔ برنامه ثبت نشده است." };

  const now = deps.now();
  if (isBrs) {
    const used = await brsRequestsToday(tehranDay(now));
    if (used + MAX_ATTEMPTS_PER_FETCH > config.brsapi.dailyBudget) return { source, status: "skipped" };
  }
  const interval = isBrs ? config.brsapi.intervalMs : config.goldApi.intervalMs;
  if (!(await claimSource(source, interval, now))) return { source, status: "skipped" };

  let attempts = 0;
  try {
    let quotes: ReadonlyMap<string, PriceQuote>;
    let rejected = 0;
    if (isBrs) {
      const feed = source.slice("brsapi:".length) as BrsFeed;
      const result: FeedResult = await (provider as BrsApiProvider).fetchFeed(feed, {
        onAttempt: () => {
          attempts += 1;
        },
      });
      if ("failure" in result) {
        await recordFailure(source, deps.now(), attempts, result.failure);
        return { source, status: "failed", code: result.failure };
      }
      quotes = result.quotes;
      rejected = result.rejected.size;
    } else {
      const result = await (provider as GoldApiProvider).fetchQuotes(GOLD_API_REFS);
      attempts = GOLD_API_REFS.length;
      if (result.quotes.size === 0) {
        const code = result.failures.values().next().value ?? "upstream_error";
        await recordFailure(source, deps.now(), attempts, code);
        return { source, status: "failed", code };
      }
      quotes = result.quotes;
      rejected = result.failures.size;
    }
    await persistReferenceQuotes(provider.id, quotes);
    await recordSuccess(source, deps.now(), attempts, { quotes: quotes.size, rejected });
    return { source, status: "ok", quotes: quotes.size, rejected };
  } catch {
    // A database or parser fault: release the lease, report a code, keep the
    // last valid prices. Never rethrow — one source must not stop the others.
    try {
      await recordFailure(source, deps.now(), attempts, "upstream_error");
    } catch {
      /* the status row is best-effort */
    }
    return { source, status: "failed", code: "upstream_error" };
  }
}

/**
 * Refresh every enabled source whose turn it is. Sources run one after
 * another (BrsAPI caps concurrent requests per IP). Always resolves.
 */
export async function refreshReferenceQuotes(deps: RefreshDeps = {}): Promise<RefreshOutcome[]> {
  const full: Required<RefreshDeps> = {
    now: deps.now ?? (() => new Date()),
    config: deps.config ?? readReferenceConfig(),
    registry: deps.registry ?? bootstrapProviders(),
  };
  const out: RefreshOutcome[] = [];
  for (const source of REFERENCE_SOURCES) {
    try {
      out.push(await refreshOne(source, full));
    } catch {
      out.push({ source, status: "failed", code: "upstream_error" });
    }
  }
  return out;
}

const globalForReference = globalThis as unknown as { __pwosReferenceRefresh?: Promise<unknown> };

/**
 * Start a refresh after the response — the page never waits on a provider.
 * The database lease decides whether anything is actually fetched.
 */
export function scheduleReferenceRefresh(): void {
  if (globalForReference.__pwosReferenceRefresh) return;
  const task = () => {
    const run = refreshReferenceQuotes().finally(() => {
      globalForReference.__pwosReferenceRefresh = undefined;
    });
    globalForReference.__pwosReferenceRefresh = run;
    return run.then(() => undefined, () => undefined);
  };
  try {
    after(task);
  } catch {
    // Outside a request scope (a script) `after` throws — run detached.
    void task();
  }
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export type StoredReferenceQuote = {
  source: string;
  ref: string;
  instrumentId: string;
  price: string;
  currency: "IRT" | "IRR" | "USD";
  quantityUnit: string;
  sourceUnitQuantity: string;
  basis: string;
  observedAt: string;
  observedAtInferred: boolean;
  fetchedAt: string;
  extra: Record<string, string> | null;
};

/** Every stored reference price, keyed `source|ref`. Empty — never throws — when the table is unavailable. */
export async function readReferenceQuotes(): Promise<Map<string, StoredReferenceQuote>> {
  try {
    const rows = await db.select().from(marketReferenceQuotes);
    const out = new Map<string, StoredReferenceQuote>();
    for (const r of rows) {
      const price = String(r.price);
      if (!(Number(price) > 0)) continue; // a zero or broken row is never shown
      out.set(`${r.source}|${r.ref}`, {
        source: r.source,
        ref: r.ref,
        instrumentId: r.instrumentId,
        price: trimZeros(price),
        currency: r.currency as StoredReferenceQuote["currency"],
        quantityUnit: r.quantityUnit,
        sourceUnitQuantity: r.sourceUnitQuantity,
        basis: r.basis,
        observedAt: new Date(r.observedAt).toISOString(),
        observedAtInferred: r.observedAtInferred,
        fetchedAt: new Date(r.fetchedAt).toISOString(),
        extra: (r.extra as Record<string, string> | null) ?? null,
      });
    }
    return out;
  } catch {
    return new Map();
  }
}

function trimZeros(value: string): string {
  return value.includes(".") ? value.replace(/0+$/, "").replace(/\.$/, "") : value;
}

export type SourceStatusView = {
  source: ReferenceSourceId;
  /** Persian name of the source, e.g. «BrsAPI — طلا و ارز». */
  label: string;
  disabledReason: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  backoffUntil: string | null;
  quotaExhaustedUntil: string | null;
  requestsToday: number;
  lastQuoteCount: number | null;
  lastRejectedCount: number | null;
  /** The last attempt failed after the last success — the source is unreachable now. */
  failing: boolean;
};

const SOURCE_LABELS: Record<ReferenceSourceId, string> = {
  "gold-api": "Gold API — اونس طلا و نقره",
  "brsapi:gold_currency": "BrsAPI — طلا، سکه و ارز",
  "brsapi:commodity": "BrsAPI — کامودیتی",
  "brsapi:tsetmc": "BrsAPI — بورس و فرابورس",
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** For the diagnostics panel: codes and times only — no key, no URL, no upstream text. */
export async function readSourceStatus(config: ReferenceConfig = readReferenceConfig(), now = new Date()): Promise<SourceStatusView[]> {
  let rows: Array<typeof marketSourceStatus.$inferSelect> = [];
  try {
    rows = await db.select().from(marketSourceStatus);
  } catch {
    rows = [];
  }
  const byId = new Map(rows.map((r) => [r.source, r]));
  const day = tehranDay(now);
  return REFERENCE_SOURCES.map((source) => {
    const r = byId.get(source);
    const lastSuccess = r?.lastSuccessAt ? new Date(r.lastSuccessAt).getTime() : 0;
    const lastError = r?.lastErrorAt ? new Date(r.lastErrorAt).getTime() : 0;
    return {
      source,
      label: SOURCE_LABELS[source],
      disabledReason: disabledReason(source, config),
      lastSuccessAt: iso(r?.lastSuccessAt),
      lastErrorAt: iso(r?.lastErrorAt),
      lastErrorCode: r?.lastErrorCode ?? null,
      backoffUntil: iso(r?.backoffUntil),
      quotaExhaustedUntil: iso(r?.quotaExhaustedUntil),
      requestsToday: r?.quotaDay === day ? r.requestsToday : 0,
      lastQuoteCount: r?.lastQuoteCount ?? null,
      lastRejectedCount: r?.lastRejectedCount ?? null,
      failing: lastError > lastSuccess,
    };
  });
}
