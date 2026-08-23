"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordRealEstateValuationAction } from "@/app/actions/realEstate";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { formatJalaliIso, toFaDigits } from "@/lib/format";
import type { RealEstateDashboardItem } from "@/features/rwa/realEstate/service";
import { DeltaPct, DeltaToman, DeltaUsd, DetailRow, FxRateInfo, Hint, JDate, Labeled, Result, Toman, Usd, faNum } from "./shared";
import { getRealEstateDisplayLabel } from "@/features/rwa/realEstate/display";

function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="num ltr-isolate">
      {children}
    </span>
  );
}

export default function RealEstateCard({ item }: { item: RealEstateDashboardItem }) {
  const [state, action, pending] = useActionState(recordRealEstateValuationAction, null);
  const [revalue, setRevalue] = useState(false);

  const a = item;
  const p = item.performance;

  const ledgerLink = a.ledgerEntryId ? `/ledger?entry=${a.ledgerEntryId}` : null;
  const divergence =
    p.gainToman && p.gainUsd && Number(p.gainToman) > 0 && Number(p.gainUsd) < 0
      ? "ارزش ملک به تومان افزایش یافته اما ارزش دلاری آن کاهش یافته است (اثر نرخ ارز)."
      : p.gainToman && p.gainUsd && Number(p.gainToman) < 0 && Number(p.gainUsd) > 0
        ? "ارزش ملک به تومان کاهش یافته اما ارزش دلاری آن افزایش یافته است (اثر نرخ ارز)."
        : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--sunken)" }}>
          <h5 className="mb-1 text-[11.5px] font-bold">اطلاعات دارایی</h5>
          <DetailRow label="نام خودکار">
            <span className="font-semibold">{a.assetName}</span>
          </DetailRow>
          <DetailRow label="نمایش فارسی">
            <span className="font-semibold">
              {getRealEstateDisplayLabel({
                symbol: a.symbol,
                assetName: a.assetName,
                neighborhoodNameFa: a.neighborhoodNameFa,
                cityNameFa: a.cityNameFa,
              })}
            </span>
          </DetailRow>
          <DetailRow label="شناسه دارایی">
            <span className="num font-semibold">{toFaDigits(a.symbol)}</span>
          </DetailRow>
          <DetailRow label="نوع ملک">
            {a.propertyTypeNameFa ?? a.propertyType ?? "—"}
          </DetailRow>
          <DetailRow label="شهر">{a.cityNameFa ?? a.cityNameEn ?? "—"}</DetailRow>
          <DetailRow label="منطقه / محله">{a.neighborhoodNameFa ?? a.area ?? "—"}</DetailRow>
          {a.address && <DetailRow label="نشانی">{a.address}</DetailRow>}
          {a.sizeSqm && (
            <DetailRow label="متراژ">
              <Ltr>{faNum(a.sizeSqm, 2)}</Ltr> متر مربع
            </DetailRow>
          )}
          {a.deedNumber && <DetailRow label="شماره سند">{a.deedNumber}</DetailRow>}
          <DetailRow label="تاریخ ثبت در سیستم">
            <JDate iso={a.systemEntryDate} fallback="—" />
            {a.isHistorical && (
              <span className="mr-2 rounded-full px-2 py-0.5 text-[9.5px]" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
                تملک پیش از راه‌اندازی سیستم
              </span>
            )}
          </DetailRow>
        </div>

        <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--sunken)" }}>
          <h5 className="mb-1 text-[11.5px] font-bold">اطلاعات خرید (تغییرناپذیر)</h5>
          <DetailRow label="تاریخ تملک (شمسی)">
            <JDate iso={a.acquisitionDate} fallback="—" />
          </DetailRow>
          <DetailRow label="تاریخ تملک (میلادی)">
            <Ltr>{a.acquisitionDate ?? "—"}</Ltr>
          </DetailRow>
          <DetailRow label="قیمت خرید (تومان)">
            <Toman value={a.purchasePriceToman} />
          </DetailRow>
          <DetailRow label="نرخ دلار تاریخ خرید">
            <FxRateInfo rate={a.purchaseFxRate} source={a.purchaseFxRateSource} effectiveDate={a.purchaseFxRateDate} />
          </DetailRow>
          <DetailRow label="قیمت خرید (دلار)">
            <Usd value={a.purchaseValueUsd} />
          </DetailRow>
        </div>

        <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--sunken)" }}>
          <h5 className="mb-1 text-[11.5px] font-bold">اطلاعات ارزش‌گذاری</h5>
          <DetailRow label="تاریخ ارزش‌گذاری (شمسی)">
            <JDate iso={a.valuationDate} fallback="—" />
          </DetailRow>
          <DetailRow label="تاریخ ارزش‌گذاری (میلادی)">
            <Ltr>{a.valuationDate ?? "—"}</Ltr>
          </DetailRow>
          <DetailRow label="ارزش فعلی (تومان)">
            <Toman value={a.currentValueToman} />
          </DetailRow>
          <DetailRow label="نرخ دلار تاریخ ارزش‌گذاری">
            <FxRateInfo rate={a.valuationFxRate} source={a.valuationFxRateSource} effectiveDate={a.valuationFxRateDate} />
          </DetailRow>
          <DetailRow label="ارزش فعلی (دلار)">
            <Usd value={a.currentValueUsd} />
          </DetailRow>
          <DetailRow label="تاریخ شمسی ذخیره‌شده (Audit)">
            <Ltr>{a.valuationDatePersian ?? formatJalaliIso(a.valuationDate ?? "", "en")}</Ltr>
          </DetailRow>
        </div>

        <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--sunken)" }}>
          <h5 className="mb-1 text-[11.5px] font-bold">عملکرد</h5>
          <DetailRow label="سود / زیان تومانی">
            <DeltaToman value={p.gainToman} />
          </DetailRow>
          <DetailRow label="درصد بازده تومانی">
            <DeltaPct value={p.roiToman} />
          </DetailRow>
          <DetailRow label="سود / زیان دلاری">
            <DeltaUsd value={p.gainUsd} />
          </DetailRow>
          <DetailRow label="درصد بازده دلاری">
            <DeltaPct value={p.roiUsd} />
          </DetailRow>
          <div className="mt-2 flex flex-wrap gap-2">
            {ledgerLink ? (
              <Link href={ledgerLink} className="btn btn-soft text-[11.5px]">
                مشاهده سند دفترکل ←
              </Link>
            ) : (
              <span className="muted text-[10.5px]">سند دفترکل ثبت نشده</span>
            )}
            <button type="button" className="btn text-[11.5px]" onClick={() => setRevalue((v) => !v)} aria-expanded={revalue}>
              {revalue ? "بستن ارزش‌گذاری جدید" : "ثبت ارزش‌گذاری جدید"}
            </button>
          </div>
        </div>
      </div>

      {divergence && <Hint tone="warn">{divergence}</Hint>}

      {revalue && (
        <form action={action} className="rounded-[var(--r-md)] border p-3" style={{ borderColor: "var(--border)" }}>
          <input type="hidden" name="propertyId" value={a.id} />
          <h5 className="mb-2 text-[11.5px] font-bold">ثبت ارزش‌گذاری جدید — ارزش فعلی فقط با این فرآیند تغییر می‌کند</h5>
          <div className="grid gap-3 md:grid-cols-3">
            <JalaliDateInput name="valuationDate" label="تاریخ ارزش‌گذاری (شمسی)" required />
            <Labeled label="ارزش فعلی (تومان)" required>
              <AmountInput className="field num" name="currentValueToman" inputMode="numeric" dir="ltr" placeholder="7500000000" unit="toman" required />
            </Labeled>
            <Labeled label="نرخ دلار (اختیاری)" hint="خالی بماند: نرخ همان تاریخ از موتور نرخ ارز خوانده می‌شود.">
              <input className="field num" name="valuationFxRate" inputMode="numeric" dir="ltr" placeholder="190000" />
            </Labeled>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? "در حال ثبت…" : "ثبت ارزش‌گذاری جدید"}
            </button>
            <span className="muted text-[10.5px]">سند دفترکل و تاریخچه خرید تغییر نمی‌کنند (Historical Transactions are Immutable).</span>
          </div>
          <div className="mt-2">
            <Result state={state} />
          </div>
        </form>
      )}

      {a.notes && (
        <p className="muted text-[10.5px] leading-5">
          <b>یادداشت:</b> {a.notes}
        </p>
      )}
    </div>
  );
}
