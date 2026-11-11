"use client";

import { useMemo, useState, type ReactNode } from "react";
import { toFaDigits, toLatinDigits } from "@/lib/format";
import Icon from "@/components/ui/Icon";

export interface BankCardProps {
  /** شماره ۱۶ رقمی کارت */
  number: string;
  /** نام صاحب کارت */
  holder?: string;
  /** تاریخ انقضا مانند ۰۸/۰۵ یا 1408/05 */
  expiry?: string;
  /** پنهان کردن ارقام میانی ۶۱۰۴ ۳۳** **** ۳۴۵۶ */
  masked?: boolean;
  /** نام یا اسلاگ بانک در صورت تمایل به تعیین دستی */
  bankName?: string;
  /** موجودی کارت یا حساب */
  balance?: string;
  className?: string;
}

interface BankMeta {
  name: string;
  color: string;
  textColor: string;
}

const BANK_BINS: Record<string, BankMeta> = {
  "610433": { name: "بانک ملت", color: "#a81326", textColor: "#ffffff" },
  "603799": { name: "بانک ملی ایران", color: "#0d3b66", textColor: "#ffffff" },
  "603769": { name: "بانک صادرات ایران", color: "#1d3557", textColor: "#ffffff" },
  "627353": { name: "بانک تجارت", color: "#184e77", textColor: "#ffffff" },
  "585983": { name: "بانک تجارت", color: "#184e77", textColor: "#ffffff" },
  "589210": { name: "بانک سپه", color: "#1f487e", textColor: "#ffffff" },
  "621986": { name: "بانک سامان", color: "#0077b6", textColor: "#ffffff" },
  "502229": { name: "بانک پاسارگاد", color: "#2d2a26", textColor: "#f4a261" },
  "639347": { name: "بانک پاسارگاد", color: "#2d2a26", textColor: "#f4a261" },
  "622106": { name: "بانک پارسیان", color: "#780016", textColor: "#ffffff" },
  "627884": { name: "بانک پارسیان", color: "#780016", textColor: "#ffffff" },
  "603770": { name: "بانک کشاورزی", color: "#1b4332", textColor: "#ffffff" },
  "628023": { name: "بانک مسکن", color: "#ca6702", textColor: "#ffffff" },
  "589463": { name: "بانک رفاه کارگران", color: "#005f73", textColor: "#ffffff" },
  "627412": { name: "بانک اقتصاد نوین", color: "#4a154b", textColor: "#ffffff" },
  "636214": { name: "بانک آینده", color: "#582f0e", textColor: "#ffffff" },
  "502806": { name: "بانک شهر", color: "#9b2226", textColor: "#ffffff" },
  "504172": { name: "بانک قرض‌الحسنه رسالت", color: "#2d6a4f", textColor: "#ffffff" },
  "606373": { name: "بانک قرض‌الحسنه مهر ایران", color: "#087e8b", textColor: "#ffffff" },
  "627760": { name: "پست بانک ایران", color: "#14591d", textColor: "#ffffff" },
  "502938": { name: "بانک دی", color: "#005c6e", textColor: "#ffffff" },
  "639346": { name: "بانک سینا", color: "#1e3d59", textColor: "#ffffff" },
  "627488": { name: "بانک کارآفرین", color: "#0b525b", textColor: "#ffffff" },
  "505416": { name: "بانک گردشگری", color: "#6a040f", textColor: "#ffffff" },
  "505785": { name: "بانک ایران زمین", color: "#49117c", textColor: "#ffffff" },
  "639607": { name: "بانک سرمایه", color: "#242582", textColor: "#ffffff" },
};

export function detectBank(rawNumber: string, fallbackName?: string): BankMeta {
  const clean = toLatinDigits(rawNumber).replace(/[^\d]/g, "");
  const bin = clean.slice(0, 6);
  if (bin && BANK_BINS[bin]) return BANK_BINS[bin];
  if (fallbackName) {
    const norm = fallbackName.trim();
    const found = Object.values(BANK_BINS).find(
      (b) => b.name === norm || norm.includes(b.name) || b.name.includes(norm)
    );
    if (found) return { ...found, name: norm };
  }
  return { name: fallbackName || "کارت شتابی", color: "#1f2937", textColor: "#ffffff" };
}

/**
 * BankCard — کارت بانکی هوشمند با تشخیص خودکار بانک بر پایه الگوی کاشی ۲.۰
 */
export default function BankCard({
  number,
  holder,
  expiry,
  masked = false,
  bankName,
  balance,
  className = "",
}: BankCardProps) {
  const [copied, setCopied] = useState(false);
  const [showMasked, setShowMasked] = useState(masked);

  const clean = toLatinDigits(number).replace(/[^\d]/g, "");
  const bank = useMemo(() => {
    return detectBank(clean, bankName);
  }, [clean, bankName]);

  const displayDigits = useMemo(() => {
    if (!clean) return "•••• •••• •••• ••••";
    let formatted = clean;
    if (clean.length === 4) {
      formatted = `••••••••••••${clean}`;
    } else if (clean.length === 10) {
      // 6-digit BIN + 4-digit tail
      formatted = `${clean.slice(0, 6)}••••••${clean.slice(6)}`;
    } else if (clean.length < 16) {
      formatted = clean.padEnd(16, "•").slice(0, 16);
    }

    if (showMasked && clean.length === 16) {
      const m = `${clean.slice(0, 4)} ${clean.slice(4, 6)}•• •••• ${clean.slice(12, 16)}`;
      return toFaDigits(m);
    }
    const grouped = formatted.slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
    return toFaDigits(grouped);
  }, [clean, showMasked]);

  const handleCopy = () => {
    if (!clean) return;
    navigator.clipboard.writeText(clean);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div
      className={`bank-card relative flex flex-col justify-between overflow-hidden rounded-2xl p-5 shadow-md transition-all select-none hover:shadow-lg ${className}`}
      style={{
        background: `linear-gradient(135deg, ${bank.color} 0%, color-mix(in srgb, ${bank.color} 80%, #000) 100%)`,
        color: bank.textColor,
        minHeight: "190px",
        aspectRatio: "1.586 / 1",
      }}
      dir="rtl"
    >
      {/* بافت لطیف پس‌زمینه کارت */}
      <div
        className="pointer-events-none absolute inset-0 opacity-10"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 150%, #ffffff 0%, transparent 60%), radial-gradient(circle at 80% -20%, #ffffff 0%, transparent 50%)`,
        }}
      />

      {/* سربرگ: نام بانک و نشان شتاب */}
      <div className="relative flex items-center justify-between z-10">
        <span className="text-sm font-bold tracking-tight opacity-95">{bank.name}</span>
        <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white">
          شتاب
        </span>
      </div>

      {/* چیپ الکترونیکی کارت */}
      <div className="relative z-10 my-1 flex items-center gap-3">
        <div className="relative h-8 w-11 rounded-md border border-amber-300/40 bg-gradient-to-br from-amber-200 via-amber-300 to-amber-500 shadow-inner">
          {/* خطوط اتصال چیپ */}
          <div className="absolute inset-0 flex items-center justify-center opacity-40">
            <div className="h-full w-px bg-amber-900" />
            <div className="h-px w-full bg-amber-900" />
          </div>
        </div>
        {/* آیکون پرداخت بدون تماس (NFC) */}
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="opacity-60">
          <path d="M8.5 16.5a6 6 0 0 1 0-9M12 19a10 10 0 0 0 0-14M15.5 21.5a14 14 0 0 0 0-19" />
        </svg>
      </div>

      {/* شماره کارت ۱۶ رقمی */}
      <div className="relative z-10 flex items-center justify-between" dir="ltr">
        <span className="num text-lg font-bold tracking-widest sm:text-xl drop-shadow-sm">
          {displayDigits}
        </span>
        <div className="flex items-center gap-1.5">
          {masked && (
            <button
              type="button"
              onClick={() => setShowMasked((prev) => !prev)}
              className="rounded-full p-1 opacity-70 transition-opacity hover:opacity-100"
              title={showMasked ? "نمایش کامل" : "پنهان کردن"}
            >
              <Icon name={showMasked ? "sparkle" : "shield"} size={14} />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium backdrop-blur-sm transition-all hover:bg-white/25 active:scale-95"
            title="کپی شماره کارت"
          >
            {copied ? (
              <span className="flex items-center gap-1 text-emerald-300">
                <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m4 10 4 4 8-8" />
                </svg>
                کپی شد
              </span>
            ) : (
              <span>کپی</span>
            )}
          </button>
        </div>
      </div>

      {/* پایین کارت: صاحب کارت و تاریخ انقضا */}
      <div className="relative z-10 flex items-end justify-between pt-1 text-xs opacity-90">
        <div className="flex flex-col">
          <span className="text-[9px] opacity-70">صاحب کارت</span>
          <span className="font-semibold">{holder || "دارنده کارت"}</span>
        </div>
        {balance && (
          <div className="flex flex-col items-center">
            <span className="text-[9px] opacity-70">موجودی</span>
            <span className="num font-bold text-sm tracking-tight">{balance}</span>
          </div>
        )}
        {expiry && (
          <div className="flex flex-col items-end" dir="ltr">
            <span className="text-[9px] opacity-70">انقضا</span>
            <span className="num font-bold">{toFaDigits(expiry)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
