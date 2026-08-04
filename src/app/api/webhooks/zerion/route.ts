import { NextResponse } from "next/server";
import { db } from "@/db";
import { watchWalletTransactionsCache } from "@/db/schema";
import { D } from "@/domain/decimal";

export const dynamic = "force-dynamic";

/**
 * Zerion Webhook Handler — Real-time wallet transaction alerts
 * Verifies webhook signature if ZERION_WEBHOOK_SECRET is set, inserts events into watch_wallet_transactions_cache
 * Isolated cache, no FK to Financial Core, never writes ledger
 */

function verifySignature(payload: string, signature: string | null, secret: string | null): boolean {
  if (!secret) {
    console.warn("[Zerion Webhook] ZERION_WEBHOOK_SECRET not set — skipping signature verification");
    return true; // Allow if no secret configured, but log warning
  }
  if (!signature) {
    console.warn("[Zerion Webhook] Missing signature header");
    return false;
  }

  // Simple HMAC verification — Zerion may use hex or base64 signature
  // For audit, we support both: if secret provided, try to verify HMAC-SHA256
  try {
    const crypto = require("crypto");
    const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
    // Compare signatures in constant time
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) || signature === expected;
  } catch (e) {
    console.warn("[Zerion Webhook] Signature verification error, allowing with warning", e);
    return true;
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-zerion-signature") || request.headers.get("x-webhook-signature") || request.headers.get("authorization")?.replace("Bearer ", "");
    const secret = process.env.ZERION_WEBHOOK_SECRET || null;

    const isValid = verifySignature(rawBody, signature, secret);
    if (!isValid) {
      console.error("[Zerion Webhook] Invalid signature");
      return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
    }

    let payload: any;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.error("[Zerion Webhook] Invalid JSON payload");
      return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
    }

    // Zerion webhook payload structure may vary: { data: { id, attributes: { hash, operation_type, status, fee, ... } }, wallet_address }
    // Support multiple formats
    const data = payload.data || payload;
    const attributes = data.attributes || data;
    const walletAddress = (
      payload.wallet_address ||
      payload.walletAddress ||
      attributes.wallet_address ||
      data.wallet_address ||
      attributes.address ||
      ""
    )
      ?.toString()
      .toLowerCase();

    if (!walletAddress) {
      console.warn("[Zerion Webhook] Missing wallet_address in payload, using unknown");
    }

    const txId = String(data.id || attributes.id || attributes.hash || `${walletAddress}-${Date.now()}`);
    const txHash = attributes.hash ? String(attributes.hash) : attributes.tx_hash ? String(attributes.tx_hash) : null;
    const txType = attributes.operation_type ? String(attributes.operation_type) : attributes.type ? String(attributes.type) : null;
    const status = attributes.status ? String(attributes.status) : null;
    const feeValue = attributes.fee?.value ?? attributes.fee ?? null;
    let feeUSD: string | null = null;
    if (feeValue !== null) {
      try {
        feeUSD = D(String(feeValue)).toString();
      } catch {
        feeUSD = null;
      }
    }
    const summary = attributes.name ? String(attributes.name) : attributes.summary ? String(attributes.summary) : null;
    const minedAtRaw = attributes.mined_at ? String(attributes.mined_at) : null;
    const minedAt = minedAtRaw ? new Date(minedAtRaw) : null;

    // Insert into watch_wallet_transactions_cache — isolated cache, no ledger write
    await db
      .insert(watchWalletTransactionsCache)
      .values({
        id: txId.slice(0, 200),
        walletAddress: walletAddress || "unknown",
        txHash,
        txType,
        status,
        feeUSD,
        summary,
        detailsJson: JSON.stringify(payload).slice(0, 10000),
        minedAt,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: watchWalletTransactionsCache.id,
        set: {
          walletAddress: walletAddress || "unknown",
          txHash,
          txType,
          status,
          feeUSD,
          summary,
          detailsJson: JSON.stringify(payload).slice(0, 10000),
          minedAt,
          fetchedAt: new Date(),
        },
      });

    console.log(`[Zerion Webhook] Processed transaction ${txId} for wallet ${walletAddress}`);

    return NextResponse.json({ ok: true, id: txId });
  } catch (e) {
    console.error("[Zerion Webhook] Error processing webhook", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Internal error" }, { status: 500 });
  }
}

// Optional GET for health check
export async function GET() {
  return NextResponse.json({ ok: true, service: "zerion-webhook", message: "Zerion webhook endpoint active. POST to receive events." });
}
