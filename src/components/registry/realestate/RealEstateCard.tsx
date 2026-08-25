"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { recordRealEstateValuationAction } from "@/app/actions/realEstate";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { formatJalaliIso, toFaDigits, todayIso } from "@/lib/format";
import { compareRealEstateDates } from "@/features/rwa/realEstate/analytics";
import type { RealEstateDashboardItem } from "@/features/rwa/realEstate/service";
import {
  DeltaPct,
  DeltaToman,
  DeltaUsd,
  DetailRow,
  FxRateInfo,
  Hint,
  JDate,
  Labeled,
  Metric,
  Result,
  Toman,
  Usd,
  faNum,
} from "./shared";

function Ltr({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="num ltr-isolate">
      {children}
    </span>
  );
}

type Tab = "performance" | "history" | "compare";

export default function RealEstateCard({ item }: { item: RealEstateDashboardItem }) {
  const [state, action, pending] = useActionState(recordRealEstateValuationAction, null);
  const [revalue, setRevalue] = useState(false);
  const [tab, setTab] = useState<Tab>("performance");

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
          {a.sizeSqm && a.currentValueToman && (
            <DetailRow label="قیمت متری (از ارزش فعلی)">
              <Toman value={(Number(a.currentValueToman) / Number(a.sizeSqm)).toFixed(0)} />
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
          <DetailRow label="تعداد ارزش‌گذاری‌های ثبت‌شده">
            <span className="num">{faNum(item.snapshots.length)}</span>
            <span className="muted"> (تغییرناپذیر)</span>
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
          {(item.cagrToman || item.cagrUsd) && (
            <DetailRow label="CAGR سالانه (تومان / دلار)">
              <DeltaPct value={item.cagrToman} />
              <span className="muted"> · </span>
              <DeltaPct value={item.cagrUsd} />
            </DetailRow>
          )}
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

      {/* ── بازه‌های عملکرد / تاریخچه / مقایسه دو تاریخ ── */}
      <div className="rounded-[var(--r-md)] border p-3" style={{ borderColor: "var(--border)" }}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h5 className="text-[11.5px] font-bold">رشد / افت دلاری و تومانی در گذر زمان</h5>
          <div className="seg" role="group" aria-label="بخش‌های تحلیل ملک">
            <button type="button" onClick={() => setTab("performance")} className={tab === "performance" ? "seg-on" : ""} aria-pressed={tab === "performance"}>
              بازه‌های عملکرد
            </button>
            <button type="button" onClick={() => setTab("history")} className={tab === "history" ? "seg-on" : ""} aria-pressed={tab === "history"}>
              تاریخچه ارزش‌گذاری
            </button>
            <button type="button" onClick={() => setTab("compare")} className={tab === "compare" ? "seg-on" : ""} aria-pressed={tab === "compare"}>
              مقایسه دو تاریخ
            </button>
          </div>
        </div>

        {tab === "performance" && <PerformancePanel item={item} />}
        {tab === "history" && <HistoryPanel item={item} />}
        {tab === "compare" && <ComparePanel item={item} />}
      </div>

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
            <span className="muted text-[10.5px]">
              هر ثبت یک Snapshot جدید و تغییرناپذیر می‌سازد؛ ارزش‌گذاری قبلی (تومان + نرخ دلار همان روز) هرگز حذف یا بازنویسی نمی‌شود و سند دفترکل هم تغییر نمی‌کند.
            </span>
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

/* ───────────────────────── period performance ───────────────────────── */

function PerformancePanel({ item }: { item: RealEstateDashboardItem }) {
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>بازه</th>
              <th className="td-num">تغییر تومانی</th>
              <th className="td-num">٪ تومانی</th>
              <th className="td-num">تغییر دلاری</th>
              <th className="td-num">٪ دلاری</th>
              <th className="td-num hidden sm:table-cell">مبنا → مبین</th>
            </tr>
          </thead>
          <tbody>
            {item.periods.map((p) => (
              <tr key={p.key}>
                <td className="whitespace-nowrap text-[12px] font-medium">{p.label}</td>
                {p.available ? (
                  <>
                    <td className="td-num"><DeltaToman value={p.tomanChange} /></td>
                    <td className="td-num"><DeltaPct value={p.tomanChangePct} /></td>
                    <td className="td-num"><DeltaUsd value={p.usdChange} /></td>
                    <td className="td-num"><DeltaPct value={p.usdChangePct} /></td>
                    <td className="muted td-num hidden text-[10.5px] sm:table-cell">
                      <JDate iso={p.from.date} /> → <JDate iso={p.to.date} />
                      {p.baselineIsPurchase && " (خرید)"}
                    </td>
                  </>
                ) : (
                  <td colSpan={5} className="muted text-[11.5px]">
                    {p.reason}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted mt-2 text-[10.5px] leading-5">
        مبناهای تومانی و دلاری هر بازه از Snapshotهای واقعی همان تاریخ خوانده می‌شوند؛ نرخ دلار هر Snapshot همان نرخ ثبت‌شده در آن
        روز است و هرگز با نرخ امروز بازمحاسبه نمی‌شود. اگر برای یک بازه داده تاریخی وجود نداشته باشد، مقدار فرضی ساخته نمی‌شود.
      </p>
    </div>
  );
}

/* ───────────────────────── valuation history ───────────────────────── */

function HistoryPanel({ item }: { item: RealEstateDashboardItem }) {
  const points = item.snapshots.map((s) => ({
    date: s.snapshotDate,
    valueToman: s.currentValueToman,
    usdRate: s.usdRate,
    valueUsd: s.currentValueUsd,
  }));

  if (!item.history.length) {
    return <p className="muted text-[11.5px]">هنوز هیچ Snapshot ارزش‌گذاری برای این ملک ثبت نشده است.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>تاریخ</th>
            <th className="td-num">ارزش (تومان)</th>
            <th className="td-num">نرخ دلار</th>
            <th className="td-num">ارزش (دلار)</th>
            <th className="td-num">تغییر تومان</th>
            <th className="td-num">تغییر ٪</th>
            <th className="td-num">تغییر دلار</th>
            <th className="td-num">تغییر ٪ دلار</th>
          </tr>
        </thead>
        <tbody>
          {item.purchasePoint && (
            <tr style={{ background: "var(--brand-softer)" }}>
              <td className="whitespace-nowrap text-[11.5px]">
                <JDate iso={item.purchasePoint.date} /> <span className="muted">· خرید</span>
              </td>
              <td className="td-num"><Toman value={item.purchasePoint.valueToman} /></td>
              <td className="td-num"><Ltr>{faNum(item.purchasePoint.usdRate, 0)}</Ltr></td>
              <td className="td-num"><Usd value={item.purchasePoint.valueUsd} /></td>
              <td className="td-num muted">—</td>
              <td className="td-num muted">—</td>
              <td className="td-num muted">—</td>
              <td className="td-num muted">—</td>
            </tr>
          )}
          {item.history.map((row) => (
            <tr key={row.date}>
              <td className="whitespace-nowrap text-[11.5px]"><JDate iso={row.date} /></td>
              <td className="td-num"><Toman value={row.valueToman} /></td>
              <td className="td-num"><Ltr>{faNum(row.usdRate, 0)}</Ltr></td>
              <td className="td-num"><Usd value={row.valueUsd} /></td>
              <td className="td-num">{row.tomanChange ? <DeltaToman value={row.tomanChange} /> : <span className="muted">—</span>}</td>
              <td className="td-num">{row.tomanChangePct ? <DeltaPct value={row.tomanChangePct} /> : <span className="muted">—</span>}</td>
              <td className="td-num">{row.usdChange ? <DeltaUsd value={row.usdChange} /> : <span className="muted">—</span>}</td>
              <td className="td-num">{row.usdChangePct ? <DeltaPct value={row.usdChangePct} /> : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted mt-2 text-[10.5px]">
        هر ردیف یک Snapshot تغییرناپذیر است ({faNum(points.length)} ارزش‌گذاری ثبت‌شده)؛ نرخ دلار ذخیره‌شده در همان ردیف مبنای ارزش
        دلاری آن تاریخ است و ردیف‌ها هرگز حذف یا بازنویسی نمی‌شوند.
      </p>
    </div>
  );
}

/* ───────────────────────── compare two dates ───────────────────────── */

function ComparePanel({ item }: { item: RealEstateDashboardItem }) {
  const points = item.snapshots.map((s) => ({
    date: s.snapshotDate,
    valueToman: s.currentValueToman,
    usdRate: s.usdRate,
    valueUsd: s.currentValueUsd,
  }));
  const all = item.purchasePoint ? [item.purchasePoint, ...points] : points;
  const sorted = [...all].sort((x, y) => (x.date < y.date ? -1 : 1));
  const [from, setFrom] = useState(sorted[0]?.date ?? "");
  const [to, setTo] = useState(sorted.length ? sorted[sorted.length - 1].date : todayIso());

  const result = compareRealEstateDates(points, from, to, item.purchasePoint);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="از تاریخ (میلادی)">
          <input className="field num" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Labeled>
        <Labeled label="تا تاریخ (میلادی)">
          <input className="field num" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
        </Labeled>
      </div>

      {!result.available ? (
        <Hint tone="warn">{result.reason}</Hint>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="ارزش در تاریخ شروع" value={<Toman value={result.from.valueToman} />} sub={<>≈ <Usd value={result.from.valueUsd} /> · نرخ <Ltr>{faNum(result.from.usdRate, 0)}</Ltr> · <JDate iso={result.from.date} /></>} />
            <Metric label="ارزش در تاریخ پایان" value={<Toman value={result.to.valueToman} />} sub={<>≈ <Usd value={result.to.valueUsd} /> · نرخ <Ltr>{faNum(result.to.usdRate, 0)}</Ltr> · <JDate iso={result.to.date} /></>} />
            <Metric label="تغییر تومانی" value={<DeltaToman value={result.tomanChange} />} sub={<DeltaPct value={result.tomanChangePct} />} />
            <Metric label="تغییر دلاری" value={<DeltaUsd value={result.usdChange} />} sub={<DeltaPct value={result.usdChangePct} />} />
          </div>
          {Number(result.tomanChange) > 0 && Number(result.usdChange) < 0 && (
            <Hint tone="warn">
              ارزش ملک به تومان افزایش یافته اما ارزش دلاری آن کاهش یافته است — رشد قیمت از رشد دلار عقب مانده است.
            </Hint>
          )}
          {Number(result.tomanChange) < 0 && Number(result.usdChange) > 0 && (
            <Hint tone="warn">ارزش ملک به تومان کاهش یافته اما ارزش دلاری آن افزایش یافته است (اثر نرخ ارز).</Hint>
          )}
        </>
      )}
    </div>
  );
}
