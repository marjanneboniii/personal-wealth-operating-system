import crypto from "node:crypto";
import type { RedisClientType } from "redis";

/**
 * Rate limiting for AUTH-FACING entry points only (login/register/OAuth).
 * It is deliberately kept OUT of the accounting core.
 *
 * Storage is modular:
 *
 *  1. Default — in-memory Map (per-process). Zero configuration, used in
 *     local development and `memory://` tests. Windows always expire, so a
 *     rate limit can never cause a permanent lockout.
 *  2. Redis — when `REDIS_URL` is defined, counters live in a shared store
 *     using an atomic fixed-window counter (one Lua script per check), so N
 *     pods/containers enforce ONE limit instead of N independent ones.
 *
 * Graceful fallback: if Redis is unreachable, misconfigured, or fails at
 * runtime, the module transparently degrades to the in-memory Map — the
 * limiter never throws and never takes the auth flow down. The client is
 * created lazily and the connection is attempted in the background, so a
 * stale `REDIS_URL` cannot add latency (or errors) to a request.
 *
 * NOTE: `checkRateLimit` is async because a shared Redis round-trip is
 * inherently asynchronous. The in-memory path resolves immediately.
 */

export type RateLimitResult = { ok: boolean; remaining: number };

/* ------------------------------------------------------------------ *
 * In-memory storage (default + fallback)
 * ------------------------------------------------------------------ */

type Entry = {
  count: number;
  resetAt: number;
};

/**
 * Hard cap on tracked keys so the in-memory limiter cannot grow unbounded
 * (memory-exhaustion DoS via attacker-controlled keys). When the cap is
 * reached, expired entries are evicted first; if the map is still too large,
 * the oldest-resetting entries are dropped. Dropping an entry only grants the
 * caller a fresh (still limited) window — it never fails open permanently.
 */
const MAX_TRACKED_KEYS = 20000;

function evictIfNeeded(limits: Map<string, Entry>, now: number): void {
  if (limits.size < MAX_TRACKED_KEYS) return;
  for (const [key, entry] of limits) {
    if (entry.resetAt <= now) limits.delete(key);
  }
  if (limits.size < MAX_TRACKED_KEYS) return;
  // Still over the cap: drop entries with the earliest reset time.
  const sorted = [...limits.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  const dropCount = limits.size - MAX_TRACKED_KEYS + 1;
  for (let i = 0; i < dropCount && i < sorted.length; i++) {
    limits.delete(sorted[i][0]);
  }
}

type RateLimitBackend = {
  readonly kind: "memory" | "redis";
  check(key: string, maxAttempts: number, windowSeconds: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
};

function createMemoryBackend(): RateLimitBackend {
  const limits = new Map<string, Entry>();
  return {
    kind: "memory",
    async check(key, maxAttempts, windowSeconds): Promise<RateLimitResult> {
      const now = Date.now();
      evictIfNeeded(limits, now);
      const existing = limits.get(key);

      if (!existing || existing.resetAt <= now) {
        limits.set(key, {
          count: 1,
          resetAt: now + windowSeconds * 1000,
        });
        return { ok: true, remaining: maxAttempts - 1 };
      }

      if (existing.count >= maxAttempts) {
        return { ok: false, remaining: 0 };
      }

      existing.count += 1;
      return { ok: true, remaining: maxAttempts - existing.count };
    },
    async reset(key): Promise<void> {
      limits.delete(key);
    },
  };
}

const memoryBackend = createMemoryBackend();

/* ------------------------------------------------------------------ *
 * Redis storage (optional, shared across instances)
 * ------------------------------------------------------------------ */

/**
 * Fixed-window counter anchored at the FIRST hit in the window (parity with
 * the in-memory backend: a window starts at the first request and expires
 * `windowSeconds` later; the TTL is never refreshed by later hits). Executed
 * atomically so concurrent pods can never double-count a window.
 */
const FIXED_WINDOW_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return count
`;

const REDIS_KEY_PREFIX = "pwos:rl:";
const REDIS_CONNECT_TIMEOUT_MS = 2_000;
const REDIS_COMMAND_TIMEOUT_MS = 3_000;
/** Cooldown between re-connect attempts while Redis is down. */
const REDIS_RETRY_INTERVAL_MS = 10_000;

function redisUrl(): string | null {
  const url = process.env.REDIS_URL?.trim();
  return url ? url : null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Redis ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Lazy Redis coordinator (module-level state).
 *
 * The client is only ever created when REDIS_URL is set, and the connect
 * attempt happens in the background on first use — a request never waits on
 * Redis to become available. Every failure path degrades to the in-memory
 * backend and logs once (best-effort), never throws to the caller.
 */
let readyRedisClient: Promise<RedisClientType | null> | null = null;
let lastRedisAttemptAt = 0;
let redisWarned = false;

function warnOnce(message: string): void {
  if (redisWarned) return;
  redisWarned = true;
  try {
    console.warn(`[pwos:rate-limit] ${message}`);
  } catch {
    // logging must never throw
  }
}

function markRedisDown(error: unknown, op: string): void {
  readyRedisClient = null;
  warnOnce(
    `Redis rate-limit ${op} failed (${error instanceof Error ? error.message : String(error)}); ` +
      "falling back to the in-memory rate-limit store.",
  );
}

/** Starts a background connect attempt (throttled by REDIS_RETRY_INTERVAL_MS). */
function startRedisConnect(): void {
  if (!redisUrl() || readyRedisClient) return;
  const now = Date.now();
  if (now - lastRedisAttemptAt < REDIS_RETRY_INTERVAL_MS) return;
  lastRedisAttemptAt = now;

  readyRedisClient = (async () => {
    const { createClient } = await import("redis");
    const client = createClient({
      url: redisUrl() ?? undefined,
      socket: {
        connectTimeout: REDIS_CONNECT_TIMEOUT_MS,
        // No infinite reconnect loop: a dead Redis must fail fast so the
        // limiter falls back to memory instead of queueing commands forever.
        reconnectStrategy: false,
      },
    });

    // Without an 'error' listener the client would crash the process on
    // connection loss. Once attached, a connect/IO failure surfaces through
    // connect()/commands and is handled by the callers below.
    client.on("error", () => {
      /* handled through command/connect failures */
    });

    try {
      const redisUrlValue = redisUrl();
      if (!redisUrlValue) return null;
      await withTimeout(client.connect(), REDIS_CONNECT_TIMEOUT_MS, "connect");
      return client as RedisClientType;
    } catch (error) {
      try {
        await client.quit();
      } catch {
        /* client may already be closed */
      }
      warnOnce(
        `Redis at ${redisUrl()} unavailable (${error instanceof Error ? error.message : String(error)}); ` +
          "falling back to the in-memory rate-limit store.",
      );
      return null;
    }
  })();
}

function redisBackend(): RateLimitBackend {
  if (!redisUrl()) {
    if (process.env.NODE_ENV === "production") {
      return {
        kind: "memory",
        async check() { return { ok: false, remaining: 0 }; },
        async reset() {},
      };
    }
    return memoryBackend;
  }

  // No live connection yet (not attempted, still connecting, or previously
  // failed): answer from the in-memory store right away and re-arm the
  // background connect attempt. No request ever blocks on Redis.
  startRedisConnect();
  const ready = readyRedisClient;
  if (!ready) return memoryBackend;

  return {
    kind: "redis",
    async check(key, maxAttempts, windowSeconds): Promise<RateLimitResult> {
      try {
        const client = await withTimeout(ready, REDIS_CONNECT_TIMEOUT_MS, "acquire");
        if (!client) {
          return process.env.NODE_ENV === "production"
            ? { ok: false, remaining: 0 }
            : memoryBackend.check(key, maxAttempts, windowSeconds);
        }
        const count = (await withTimeout(
          client.eval(FIXED_WINDOW_LUA, {
            keys: [`${REDIS_KEY_PREFIX}${key}`],
            arguments: [String(windowSeconds * 1000)],
          }) as Promise<number>,
          REDIS_COMMAND_TIMEOUT_MS,
          "command",
        )) as number;
        if (typeof count !== "number" || !Number.isFinite(count)) {
          throw new Error(`Unexpected Redis INCR reply: ${String(count)}`);
        }
        if (count > maxAttempts) return { ok: false, remaining: 0 };
        return { ok: true, remaining: maxAttempts - count };
      } catch (error) {
        // Transient command/connection failure -> degrade for this call and
        // clear the client so the next call re-arms a fresh connect.
        markRedisDown(error, "check");
        return process.env.NODE_ENV === "production"
          ? { ok: false, remaining: 0 }
          : memoryBackend.check(key, maxAttempts, windowSeconds);
      }
    },
    async reset(key): Promise<void> {
      try {
        const client = await withTimeout(ready, REDIS_CONNECT_TIMEOUT_MS, "acquire");
        if (client) {
          await withTimeout(
            client.del(`${REDIS_KEY_PREFIX}${key}`) as Promise<number>,
            REDIS_COMMAND_TIMEOUT_MS,
            "command",
          );
          return;
        }
      } catch (error) {
        markRedisDown(error, "reset");
      }
      return memoryBackend.reset(key);
    },
  };
}

/**
 * Which backend will serve the next check: "redis" when a Redis connection is
 * live, "memory" otherwise (unset REDIS_URL, still connecting, or graceful
 * fallback). Exposed for observability/tests.
 */
export function getRateLimitBackend(): "memory" | "redis" {
  if (!redisUrl()) return "memory";
  startRedisConnect();
  return readyRedisClient ? "redis" : "memory";
}

/* ------------------------------------------------------------------ *
 * Public API
 * ------------------------------------------------------------------ */

/**
 * Fixed-window rate limiter with modular storage.
 *
 * @param key unique identifier (IP, username, or action name)
 * @param maxAttempts maximum attempts allowed in window
 * @param windowSeconds length of window in seconds
 * @returns `{ ok, remaining }` — never throws. Windows always expire.
 */
export async function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowSeconds: number = 60,
): Promise<RateLimitResult> {
  const backend = redisBackend();
  return backend.check(key, maxAttempts, windowSeconds);
}

/** Clears the counter for `key` (used after a successful login/claim). */
export async function resetRateLimit(key: string): Promise<void> {
  const backend = redisBackend();
  return backend.reset(key);
}

/**
 * Extracts the client IP from a Request (API route handler).
 * Used only as a rate-limiting key — never for authorization decisions.
 */
export function getClientIp(request: Request): string {
  try {
    const xff = request.headers.get("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = request.headers.get("x-real-ip");
    if (realIp && realIp.trim()) return realIp.trim();
  } catch {}
  return "unknown";
}

/**
 * Best-effort client IP for Server Actions (reads Next.js request headers).
 * Returns null when unavailable (e.g. outside a request context / tests);
 * callers must degrade gracefully and never fail open or closed on this alone.
 */
export async function getRequestIp(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const xff = h.get?.("x-forwarded-for");
    if (xff) {
      const first = xff.split(",")[0]?.trim();
      if (first) return first;
    }
    const realIp = h.get?.("x-real-ip");
    if (realIp && realIp.trim()) return realIp.trim();
  } catch {}
  return null;
}

/**
 * Constant-time string comparison (safe for differing lengths).
 * Used for secret/token equality checks such as PWOS_AUTH_TOKEN.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
