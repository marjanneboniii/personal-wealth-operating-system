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

/**
 * DISPLAY-ONLY fallback, used when no real rate exists anywhere so a page can
 * still draw its «≈ دلار» hints. It is NOT a rate: a write that freezes a rate
 * must go through `getWritableUsdIrtRateForUser` / `assertRealUsdIrtRate`,
 * which refuse it.
 */
export const FALLBACK_DISPLAY_RATE = "190000";

/** Sources that are a placeholder, not a market or recorded rate. */
const PLACEHOLDER_SOURCES = new Set(["fallback", "default"]);

export const MISSING_RATE_MESSAGE =
  "نرخ دلار هنوز از بازار دریافت نشده است؛ چند لحظه دیگر دوباره تلاش کنید. تا نرخ واقعی نرسد، ثبتِ این مورد انجام نمی‌شود.";

/** True when `snap` is the display placeholder rather than a real rate. */
export function isPlaceholderRate(snap: { source: string; rate: string }): boolean {
  return PLACEHOLDER_SOURCES.has(snap.source) || !(Number(snap.rate) > 0);
}

/**
 * Guard for every write that FREEZES a rate (a journal entry's FX snapshot, a
 * debt's creation-time USD, a property's purchase USD, …). A frozen value is
 * permanent, so freezing the placeholder would store a made-up dollar figure
 * forever. Throws the user-facing message instead.
 */
export function assertRealUsdIrtRate<T extends { source: string; rate: string }>(snap: T): T {
  if (isPlaceholderRate(snap)) throw new Error(MISSING_RATE_MESSAGE);
  return snap;
}

/**
 * The rate for a write: the user's real rate, fetched from the market once if
 * they have none yet. Makes a network call — never use it inside a database
 * transaction; there, read with getLatestUsdIrtRateForUser + assertRealUsdIrtRate.
 */
export async function getWritableUsdIrtRateForUser(userId: string | null | undefined): Promise<FxSnapshot> {
  let snap = await getLatestUsdIrtRateForUser(userId);
  if (isPlaceholderRate(snap) && userId) {
    try {
      const { refreshUserFxRateFromMarket } = await import("@/features/fx/userRate");
      await refreshUserFxRateFromMarket(userId);
    } catch {}
    snap = await getLatestUsdIrtRateForUser(userId);
  }
  return assertRealUsdIrtRate(snap);
}

/**
 * Get latest USD→IRT rate for a specific user (per-user isolation).
 * Priority: user_fx_settings → exchange_rates → settings.irt_rate → display fallback.
 */
export async function getLatestUsdIrtRateForUser(
  userId: string | null | undefined,
  dbClient: any = db,
): Promise<FxSnapshot> {
  // 1. User-specific rate (new per-user system)
  if (userId) {
    try {
      const [urow] = await dbClient.select().from(userFxSettings).where(eq(userFxSettings.userId, userId)).limit(1);
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
    const [row] = await dbClient
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
    const [s] = await dbClient.select().from(settings).where(eq(settings.key, "irt_rate")).limit(1);
    if (s?.value) {
      return { rate: s.value, effectiveDate: new Date().toISOString().slice(0, 10), source: "settings" };
    }
  } catch {}

  // Display placeholder — `source: "fallback"` makes every write refuse it.
  return { rate: FALLBACK_DISPLAY_RATE, effectiveDate: new Date().toISOString().slice(0, 10), source: "fallback" };
}

/**
 * Get latest USD→IRT rate (legacy, user-agnostic).
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
