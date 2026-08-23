"use client";

import { useActionState, useMemo, useState } from "react";
import {
  recordVehicleValuationAction,
  sellVehicleAction,
  updateVehicleDetailsAction,
} from "@/app/actions/registry";
import { compareDates, type SnapshotPoint } from "@/features/rwa/vehicle/analytics";
import type { VehicleDashboardItem } from "@/features/rwa/vehicle/dto";
import { formatMoney, toFaDigits, todayIso } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import VehicleChart from "./VehicleChart";
import {
  DeltaPct,
  DeltaToman,
  DeltaUsd,
  Hint,
  JDate,
  Labeled,
  Metric,
  Result,
  StatusChip,
  Toman,
  Usd,
  faNum,
  yearLabel,
} from "./shared";

type Tab = "performance" | "history" | "compare" | "valuation" | "manage";

export default function VehicleCard({ item }: { item: VehicleDashboardItem }) {
  const { vehicle, catalog, valuation, gains, purchasePoint, history, periods, holding } = item;
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("performance");

  const points: SnapshotPoint[] = useMemo(
    () =>
      item.snapshots.map((s) => ({
        date: s.snapshotDate,
        valueToman: s.currentValueToman,
        usdRate: s.usdRate,
        valueUsd: s.currentValueUsd,
      })),
    [item.snapshots],
  );

  const title = `${vehicle.brand} ${vehicle.model}`;
  const divergence =
    gains.gainToman && gains.gainUsd && Number(gains.gainToman) > 0 && Number(gains.gainUsd) < 0
      ? "ارزش خودرو به تومان افزایش یافته اما ارزش دلاری آن کاهش یافته است."
      : gains.gainToman && gains.gainUsd && Number(gains.gainToman) < 0 && Number(gains.gainUsd) > 0
        ? "ارزش خودرو به تومان کاهش یافته اما ارزش دلاری آن افزایش یافته است."
        : null;

  return (
    <article className="card p-4 sm:p-5">
      {/* ── Header ── */}
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-[13px] sm:text-[14px] font-bold tracking-tight">
            🚗 {title}
            {vehicle.assetSymbol && (
              <span className="badge badge-neutral num">شناسه {toFaDigits(vehicle.assetSymbol)}</span>
            )}
            <StatusChip status={vehicle.status} />
            {valuation.scope === "catalog" && (
              <span className="muted text-[10px]">ارزش‌گذاری در سطح مدل (بازار)</span>
            )}
          </h3>
          <p className="muted mt-1 text-[11px] leading-5">
            سال ساخت: {yearLabel(vehicle.year)}
            {catalog?.manufacturer ? ` · سازنده/مونتاژکننده: ${catalog.manufacturer}` : ""}
            {vehicle.licensePlate ? ` · پلاک: ${vehicle.licensePlate}` : ""}
            {vehicle.mileage != null ? ` · کارکرد: ${faNum(vehicle.mileage)} کیلومتر` : ""}
          </p>
        </div>
        <button type="button" className="btn text-[12px]" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? "بستن جزئیات" : "تحلیل و تاریخچه"}
        </button>
      </header>

      {/* ── KPI grid ── */}
      <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-3 lg:grid-cols-4" style={{ borderColor: "var(--border)" }}>
        <Metric label="تاریخ تملک" value={<JDate iso={vehicle.ownershipDate} />} sub={holding ? `مدت مالکیت: ${holding.label}` : undefined} />
        <Metric
          label="قیمت خرید"
          value={<Toman value={vehicle.purchasePriceToman} />}
          sub={
            vehicle.purchaseValueUsd ? (
              <>
                ≈ <Usd value={vehicle.purchaseValueUsd} /> · نرخ خرید:{" "}
                <span className="num">{vehicle.purchaseUsdRate ? formatMoney(vehicle.purchaseUsdRate, "IRT") : "—"}</span>
              </>
            ) : undefined
          }
        />
        <Metric
          label="ارزش فعلی"
          value={valuation.currentValueToman ? <Toman value={valuation.currentValueToman} /> : <span className="muted text-[12px]">ارزش‌گذاری ثبت نشده</span>}
          sub={
            valuation.currentValueUsd ? (
              <>
                ≈ <Usd value={valuation.currentValueUsd} /> · نرخ Snapshot:{" "}
                <span className="num">{valuation.currentUsdRate ? formatMoney(valuation.currentUsdRate, "IRT") : "—"}</span>
              </>
            ) : (
              "برای محاسبه سود/زیان یک ارزش‌گذاری ثبت کنید."
            )
          }
        />
        <Metric
          label="آخرین ارزش‌گذاری"
          value={<JDate iso={valuation.lastValuationDate} fallback="—" />}
          sub={vehicle.status === "sold" ? <>تاریخ فروش: <JDate iso={vehicle.saleDate} /></> : "ارزش فعلی فقط با Snapshot جدید تغییر می‌کند"}
        />
        <Metric
          label={gains.realised ? "سود/زیان نهایی (تومان)" : "سود/زیان تومانی"}
          value={<DeltaToman value={gains.gainToman} />}
          sub={<>بازدهی: <DeltaPct value={gains.roiToman} /></>}
        />
        <Metric
          label={gains.realised ? "سود/زیان نهایی (دلار)" : "سود/زیان دلاری"}
          value={<DeltaUsd value={gains.gainUsd} />}
          sub={<>بازدهی: <DeltaPct value={gains.roiUsd} /></>}
        />
        {vehicle.status === "sold" && (
          <Metric
            label="قیمت واقعی فروش"
            value={<Toman value={vehicle.salePriceToman} />}
            sub={vehicle.saleValueUsd ? <>≈ <Usd value={vehicle.saleValueUsd} /></> : undefined}
          />
        )}
        {(item.cagrToman || item.cagrUsd) && (
          <Metric
            label="CAGR (سالانه مرکب)"
            value={<DeltaPct value={item.cagrToman} />}
            sub={item.cagrUsd ? <>دلاری: <DeltaPct value={item.cagrUsd} /></> : "فقط با داده واقعی بیش از یک سال"}
          />
        )}
      </div>

      {divergence && (
        <div className="mt-3">
          <Hint tone="warn">{divergence}</Hint>
        </div>
      )}

      {/* ── Details ── */}
      {open && (
        <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
          <div className="seg mb-4 flex-wrap" role="group" aria-label="بخش‌های تحلیل خودرو">
            {(
              [
                ["performance", "بازه‌های عملکرد"],
                ["history", "تاریخچه و نمودار"],
                ["compare", "مقایسه دو تاریخ"],
                ["valuation", "ثبت ارزش جدید"],
                ["manage", "ویرایش / فروش"],
              ] as [Tab, string][]
            ).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)} className={tab === key ? "seg-on" : ""} aria-pressed={tab === key}>
                {label}
              </button>
            ))}
          </div>

          {tab === "performance" && <PerformanceTable periods={periods} />}

          {tab === "history" && (
            <div className="space-y-5">
              <VehicleChart points={points} purchasePoint={purchasePoint} />
              <HistoryTable history={history} purchasePoint={purchasePoint} />
            </div>
          )}

          {tab === "compare" && <ComparePanel points={points} purchasePoint={purchasePoint} />}

          {tab === "valuation" && <ValuationForm item={item} />}

          {tab === "manage" && <ManagePanel item={item} />}
        </div>
      )}
    </article>
  );
}

/* ───────────────────────── performance ───────────────────────── */

function PerformanceTable({ periods }: { periods: VehicleDashboardItem["periods"] }) {
  return (
    <div className="overflow-x-auto">
      <table className="table">
        <thead>
          <tr>
            <th>بازه</th>
            <th className="td-num">تغییر تومانی</th>
            <th className="td-num">٪ تومانی</th>
            <th className="td-num">تغییر دلاری</th>
            <th className="td-num">٪ دلاری</th>
            <th className="td-num hidden sm:table-cell">مبنا</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => (
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
      <p className="muted mt-2 text-[10.5px] leading-5">
        همه محاسبات فقط بر پایه Snapshotهای واقعی انجام می‌شوند. اگر برای یک بازه داده تاریخی وجود نداشته باشد، هیچ مقدار
        فرضی ساخته نمی‌شود.
      </p>
    </div>
  );
}

/* ───────────────────────── history table ───────────────────────── */

function HistoryTable({
  history,
  purchasePoint,
}: {
  history: VehicleDashboardItem["history"];
  purchasePoint: SnapshotPoint | null;
}) {
  if (!history.length) {
    return <p className="muted text-[11.5px]">هنوز هیچ Snapshot ارزش‌گذاری برای این خودرو ثبت نشده است.</p>;
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
          {purchasePoint && (
            <tr style={{ background: "var(--brand-softer)" }}>
              <td className="whitespace-nowrap text-[11.5px]">
                <JDate iso={purchasePoint.date} /> <span className="muted">· خرید</span>
              </td>
              <td className="td-num"><Toman value={purchasePoint.valueToman} /></td>
              <td className="td-num num" dir="rtl">{formatMoney(purchasePoint.usdRate, "IRT")}</td>
              <td className="td-num"><Usd value={purchasePoint.valueUsd} /></td>
              <td className="td-num muted">—</td>
              <td className="td-num muted">—</td>
              <td className="td-num muted">—</td>
              <td className="td-num muted">—</td>
            </tr>
          )}
          {history.map((row) => (
            <tr key={row.date}>
              <td className="whitespace-nowrap text-[11.5px]"><JDate iso={row.date} /></td>
              <td className="td-num"><Toman value={row.valueToman} /></td>
              <td className="td-num num" dir="rtl">{formatMoney(row.usdRate, "IRT")}</td>
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
        هر ردیف یک Snapshot تغییرناپذیر است؛ نرخ دلار ذخیره‌شده در همان ردیف مبنای ارزش دلاری آن تاریخ است.
      </p>
    </div>
  );
}

/* ───────────────────────── compare two dates ───────────────────────── */

function ComparePanel({ points, purchasePoint }: { points: SnapshotPoint[]; purchasePoint: SnapshotPoint | null }) {
  const all = purchasePoint ? [purchasePoint, ...points] : points;
  const sorted = [...all].sort((a, b) => (a.date < b.date ? -1 : 1));
  const [from, setFrom] = useState(sorted[0]?.date ?? "");
  const [to, setTo] = useState(sorted.length ? sorted[sorted.length - 1].date : todayIso());

  const result = compareDates(points, from, to, purchasePoint);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Labeled label="از تاریخ">
          <input className="field num" type="date" dir="ltr" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Labeled>
        <Labeled label="تا تاریخ">
          <input className="field num" type="date" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} />
        </Labeled>
      </div>

      {!result.available ? (
        <Hint tone="warn">{result.reason}</Hint>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Metric label="ارزش در تاریخ شروع" value={<Toman value={result.from.valueToman} />} sub={<>≈ <Usd value={result.from.valueUsd} /> · <JDate iso={result.from.date} /></>} />
            <Metric label="ارزش در تاریخ پایان" value={<Toman value={result.to.valueToman} />} sub={<>≈ <Usd value={result.to.valueUsd} /> · <JDate iso={result.to.date} /></>} />
            <Metric label="تغییر تومانی" value={<DeltaToman value={result.tomanChange} />} sub={<DeltaPct value={result.tomanChangePct} />} />
            <Metric label="تغییر دلاری" value={<DeltaUsd value={result.usdChange} />} sub={<DeltaPct value={result.usdChangePct} />} />
          </div>
          {Number(result.tomanChange) > 0 && Number(result.usdChange) < 0 && (
            <Hint tone="warn">ارزش خودرو به تومان افزایش یافته اما ارزش دلاری آن کاهش یافته است.</Hint>
          )}
          {Number(result.tomanChange) < 0 && Number(result.usdChange) > 0 && (
            <Hint tone="warn">ارزش خودرو به تومان کاهش یافته اما ارزش دلاری آن افزایش یافته است.</Hint>
          )}
        </>
      )}
    </div>
  );
}

/* ───────────────────────── new valuation ───────────────────────── */

function ValuationForm({ item }: { item: VehicleDashboardItem }) {
  const [state, action, pending] = useActionState(recordVehicleValuationAction, null);
  const [scope, setScope] = useState<"vehicle" | "catalog">("vehicle");

  if (!item.vehicle.catalogId) {
    return <Hint tone="warn">این خودرو هنوز به کاتالوگ متصل نیست؛ ابتدا خودرو را از کاتالوگ ثبت کنید.</Hint>;
  }

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="catalogId" value={item.vehicle.catalogId} />
      <input type="hidden" name="vehicleId" value={item.vehicle.id} />
      <input type="hidden" name="scope" value={scope} />

      <div className="seg" role="group" aria-label="دامنه ارزش‌گذاری">
        <button type="button" onClick={() => setScope("vehicle")} className={scope === "vehicle" ? "seg-on" : ""} aria-pressed={scope === "vehicle"}>
          فقط این خودرو
        </button>
        <button type="button" onClick={() => setScope("catalog")} className={scope === "catalog" ? "seg-on" : ""} aria-pressed={scope === "catalog"}>
          ارزش بازار این مدل
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Labeled label="ارزش فعلی (تومان)" required>
          <AmountInput className="field num" name="currentValueToman" inputMode="numeric" dir="ltr" placeholder="5300000000" unit="toman" required />
        </Labeled>
        <Labeled label="تاریخ ارزش‌گذاری" required>
          <input className="field num" type="date" name="snapshotDate" defaultValue={todayIso()} dir="ltr" required />
        </Labeled>
        <Labeled label="نرخ دلار (اختیاری)" hint="خالی بماند: نرخ همان تاریخ از سیستم نرخ ارز خوانده می‌شود.">
          <input className="field num" name="usdRate" inputMode="numeric" dir="ltr" placeholder="210000" />
        </Labeled>
      </div>

      <Labeled label="یادداشت (اختیاری)">
        <input className="field" name="note" placeholder="منبع ارزش‌گذاری، وضعیت خودرو…" />
      </Labeled>

      <Hint>
        هر ثبت، یک Snapshot جدید و تغییرناپذیر می‌سازد؛ Snapshotهای قبلی هرگز به‌روزرسانی نمی‌شوند. چرخه پیشنهادی
        ارزش‌گذاری: هر دو هفته یک‌بار.
      </Hint>

      <button className="btn btn-primary" disabled={pending}>
        {pending ? "در حال ثبت…" : "ثبت ارزش‌گذاری جدید"}
      </button>
      <Result state={state} />
    </form>
  );
}

/* ───────────────────────── manage / sell ───────────────────────── */

function ManagePanel({ item }: { item: VehicleDashboardItem }) {
  const [detailState, detailAction, detailPending] = useActionState(updateVehicleDetailsAction, null);
  const [saleState, saleAction, salePending] = useActionState(sellVehicleAction, null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={detailAction} className="space-y-3">
        <h4 className="text-[13px] font-semibold">ویرایش اطلاعات جاری</h4>
        <input type="hidden" name="vehicleId" value={item.vehicle.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="پلاک">
            <input className="field" name="plate" defaultValue={item.vehicle.licensePlate ?? ""} />
          </Labeled>
          <Labeled label="کارکرد (کیلومتر)">
            <input className="field num" name="mileage" inputMode="numeric" dir="ltr" defaultValue={item.vehicle.mileage ?? ""} />
          </Labeled>
        </div>
        <Labeled label="یادداشت">
          <input className="field" name="notes" defaultValue={item.vehicle.notes ?? ""} />
        </Labeled>
        <p className="muted text-[10.5px]">قیمت خرید، نرخ دلار خرید و Snapshotها از این مسیر قابل تغییر نیستند.</p>
        <button className="btn" disabled={detailPending}>
          {detailPending ? "در حال ذخیره…" : "ذخیره تغییرات"}
        </button>
        <Result state={detailState} />
      </form>

      {item.vehicle.status === "active" ? (
        <form action={saleAction} className="space-y-3">
          <h4 className="text-[13px] font-semibold">ثبت فروش خودرو</h4>
          <input type="hidden" name="vehicleId" value={item.vehicle.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="تاریخ فروش" required>
              <input className="field num" type="date" name="saleDate" defaultValue={todayIso()} dir="ltr" required />
            </Labeled>
            <Labeled label="قیمت واقعی فروش (تومان)" required>
              <AmountInput className="field num" name="salePriceToman" inputMode="numeric" dir="ltr" unit="toman" required />
            </Labeled>
          </div>
          <Labeled label="نرخ دلار فروش (اختیاری)">
            <input className="field num" name="saleUsdRate" inputMode="numeric" dir="ltr" placeholder="نرخ تاریخ فروش" />
          </Labeled>
          <Hint tone="warn">قیمت واقعی فروش هرگز با «ارزش فعلی» یکی فرض نمی‌شود و مبنای بازدهی نهایی است.</Hint>
          <button className="btn" disabled={salePending}>
            {salePending ? "در حال ثبت…" : "ثبت فروش"}
          </button>
          <Result state={saleState} />
        </form>
      ) : (
        <div className="space-y-2">
          <h4 className="text-[13px] font-semibold">اطلاعات فروش</h4>
          <div className="grid grid-cols-2 gap-4">
            <Metric label="تاریخ فروش" value={<JDate iso={item.vehicle.saleDate} />} />
            <Metric label="قیمت فروش" value={<Toman value={item.vehicle.salePriceToman} />} sub={<>≈ <Usd value={item.vehicle.saleValueUsd} /></>} />
          </div>
        </div>
      )}
    </div>
  );
}
