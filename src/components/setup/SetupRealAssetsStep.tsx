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
};

/** سال ساخت — the one picked, else the Jalali year the car was bought in. */
export function vehicleYearOf(row: VehicleDraftRow): string {
  if (Number(row.manufacturingYear) > 0) return row.manufacturingYear;
  return row.ownershipDate ? String(toJalali(row.ownershipDate).y) : "";
}

/** A vehicle row is complete enough to register. */
export function vehicleRowReady(row: VehicleDraftRow): boolean {
  return Boolean(
    row.catalogId && row.ownershipDate && Number(vehicleYearOf(row)) > 0 && amountOf(row.purchasePriceToman).gt(0),
  );
}

/** A property row is complete enough to register. */
export function propertyRowReady(row: PropertyDraftRow): boolean {
  return Boolean(
    row.cityId &&
      row.neighborhoodId &&
      row.propertyTypeId &&
      row.acquisitionDate &&
      amountOf(row.purchasePriceToman).gt(0),
  );
}

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
      .then((r) => (r.ok && Number(r.rate) > 0 ? { rate: r.rate, effectiveDate: r.effectiveDate, source: r.source } : null))
      .catch(() => null);
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
      {catalogs.message ?? "فهرست بارگذاری نشد."} می‌توانید این مرحله را رد کنید و بعداً از «دارایی‌های واقعی» ثبت کنید.
    </p>
  );
}

type SearchItem = { id: string; title: string; subtitle?: string; haystack: string };

function CatalogSearch({
  id,
  kind,
  label,
  placeholder,
  items,
  emptyText,
  onAdd,
}: {
  id: string;
  kind: "vehicle" | "property";
  label: string;
  placeholder: string;
  items: SearchItem[];
  emptyText: string;
  onAdd: (itemId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    const tokens = normalize(query).split(" ").filter(Boolean);
    if (!tokens.length) return [];
    return items.filter((item) => tokens.every((t) => item.haystack.includes(t))).slice(0, 8);
  }, [items, query]);

  return (
    <div className="space-y-2">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder}
        className="field"
        autoComplete="off"
      />
      {query.trim().length > 0 && (
        <ul className="card list-card">
          {matches.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="list-row w-full text-right hover:bg-[color:var(--hover)]"
                onClick={() => {
                  onAdd(item.id);
                  setQuery("");
                }}
              >
                <Plate kind={kind} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--fs-sm)] font-medium">{item.title}</span>
                  {item.subtitle && <span className="muted block truncate text-[length:var(--fs-xs)]">{item.subtitle}</span>}
                </span>
                <Icon name="plus" size={15} />
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="muted p-3 text-center text-[length:var(--fs-xs)]">{emptyText}</li>}
        </ul>
      )}
    </div>
  );
}

/** «معادل دلاری در زمان خرید» — the free-market dollar of the purchase day. */
function PurchaseUsd({ dateIso, priceToman }: { dateIso: string; priceToman: string }) {
  const [found, setFound] = useState<{ date: string; rate: RateAt | null } | null>(null);

  useEffect(() => {
    if (!dateIso) return;
    let alive = true;
    void rateAt(dateIso).then((rate) => {
      if (alive) setFound({ date: dateIso, rate });
    });
    return () => {
      alive = false;
    };
  }, [dateIso]);

  const box = "soft space-y-1 rounded-[var(--r-md)] p-3";
  if (!dateIso) {
    return <p className={`${box} muted text-[length:var(--fs-xs)]`}>تاریخ خرید را انتخاب کنید تا دلار همان روز پیدا شود.</p>;
  }
  const current = found?.date === dateIso ? found : null;
  if (!current) return <p className={`${box} muted text-[length:var(--fs-xs)]`}>در حال یافتن نرخ دلار آن روز…</p>;
  if (!current.rate) {
    return (
      <p className={`${box} text-[length:var(--fs-xs)]`} style={{ color: "var(--warning)" }}>
        نرخ دلار آن روز در دسترس نیست؛ هنگام ثبت دوباره بررسی می‌شود.
      </p>
    );
  }

  const { rate, effectiveDate, source } = current.rate;
  const price = amountOf(priceToman);
  const usd = price.gt(0) ? price.div(D(rate)).toFixed(0) : null;
  const approximate = source === "current" || source === "fallback";

  return (
    <div className={box}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[length:var(--fs-xs)] font-medium">معادل دلاری در زمان خرید</span>
        <b className="num money-nowrap text-[length:var(--fs-sm)]" dir="rtl" style={{ color: "var(--action)" }}>
          {usd ? formatMoney(usd, "USD") : "—"}
        </b>
      </div>
      <p className="muted text-[length:var(--fs-xs)] leading-5" style={approximate ? { color: "var(--warning)" } : undefined}>
        {approximate ? "نرخ آن تاریخ پیدا نشد؛ نرخ امروز " : `دلار ${formatDate(effectiveDate)}: `}
        <span className="num money-nowrap" dir="rtl">
          {formatMoney(rate, "IRT")}
        </span>
        {approximate && " به کار رفت."}
      </p>
    </div>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-btn !min-h-9 !min-w-9" onClick={onClick} aria-label={`حذف ${label}`}>
      <Icon name="x" size={15} />
    </button>
  );
}

function PriceField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  return (
    <div>
      <label className="label">قیمت خرید (تومان)</label>
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

export function SetupVehiclesStep({
  rows,
  onChange,
  showIntro = true,
}: {
  rows: VehicleDraftRow[];
  onChange: (next: VehicleDraftRow[]) => void;
  /** Off inside «دارایی‌های واقعی», where the module header already names the step. */
  showIntro?: boolean;
}) {
  const catalogs = useCatalogs();

  const items = useMemo<SearchItem[]>(
    () =>
      (catalogs?.models ?? [])
        .filter((m) => m.isActive)
        .map((m) => ({
          id: m.id,
          title: `${m.brandName} ${m.modelName}`,
          subtitle: m.category ?? undefined,
          haystack: normalize(`${m.brandName} ${m.brandNameEn ?? ""} ${m.modelName}`),
        })),
    [catalogs],
  );

  const patch = (key: string, next: Partial<VehicleDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

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
      },
    ]);
  };

  return (
    <section className="space-y-5">
      {showIntro && (
        <StepIntro title="خودرو" text="خودرو را جست‌وجو کنید و با + اضافه کنید؛ فقط تاریخ و قیمت خرید را وارد کنید." />
      )}
      <CatalogStatus catalogs={catalogs} />

      {catalogs?.ok && (
        <CatalogSearch
          id="setup-vehicle-search"
          kind="vehicle"
          label="افزودن خودرو"
          placeholder="پژو ۲۰۶، تیبا، هایما…"
          items={items}
          emptyText="در فهرست نیست — بعداً از «دارایی‌های واقعی» اضافه کنید."
          onAdd={add}
        />
      )}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => {
            const year = vehicleYearOf(row);
            return (
              <li key={row.key} className="card setup-row space-y-3">
                <div className="flex items-center gap-2.5">
                  <Plate kind="vehicle" />
                  <b className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{row.label}</b>
                  {year && <span className="badge badge-neutral num">{toFaDigits(year)}</span>}
                  <RemoveButton label={row.label} onClick={() => onChange(rows.filter((r) => r.key !== row.key))} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="label">تاریخ خرید</label>
                    <JalaliDatePicker
                      value={row.ownershipDate || undefined}
                      onChange={(iso) => patch(row.key, { ownershipDate: iso })}
                      showGregorian={false}
                      yearTo={TODAY_JY}
                      ariaLabel={`تاریخ خرید ${row.label}`}
                    />
                  </div>
                  <PriceField value={row.purchasePriceToman} onChange={(v) => patch(row.key, { purchasePriceToman: v })} />
                </div>

                <PurchaseUsd dateIso={row.ownershipDate} priceToman={row.purchasePriceToman} />

                <details className="rounded-[var(--r-md)] border p-3" style={{ borderColor: "var(--border)" }}>
                  <summary className="cursor-pointer text-[length:var(--fs-xs)] font-semibold">مشخصات بیشتر (اختیاری)</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">سال ساخت</label>
                      <select
                        className="field num"
                        value={year}
                        onChange={(event) => patch(row.key, { manufacturingYear: event.target.value })}
                      >
                        <option value="">همان سال خرید</option>
                        <optgroup label="شمسی">
                          {JALALI_YEARS.map((y) => (
                            <option key={`j${y}`} value={y}>
                              {toFaDigits(String(y))}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="میلادی">
                          {GREGORIAN_YEARS.map((y) => (
                            <option key={`g${y}`} value={y}>
                              {y}
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                    <div>
                      <label className="label">ارزش فعلی (تومان)</label>
                      <AmountInput
                        className="field num"
                        dir="ltr"
                        inputMode="numeric"
                        unit="toman"
                        placeholder="۰"
                        value={row.currentValueToman}
                        onChange={(event) => patch(row.key, { currentValueToman: digitsOnly(event.target.value) })}
                      />
                    </div>
                  </div>
                </details>

                {!vehicleRowReady(row) && (
                  <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                    برای ثبت، تاریخ خرید و قیمت خرید لازم است.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ── ملک ───────────────────────────────────────────────────────────────── */

export function SetupPropertiesStep({
  rows,
  onChange,
  showIntro = true,
}: {
  rows: PropertyDraftRow[];
  onChange: (next: PropertyDraftRow[]) => void;
  /** Off inside «دارایی‌های واقعی», where the module header already names the step. */
  showIntro?: boolean;
}) {
  const catalogs = useCatalogs();
  const activeTypes = useMemo(() => (catalogs?.propertyTypes ?? []).filter((p) => p.isActive), [catalogs]);

  const items = useMemo<SearchItem[]>(() => {
    const cityName = new Map((catalogs?.cities ?? []).filter((c) => c.isActive).map((c) => [c.id, c.nameFa]));
    return (catalogs?.neighborhoods ?? [])
      .filter((n) => n.isActive && cityName.has(n.cityId))
      .map((n) => ({
        id: n.id,
        title: n.nameFa,
        subtitle: cityName.get(n.cityId),
        haystack: normalize(`${n.nameFa} ${n.nameEn} ${cityName.get(n.cityId) ?? ""}`),
      }));
  }, [catalogs]);

  const labelOf = (propertyTypeId: string, neighborhoodId: string) => {
    const type = activeTypes.find((p) => p.id === propertyTypeId);
    const hood = catalogs?.neighborhoods.find((n) => n.id === neighborhoodId);
    return [type?.nameFa, hood?.nameFa].filter(Boolean).join(" — ");
  };

  const patch = (key: string, next: Partial<PropertyDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

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
      },
    ]);
  };

  return (
    <section className="space-y-5">
      {showIntro && (
        <StepIntro title="ملک" text="محله را جست‌وجو کنید و با + اضافه کنید؛ فقط تاریخ و قیمت خرید را وارد کنید." />
      )}
      <CatalogStatus catalogs={catalogs} />

      {catalogs?.ok && (
        <CatalogSearch
          id="setup-property-search"
          kind="property"
          label="افزودن ملک"
          placeholder="گلستان، کیانپارس، امانیه…"
          items={items}
          emptyText="پیدا نشد"
          onAdd={add}
        />
      )}

      {rows.length > 0 && (
        <ul className="space-y-3">
          {rows.map((row) => {
            const hood = items.find((i) => i.id === row.neighborhoodId);
            return (
              <li key={row.key} className="card setup-row space-y-3">
                <div className="flex items-center gap-2.5">
                  <Plate kind="property" />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[length:var(--fs-sm)]">{row.label || "ملک"}</b>
                    {hood?.subtitle && <span className="muted block truncate text-[length:var(--fs-xs)]">{hood.subtitle}</span>}
                  </span>
                  <RemoveButton label={row.label || "ملک"} onClick={() => onChange(rows.filter((r) => r.key !== row.key))} />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label">نوع ملک</label>
                    <select
                      className="field"
                      value={row.propertyTypeId}
                      onChange={(event) =>
                        patch(row.key, {
                          propertyTypeId: event.target.value,
                          label: labelOf(event.target.value, row.neighborhoodId),
                        })
                      }
                    >
                      {activeTypes.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.nameFa}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">تاریخ خرید</label>
                    <JalaliDatePicker
                      value={row.acquisitionDate || undefined}
                      onChange={(iso) => patch(row.key, { acquisitionDate: iso })}
                      showGregorian={false}
                      yearTo={TODAY_JY}
                      ariaLabel="تاریخ خرید ملک"
                    />
                  </div>
                  <PriceField value={row.purchasePriceToman} onChange={(v) => patch(row.key, { purchasePriceToman: v })} />
                </div>

                <PurchaseUsd dateIso={row.acquisitionDate} priceToman={row.purchasePriceToman} />

                <details className="rounded-[var(--r-md)] border p-3" style={{ borderColor: "var(--border)" }}>
                  <summary className="cursor-pointer text-[length:var(--fs-xs)] font-semibold">مشخصات بیشتر (اختیاری)</summary>
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">متراژ</label>
                      <AmountInput
                        className="field num"
                        inputMode="decimal"
                        placeholder="۱۲۰"
                        value={row.sizeSqm}
                        onChange={(event) => patch(row.key, { sizeSqm: event.target.value })}
                        showWords={false}
                        unit="none"
                      />
                    </div>
                    <div>
                      <label className="label">ارزش فعلی (تومان)</label>
                      <AmountInput
                        className="field num"
                        dir="ltr"
                        inputMode="numeric"
                        unit="toman"
                        placeholder="۰"
                        value={row.currentValueToman}
                        onChange={(event) => patch(row.key, { currentValueToman: digitsOnly(event.target.value) })}
                      />
                      <p className="muted mt-1 text-[length:var(--fs-xs)] leading-5">
                        خالی بماند: قیمت خرید به‌عنوان ارزش همان تاریخ خرید ثبت می‌شود.
                      </p>
                    </div>
                  </div>
                </details>

                {!propertyRowReady(row) && (
                  <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                    برای ثبت، تاریخ خرید و قیمت خرید لازم است.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
