type TurnstileResponse = { success?: boolean };

/** Verify Cloudflare Turnstile on the server. Production fails closed. */
export async function verifyBotChallenge(token: unknown, ip?: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY?.trim();
  if (!secret) return process.env.NODE_ENV !== "production";
  if (typeof token !== "string" || token.length < 10 || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, cache: "no-store",
    });
    if (!response.ok) return false;
    return ((await response.json()) as TurnstileResponse).success === true;
  } catch { return false; }
}
