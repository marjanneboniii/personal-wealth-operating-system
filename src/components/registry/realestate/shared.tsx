"use client";

import type { ReactNode } from "react";
import { formatMoney } from "@/lib/format";
import type { RealEstateResult } from "@/app/actions/realEstate";

/**
 * Shared UI atoms for the Real Estate module — re-exports the vehicle
 * module's presentation primitives (single source of truth) and adds a few
 * real-estate specific helpers.
 */
export {
  DeltaPct,
  DeltaToman,
  DeltaUsd,
  Hint,
  JDate,
  Labeled,
  Metric,
  Result,
  Toman,
  Usd,
  faNum,
} from "@/components/registry/vehicle/shared";

/** نرخ دلار + منبع استفاده‌شده (exact/nearest/…/manual) — قابل ردیابی. */
const RATE_SOURCE_LABEL: Record<string, string> = {
  exact: "نرخ ثبت‌شده همان تاریخ",
  nearest: "نزدیک‌ترین نرخ ثبت‌شده قبل از تاریخ",
  current: "نرخ جاری کاربر (برای آن تاریخ نرخی ثبت نشده است)",
  fallback: "نرخ پیش‌فرض سیستم",
  manual: "نرخ واردشده به‌صورت دستی",
};

export function FxRateInfo({
  rate,
  source,
  effectiveDate,
}: {
  rate: string | null | undefined;
  source: string | null | undefined;
  effectiveDate?: string | null;
}) {
  if (!rate) return <span className="muted">—</span>;
  return (
    <span className="num money-nowrap text-[11px] sm:text-[12px]" dir="rtl">
      {formatMoney(rate, "IRT")}
      <span className="muted text-[9px] sm:text-[9.5px]">
        {" "}
        · {source ? (RATE_SOURCE_LABEL[source] ?? source) : ""}
        {effectiveDate ? ` (${effectiveDate})` : ""}
      </span>
    </span>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b py-2 text-[11px] last:border-0 sm:gap-x-3 sm:text-[11.5px]" style={{ borderColor: "var(--border)" }}>
      <span className="muted shrink-0">{label}</span>
      <span className="font-medium min-w-0 text-left money-nowrap">{children}</span>
    </div>
  );
}
