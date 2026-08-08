"use client";

import { useEffect, useState } from "react";
import { D } from "@/domain/decimal";
import { formatMoney, getDualDate, formatDualMoneyFromIrt, toFaDigits } from "@/lib/format";

type SmartAmountPreviewProps = {
  irtAmount: string;
  rate: string | null;
  rateDate?: string;
  rateSource?: string;
};

export function SmartAmountPreview({ irtAmount, rate, rateDate, rateSource }: SmartAmountPreviewProps) {
  const hasAmount = irtAmount && D(irtAmount).gt(0);
  const hasRate = rate && D(rate).gt(0);
  const preview = hasAmount ? formatDualMoneyFromIrt(irtAmount, rate ?? null) : null;

  if (!hasAmount) {
    return <div className="muted text-[11px]">مبلغ به تومان را وارد کنید تا پیش‌نمایش دلاری نمایش داده شود.</div>;
  }
  if (!hasRate) {
    return (
      <div className="soft rounded-[var(--r-md)] p-3 text-[11px] leading-6 border border-amber-200">
        <div>مبلغ: <strong className="num" dir="ltr">{formatMoney(irtAmount, "IRT")}</strong></div>
        <div className="muted">نرخ دلار ثبت نشده — معادل دلاری قابل محاسبه نیست. لطفاً ابتدا نرخ دلار را در تنظیمات ثبت کنید.</div>
      </div>
    );
  }
  return (
    <div className="soft rounded-[var(--r-md)] p-3 text-[11px] leading-6" style={{ background: "var(--brand-soft)", border: "1px solid var(--border)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span>مبلغ:</span>
        <strong className="num text-xs" dir="ltr">{preview!.irt}</strong>
        <span className="muted">·</span>
        <span>معادل تقریبی:</span>
        <strong className="num text-xs" dir="ltr" style={{ color: "var(--brand)" }}>{preview!.usd}</strong>
      </div>
      <div className="muted text-[10px] mt-1">
        {preview!.rateLabel}
        {rateDate && <span> · تاریخ نرخ: <span dir="auto" className="num">{rateDate}</span></span>}
        {rateSource && <span> · منبع: {rateSource}</span>}
      </div>
      <div className="muted text-[10px]">این محاسبه صرفاً نمایشی است و تا قبل از «تأیید نهایی» هیچ سندی در دفترکل ایجاد نمی‌کند.</div>
    </div>
  );
}

type DualDatePreviewProps = {
  iso: string; // YYYY-MM-DD gregorian
};

export function DualDatePreview({ iso }: DualDatePreviewProps) {
  if (!iso) return <div className="muted text-[11px]">تاریخ را انتخاب کنید تا پیش‌نمایش دوگانه نمایش داده شود.</div>;
  const dual = getDualDate(iso);
  return (
    <div className="soft rounded-[var(--r-md)] p-3 text-[11px] leading-6 flex flex-wrap gap-3">
      <span className="flex items-center gap-1">
        <span className="muted">شمسی:</span>
        <strong dir="rtl" className="num">{dual.jalali}</strong>
      </span>
      <span className="muted">·</span>
      <span className="flex items-center gap-1">
        <span className="muted">میلادی:</span>
        <strong dir="ltr" className="num" style={{ fontFamily: "ui-monospace, monospace" }}>{dual.gregorian}</strong>
      </span>
      <span className="muted text-[10px]">هر دو تاریخ هم‌زمان و از یک موتور مشترک محاسبه شده‌اند.</span>
    </div>
  );
}

// Hook for client-side FX live rate
export function useLatestRate(initialRate?: string | null) {
  const [rate, setRate] = useState<string | null>(initialRate ?? null);
  const [meta, setMeta] = useState<{ date?: string; source?: string }>({});

  useEffect(() => {
    if (initialRate) return;
    fetch("/api/fx/latest")
      .then((r) => r.json())
      .then((j) => {
        if (j?.rate) {
          setRate(String(j.rate));
          setMeta({ date: j.effectiveDate, source: j.source });
        }
      })
      .catch(() => {});
  }, [initialRate]);

  // also allow manual refresh when settings change?
  return { rate, ...meta, setRate };
}

export function PreviewCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card soft p-4 space-y-2 border" style={{ borderColor: "var(--brand)" }}>
      <div className="text-xs font-bold" style={{ color: "var(--brand)" }}>{title}</div>
      {children}
      <div className="muted text-[10px]">این پیش‌نمایش فقط نمایشی است — هیچ اطلاعاتی تا قبل از «تأیید نهایی» در دفترکل ثبت نمی‌شود.</div>
    </div>
  );
}
