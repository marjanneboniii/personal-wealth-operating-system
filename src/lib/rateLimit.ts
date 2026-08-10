import crypto from "node:crypto";

type Entry = {
  count: number;
  resetAt: number;
};

const limits = new Map<string, Entry>();

/**
 * Hard cap on tracked keys so the in-memory limiter cannot grow unbounded
 * (memory-exhaustion DoS via attacker-controlled keys). When the cap is
 * reached, expired entries are evicted first; if the map is still too large,
 * the oldest-resetting entries are dropped. Dropping an entry only grants the
 * caller a fresh (still limited) window — it never fails open permanently.
 */
const MAX_TRACKED_KEYS = 20000;

function evictIfNeeded(now: number): void {
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

/**
 * In-memory sliding window rate limiter.
 *
 * NOTE: In-memory state is per-process. Multi-instance deployments should put
 * a shared store (e.g. Redis) in front of authentication endpoints; this
 * limiter is deliberately kept OUT of the accounting core and only guards
 * auth-facing entry points.
 *
 * Windows always expire, so a rate limit can never cause a permanent lockout.
 *
 * @param key unique identifier (IP, username, or action name)
 * @param maxAttempts maximum attempts allowed in window
 * @param windowSeconds length of window in seconds
 * @returns { ok: boolean, remaining: number }
 */
export function checkRateLimit(
  key: string,
  maxAttempts: number = 10,
  windowSeconds: number = 60
): { ok: boolean; remaining: number } {
  const now = Date.now();
  evictIfNeeded(now);
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
}

export function resetRateLimit(key: string): void {
  limits.delete(key);
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
