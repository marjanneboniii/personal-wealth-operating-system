"use client";

/**
 * «ملک» و «خودرو» در راه‌اندازی اولیه — دو مرحلهٔ مستقل، به همان شکل «رمزارز».
 *
 * THE SHAPE: search → tap + → a card that is already filled in from the
 * registry catalogue (model / neighbourhood, city, property type, year). The
 * user enters only the purchase date and the purchase price; the dollar value
 * AT THAT DATE is looked up right away with the same resolver the registry
 * uses when it stores the purchase — what the card shows is what gets saved.
 *
 * IT BUILDS NOTHING NEW. Brands, models, cities, neighbourhoods and property
 * types come from the EXISTING registry master data, and the write side is
 * delegated, unchanged, to `createUserVehicle` / `createRealEstateAsset`.
 *
 * DRAFTS ONLY: nothing is written until the wizard's final confirmation.
 */
import { useEffect, useMemo, useState } from "react";
import CatalogPicker from "@/components/ui/CatalogPicker";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import StepIntro from "@/components/setup/StepIntro";
import { RealEstateMark, VehicleMark } from "@/components/ui/AssetTypeMarks";
import { D } from "@/domain/decimal";
import { formatDate, formatMoney, toFaDigits, toJalali, toLatinDigits, todayIso } from "@/lib/format";
import { getUsdRateForDateAction } from "@/app/actions/registry";
import { loadRealAssetCatalogsAction, type RealAssetCatalogs } from "@/app/actions/setupRealAssets";
import { amountOf, newRowKey } from "@/components/setup/setupMoney";
import { PRICE_FIELD_LABELS, validatePropertyPrices, validateVehiclePrices, type PriceField, type PriceVerdict } from "@/features/rwa/priceValidation";

/** Result of the price checks, kept on the row so «ready» stays synchronous. */
export type PriceStatus = "pending" | "ok" | "warn" | "block";

export type VehicleDraftRow = {
  key: string;
  catalogId: string;
  /** Display only — «ایران‌خودرو پژو ۲۰۶». */
  label: string;
  /** "" = the Jalali year of the purchase (see `vehicleYearOf`). */
  manufacturingYear: string;
  ownershipDate: string;
  purchasePriceToman: string;
  currentValueToman: string;
  /** کارکرد به کیلومتر (اختیاری). */
  mileage?: string;
  /** The user confirmed the amounts despite a warning. */
  priceConfirmed?: boolean;
  priceStatus?: PriceStatus;
};

export type PropertyDraftRow = {
  key: string;
  cityId: string;
  neighborhoodId: string;
  propertyTypeId: string;
  label: string;
  acquisitionDate: string;
  purchasePriceToman: string;
  /** "" = the purchase price, as the valuation of the purchase day. */
  currentValueToman: string;
  sizeSqm: string;
  /** The user confirmed the amounts despite a warning. */
  priceConfirmed?: boolean;
  priceStatus?: PriceStatus;
};

/** سال ساخت — the one picked, else the Jalali year the car was bought in. */
export function vehicleYearOf(row: VehicleDraftRow): string {
  if (Number(row.manufacturingYear) > 0) return row.manufacturingYear;
  return row.ownershipDate ? String(toJalali(row.ownershipDate).y) : "";
}

/** Prices pass: no warning, or a warning the user confirmed; never a blocked one. */
const pricesAccepted = (row: { priceStatus?: PriceStatus; priceConfirmed?: boolean }) =>
  row.priceStatus === "ok" || (row.priceStatus === "warn" && !!row.priceConfirmed);

/** A vehicle row is complete enough to register (mileage is optional). */
export function vehicleRowReady(row: VehicleDraftRow): boolean {
  return Boolean(
    row.catalogId &&
      row.ownershipDate &&
      Number(row.manufacturingYear) > 0 &&
      amountOf(row.purchasePriceToman).gt(0) &&
      amountOf(row.currentValueToman).gt(0) &&
      pricesAccepted(row),
  );
}

/** A property row is complete enough to register: every field is required. */
export function propertyRowReady(row: PropertyDraftRow): boolean {
  return Boolean(
    row.cityId &&
      row.neighborhoodId &&
      row.propertyTypeId &&
      row.acquisitionDate &&
      amountOf(row.sizeSqm).gt(0) &&
      amountOf(row.purchasePriceToman).gt(0) &&
      amountOf(row.currentValueToman).gt(0) &&
      pricesAccepted(row),
  );
}

/** Fields whose change invalidates the user's price confirmation. */
const PRICE_INPUTS = ["purchasePriceToman", "currentValueToman", "sizeSqm", "manufacturingYear", "ownershipDate", "acquisitionDate", "propertyTypeId", "mileage"];

const TODAY_JY = toJalali(todayIso()).y;
const JALALI_YEARS = Array.from({ length: TODAY_JY + 2 - 1360 }, (_, i) => TODAY_JY + 1 - i);
const GREGORIAN_YEARS = Array.from({ length: Number(todayIso().slice(0, 4)) + 2 - 1980 }, (_, i) => Number(todayIso().slice(0, 4)) + 1 - i);

const digitsOnly = (value: string) => value.replace(/[^\d]/g, "");

/** Search text: Latin digits, Persian ی/ک, one space, lower case. */
function normalize(text: string): string {
  return toLatinDigits(text)
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌\s]+/g, " ")
    .trim()
    .toLowerCase();
}

/* ── shared data ───────────────────────────────────────────────────────── */

// One request per wizard: both steps read the same catalogue.
let catalogsRequest: Promise<RealAssetCatalogs> | null = null;

function useCatalogs(): RealAssetCatalogs | null {
  const [catalogs, setCatalogs] = useState<RealAssetCatalogs | null>(null);
  useEffect(() => {
    let alive = true;
    catalogsRequest ??= loadRealAssetCatalogsAction();
    catalogsRequest
      .then((result) => {
        if (!result.ok) catalogsRequest = null;
        if (alive) setCatalogs(result);
      })
      .catch(() => {
        catalogsRequest = null;
        if (alive) {
          setCatalogs({
            ok: false,
            brands: [],
            models: [],
            cities: [],
            neighborhoods: [],
            propertyTypes: [],
            existingVehicleCount: 0,
          });
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  return catalogs;
}

type RateAt = { rate: string; effectiveDate: string; source: string };
const rateRequests = new Map<string, Promise<RateAt | null>>();

function rateAt(dateIso: string): Promise<RateAt | null> {
  let request = rateRequests.get(dateIso);
  if (!request) {
    request = getUsdRateForDateAction(dateIso)
      .then((r) => { if (!r.ok || !(Number(r.rate)>0)) {rateRequests.delete(dateIso); return null;} return {rate:r.rate,effectiveDate:r.effectiveDate,source:r.source}; })
      .catch(() => {rateRequests.delete(dateIso);return null;});
    rateRequests.set(dateIso, request);
  }
  return request;
}

/* ── shared pieces ─────────────────────────────────────────────────────── */

function Plate({ kind, size = 30 }: { kind: "vehicle" | "property"; size?: number }) {
  const Mark = kind === "vehicle" ? VehicleMark : RealEstateMark;
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden="true"
    >
      <Mark size={size} />
    </span>
  );
}

function CatalogStatus({ catalogs }: { catalogs: RealAssetCatalogs | null }) {
  if (!catalogs) return <p className="muted text-[length:var(--fs-xs)]">در حال بارگذاری فهرست…</p>;
  if (catalogs.ok) return null;
  return (
    <p className="card p-3 text-[length:var(--fs-xs)] leading-6" role="alert" style={{ color: "var(--negative)" }}>
      {catalogs.message ?? "فهرست بارگذاری نشد."} صفحه را دوباره بارگذاری کنید تا بتوانید دارایی خود را انتخاب کنید.
    </p>
  );
}

type SearchItem = { id: string; title: string; subtitle?: string; haystack: string };

function CatalogSearch({ kind, label, items, emptyText, onAdd }: {
  kind:"vehicle"|"property"; label:string; items:SearchItem[]; emptyText:string; onAdd:(id:string)=>void;
}) {
  return <CatalogPicker label={label} options={items.map(item=>({id:item.id,label:toFaDigits(item.title),detail:item.subtitle ? toFaDigits(item.subtitle) : undefined,searchText:item.haystack,mark:<Plate kind={kind} size={28} />}))} onSelect={onAdd} emptyText={emptyText} />;
}

/** «معادل دلاری در زمان خرید» — the free-market dollar of the purchase day. */
export function PurchaseUsd({ dateIso, priceToman, currentRate }: { dateIso: string; priceToman: string; currentRate?:string }) {
  const [attempt,setAttempt] = useState(0);
  const [found, setFound] = useState<{ date: string; rate: RateAt | null } | null>(null);

  useEffect(() => {
    if (!dateIso || dateIso > todayIso()) return;
    let alive = true;
    if(dateIso === todayIso() && currentRate && Number(currentRate)>0) return;
    void rateAt(dateIso).then((rate) => {
      if (alive) setFound({ date: dateIso, rate });
    });
    return () => {
      alive = false;
    };
  }, [dateIso,currentRate,attempt]);

  const box = "soft space-y-1 rounded-[var(--r-md)] p-3";
  if(dateIso > todayIso()) return <p className={`${box} text-xs`} role="alert">تاریخ خرید نمی‌تواند در آینده باشد؛ تاریخ را اصلاح کنید.</p>;
  if (!dateIso) {
    return <p className={`${box} muted text-[length:var(--fs-xs)]`}>تاریخ خرید را انتخاب کنید تا دلار همان روز پیدا شود.</p>;
  }
  const current = dateIso === todayIso() && currentRate && Number(currentRate)>0 ? {date:dateIso,rate:{rate:currentRate,effectiveDate:dateIso,source:"setup_confirmed"}} : found?.date === dateIso ? found : null;
  if (!current) return <p className={`${box} muted text-[length:var(--fs-xs)]`}>در حال یافتن نرخ دلار آن روز…</p>;
  if (!current.rate) {
    return (
      <p className={`${box} text-[length:var(--fs-xs)]`} style={{ color: "var(--warning)" }}>
        نرخ معتبر دلار این تاریخ موجود نیست؛ ثبت خرید تا رفع این مورد انجام نمی‌شود. <button type="button" className="btn btn-ghost !min-h-8 !px-2" onClick={()=>setAttempt(n=>n+1)}>تلاش دوباره</button>
      </p>
    );
  }

  const { rate, effectiveDate, source } = current.rate;
  const price = amountOf(priceToman);
  const usd = price.gt(0) ? price.div(D(rate)).toFixed(2) : null;
  const confirmedToday = dateIso === todayIso() && (source === "current" || source === "setup_confirmed");

  return (
    <div className={box}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[length:var(--fs-xs)] font-medium">معادل دلاری در زمان خرید</span>
        <b className="num money-nowrap text-[length:var(--fs-sm)]" dir="rtl" style={{ color: "var(--action)" }}>
          {usd ? formatMoney(usd, "USD") : "—"}
        </b>
      </div>
      <p className="muted text-[length:var(--fs-xs)] leading-5">
        {confirmedToday ? "نرخ تأییدشدهٔ امروز: " : `دلار ${formatDate(effectiveDate)}: `}
        <span className="num money-nowrap" dir="rtl">
          {formatMoney(rate, "IRT")}
        </span>
      </p>
    </div>
  );
}

/**
 * Toman per dollar for each date: today's confirmed rate, else the historical
 * one. `undefined` = still loading, `null` = no rate for that date.
 */
function useRates(dates: string[], currentRate?: string): (dateIso: string) => string | null | undefined {
  const today = todayIso();
  const key = [...new Set([...dates, today].filter(Boolean))].sort().join(",");
  const confirmedToday = currentRate && Number(currentRate) > 0 ? currentRate : "";
  const [found, setFound] = useState<Record<string, string | null>>({});
  useEffect(() => {
    let alive = true;
    for (const date of key.split(",")) {
      if (!date || date > today || (date === today && confirmedToday)) continue;
      void rateAt(date).then((r) => {
        if (alive) setFound((m) => (m[date] === (r?.rate ?? null) ? m : { ...m, [date]: r?.rate ?? null }));
      });
    }
    return () => { alive = false; };
  }, [key, today, confirmedToday]);
  return (date) => {
    if (!date || date > today) return null;
    if (date === today && confirmedToday) return confirmedToday;
    return found[date];
  };
}

function statusOf(verdict: PriceVerdict, loading: boolean): PriceStatus {
  return loading ? "pending" : verdict.level;
}

/** Keeps every row's `priceStatus` in step with its verdict, in ONE update. */
function useSyncStatuses<T extends { priceStatus?: PriceStatus }>(rows: T[], statuses: PriceStatus[], onChange: (next: T[]) => void) {
  const statusKey = statuses.join("|");
  useEffect(() => {
    const next = statusKey ? statusKey.split("|") as PriceStatus[] : [];
    if (next.length !== rows.length || rows.every((r, i) => r.priceStatus === next[i])) return;
    onChange(rows.map((r, i) => ({ ...r, priceStatus: next[i] })));
  }, [rows, statusKey, onChange]);
}

/** Problems with the amounts, each with a one-tap fix when a slipped zero explains it. */
function PriceIssues({ verdict, confirmed, onFix, onConfirm }: {
  verdict: PriceVerdict;
  confirmed: boolean;
  onFix: (field: PriceField, value: string) => void;
  onConfirm: (next: boolean) => void;
}) {
  if (!verdict.issues.length) return null;
  return (
    <div className="space-y-2 text-[length:var(--fs-xs)] leading-6">
      {verdict.issues.map((issue, index) => (
        <div key={index} role={issue.level === "block" ? "alert" : undefined} style={{ color: issue.level === "block" ? "var(--negative)" : "var(--warning)" }}>
          <p>{PRICE_FIELD_LABELS[issue.field]}: {issue.message}</p>
          {issue.suggestion !== undefined && (
            <button type="button" className="btn btn-ghost !min-h-8 !px-2.5 text-[length:var(--fs-xs)]" onClick={() => onFix(issue.field, String(issue.suggestion))}>
              منظورتان {issue.field === "mileage" ? `${toFaDigits(issue.suggestion.toLocaleString("en-US").replace(/,/g, "٬"))} کیلومتر` : formatMoney(String(issue.suggestion), "IRT")} بود؟
            </button>
          )}
        </div>
      ))}
      {verdict.level === "warn" && (
        <label className="flex items-start gap-2">
          <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} />
          مبلغ‌ها را بررسی کردم و درست است.
        </label>
      )}
    </div>
  );
}

const FIX_FIELD: Record<PriceField, string | null> = { purchase: "purchasePriceToman", current: "currentValueToman", mileage: "mileage", size: null, date: null };

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn !min-h-9 !min-w-9" onClick={onClick} aria-label={`حذف ${label}`}>
      <Icon name="x" size={15} />
    </button>
  );
}

function PriceField({ value, onChange, label = "قیمت خرید (تومان)" }: { value: string; onChange: (next: string) => void; label?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      <AmountInput
        className="field num"
        dir="ltr"
        inputMode="numeric"
        unit="toman"
        placeholder="۰"
        value={value}
        onChange={(event) => onChange(digitsOnly(event.target.value))}
      />
    </div>
  );
}

/* ── خودرو ─────────────────────────────────────────────────────────────── */

function VehicleCard({ row, model, verdict, currentRate, patch, onRemove }: {
  row: VehicleDraftRow;
  model: RealAssetCatalogs["models"][number] | undefined;
  verdict: PriceVerdict;
  currentRate?: string;
  patch: (next: Partial<VehicleDraftRow>) => void;
  onRemove: () => void;
}) {
  return (
    <li className="card setup-row space-y-3">
      <div className="flex items-center gap-2.5">
        <Plate kind="vehicle" />
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[length:var(--fs-sm)]">{model ? toFaDigits(model.modelName) : row.label}</b>
          {model && <span className="muted block truncate text-[length:var(--fs-xs)]">برند: {toFaDigits(model.brandName)}</span>}
        </span>
        <RemoveButton label={row.label} onClick={onRemove} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label">سال ساخت</label>
          <select className="field num" value={row.manufacturingYear} onChange={(event) => patch({ manufacturingYear: event.target.value })}>
            <option value="">انتخاب کنید</option>
            <optgroup label="شمسی">
              {JALALI_YEARS.map((y) => <option key={`j${y}`} value={y}>{toFaDigits(String(y))}</option>)}
            </optgroup>
            <optgroup label="میلادی">
              {GREGORIAN_YEARS.map((y) => <option key={`g${y}`} value={y}>{y}</option>)}
            </optgroup>
          </select>
        </div>
        <div>
          <label className="label">کارکرد (کیلومتر، اختیاری)</label>
          <AmountInput className="field num" dir="ltr" inputMode="numeric" unit="none" showWords={false} placeholder="۰" value={row.mileage ?? ""} onChange={(event) => patch({ mileage: digitsOnly(event.target.value) })} />
        </div>
        <div>
          <label className="label">تاریخ خرید</label>
          <JalaliDatePicker value={row.ownershipDate || undefined} onChange={(iso) => patch({ ownershipDate: iso })} showGregorian={false} yearTo={TODAY_JY} ariaLabel={`تاریخ خرید ${row.label}`} />
        </div>
        <PriceField value={row.purchasePriceToman} onChange={(v) => patch({ purchasePriceToman: v })} />
        <div className="sm:col-span-2">
          <PriceField label="ارزش فعلی (تومان)" value={row.currentValueToman} onChange={(v) => patch({ currentValueToman: v })} />
        </div>
      </div>

      <PurchaseUsd currentRate={currentRate} dateIso={row.ownershipDate} priceToman={row.purchasePriceToman} />
      <PriceIssues
        verdict={verdict}
        confirmed={!!row.priceConfirmed}
        onFix={(field, value) => { const key = FIX_FIELD[field]; if (key) patch({ [key]: value } as Partial<VehicleDraftRow>); }}
        onConfirm={(priceConfirmed) => patch({ priceConfirmed })}
      />

      {!vehicleRowReady(row) && row.priceStatus !== "block" && (
        <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
          {row.priceStatus === "warn" ? "برای ثبت، مبلغ‌ها را تأیید کنید." : "برای ثبت، سال ساخت، تاریخ و قیمت خرید و ارزش فعلی لازم است."}
        </p>
      )}
    </li>
  );
}

export function SetupVehiclesStep({
  rows,
  onChange,
  currentRate,
  showIntro = true,
}: {
  rows: VehicleDraftRow[];
  onChange: (next: VehicleDraftRow[]) => void;
  /** Off inside «دارایی‌های واقعی», where the module header already names the step. */
  showIntro?: boolean;
  currentRate?:string;
}) {
  const catalogs = useCatalogs();
  const [selectedBrand,setSelectedBrand] = useState("");
  const rateOf = useRates(rows.map((r) => r.ownershipDate), currentRate);
  const today = todayIso();

  const items = useMemo<SearchItem[]>(
    () =>
      (catalogs?.models ?? [])
        .filter((m) => m.isActive && m.brandId === selectedBrand)
        .map((m) => ({
          id: m.id,
          title: m.modelName,
          subtitle: m.category ?? undefined,
          haystack: normalize(`${m.brandName} ${m.brandNameEn ?? ""} ${m.modelName}`),
        })),
    [catalogs,selectedBrand],
  );

  const checks = rows.map((row) => {
    const model = catalogs?.models.find((m) => m.id === row.catalogId);
    const purchaseRate = rateOf(row.ownershipDate);
    const todayRate = rateOf(today);
    const verdict: PriceVerdict = model
      ? validateVehiclePrices({
          brandNameEn: model.brandNameEn, modelName: model.modelName, origin: model.brandOrigin,
          manufacturingYear: row.manufacturingYear, ownershipDate: row.ownershipDate, valuationDate: today, mileage: row.mileage,
          purchaseToman: row.purchasePriceToman, purchaseRate, currentToman: row.currentValueToman, currentRate: todayRate,
          referenceUsd: catalogs?.vehicleRefUsd?.[row.catalogId] ?? null,
        })
      : { level: "ok", issues: [] };
    const loading = !model || (!!row.ownershipDate && purchaseRate === undefined) || todayRate === undefined;
    return { model, verdict, status: statusOf(verdict, loading) };
  });
  useSyncStatuses(rows, checks.map((c) => c.status), onChange);

  const patch = (key: string, next: Partial<VehicleDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next, ...(Object.keys(next).some((k) => PRICE_INPUTS.includes(k)) ? { priceConfirmed: false } : {}) } : r)));

  const add = (catalogId: string) => {
    const model = catalogs?.models.find((m) => m.id === catalogId);
    if (!model) return;
    onChange([
      ...rows,
      {
        key: newRowKey(),
        catalogId,
        label: `${model.brandName} ${model.modelName}`,
        manufacturingYear: model.modelYear ? String(model.modelYear) : "",
        ownershipDate: "",
        purchasePriceToman: "",
        currentValueToman: "",
        mileage: "",
        priceConfirmed: false,
      },
    ]);
  };

  return (
    <section className="space-y-5">
      {showIntro && (
        <StepIntro title="خودرو" text="برند و مدل را انتخاب کنید، سپس سال ساخت، قیمت خرید و ارزش فعلی را وارد کنید." />
      )}
      <CatalogStatus catalogs={catalogs} />

      {catalogs?.ok && <>
        <CatalogPicker label="برند" value={selectedBrand} options={catalogs.brands.filter(b=>b.isActive).map(b=>({id:b.id,label:toFaDigits(b.name)}))} onSelect={setSelectedBrand} placeholder="ابتدا برند را انتخاب کنید"/>
        {selectedBrand && <CatalogSearch
          kind="vehicle"
          label="مدل"
          items={items}
          emptyText="مدلی برای این برند در فهرست نیست."
          onAdd={add}
        />}
      </>}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <VehicleCard
              key={row.key}
              row={row}
              model={checks[index].model}
              verdict={checks[index].verdict}
              currentRate={currentRate}
              patch={(next) => patch(row.key, next)}
              onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/* ── ملک ───────────────────────────────────────────────────────────────── */

const perSqmText = (toman: string, sqm: string) => {
  const area = amountOf(sqm);
  const value = amountOf(toman);
  return area.gt(0) && value.gt(0) ? formatMoney(value.div(area).toFixed(0), "IRT") : null;
};

function PropertyCard({ row, activeTypes, area, verdict, currentRate, patch, onRemove, labelOf }: {
  row: PropertyDraftRow;
  activeTypes: RealAssetCatalogs["propertyTypes"];
  area?: string;
  verdict: PriceVerdict;
  currentRate?: string;
  patch: (next: Partial<PropertyDraftRow>) => void;
  onRemove: () => void;
  labelOf: (propertyTypeId: string, neighborhoodId: string) => string;
}) {
  const currentPerSqm = perSqmText(row.currentValueToman, row.sizeSqm);
  const purchasePerSqm = perSqmText(row.purchasePriceToman, row.sizeSqm);
  return (
    <li className="card setup-row space-y-3">
      <div className="flex items-center gap-2.5">
        <Plate kind="property" />
        <b className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{row.label || "ملک"}</b>
        <RemoveButton label={row.label || "ملک"} onClick={onRemove} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="label">نوع ملک</label>
          <select className="field" value={row.propertyTypeId} onChange={(event) => patch({ propertyTypeId: event.target.value, label: labelOf(event.target.value, row.neighborhoodId) })}>
            {activeTypes.map((p) => <option key={p.id} value={p.id}>{p.nameFa}</option>)}
          </select>
        </div>
        <div className="sm:col-span-2">
          <span className="label">شهر/منطقه</span>
          <p className="field flex items-center">{area ?? "—"}</p>
        </div>
        <div>
          <label className="label">متراژ (متر مربع)</label>
          <AmountInput className="field num" inputMode="decimal" placeholder="۰" value={row.sizeSqm} onChange={(event) => patch({ sizeSqm: event.target.value })} showWords={false} unit="none" />
        </div>
        <div>
          <PriceField label="ارزش فعلی (تومان)" value={row.currentValueToman} onChange={(v) => patch({ currentValueToman: v })} />
          {currentPerSqm && <p className="muted text-[length:var(--fs-xs)]">هر متر: <span className="num money-nowrap" dir="rtl">{currentPerSqm}</span></p>}
        </div>
        <div>
          <label className="label">تاریخ خرید</label>
          <JalaliDatePicker value={row.acquisitionDate || undefined} onChange={(iso) => patch({ acquisitionDate: iso })} showGregorian={false} yearTo={TODAY_JY} ariaLabel="تاریخ خرید ملک" />
        </div>
        <div>
          <PriceField value={row.purchasePriceToman} onChange={(v) => patch({ purchasePriceToman: v })} />
          {purchasePerSqm && <p className="muted text-[length:var(--fs-xs)]">هر متر: <span className="num money-nowrap" dir="rtl">{purchasePerSqm}</span></p>}
        </div>
      </div>

      <PurchaseUsd currentRate={currentRate} dateIso={row.acquisitionDate} priceToman={row.purchasePriceToman} />
      <PriceIssues
        verdict={verdict}
        confirmed={!!row.priceConfirmed}
        onFix={(field, value) => { const key = FIX_FIELD[field]; if (key) patch({ [key]: value } as Partial<PropertyDraftRow>); }}
        onConfirm={(priceConfirmed) => patch({ priceConfirmed })}
      />

      {!propertyRowReady(row) && row.priceStatus !== "block" && (
        <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
          {row.priceStatus === "warn" ? "برای ثبت، مبلغ‌ها را تأیید کنید." : "برای ثبت، متراژ، ارزش فعلی، تاریخ و قیمت خرید لازم است."}
        </p>
      )}
    </li>
  );
}

export function SetupPropertiesStep({
  rows,
  onChange,
  currentRate,
  showIntro = true,
}: {
  rows: PropertyDraftRow[];
  onChange: (next: PropertyDraftRow[]) => void;
  /** Off inside «دارایی‌های واقعی», where the module header already names the step. */
  showIntro?: boolean;
  currentRate?:string;
}) {
  const catalogs = useCatalogs();
  const [selectedCity,setSelectedCity] = useState("");
  const activeTypes = useMemo(() => (catalogs?.propertyTypes ?? []).filter((p) => p.isActive), [catalogs]);
  const rateOf = useRates(rows.map((r) => r.acquisitionDate), currentRate);
  const today = todayIso();

  const items = useMemo<SearchItem[]>(() => {
    const cityName = new Map((catalogs?.cities ?? []).filter((c) => c.isActive).map((c) => [c.id, c.nameFa]));
    return (catalogs?.neighborhoods ?? [])
      .filter((n) => n.isActive && cityName.has(n.cityId) && (!selectedCity || n.cityId === selectedCity))
      .map((n) => ({
        id: n.id,
        title: n.nameFa,
        subtitle: cityName.get(n.cityId),
        haystack: normalize(`${n.nameFa} ${n.nameEn} ${cityName.get(n.cityId) ?? ""}`),
      }));
  }, [catalogs,selectedCity]);

  const labelOf = (propertyTypeId: string, neighborhoodId: string) => {
    const type = activeTypes.find((p) => p.id === propertyTypeId);
    const hood = catalogs?.neighborhoods.find((n) => n.id === neighborhoodId);
    return [type?.nameFa, hood?.nameFa].filter(Boolean).join(" — ");
  };

  const checks = rows.map((row) => {
    const city = catalogs?.cities.find((c) => c.id === row.cityId);
    const hood = catalogs?.neighborhoods.find((n) => n.id === row.neighborhoodId);
    const type = activeTypes.find((p) => p.id === row.propertyTypeId);
    const purchaseRate = rateOf(row.acquisitionDate);
    const todayRate = rateOf(today);
    const verdict = validatePropertyPrices({
      cityCode: city?.code, neighborhoodCode: hood?.code, typeCode: type?.code, sizeSqm: row.sizeSqm,
      purchaseToman: row.purchasePriceToman, purchaseRate, currentToman: row.currentValueToman, currentRate: todayRate,
      referencePpsqmUsd: catalogs?.propertyRefPpsqmUsd?.[`${row.neighborhoodId}:${row.propertyTypeId}`] ?? null,
    });
    const loading = !catalogs?.ok || (!!row.acquisitionDate && purchaseRate === undefined) || todayRate === undefined;
    return { verdict, status: statusOf(verdict, loading) };
  });
  useSyncStatuses(rows, checks.map((c) => c.status), onChange);

  const patch = (key: string, next: Partial<PropertyDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next, ...(Object.keys(next).some((k) => PRICE_INPUTS.includes(k)) ? { priceConfirmed: false } : {}) } : r)));

  const add = (neighborhoodId: string) => {
    const hood = catalogs?.neighborhoods.find((n) => n.id === neighborhoodId);
    const type = activeTypes.find((p) => p.code === "APT") ?? activeTypes[0];
    if (!hood || !type) return;
    onChange([
      ...rows,
      {
        key: newRowKey(),
        cityId: hood.cityId,
        neighborhoodId,
        propertyTypeId: type.id,
        label: labelOf(type.id, neighborhoodId),
        acquisitionDate: "",
        purchasePriceToman: "",
        currentValueToman: "",
        sizeSqm: "",
        priceConfirmed: false,
      },
    ]);
  };

  return (
    <section className="space-y-5">
      {showIntro && (
        <StepIntro title="ملک" text="شهر/منطقه را انتخاب کنید، سپس متراژ، ارزش فعلی و اطلاعات خرید را وارد کنید." />
      )}
      <CatalogStatus catalogs={catalogs} />

      {catalogs?.ok && <>
        <CatalogPicker label="شهر/منطقه" value={selectedCity} options={catalogs.cities.filter(c=>c.isActive).map(c=>({id:c.id,label:c.nameFa}))} onSelect={setSelectedCity} placeholder="همه"/>
        <CatalogSearch
          kind="property"
          label="انتخاب محدودهٔ ملک"
          items={items}
          emptyText="پیدا نشد"
          onAdd={add}
        />
      </>}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row, index) => {
            const hood = items.find((i) => i.id === row.neighborhoodId);
            return (
              <PropertyCard
                key={row.key}
                row={row}
                activeTypes={activeTypes}
                area={hood ? [hood.subtitle, hood.title].filter(Boolean).join(" / ") : undefined}
                verdict={checks[index].verdict}
                currentRate={currentRate}
                patch={(next) => patch(row.key, next)}
                onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
                labelOf={labelOf}
              />
            );
          })}
        </ul>
      )}
    </section>
  );
}
