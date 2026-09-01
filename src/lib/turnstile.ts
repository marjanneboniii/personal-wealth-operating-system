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
 * Is CAPTCHA a hard requirement?
 *
 * Historically the answer was "always in production", which meant a deployment
 * without Turnstile credentials locked every user out of /login and /register
 * with «تأیید امنیتی در حال حاضر در دسترس نیست.» — the CAPTCHA became a denial
 * of service against the legitimate owner rather than a defense.
 *
 * New behaviour:
 *   - Keys configured  → CAPTCHA is rendered and STRICTLY enforced (unchanged).
 *   - Keys NOT configured → the CAPTCHA step is skipped (the widget is hidden
 *     instead of showing an error) and auth proceeds on the remaining
 *     protections: per-username and per-IP rate limiting, password policy,
 *     hashed credentials and optional TOTP two-factor.
 *   - Operators who want the old strict behaviour set TURNSTILE_REQUIRED=true;
 *     then a missing/failed CAPTCHA refuses authentication as before.
 */
function isTurnstileRequired(): boolean {
  return process.env.TURNSTILE_REQUIRED?.trim().toLowerCase() === "true";
}

/**
 * True when a real (or dev-fallback) credential pair exists, i.e. the widget
 * can be rendered AND the token can actually be verified server-side.
 */
export function isTurnstileConfigured(): boolean {
  return Boolean(getTurnstileSiteKey() && getTurnstileSecret());
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
  // Site keys are public by design. We read the key server-side and pass it to
  // the client widget as a prop, so a value set under the non-public name
  // (`TURNSTILE_SITE_KEY`) also works without being inlined by Next.js. This
  // guards against the common misconfiguration of omitting the `NEXT_PUBLIC_`
  // prefix, which otherwise leaves the widget in the "unavailable" state.
  const configured = (process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || process.env.TURNSTILE_SITE_KEY?.trim());
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
  const siteKey = getTurnstileSiteKey();

  // ── Not configured ────────────────────────────────────────────────────────
  // No usable credential pair: there is no widget in the browser, so the user
  // cannot possibly produce a token. Blocking here would lock everyone out of
  // their own account. Skip the step (unless the operator opted into strict
  // mode) and record it, so the situation is visible in the logs.
  if (!secret || !siteKey) {
    if (isTurnstileRequired()) {
      logVerify("reject", {
        reason: "not-configured-strict",
        tokenPresent: token ? "yes" : "no",
        secretConfigured: secret ? "yes" : "no",
        siteKeyConfigured: siteKey ? "yes" : "no",
      });
      return { ok: false, message: MSG_UNAVAILABLE };
    }
    logVerify("skip", {
      reason: "not-configured",
      secretConfigured: secret ? "yes" : "no",
      siteKeyConfigured: siteKey ? "yes" : "no",
      note: "captcha disabled; rate-limiting and 2FA still apply",
    });
    return { ok: true };
  }

  // ── Configured → strict enforcement (unchanged behaviour) ─────────────────
  if (!token) {
    logVerify("reject", { reason: "missing-token", tokenPresent: "no", secretConfigured: "yes" });
    return { ok: false, message: MSG_MISSING };
  }
  logVerify("verify", { tokenPresent: "yes", secretConfigured: "yes" });

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

/**
 * Site key to hand to the browser widget.
 *
 * Returns the key ONLY when the server can also verify the resulting token
 * (i.e. a secret exists). A half-configured deployment would otherwise render a
 * challenge whose token is never checked — confusing UI for zero security.
 */
export function getTurnstileWidgetSiteKey(): string | undefined {
  return isTurnstileConfigured() ? getTurnstileSiteKey() : undefined;
}
