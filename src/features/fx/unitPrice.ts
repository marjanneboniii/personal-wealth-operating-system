/**
 * Native unit price — single authoritative conversion for ledger quantities.
 *
 * PURPOSE
 * -------
 * Convert a base-currency (USD) amount into NATIVE account units for ledger
 * postings. This is the ONE place that decides the USD value of one native
 * unit of an asset, so every write path (expense, income, debt repayment,
 * transfer, buy, sell, installment settlement, planned execution) derives
 * quantities from the SAME rule.
 *
 * FX / MARKET-PRICE SEPARATION
 * ----------------------------
 * A) User FX rate (per-user valuation setting, authoritative source:
 *    `user_fx_settings.currentRate` via `getLatestUsdIrtRateForUser`).
 *      1 native IRT unit = 1 Toman  →  unit USD = 1 / userRate.
 *      prices.IRT is NEVER used for this — the old `prices.IRT = 0.00001`
 *      convention is not an FX authority.
 * B) Market asset price (global market data: `prices` / CoinGecko).
 *      Everything except IRT keeps its historical behavior: the latest
 *      recorded `prices` unit price, falling back to 1.
 *
 * This module only READS. It never writes prices, FX settings, or the ledger.
 */
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets } from "@/db/schema";
import { D } from "@/domain/decimal";
import { getLatestUsdIrtRateForUser } from "@/lib/fx";

/** Stable / face-value assets whose unit is defined as 1 USD. */
const FACE_VALUE_SYMBOLS = new Set(["USD", "USDT", "USDC", "USDS", "USDE", "USDG"]);

/**
 * USD value of ONE native unit of `assetId`.
 *
 * - IRT  → 1 / user FX rate (per-user authoritative FX; Toman is native).
 * - USD / stables → 1 (face value).
 * - everything else → latest `prices` market quote (global), fallback 1.
 *
 * `client` may be the shared `db` or a transaction handle; the FX reads run
 * on that same client so callers inside a transaction stay consistent.
 */
export async function nativeUnitPriceUsd(
  assetId: string,
  userId?: string | null,
  client: any = db,
): Promise<string> {
  const [asset] = await client
    .select({ symbol: assets.symbol })
    .from(assets)
    .where(eq(assets.id, assetId))
    .limit(1);
  const symbol = (asset?.symbol ?? "").toUpperCase();

  // Authoritative per-user FX: 1 Toman = 1 native IRT unit.
  if (symbol === "IRT") {
    const fx = await getLatestUsdIrtRateForUser(userId ?? null, client);
    const rate = D(fx.rate);
    if (rate.lte(0)) throw new Error("نرخ تبدیل دلار به تومان معتبر نیست.");
    return D("1").div(rate).toString();
  }

  if (FACE_VALUE_SYMBOLS.has(symbol)) {
    return "1";
  }

  // Global market data — latest recorded unit price.
  const res = await client.execute(
    sql`select price_base::text as p from prices where asset_id = ${assetId} order by as_of desc limit 1`,
  );
  return (res.rows[0] as { p?: string } | undefined)?.p ?? "1";
}
