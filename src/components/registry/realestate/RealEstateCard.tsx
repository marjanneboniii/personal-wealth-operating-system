"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { deleteRealEstateAction, recordRealEstateValuationAction } from "@/app/actions/realEstate";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import AmountInput from "@/components/ui/AmountInput";
import { todayIso } from "@/lib/format";
import { compareRealEstateDates } from "@/features/rwa/realEstate/analytics";
import type { RealEstateDashboardItem } from "@/features/rwa/realEstate/service";
import type { PropertyMarketView } from "@/features/rwa/realEstate/market/service";
import { yearLabel } from "@/components/registry/vehicle/shared";
import MarketPanel from "./MarketPanel";
import { DeltaPct, DeltaToman, DeltaUsd, DetailRow, FxRateInfo, Hint, JDate, Labeled, Result, Toman, Usd, faNum } from "./shared";

type Tab = "summary" | "market" | "history";

const MARKET_NOTE = "برآورد بازار";

export default function RealEstateCard({
  item,
  marketView,
}: {
  item: RealEstateDashboardItem;
  marketView?: PropertyMarketView;
}) {
  const [state, action, pending] = useActionState(recordRealEstateValuationAction, null);
  const [tab, setTab] = useState<Tab>("summary");
  const [revalue, setRevalue] = useState(false);
  const [prefill, setPrefill] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  const a = item;
  const ledgerLink = a.ledgerEntryId ? `/ledger?entry=${a.ledgerEntryId}` : null;

  return (
    <div className="re-detail">
      <div className="seg" role="group" aria-label={`بخش‌های ${a.label}`}>
        {(
          [
            ["summary", "خلاصه"],
            ["market", "بازار"],
            ["history", "تاریخچه"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={tab === key ? "seg-on" : ""} aria-pressed={tab === key}>
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && <SummaryPanel item={item} />}
      {tab === "market" && (
        <MarketPanel
          view={marketView}
          onUseEstimate={(value) => {
            setPrefill(value);
            setRevalue(true);
          }}
        />
      )}
      {tab === "history" && <HistoryPanel item={item} />}

      {revalue && (
        <form action={action} className="re-revalue">
          <input type="hidden" name="propertyId" value={a.id} />
          {prefill && <input type="hidden" name="note" value={MARKET_NOTE} />}
          <p className="re-section-title">ثبت ارزش‌گذاری جدید</p>
          {prefill && (
            <Hint>
              مبلغ از برآورد بازار پر شد. پیش از ثبت، عدد را بر اساس شناخت خودتان از ملک اصلاح کنید.
            </Hint>
          )}
          <div className="grid gap-3 md:grid-cols-3">
            <JalaliDateInput name="valuationDate" label="تاریخ ارزش‌گذاری" required />
            <Labeled label="ارزش فعلی (تومان)" required>
              <AmountInput
                key={prefill ?? "manual"}
                className="field num"
                name="currentValueToman"
                inputMode="numeric"
                dir="ltr"
                defaultValue={prefill ?? undefined}
                unit="toman"
                required
              />
            </Labeled>
            <Labeled label="نرخ دلار (اختیاری)" hint="خالی بماند: نرخ همان تاریخ.">
              <AmountInput className="field num" name="valuationFxRate" inputMode="numeric" showWords={false} />
            </Labeled>
          </div>
          <div className="re-actions">
            <button className="btn btn-primary" disabled={pending}>
              {pending ? "در حال ثبت…" : "ثبت ارزش‌گذاری"}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setRevalue(false);
                setPrefill(null);
              }}
            >
              انصراف
            </button>
          </div>
          <Result state={state} />
        </form>
      )}

      <div className="re-actions">
        {!revalue && (
          <button type="button" className="btn btn-soft" onClick={() => setRevalue(true)}>
            ثبت ارزش‌گذاری
          </button>
        )}
        {ledgerLink && (
          <Link href={ledgerLink} className="btn btn-ghost">
            سند دفترکل
          </Link>
        )}
        <button
          type="button"
          className="btn btn-ghost re-danger"
          disabled={deleting}
          onClick={() => {
            const ok = window.confirm(`${a.label} از گزارش‌ها، سبد و شاخص‌های ثروت حذف می‌شود. سند دفترکل دست‌نخورده می‌ماند. ادامه می‌دهید؟`);
            if (!ok) return;
            startDelete(async () => {
              const result = await deleteRealEstateAction(a.id);
              setDeleteMessage(result.message);
            });
          }}
        >
          {deleting ? "در حال حذف…" : "حذف ملک"}
        </button>
      </div>
      {deleteMessage && <p className="muted re-note">{deleteMessage}</p>}
    </div>
  );
}

/* ───────────────────────── summary ───────────────────────── */

function SummaryPanel({ item }: { item: RealEstateDashboardItem }) {
  const a = item;
  const p = item.performance;
  const divergence =
    p.gainToman && p.gainUsd && Number(p.gainToman) > 0 && Number(p.gainUsd) < 0
      ? "ارزش تومانی بالا رفته اما ارزش دلاری کم شده است؛ رشد قیمت ملک از رشد دلار عقب مانده."
      : p.gainToman && p.gainUsd && Number(p.gainToman) < 0 && Number(p.gainUsd) > 0
        ? "ارزش تومانی کم شده اما ارزش دلاری بالا رفته است (اثر نرخ ارز)."
        : null;

  return (
    <div className="re-panel">
      <dl className="metric-strip re-facts">
        <div>
          <dt>ارزش فعلی</dt>
          <dd>
            <Toman value={a.currentValueToman} />
          </dd>
          <dd className="re-sub">
            <Usd value={a.currentValueUsd} /> · <JDate iso={a.valuationDate} />
          </dd>
        </div>
        <div>
          <dt>قیمت خرید</dt>
          <dd>
            <Toman value={a.purchasePriceToman} />
          </dd>
          <dd className="re-sub">
            <Usd value={a.purchaseValueUsd} /> · <JDate iso={a.acquisitionDate} />
          </dd>
        </div>
        <div>
          <dt>سود / زیان</dt>
          <dd>
            <DeltaToman value={p.gainToman} />
          </dd>
          <dd className="re-sub">
            <DeltaUsd value={p.gainUsd} />
          </dd>
        </div>
        <div>
          <dt>بازده</dt>
          <dd>
            <DeltaPct value={p.roiToman} />
          </dd>
          <dd className="re-sub">
            دلاری <DeltaPct value={p.roiUsd} />
            {item.cagrToman && (
              <>
                {" "}
                · سالانه <DeltaPct value={item.cagrToman} />
              </>
            )}
          </dd>
        </div>
      </dl>

      {divergence && <Hint tone="warn">{divergence}</Hint>}

      <div className="overflow-x-auto">
        <table className="table re-periods">
          <thead>
            <tr>
              <th scope="col">بازه</th>
              <th scope="col" className="td-num">تغییر تومانی</th>
              <th scope="col" className="td-num">٪ تومانی</th>
              <th scope="col" className="td-num">٪ دلاری</th>
            </tr>
          </thead>
          <tbody>
            {item.periods.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {row.available ? (
                  <>
                    <td className="td-num">
                      <DeltaToman value={row.tomanChange} />
                    </td>
                    <td className="td-num">
                      <DeltaPct value={row.tomanChangePct} />
                    </td>
                    <td className="td-num">
                      <DeltaPct value={row.usdChangePct} />
                    </td>
                  </>
                ) : (
                  <td colSpan={3} className="muted">
                    داده کافی نیست
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="re-specs">
        <summary>مشخصات و نرخ‌های ثبت‌شده</summary>
        <div className="re-specs-grid">
          <div>
            <DetailRow label="نوع ملک">{a.propertyTypeNameFa ?? a.propertyType ?? "—"}</DetailRow>
            <DetailRow label="شهر / محله">
              {a.cityNameFa ?? a.cityNameEn ?? "—"} · {a.neighborhoodNameFa ?? a.area ?? "—"}
            </DetailRow>
            <DetailRow label="متراژ">{a.sizeSqm ? `${faNum(a.sizeSqm)} متر` : "—"}</DetailRow>
            <DetailRow label="سال ساخت">{yearLabel(a.yearBuilt)}</DetailRow>
            {a.floor !== null && <DetailRow label="طبقه">{faNum(a.floor)}</DetailRow>}
            {a.address && <DetailRow label="نشانی">{a.address}</DetailRow>}
            {a.deedNumber && <DetailRow label="شماره سند">{a.deedNumber}</DetailRow>}
          </div>
          <div>
            <DetailRow label="نرخ دلار روز خرید">
              <FxRateInfo rate={a.purchaseFxRate} source={a.purchaseFxRateSource} effectiveDate={a.purchaseFxRateDate} />
            </DetailRow>
            <DetailRow label="نرخ دلار روز ارزش‌گذاری">
              <FxRateInfo rate={a.valuationFxRate} source={a.valuationFxRateSource} effectiveDate={a.valuationFxRateDate} />
            </DetailRow>
            <DetailRow label="ثبت در سیستم">
              <JDate iso={a.systemEntryDate} />
              {a.isHistorical && <span className="muted"> · تملک پیش از ثبت</span>}
            </DetailRow>
          </div>
        </div>
        {a.notes && <p className="muted re-note">یادداشت: {a.notes}</p>}
      </details>
    </div>
  );
}

/* ───────────────────────── history + compare ───────────────────────── */

function HistoryPanel({ item }: { item: RealEstateDashboardItem }) {
  if (!item.history.length && !item.purchasePoint) {
    return <p className="muted re-note">هنوز ارزش‌گذاری‌ای ثبت نشده است.</p>;
  }
  return (
    <div className="re-panel">
      <div className="overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">تاریخ</th>
              <th scope="col" className="td-num">ارزش</th>
              <th scope="col" className="td-num">تغییر</th>
              <th scope="col" className="td-num">ارزش دلاری</th>
              <th scope="col" className="td-num">تغییر دلاری</th>
            </tr>
          </thead>
          <tbody>
            {item.purchasePoint && (
              <tr>
                <td>
                  <JDate iso={item.purchasePoint.date} /> <span className="muted">· خرید</span>
                </td>
                <td className="td-num">
                  <Toman value={item.purchasePoint.valueToman} />
                </td>
                <td className="td-num muted">—</td>
                <td className="td-num">
                  <Usd value={item.purchasePoint.valueUsd} />
                </td>
                <td className="td-num muted">—</td>
              </tr>
            )}
            {item.history.map((row) => (
              <tr key={row.date}>
                <td>
                  <JDate iso={row.date} />
                </td>
                <td className="td-num">
                  <Toman value={row.valueToman} />
                </td>
                <td className="td-num">{row.tomanChangePct ? <DeltaPct value={row.tomanChangePct} /> : <span className="muted">—</span>}</td>
                <td className="td-num">
                  <Usd value={row.valueUsd} />
                </td>
                <td className="td-num">{row.usdChangePct ? <DeltaPct value={row.usdChangePct} /> : <span className="muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted re-note">هر ردیف یک ارزش‌گذاری تغییرناپذیر است و دلار آن با نرخ همان روز محاسبه شده است.</p>
      <details className="re-specs">
        <summary>مقایسهٔ دو تاریخ</summary>
        <ComparePanel item={item} />
      </details>
    </div>
  );
}

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
    <div className="re-panel">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="از تاریخ">
          <JalaliDatePicker value={from} onChange={setFrom} ariaLabel="از تاریخ" showToday={false} />
        </Labeled>
        <Labeled label="تا تاریخ">
          <JalaliDatePicker value={to} onChange={setTo} ariaLabel="تا تاریخ" />
        </Labeled>
      </div>
      {!result.available ? (
        <Hint tone="warn">{result.reason}</Hint>
      ) : (
        <dl className="metric-strip re-facts">
          <div>
            <dt>ارزش شروع</dt>
            <dd>
              <Toman value={result.from.valueToman} />
            </dd>
            <dd className="re-sub">
              <Usd value={result.from.valueUsd} />
            </dd>
          </div>
          <div>
            <dt>ارزش پایان</dt>
            <dd>
              <Toman value={result.to.valueToman} />
            </dd>
            <dd className="re-sub">
              <Usd value={result.to.valueUsd} />
            </dd>
          </div>
          <div>
            <dt>تغییر تومانی</dt>
            <dd>
              <DeltaToman value={result.tomanChange} />
            </dd>
            <dd className="re-sub">
              <DeltaPct value={result.tomanChangePct} />
            </dd>
          </div>
          <div>
            <dt>تغییر دلاری</dt>
            <dd>
              <DeltaUsd value={result.usdChange} />
            </dd>
            <dd className="re-sub">
              <DeltaPct value={result.usdChangePct} />
            </dd>
          </div>
        </dl>
      )}
    </div>
  );
}
