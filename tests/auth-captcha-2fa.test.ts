import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getTurnstileSiteKey, getTurnstileWidgetSiteKey, isTurnstileConfigured, verifyTurnstile } from "../src/lib/turnstile";
import { decryptTotpSecret, encryptTotpSecret, normalizeOtp, readChallenge, signChallenge, verifyTotp } from "../src/lib/totp";

test("CAPTCHA — missing token is rejected without a network request (when configured)", async () => {
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "site-key";
  process.env.TURNSTILE_SECRET_KEY = "server-secret";
  try {
    assert.equal((await verifyTurnstile("")).ok, false);
  } finally {
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("CAPTCHA — development falls back to Cloudflare test keys (widget renders, no bypass)", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;
  try {
    // Simulate a fresh dev machine with no Turnstile credentials configured.
    (process.env as Record<string, string>).NODE_ENV = "development";
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;

    // The public site key is present so the widget renders instead of showing
    // «تأیید امنیتی در حال حاضر در دسترس نیست.».
    assert.equal(getTurnstileSiteKey(), "1x00000000000000000000AA");

    // The server still POSTs the token to the real siteverify endpoint with the
    // dev test SECRET — verification is exercised end to end (no fake pass flag).
    let sentSecret: string | null = null;
    global.fetch = (async (_url: unknown, init: RequestInit) => {
      sentSecret = String((init.body as URLSearchParams).get("secret"));
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;
    const result = await verifyTurnstile("dev-token");
    assert.equal(result.ok, true);
    assert.equal(sentSecret, "1x0000000000000000000000000000000AA");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
    if (originalSite === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSite;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    global.fetch = originalFetch;
  }
});

test("CAPTCHA — production without keys degrades gracefully instead of locking users out", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSiteAlias = process.env.TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalRequired = process.env.TURNSTILE_REQUIRED;
  const originalFetch = global.fetch;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_REQUIRED;

    // No widget is offered to the browser…
    assert.equal(getTurnstileSiteKey(), undefined);
    assert.equal(getTurnstileWidgetSiteKey(), undefined);
    assert.equal(isTurnstileConfigured(), false);

    // …so the step is skipped rather than refusing every login/registration,
    // and no request is made to the provider.
    global.fetch = (async () => {
      throw new Error("siteverify must not be called when Turnstile is unconfigured");
    }) as typeof fetch;
    assert.equal((await verifyTurnstile("")).ok, true);
  } finally {
    (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
    if (originalSite === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSite;
    if (originalSiteAlias === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSiteAlias;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    if (originalRequired === undefined) delete process.env.TURNSTILE_REQUIRED;
    else process.env.TURNSTILE_REQUIRED = originalRequired;
    global.fetch = originalFetch;
  }
});

test("CAPTCHA — TURNSTILE_REQUIRED=true restores strict fail-closed behaviour", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSiteAlias = process.env.TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalRequired = process.env.TURNSTILE_REQUIRED;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    process.env.TURNSTILE_REQUIRED = "true";
    const result = await verifyTurnstile("any-token");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "تأیید امنیتی در حال حاضر در دسترس نیست.");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
    if (originalSite === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSite;
    if (originalSiteAlias === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSiteAlias;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
    if (originalRequired === undefined) delete process.env.TURNSTILE_REQUIRED;
    else process.env.TURNSTILE_REQUIRED = originalRequired;
  }
});

test("CAPTCHA — site key configured under the non-public name is honored (NEXT_PUBLIC_ not required)", () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSiteAlias = process.env.TURNSTILE_SITE_KEY;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    process.env.TURNSTILE_SITE_KEY = "0x4AAAAAAEi9TyCQb-kc837g";
    assert.equal(getTurnstileSiteKey(), "0x4AAAAAAEi9TyCQb-kc837g");
    // The public name still wins when both are present.
    process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = "public-wins";
    assert.equal(getTurnstileSiteKey(), "public-wins");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
    if (originalSite === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSite;
    if (originalSiteAlias === undefined) delete process.env.TURNSTILE_SITE_KEY;
    else process.env.TURNSTILE_SITE_KEY = originalSiteAlias;
  }
});

test("CAPTCHA — invalid/expired token is rejected and valid token proceeds", async () => {
  process.env.TURNSTILE_SECRET_KEY = "server-secret";
  const original = global.fetch;
  global.fetch = (async (_url: unknown, init: RequestInit) => {
    const token = String((init.body as URLSearchParams).get("response"));
    return new Response(JSON.stringify({ success: token === "valid-single-use-token" }), { status: 200 });
  }) as typeof fetch;
  try {
    assert.equal((await verifyTurnstile("invalid-or-expired")).ok, false);
    assert.equal((await verifyTurnstile("valid-single-use-token")).ok, true);
  } finally {
    global.fetch = original;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("CAPTCHA — an expired/duplicate token maps to the distinct re-verify message", async () => {
  process.env.TURNSTILE_SECRET_KEY = "server-secret";
  const original = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ success: false, "error-codes": ["timeout-or-duplicate"] }), { status: 200 })
  ) as typeof fetch;
  try {
    const result = await verifyTurnstile("expired-token");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "تأیید امنیتی منقضی شده است. لطفاً دوباره تأیید کنید.");
  } finally {
    global.fetch = original;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("CAPTCHA — a network/provider failure maps to the distinct connectivity message", async () => {
  process.env.TURNSTILE_SECRET_KEY = "server-secret";
  const original = global.fetch;
  // fetch throws — provider unreachable / request aborted.
  global.fetch = (async () => { throw new Error("network down"); }) as typeof fetch;
  try {
    const result = await verifyTurnstile("some-token");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "ارتباط با سرویس تأیید امنیتی برقرار نشد. لطفاً دوباره تلاش کنید.");
  } finally {
    global.fetch = original;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("CAPTCHA — a non-OK HTTP status maps to the connectivity message (provider problem)", async () => {
  process.env.TURNSTILE_SECRET_KEY = "server-secret";
  const original = global.fetch;
  global.fetch = (async () => new Response("upstream error", { status: 502 })) as typeof fetch;
  try {
    const result = await verifyTurnstile("some-token");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "ارتباط با سرویس تأیید امنیتی برقرار نشد. لطفاً دوباره تلاش کنید.");
  } finally {
    global.fetch = original;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("CAPTCHA — a generic verification failure still maps to the retry message", async () => {
  process.env.TURNSTILE_SECRET_KEY = "server-secret";
  const original = global.fetch;
  global.fetch = (async () =>
    new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 })
  ) as typeof fetch;
  try {
    const result = await verifyTurnstile("bad-token");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "تأیید امنیتی ناموفق بود. لطفاً دوباره تلاش کنید.");
  } finally {
    global.fetch = original;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});

test("TOTP — Persian digits normalize and invalid codes are rejected", () => {
  assert.equal(normalizeOtp("۱۲۳۴۵۶"), "123456");
  assert.equal(verifyTotp("JBSWY3DPEHPK3PXP", "000000", 0), false);
});

test("TOTP — standard RFC-compatible SHA1 code verifies", () => {
  // Base32 for the RFC 6238 SHA1 test secret; at 59 seconds the 6-digit suffix is 287082.
  assert.equal(verifyTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", "۲۸۷۰۸۲", 59_000), true);
});

test("TOTP — secrets and partial-login challenges are authenticated and encrypted", () => {
  process.env.TOTP_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
  const encrypted = encryptTotpSecret("JBSWY3DPEHPK3PXP");
  assert.equal(encrypted.includes("JBSWY3DPEHPK3PXP"), false);
  assert.equal(decryptTotpSecret(encrypted), "JBSWY3DPEHPK3PXP");
  const challenge = signChallenge("user-id", Date.now() + 60_000);
  assert.equal(readChallenge(challenge), "user-id");
  assert.equal(readChallenge(`${challenge}tampered`), null);
  delete process.env.TOTP_ENCRYPTION_KEY;
});

test("CAPTCHA — verification diagnostics are logged safely and never include the secret", async () => {
  process.env.TURNSTILE_SECRET_KEY = "super-secret-value-xyz";
  const original = global.fetch;
  const originalError = console.error;
  const lines: string[] = [];
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  global.fetch = (async () =>
    new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 })
  ) as typeof fetch;
  try {
    const result = await verifyTurnstile("some-token");
    assert.equal(result.ok, false);
    const joined = lines.join("\n");
    assert.equal(joined.includes("super-secret-value-xyz"), false);
    assert.equal(joined.includes("some-token"), false);
    assert.match(joined, /secretConfigured=yes/);
    assert.match(joined, /errorCodes=invalid-input-response/);
    assert.match(joined, /reason=verify-failed/);
  } finally {
    global.fetch = original;
    console.error = originalError;
    delete process.env.TURNSTILE_SECRET_KEY;
  }
});
