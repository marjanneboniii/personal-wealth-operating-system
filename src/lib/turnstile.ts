const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; message: string };

/**
 * User-facing Persian messages for each distinct verification outcome.
 * Kept as a single source of truth so /login and /register stay consistent and
 * so a technical/provider detail is never leaked to the user (only logged).
 */
const MSG_MISSING = "لطفاً تأیید کنید که ربات نیستید.";
const MSG_UNAVAILABLE = "تأیید امنیتی در حال حاضر در دسترس نیست.";
const MSG_FAILED = "تأیید امنیتی ناموفق بود. لطفاً دوباره تلاش کنید.";
const MSG_EXPIRED = "تأیید امنیتی منقضی شده است. لطفاً دوباره تأیید کنید.";
const MSG_PROVIDER = "ارتباط با سرویس تأیید امنیتی برقرار نشد. لطفاً دوباره تلاش کنید.";

/**
 * Cloudflare's officially documented Turnstile **testing** keys.
 * https://developers.cloudflare.com/turnstile/troubleshooting/testing/
 *
 * These are NOT a bypass: the browser still renders a real Turnstile widget,
 * a real token is generated, and the server still POSTs that token to the real
 * `siteverify` endpoint. The only difference is that Cloudflare short-circuits
 * these documented dummy credentials to "always pass" so a developer without
 * Cloudflare account credentials can still exercise the complete token
 * generation + server verification flow on localhost.
 *
 * They are used ONLY outside production, and ONLY when the operator has not
 * configured real keys. In production, missing keys stay fail-closed.
 */
const DEV_TEST_SITE_KEY = "1x00000000000000000000AA"; // visible widget, always passes
const DEV_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA"; // always passes verification

/** Evaluated per-call (not memoized) so it reflects the current runtime env. */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolve the PUBLIC Turnstile site key.
 *
 * Safe to expose to the browser (site keys are public by design). Prefers the
 * operator-configured `NEXT_PUBLIC_TURNSTILE_SITE_KEY`; in non-production it
 * falls back to Cloudflare's documented test site key so the widget renders in
 * local development even before real credentials are provisioned.
 */
export function getTurnstileSiteKey(): string | undefined {
  const configured = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim();
  if (configured) return configured;
  return isProduction() ? undefined : DEV_TEST_SITE_KEY;
}

/**
 * Resolve the SERVER-ONLY Turnstile secret key. Never returned to the client.
 * Prefers the operator-configured `TURNSTILE_SECRET_KEY`; in non-production it
 * falls back to Cloudflare's documented test secret key so the server-side
 * verification actually runs against `siteverify` during local development.
 */
function getTurnstileSecret(): string | undefined {
  const configured = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (configured) return configured;
  return isProduction() ? undefined : DEV_TEST_SECRET_KEY;
}

/**
 * Safe diagnostic logging for the verification pipeline.
 *
 * Only non-sensitive facts are ever logged:
 *   - `tokenPresent` — whether the client submitted a captcha token (yes/no).
 *   - `secretConfigured` — whether a server secret key exists (yes/no).
 *   - `httpStatus` — the HTTP status Cloudflare's siteverify returned.
 *   - `errorCodes` — Cloudflare's documented error codes (e.g. timeout-or-duplicate).
 *   - `reason` — a generic failure classification (missing-token / no-secret /
 *     network / http-<status> / verify-failed).
 *
 * The secret value and the token value are NEVER logged or exposed.
 */
function logVerify(label: string, details: Record<string, string | number | null | undefined>): void {
  const safe: Record<string, string | number | null | undefined> = { ...details };
  // Belt-and-suspenders: drop any key that could carry a credential.
  for (const key of ["secret", "token", "response", "remoteip"]) {
    if (key in safe) safe[key] = "[redacted]";
  }
  const fields = Object.entries(safe)
    .map(([k, v]) => `${k}=${v === null || v === undefined ? "" : String(v)}`)
    .join(" ");
  console.error(`[turnstile] ${label}: ${fields}`);
}

/** Server-only Cloudflare verification. Tokens are validated during the auth request. */
export async function verifyTurnstile(token: string, remoteIp?: string | null): Promise<TurnstileResult> {
  const secret = getTurnstileSecret();
  if (!token) {
    logVerify("reject", { reason: "missing-token", tokenPresent: "no", secretConfigured: secret ? "yes" : "no" });
    return { ok: false, message: MSG_MISSING };
  }
  logVerify("verify", { tokenPresent: "yes", secretConfigured: secret ? "yes" : "no" });
  if (!secret) {
    // Fail-closed: production without a configured secret must refuse auth.
    logVerify("reject", { reason: "no-secret", tokenPresent: "yes", secretConfigured: "no" });
    return { ok: false, message: MSG_UNAVAILABLE };
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      // The provider was reachable but returned an unexpected HTTP status —
      // classify as a provider/network problem, not a user verification failure.
      logVerify("reject", { reason: `http-${response.status}`, httpStatus: response.status, tokenPresent: "yes", secretConfigured: "yes" });
      return { ok: false, message: MSG_PROVIDER };
    }
    const result = (await response.json()) as { success?: boolean; "error-codes"?: string[] };
    if (result.success) {
      logVerify("ok", { httpStatus: response.status, tokenPresent: "yes", secretConfigured: "yes" });
      return { ok: true };
    }
    const errorCodes = Array.isArray(result["error-codes"]) ? result["error-codes"] : [];
    logVerify("reject", {
      reason: "verify-failed",
      httpStatus: response.status,
      errorCodes: errorCodes.length ? errorCodes.join(",") : null,
      tokenPresent: "yes",
      secretConfigured: "yes",
    });
    // Cloudflare returns `timeout-or-duplicate` when a token has already been
    // consumed or has expired — that is a distinct, recoverable state the user
    // resolves by re-verifying, not a hard failure.
    if (errorCodes.includes("timeout-or-duplicate")) {
      return { ok: false, message: MSG_EXPIRED };
    }
    return { ok: false, message: MSG_FAILED };
  } catch (error) {
    // fetch threw: timeout (AbortError / TimeoutError) or a transport error —
    // i.e. we could not reach the verification provider at all.
    const reason = error instanceof Error && error.name ? error.name : "unknown";
    logVerify("reject", { reason, tokenPresent: "yes", secretConfigured: "yes" });
    return { ok: false, message: MSG_PROVIDER };
  }
}
