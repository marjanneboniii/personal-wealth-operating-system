const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileResult = { ok: true } | { ok: false; message: string };

/** Server-only Cloudflare verification. Tokens are validated during the auth request. */
export async function verifyTurnstile(token: string, remoteIp?: string | null): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!token) return { ok: false, message: "لطفاً تأیید کنید که ربات نیستید." };
  if (!secret) return { ok: false, message: "تأیید امنیتی در حال حاضر در دسترس نیست." };

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set("remoteip", remoteIp);
    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return { ok: false, message: "تأیید امنیتی ناموفق بود. لطفاً دوباره تلاش کنید." };
    const result = (await response.json()) as { success?: boolean };
    return result.success
      ? { ok: true }
      : { ok: false, message: "تأیید امنیتی ناموفق بود. لطفاً دوباره تلاش کنید." };
  } catch {
    return { ok: false, message: "تأیید امنیتی ناموفق بود. لطفاً دوباره تلاش کنید." };
  }
}
