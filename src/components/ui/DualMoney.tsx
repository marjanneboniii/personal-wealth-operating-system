"use client";

import { formatMoney, formatDualMoneyFromIrt, formatDualMoneyFromUsd } from "@/lib/format";

type PropsIrt = { irt: string | number; rate: string | null; digits?: "fa" | "en" };
type PropsUsd = { usd: string | number; rate: string | null; digits?: "fa" | "en" };

export function DualMoneyFromIrt({ irt, rate, digits = "fa" }: PropsIrt) {
  const { irt: irtLabel, usd, rateLabel } = formatDualMoneyFromIrt(irt, rate, "fa");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="num font-bold" dir="rtl">{irtLabel}</span>
      <span className="muted text-[10px]">≈</span>
      <span className="num" dir="ltr" style={{ color: "var(--brand)" }}>{usd}</span>
      <span className="chip text-[10px]">{rateLabel}</span>
    </span>
  );
}

export function DualMoneyFromUsd({ usd, rate, digits = "fa" }: PropsUsd) {
  const { irt, usd: usdLabel, rateLabel } = formatDualMoneyFromUsd(usd, rate, "fa");
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className="num font-bold" dir="ltr">{usdLabel}</span>
      <span className="muted text-[10px]">≈</span>
      <span className="num" dir="rtl">{irt}</span>
      <span className="chip text-[10px]">{rateLabel}</span>
    </span>
  );
}

export function MoneyIrtUsd({ usd, rate }: { usd: string | number; rate: string | null }) {
  // usd is stored baseValue (USD), show both
  return <DualMoneyFromUsd usd={usd} rate={rate} />;
}
