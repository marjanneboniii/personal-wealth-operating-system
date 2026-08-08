/**
 * FX Preview — Shared Single Source of Truth
 * Provides latest USD→IRT rate for presentation-layer previews.
 * Never writes to ledger. Pure read from exchange_rates + settings fallback.
 * Now per-user: user_fx_settings takes priority, then exchange_rates, then settings.
 */
import { db } from "@/db";
import { exchangeRates, settings, userFxSettings } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

export type FxSnapshot = {
  rate: string; // IRT per 1 USD, e.g. "190000"
  effectiveDate: string;
  source: string;
  lastUpdatedAt?: string | null;
  canUpdate?: boolean;
  nextUpdateAt?: string | null;
};

const DEFAULT_RATE = "190000";

/**
 * Get latest USD→IRT rate for a specific user (per-user isolation).
 * Priority: user_fx_settings → exchange_rates → settings.irt_rate → fallback 190000
 */
export async function getLatestUsdIrtRateForUser(userId: string | null | undefined): Promise<FxSnapshot> {
  // 1. User-specific rate (new per-user system)
  if (userId) {
    try {
      const [urow] = await db.select().from(userFxSettings).where(eq(userFxSettings.userId, userId)).limit(1);
      if (urow?.currentRate) {
        const last = urow.lastUpdatedAt ? new Date(urow.lastUpdatedAt) : null;
        const now = new Date();
        const canUpdate = !last || now.getTime() - last.getTime() >= 24 * 60 * 60 * 1000;
        const next = last && !canUpdate ? new Date(last.getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
        return {
          rate: urow.currentRate.toString(),
          effectiveDate: new Date().toISOString().slice(0, 10),
          source: "user_settings",
          lastUpdatedAt: last?.toISOString() ?? null,
          canUpdate,
          nextUpdateAt: next,
        };
      }
    } catch {}
  }

  // 2. Global exchange_rates
  try {
    const [row] = await db
      .select()
      .from(exchangeRates)
      .where(and(eq(exchangeRates.baseCurrency, "USD"), eq(exchangeRates.quoteCurrency, "IRT")))
      .orderBy(desc(exchangeRates.effectiveDate))
      .limit(1);

    if (row?.rate) {
      return {
        rate: row.rate.toString(),
        effectiveDate: row.effectiveDate,
        source: row.source ?? "exchange_rates",
      };
    }
  } catch {}

  // 3. Legacy settings.irt_rate
  try {
    const [s] = await db.select().from(settings).where(eq(settings.key, "irt_rate")).limit(1);
    if (s?.value) {
      return { rate: s.value, effectiveDate: new Date().toISOString().slice(0, 10), source: "settings" };
    }
  } catch {}

  // ultimate fallback — per spec 190,000
  return { rate: DEFAULT_RATE, effectiveDate: new Date().toISOString().slice(0, 10), source: "fallback" };
}

/**
 * Get latest USD→IRT rate (legacy, user-agnostic — uses default 190000).
 * For backward compat; new code should use getLatestUsdIrtRateForUser.
 */
export async function getLatestUsdIrtRate(): Promise<FxSnapshot> {
  // Try to resolve current user if available (best effort)
  let userId: string | null = null;
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const user = await getCurrentUser();
    userId = (user as any)?.id ?? null;
  } catch {}
  return getLatestUsdIrtRateForUser(userId);
}

/** Server-side helper to compute USD from IRT using latest rate */
export async function previewIrtToUsd(irtAmount: string, userId?: string | null): Promise<{ usd: string; rate: FxSnapshot }> {
  const snap = userId ? await getLatestUsdIrtRateForUser(userId) : await getLatestUsdIrtRate();
  const { D } = await import("@/domain/decimal");
  const rateDec = D(snap.rate);
  const usd = rateDec.lte(0) ? "0" : D(irtAmount).div(rateDec).toFixed(2);
  return { usd, rate: snap };
}
