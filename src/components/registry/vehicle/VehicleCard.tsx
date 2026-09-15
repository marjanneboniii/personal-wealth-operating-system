"use client";

import { useActionState, useMemo, useState } from "react";
import {
  recordVehicleValuationAction,
  sellVehicleAction,
  updateVehicleDetailsAction,
} from "@/app/actions/registry";
import { compareDates, type SnapshotPoint } from "@/features/rwa/vehicle/analytics";
import type { VehicleDashboardItem } from "@/features/rwa/vehicle/dto";
import { currencyLabel, formatMoney, todayIso } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import { DetailRow } from "@/components/registry/realestate/shared";
import VehicleChart from "./VehicleChart";
import { DeltaPct, DeltaToman, DeltaUsd, Hint, JDate, Labeled, Result, Toman, Usd, faNum, yearLabel } from "./shared";

type Tab = "summary" | "history";
type Panel = "none" | "valuation" | "manage";

/**
 * The inside of one car's row: a result strip that states every figure once,
 * performance periods, specs, history — and the two actions a car has
 * (new valuation · edit / sell).
 */
export default function VehicleCard({
  item,
  payoutAccounts = [],
}: {
  item: VehicleDashboardItem;
  payoutAccounts?: { id: string; name: string; symbol: string | null }[];
}) {
  const [tab, setTab] = useState<Tab>("summary");
  const [panel, setPanel] = useState<Panel>("none");
  const active = item.vehicle.status === "active";

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

  return (
    <div className="re-detail">
      <div className="seg" role="group" aria-label={`بخش‌های ${item.vehicle.brand} ${item.vehicle.model}`}>
        {(
          [
            ["summary", "خلاصه"],
            ["history", "تاریخچه"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={tab === key ? "seg-on" : ""} aria-pressed={tab === key}>
            {label}
          </button>
        ))}
      </div>

      {tab === "summary" && <SummaryPanel item={item} />}
      {tab === "history" && <HistoryPanel item={item} points={points} />}

      {panel === "valuation" && (
        <div className="re-revalue">
          <p className="re-section-title">ثبت ارزش‌گذاری جدید</p>
          <ValuationForm item={item} />
        </div>
      )}
      {panel === "manage" && (
        <div className="re-revalue">
          <ManagePanel item={item} payoutAccounts={payoutAccounts} />
        </div>
      )}

      <div className="re-actions">
        {active && panel !== "valuation" && (
          <button type="button" className="btn btn-soft" onClick={() => setPanel("valuation")}>
            ثبت ارزش‌گذاری
          </button>
        )}
        {panel !== "manage" && (
          <button type="button" className="btn btn-ghost" onClick={() => setPanel("manage")}>
            {active ? "ویرایش / فروش" : "ویرایش"}
          </button>
        )}
        {panel !== "none" && (
          <button type="button" className="btn btn-ghost" onClick={() => setPanel("none")}>
            بستن
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────── summary ───────────────────────── */

function SummaryPanel({ item }: { item: VehicleDashboardItem }) {
  const { vehicle, catalog, valuation, gains, periods, holding } = item;
  const sold = vehicle.status === "sold";
  const divergence =
    gains.gainToman && gains.gainUsd && Number(gains.gainToman) > 0 && Number(gains.gainUsd) < 0
      ? "ارزش تومانی بالا رفته اما ارزش دلاری کم شده است؛ رشد قیمت خودرو از رشد دلار عقب مانده."
      : gains.gainToman && gains.gainUsd && Number(gains.gainToman) < 0 && Number(gains.gainUsd) > 0
        ? "ارزش تومانی کم شده اما ارزش دلاری بالا رفته است (اثر نرخ ارز)."
        : null;

  return (
    <div className="re-panel">
      <dl className="metric-strip re-facts">
        <div>
          <dt>{sold ? "قیمت فروش" : "ارزش فعلی"}</dt>
          <dd>
            {sold ? (
              <Toman value={vehicle.salePriceToman} />
            ) : valuation.currentValueToman ? (
              <Toman value={valuation.currentValueToman} />
            ) : (
              <span className="muted">ثبت نشده</span>
            )}
          </dd>
          <dd className="re-sub">
            <Usd value={sold ? vehicle.saleValueUsd : valuation.currentValueUsd} /> ·{" "}
            <JDate iso={sold ? vehicle.saleDate : valuation.lastValuationDate} />
          </dd>
        </div>
        <div>
          <dt>قیمت خرید</dt>
          <dd>
            <Toman value={vehicle.purchasePriceToman} />
          </dd>
          <dd className="re-sub">
            <Usd value={vehicle.purchaseValueUsd} /> · <JDate iso={vehicle.ownershipDate} />
          </dd>
        </div>
        <div>
          <dt>{gains.realised ? "سود / زیان نهایی" : "سود / زیان"}</dt>
          <dd>
            <DeltaToman value={gains.gainToman} />
          </dd>
          <dd className="re-sub">
            تومانی <DeltaPct value={gains.roiToman} /> · دلاری <DeltaPct value={gains.roiUsd} />
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
            {periods.map((row) => (
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
            <DetailRow label="سال ساخت">{yearLabel(vehicle.year)}</DetailRow>
            {catalog?.manufacturer && <DetailRow label="سازنده">{catalog.manufacturer}</DetailRow>}
            {vehicle.licensePlate && <DetailRow label="پلاک">{vehicle.licensePlate}</DetailRow>}
            {vehicle.mileage != null && <DetailRow label="کارکرد">{`${faNum(vehicle.mileage)} کیلومتر`}</DetailRow>}
            {holding && <DetailRow label="مدت مالکیت">{holding.label}</DetailRow>}
          </div>
          <div>
            <DetailRow label="نرخ دلار روز خرید">
              <span className="num money-nowrap" dir="rtl">
                {vehicle.purchaseUsdRate ? formatMoney(vehicle.purchaseUsdRate, "IRT") : "—"}
              </span>
            </DetailRow>
            <DetailRow label="نرخ دلار آخرین ارزش‌گذاری">
              <span className="num money-nowrap" dir="rtl">
                {valuation.currentUsdRate ? formatMoney(valuation.currentUsdRate, "IRT") : "—"}
              </span>
            </DetailRow>
            {valuation.scope === "catalog" && <DetailRow label="مبنای ارزش">ارزش بازار همین مدل</DetailRow>}
          </div>
        </div>
        {vehicle.notes && <p className="muted re-note">یادداشت: {vehicle.notes}</p>}
      </details>
    </div>
  );
}

/* ───────────────────────── history + compare ───────────────────────── */

function HistoryPanel({ item, points }: { item: VehicleDashboardItem; points: SnapshotPoint[] }) {
  const { history, purchasePoint } = item;
  if (!history.length && !purchasePoint) {
    return <p className="muted re-note">هنوز ارزش‌گذاری‌ای ثبت نشده است.</p>;
  }
  return (
    <div className="re-panel">
      <VehicleChart points={points} purchasePoint={purchasePoint} />
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
            {purchasePoint && (
              <tr>
                <td>
                  <JDate iso={purchasePoint.date} /> <span className="muted">· خرید</span>
                </td>
                <td className="td-num">
                  <Toman value={purchasePoint.valueToman} />
                </td>
                <td className="td-num muted">—</td>
                <td className="td-num">
                  <Usd value={purchasePoint.valueUsd} />
                </td>
                <td className="td-num muted">—</td>
              </tr>
            )}
            {history.map((row) => (
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
        <ComparePanel points={points} purchasePoint={purchasePoint} />
      </details>
    </div>
  );
}

function ComparePanel({ points, purchasePoint }: { points: SnapshotPoint[]; purchasePoint: SnapshotPoint | null }) {
  const all = purchasePoint ? [purchasePoint, ...points] : points;
  const sorted = [...all].sort((a, b) => (a.date < b.date ? -1 : 1));
  const [from, setFrom] = useState(sorted[0]?.date ?? "");
  const [to, setTo] = useState(sorted.length ? sorted[sorted.length - 1].date : todayIso());
  const result = compareDates(points, from, to, purchasePoint);

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

/* ───────────────────────── new valuation ───────────────────────── */

function ValuationForm({ item }: { item: VehicleDashboardItem }) {
  const [state, action, pending] = useActionState(recordVehicleValuationAction, null);
  const [scope, setScope] = useState<"vehicle" | "catalog">("vehicle");

  if (!item.vehicle.catalogId) {
    return <Hint tone="warn">این خودرو هنوز به کاتالوگ متصل نیست؛ ابتدا خودرو را از کاتالوگ ثبت کنید.</Hint>;
  }

  return (
    <form action={action} className="re-panel">
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
        <Labeled label="تاریخ ارزش‌گذاری" required>
          <JalaliDatePicker name="snapshotDate" defaultValue={todayIso()} required ariaLabel="تاریخ ارزش‌گذاری" />
        </Labeled>
        <Labeled label="ارزش فعلی (تومان)" required>
          <AmountInput className="field num" name="currentValueToman" inputMode="numeric" dir="ltr" unit="toman" required />
        </Labeled>
        <Labeled label="نرخ دلار (اختیاری)" hint="خالی بماند: نرخ همان تاریخ.">
          <AmountInput className="field num" name="usdRate" inputMode="numeric" showWords={false} />
        </Labeled>
      </div>

      <Labeled label="یادداشت (اختیاری)">
        <input className="field" name="note" placeholder="منبع ارزش‌گذاری، وضعیت خودرو…" />
      </Labeled>

      <div className="re-actions">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ثبت…" : "ثبت ارزش‌گذاری"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

/* ───────────────────────── manage / sell ───────────────────────── */

function ManagePanel({
  item,
  payoutAccounts = [],
}: {
  item: VehicleDashboardItem;
  payoutAccounts?: { id: string; name: string; symbol: string | null }[];
}) {
  const [detailState, detailAction, detailPending] = useActionState(updateVehicleDetailsAction, null);
  const [saleState, saleAction, salePending] = useActionState(sellVehicleAction, null);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <form action={detailAction} className="re-panel">
        <p className="re-section-title">ویرایش اطلاعات</p>
        <input type="hidden" name="vehicleId" value={item.vehicle.id} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Labeled label="پلاک">
            <input className="field" name="plate" defaultValue={item.vehicle.licensePlate ?? ""} />
          </Labeled>
          <Labeled label="کارکرد (کیلومتر)">
            <AmountInput className="field num" name="mileage" inputMode="numeric" defaultValue={item.vehicle.mileage ?? ""} showWords={false} unit="none" />
          </Labeled>
        </div>
        <Labeled label="یادداشت">
          <input className="field" name="notes" defaultValue={item.vehicle.notes ?? ""} />
        </Labeled>
        <div className="re-actions">
          <button className="btn" disabled={detailPending}>
            {detailPending ? "در حال ذخیره…" : "ذخیره"}
          </button>
        </div>
        <Result state={detailState} />
      </form>

      {item.vehicle.status === "active" && (
        <form action={saleAction} className="re-panel">
          <p className="re-section-title">ثبت فروش</p>
          <input type="hidden" name="vehicleId" value={item.vehicle.id} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="تاریخ فروش" required>
              <JalaliDatePicker name="saleDate" defaultValue={todayIso()} required ariaLabel="تاریخ فروش" />
            </Labeled>
            <Labeled label="قیمت فروش (تومان)" required>
              <AmountInput className="field num" name="salePriceToman" inputMode="numeric" dir="ltr" unit="toman" required />
            </Labeled>
          </div>
          <Labeled label="نرخ دلار فروش (اختیاری)">
            <AmountInput className="field num" name="saleUsdRate" inputMode="numeric" placeholder="نرخ تاریخ فروش" showWords={false} />
          </Labeled>
          <Labeled label="واریز به حساب (اختیاری)" hint="با انتخاب حساب، سند فروش در دفترکل ثبت می‌شود.">
            <select className="field" name="saleAccountId" defaultValue="">
              <option value="">بدون ثبت در دفترکل</option>
              {payoutAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.symbol && a.symbol !== "IRT" ? ` — ${currencyLabel(a.symbol)}` : ""}
                </option>
              ))}
            </select>
          </Labeled>
          <div className="re-actions">
            <button className="btn" disabled={salePending}>
              {salePending ? "در حال ثبت…" : "ثبت فروش"}
            </button>
          </div>
          <Result state={saleState} />
        </form>
      )}
    </div>
  );
}
