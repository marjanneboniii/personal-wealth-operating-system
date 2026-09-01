/**
 * Installment FX view — the single backend rule for «how much is this
 * installment worth in dollars?».
 *
 * Business rule (scope-locked):
 *
 *                       INSTALLMENT
 *                            │
 *                ┌───────────┴───────────┐
 *             PENDING                  PAID
 *                │                       │
 *        Toman = FROZEN            Toman = FROZEN
 *        USD  = amount_toman        USD  = payment snapshot
 *               ÷ CURRENT FX              (historical, immutable)
 *
 * Pure functions only: no database, no clock, no FX lookup. The caller passes
 * the row and the rate it already resolved through the project's existing FX
 * source of truth (`getLatestUsdIrtRateForUser`), which keeps every read
 * user-scoped and keeps this module trivially testable.
 *
 * Nothing here writes; the only mutation helper (`buildInstallmentPaymentSnapshot`)
 * just computes the values the payment transaction persists.
 */
import { D, Decimal } from "@/domain/decimal";

/** Status the project already uses for a settled installment row. */
export const INSTALLMENT_PAID_STATUS = "paid";

export function isInstallmentPaid(status: string | null | undefined): boolean {
  return status === INSTALLMENT_PAID_STATUS;
}

/** The installment columns this module reads (a subset of the table). */
export type InstallmentFxRow = {
  status: string;
  /** Contractual Toman — AUTHORITATIVE, frozen. */
  amountToman?: string | null;
  /** LEGACY USD amount (pre-Toman rows only). */
  amountBase?: string | null;
  /** Creation-time USD snapshot. */
  amountUsdCreated?: string | null;
  /** Creation-time FX rate (IRT per 1 USD). */
  originalFxRate?: string | null;
  originalFxRateCapturedAt?: Date | string | null;
  /** Payment-time snapshots (frozen forever once written). */
  paidToman?: string | null;
  paidUsd?: string | null;
  paidFxRate?: string | null;
  paidAt?: string | null;
};

export type UsdEquivalentChange = {
  /** «کاهش» when the dollar got more expensive, «افزایش» when cheaper. */
  direction: "decrease" | "increase" | "unchanged";
  /** Absolute USD difference (always ≥ 0). */
  amountUsd: string;
  /** Absolute percentage of the original USD equivalent (always ≥ 0). */
  percent: string;
};

export type InstallmentFxView = {
  isPaid: boolean;
  /** Frozen contractual Toman (or the legacy fallback) — never FX-derived for Phase-3+ rows. */
  amountToman: string | null;
  /** Creation-time snapshot. */
  originalFxRate: string | null;
  originalFxRateCapturedAt: string | null;
  originalUsdEquivalent: string | null;
  /** Live rate + live equivalent — PENDING rows only (null when paid). */
  currentFxRate: string | null;
  currentUsdEquivalent: string | null;
  /** Payment snapshot — PAID rows only (null when pending). */
  paidToman: string | null;
  paidFxRate: string | null;
  paidUsdEquivalent: string | null;
  paidAt: string | null;
  /** What the UI must render: frozen Toman + the correct USD for the state. */
  displayToman: string | null;
  displayUsd: string | null;
  /** Small insight for PENDING rows: original → current USD move. */
  usdChange: UsdEquivalentChange | null;
};

function dec(value: string | number | null | undefined): Decimal | null {
  if (value == null || value === "") return null;
  try {
    return D(value);
  } catch {
    return null;
  }
}

function positive(value: string | number | null | undefined): Decimal | null {
  const d = dec(value);
  return d && d.gt(0) ? d : null;
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/**
 * The frozen Toman obligation of a row.
 * `amount_toman` is the source of truth; the legacy USD column is only used
 * (converted once, at the live rate) for pre-Phase-3 rows that never stored a
 * Toman figure. A PAID row prefers its `paid_toman` snapshot.
 */
export function resolveInstallmentToman(
  row: InstallmentFxRow,
  currentFxRate: string | number | null | undefined,
): string | null {
  if (isInstallmentPaid(row.status)) {
    const paid = dec(row.paidToman);
    if (paid) return paid.toFixed(0);
  }
  const contractual = dec(row.amountToman);
  if (contractual) return contractual.toFixed(0);
  const legacyUsd = dec(row.amountBase);
  const rate = positive(currentFxRate);
  if (legacyUsd && rate) return legacyUsd.mul(rate).toFixed(0);
  return null;
}

/**
 * USD equivalent of a PAID installment — HISTORICAL ONLY.
 * Resolution order (all frozen at or before payment; the current rate is never
 * consulted): paid_usd → paid_toman ÷ paid_fx_rate → creation snapshot.
 */
function resolvePaidUsd(row: InstallmentFxRow): string | null {
  const snapshot = dec(row.paidUsd);
  if (snapshot) return snapshot.toString();
  const paidToman = dec(row.paidToman);
  const paidRate = positive(row.paidFxRate);
  if (paidToman && paidRate) return paidToman.div(paidRate).toString();
  const created = dec(row.amountUsdCreated);
  return created ? created.toString() : null;
}

/**
 * Original (creation-time) USD equivalent.
 * Prefers the stored snapshot; falls back to amount_toman ÷ original_fx_rate.
 */
function resolveOriginalUsd(row: InstallmentFxRow): string | null {
  const snapshot = dec(row.amountUsdCreated);
  if (snapshot) return snapshot.toString();
  const toman = dec(row.amountToman);
  const rate = positive(row.originalFxRate);
  if (toman && rate) return toman.div(rate).toString();
  return null;
}

/** Original → current USD move for a PENDING obligation. */
export function computeUsdEquivalentChange(
  originalUsd: string | null,
  currentUsd: string | null,
): UsdEquivalentChange | null {
  const original = dec(originalUsd);
  const current = dec(currentUsd);
  if (!original || !current || !original.gt(0)) return null;
  const diff = current.sub(original);
  if (diff.isZero()) {
    return { direction: "unchanged", amountUsd: "0", percent: "0" };
  }
  const abs = diff.abs();
  return {
    direction: diff.isNegative() ? "decrease" : "increase",
    amountUsd: abs.toString(),
    percent: abs.div(original).mul("100").toString(),
  };
}

/**
 * The complete, state-aware FX view of one installment.
 * This is the ONLY place the pending/paid branch is decided; the UI just formats.
 */
export function buildInstallmentFxView(
  row: InstallmentFxRow,
  currentFxRate: string | number | null | undefined,
): InstallmentFxView {
  const paid = isInstallmentPaid(row.status);
  const rate = positive(currentFxRate);
  const amountToman = resolveInstallmentToman(row, currentFxRate);
  const originalUsd = resolveOriginalUsd(row);

  if (paid) {
    // Immutable branch: no current-rate arithmetic is performed at all.
    const paidUsd = resolvePaidUsd(row);
    return {
      isPaid: true,
      amountToman,
      originalFxRate: dec(row.originalFxRate)?.toString() ?? null,
      originalFxRateCapturedAt: isoOrNull(row.originalFxRateCapturedAt),
      originalUsdEquivalent: originalUsd,
      currentFxRate: null,
      currentUsdEquivalent: null,
      paidToman: dec(row.paidToman)?.toFixed(0) ?? null,
      paidFxRate: dec(row.paidFxRate)?.toString() ?? null,
      paidUsdEquivalent: paidUsd,
      paidAt: row.paidAt ?? null,
      displayToman: amountToman,
      displayUsd: paidUsd,
      usdChange: null,
    };
  }

  // Dynamic branch: Toman stays frozen, only the equivalent follows the rate.
  const currentUsd = amountToman && rate ? D(amountToman).div(rate).toString() : null;
  return {
    isPaid: false,
    amountToman,
    originalFxRate: dec(row.originalFxRate)?.toString() ?? null,
    originalFxRateCapturedAt: isoOrNull(row.originalFxRateCapturedAt),
    originalUsdEquivalent: originalUsd,
    currentFxRate: rate ? rate.toString() : null,
    currentUsdEquivalent: currentUsd,
    paidToman: null,
    paidFxRate: null,
    paidUsdEquivalent: null,
    paidAt: null,
    displayToman: amountToman,
    displayUsd: currentUsd,
    usdChange: computeUsdEquivalentChange(originalUsd, currentUsd),
  };
}

export type PendingUsdInsight = UsdEquivalentChange & {
  /** Sum of the creation-time USD equivalents of the pending rows counted. */
  originalUsd: string;
  /** Sum of their current USD equivalents. */
  currentUsd: string;
  /** How many pending installments carry both figures. */
  count: number;
};

/**
 * Small insight over the PENDING installments only: how much the USD
 * equivalent of the remaining obligation moved since each row was booked.
 * Paid rows are excluded by construction — their values are historical.
 */
export function summarizePendingUsdChange(views: InstallmentFxView[]): PendingUsdInsight | null {
  let original = D("0");
  let current = D("0");
  let count = 0;
  for (const v of views) {
    if (v.isPaid) continue;
    const o = dec(v.originalUsdEquivalent);
    const c = dec(v.currentUsdEquivalent);
    if (!o || !c || !o.gt(0)) continue;
    original = original.add(o);
    current = current.add(c);
    count += 1;
  }
  if (count === 0 || !original.gt(0)) return null;
  const change = computeUsdEquivalentChange(original.toString(), current.toString());
  if (!change) return null;
  return { ...change, originalUsd: original.toString(), currentUsd: current.toString(), count };
}

export type InstallmentPaymentSnapshot = {
  paidToman: string;
  paidFxRate: string;
  paidUsd: string;
};

/**
 * The values a payment must freeze, computed from the amount actually paid and
 * the FX rate valid AT THAT MOMENT. Callers persist all three inside the same
 * database transaction that flips the row to `paid` (see payInstallment /
 * createTransaction), so a PAID row can never exist without its USD snapshot.
 */
export function buildInstallmentPaymentSnapshot(input: {
  paidToman: string | number;
  fxRate: string | number;
}): InstallmentPaymentSnapshot {
  const toman = dec(input.paidToman);
  const rate = positive(input.fxRate);
  if (!toman) throw new Error("مبلغ پرداخت قسط نامعتبر است");
  if (!rate) throw new Error("نرخ تبدیل دلار به تومان برای ثبت پرداخت این قسط موجود نیست.");
  return {
    paidToman: toman.toFixed(0),
    paidFxRate: rate.toString(),
    paidUsd: toman.div(rate).toString(),
  };
}
