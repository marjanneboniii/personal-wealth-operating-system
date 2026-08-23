"use client";

import { formatDualMoneyFromIrt, formatDualMoneyFromUsd } from "@/lib/format";

type PropsIrt = { irt: string | number; rate: string | null; digits?: "fa" | "en" };
type PropsUsd = { usd: string | number; rate: string | null; digits?: "fa" | "en" };

export function DualMoneyFromIrt({ irt, rate }: PropsIrt) {
  const { irt: irtLabel, usd, rateLabel } = formatDualMoneyFromIrt(irt, rate, "fa");
  return (
    <span className="inline-flex flex-col items-start gap-1 min-w-0">
      <span className="type-financial num money-nowrap text-[13px] sm:text-[14px]" dir="rtl">{irtLabel}</span>
      <span className="type-caption flex flex-wrap items-center gap-1 money-nowrap">
        معادل: <span className="num money-nowrap text-[11px]" dir="ltr" style={{ color: "var(--brand)" }}>{usd}</span>
      </span>
      <span className="chip text-[9px] sm:text-[10px] money-nowrap">{rateLabel}</span>
    </span>
  );
}

export function DualMoneyFromUsd({ usd, rate }: PropsUsd) {
  const { irt, usd: usdLabel, rateLabel } = formatDualMoneyFromUsd(usd, rate, "fa");
  return (
    <span className="inline-flex flex-col items-start gap-1 min-w-0">
      <span className="type-financial num money-nowrap text-[13px] sm:text-[14px]" dir="rtl">{irt}</span>
      <span className="type-caption flex flex-wrap items-center gap-1 money-nowrap">
        معادل: <span className="num money-nowrap text-[11px]" dir="ltr" style={{ color: "var(--brand)" }}>{usdLabel}</span>
      </span>
      <span className="chip text-[9px] sm:text-[10px] money-nowrap">{rateLabel}</span>
    </span>
  );
}

export function MoneyIrtUsd({ usd, rate }: { usd: string | number; rate: string | null }) {
  return <DualMoneyFromUsd usd={usd} rate={rate} />;
}
