type Entry = {
  count: number;
  resetAt: number;
};

const limits = new Map<string, Entry>();

/**
 * In-memory sliding window rate limiter.
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
