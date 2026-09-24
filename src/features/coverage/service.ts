/**
 * پوشش داده — how much of the picture is actually in the books, and current.
 *
 * Net worth is a sum; a missing apartment or a six-month-old valuation makes
 * it wrong without making it look wrong. This gathers the checks that already
 * exist in separate modules into one score the user can act on:
 *
 *   • every asset category answered, and every «بله» backed by a registration
 *   • money accounts agree with the bank, recently
 *   • imported transactions reviewed
 *   • property values not older than VALUATION_STALE_DAYS
 *   • market prices fresh (supplied by the caller, who already valued the portfolio)
 *
 * A check that does not apply (no properties, no accounts) is left out rather
 * than counted as passed. Read-only.
 */
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { IconName } from "@/components/ui/Icon";
import { countAssetsByCategory } from "@/features/onboarding/counts";
import { CATEGORY_META, evaluateChecklist } from "@/features/onboarding/categories";
import { listIntents } from "@/features/onboarding/service";
import { listReconciliation } from "@/features/reconcile/service";
import { countUnreviewed } from "@/features/ledger/queries";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";

export const VALUATION_STALE_DAYS = 180;

export type CoverageCheck = {
  key: string;
  label: string;
  ok: boolean;
  /** What is missing, in one line; null when ok. */
  detail: string | null;
  href: string;
  action: string;
  icon: IconName;
};

export type Coverage = { checks: CoverageCheck[]; passed: number; total: number; percent: number };

const fa = (n: number) => n.toLocaleString("fa-IR");

/** Score over the applicable checks. PURE. */
export function scoreCoverage(checks: CoverageCheck[]): Coverage {
  const passed = checks.filter((c) => c.ok).length;
  return { checks, passed, total: checks.length, percent: checks.length ? Math.round((passed * 100) / checks.length) : 100 };
}

export async function dataCoverage(userId: string, opts: { stalePrices?: number } = {}, today = todayIso()): Promise<Coverage> {
  const [intents, counts, recon, unreviewed, properties] = await Promise.all([
    listIntents(userId).catch(() => []),
    countAssetsByCategory(userId).catch(() => ({})),
    listReconciliation(userId, today).catch(() => []),
    countUnreviewed(userId).catch(() => 0),
    db
      .execute(sql`
        select count(*)::int as n,
          count(*) filter (where p.valuation_date is null or p.valuation_date < (${today}::date - ${VALUATION_STALE_DAYS}::int))::int as stale
        from real_estate_properties p join assets a on a.id = p.asset_id and a.deleted_at is null
        where p.user_id = ${userId}::uuid
      `)
      .then((r) => r.rows[0] as { n: number; stale: number })
      .catch(() => ({ n: 0, stale: 0 })),
  ]);

  const checks: CoverageCheck[] = [];
  const checklist = evaluateChecklist(intents, counts);
  checks.push({
    key: "checklist",
    label: "همه‌ی انواع دارایی پاسخ داده شده",
    ok: checklist.complete,
    detail: checklist.complete ? null : `${fa(checklist.unanswered.length)} نوع دارایی هنوز بی‌پاسخ است`,
    href: "/onboarding",
    action: "پاسخ",
    icon: "check",
  });
  if (intents.some((i) => i.answer === "yes")) {
    const missing = checklist.promisedButEmpty;
    checks.push({
      key: "registered",
      label: "دارایی‌های اعلام‌شده ثبت شده‌اند",
      ok: missing.length === 0,
      detail: missing.length ? `${missing.map((c) => CATEGORY_META[c].label).join("، ")} اعلام شده ولی ثبت نشده` : null,
      href: missing.length ? CATEGORY_META[missing[0]].href : "/assets",
      action: "ثبت",
      icon: "layers",
    });
  }
  const funded = recon.filter((r) => !D(r.ledgerNow).isZero() || r.checkpoint);
  if (funded.length) {
    const bad = funded.filter((r) => r.state !== "matched" || r.stale);
    const mismatched = funded.filter((r) => r.state === "mismatch").length;
    checks.push({
      key: "reconciled",
      label: "حساب‌ها با بانک تطبیق دارند",
      ok: bad.length === 0,
      detail: bad.length ? (mismatched ? `${fa(mismatched)} حساب با بانک یکی نیست` : `${fa(bad.length)} حساب در ۳۰ روز اخیر تطبیق نشده`) : null,
      href: "/accounts/reconcile",
      action: "تطبیق",
      icon: "scale",
    });
  }
  checks.push({
    key: "reviewed",
    label: "تراکنش‌های درون‌ریزی‌شده بررسی شده‌اند",
    ok: unreviewed === 0,
    detail: unreviewed ? `${fa(unreviewed)} تراکنش بررسی نشده` : null,
    href: "/transactions?review=unreviewed",
    action: "بررسی",
    icon: "transactions",
  });
  if (Number(properties.n) > 0) {
    checks.push({
      key: "valuations",
      label: "ارزش املاک به‌روز است",
      ok: Number(properties.stale) === 0,
      detail: Number(properties.stale) ? `ارزش ${fa(Number(properties.stale))} ملک بیش از ${fa(VALUATION_STALE_DAYS / 30)} ماه به‌روز نشده` : null,
      href: "/asset-registry?kind=real-estate",
      action: "ارزش‌گذاری",
      icon: "home",
    });
  }
  if (opts.stalePrices != null) {
    checks.push({
      key: "prices",
      label: "قیمت دارایی‌های بازار تازه است",
      ok: opts.stalePrices === 0,
      detail: opts.stalePrices ? `قیمت ${fa(opts.stalePrices)} دارایی قدیمی یا در دسترس نیست` : null,
      href: "/portfolio",
      action: "سبد",
      icon: "refresh",
    });
  }
  return scoreCoverage(checks);
}
