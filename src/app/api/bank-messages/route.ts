import { NextResponse } from "next/server";
import { hashSmsToken, receiveSms, smsPayloadSchema, SmsError } from "@/features/bankImport/sms";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";
const respond = (body: object, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  try {
    /*
     * Two buckets, and the order matters.
     *
     * The per-connection bucket below is keyed by the token, so a caller that
     * rotates through freshly invented tokens gets a brand-new allowance for
     * each one. Every such request still reaches receiveSms, which opens a
     * transaction and takes `SELECT … FOR UPDATE` before it can discover the
     * token is unknown — so an unauthenticated client could drive database
     * work at will. Guessing a token is not the risk (they are 256-bit); the
     * cost of being told "no" is.
     *
     * A per-IP bucket is therefore checked FIRST, before the token is hashed
     * and before anything touches the database. It is deliberately loose: a
     * household syncing several phones through one NAT should never see it,
     * while a single source cannot keep the connection lookup busy.
     */
    const ip = getClientIp(request);
    if (!(await checkRateLimit(`bank-sms-ip:${ip}`, 240, 60)).ok) {
      return respond({ ok: false, error: "RATE_LIMITED" }, 429);
    }

    const authorization = request.headers.get("authorization") || "";
    const match = authorization.match(/^Bearer (tzsms_[A-Za-z0-9_-]{43})$/);
    if (!match) return respond({ ok: false, error: "INVALID_CONNECTION" }, 401);
    if (!(await checkRateLimit(`bank-sms:${hashSmsToken(match[1])}`, 60, 60)).ok) return respond({ ok: false, error: "RATE_LIMITED" }, 429);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return respond({ ok: false, error: "JSON_REQUIRED" }, 415);
    const reader = request.body?.getReader();
    if (!reader) return respond({ ok: false, error: "INVALID_PAYLOAD" }, 400);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 32_768) { await reader.cancel(); return respond({ ok: false, error: "PAYLOAD_TOO_LARGE" }, 413); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    let input: unknown;
    try { input = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { return respond({ ok: false, error: "INVALID_PAYLOAD" }, 400); }
    const parsed = smsPayloadSchema.safeParse(input);
    if (!parsed.success) return respond({ ok: false, error: "INVALID_PAYLOAD" }, 400);
    const result = await receiveSms(match[1], parsed.data);
    return respond({ ok: true, ...result }, 202);
  } catch (error) {
    if (error instanceof SmsError) return respond({ ok: false, error: error.code }, error.status);
    // Never log bank messages, bearer tokens, or driver errors containing parameters.
    return respond({ ok: false, error: "SERVICE_UNAVAILABLE" }, 503);
  }
}
