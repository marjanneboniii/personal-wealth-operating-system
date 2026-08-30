import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getTurnstileSiteKey, verifyTurnstile } from "../src/lib/turnstile";
import { decryptTotpSecret, encryptTotpSecret, normalizeOtp, readChallenge, signChallenge, verifyTotp } from "../src/lib/totp";

test("CAPTCHA — missing token is rejected without a network request", async () => {
  assert.equal((await verifyTurnstile("")).ok, false);
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

test("CAPTCHA — production stays fail-closed when keys are unset (no dev fallback)", async () => {
  const originalEnv = process.env.NODE_ENV;
  const originalSite = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  try {
    (process.env as Record<string, string>).NODE_ENV = "production";
    delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    delete process.env.TURNSTILE_SECRET_KEY;
    assert.equal(getTurnstileSiteKey(), undefined);
    const result = await verifyTurnstile("any-token");
    assert.equal(result.ok, false);
    assert.equal(result.ok === false && result.message, "تأیید امنیتی در حال حاضر در دسترس نیست.");
  } finally {
    (process.env as Record<string, string>).NODE_ENV = originalEnv as string;
    if (originalSite === undefined) delete process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
    else process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = originalSite;
    if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
    else process.env.TURNSTILE_SECRET_KEY = originalSecret;
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
