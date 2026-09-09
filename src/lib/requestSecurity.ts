/** Reject cross-origin browser mutations. System-token API clients are exempt. */
export function isTrustedMutation(request: Request): boolean {
  if (request.headers.get("x-pwos-auth") || request.headers.get("authorization")?.startsWith("Bearer ")) return true;
  const origin = request.headers.get("origin");
  if (origin) {
    try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  // Non-browser API clients and unit tests do not send Fetch Metadata. A
  // browser cross-site mutation does, and is rejected above/below.
  return !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
}

export function boundedLimit(request: Request, fallback = 50, maximum = 100): number {
  const raw = Number(new URL(request.url).searchParams.get("limit") ?? fallback);
  return Number.isInteger(raw) && raw > 0 ? Math.min(raw, maximum) : fallback;
}
