"use client";

/**
 * ثبت خودرو و ملک در راه‌اندازی اولیه.
 *
 * WHY THIS STEP EXISTS
 * For most people in this market a car and a home are the two largest things
 * they own, and the wizard asked about neither. A user finished setup with a
 * net worth missing its biggest components and no hint that the app could
 * hold them — the same gap the صندوق/سهام step closed on the securities side.
 *
 * IT BUILDS NOTHING NEW. Every brand, model, city, neighbourhood and property
 * type comes from the EXISTING registry master data that «دارایی‌های واقعی»
 * already renders, loaded through one read-only action. The write side is
 * delegated, unchanged, to `createUserVehicle` and `createRealEstateAsset` —
 * the same functions the registry's own forms call. A second implementation
 * here would have drifted from the registry's rules (catalogue-only models,
 * acquisition-date FX, symbol sequencing, valuation snapshots) the first time
 * one of them changed.
 *
 * Everything is optional. A user who owns neither presses nothing and moves on.
 *
 * The step collects DRAFTS only. Nothing is written until the wizard's final
 * confirmation, exactly like the debts and صندوق/سهام steps.
 */
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import { RealEstateMark, VehicleMark } from "@/components/ui/AssetTypeMarks";
import { D } from "@/domain/decimal";
import { faCount, formatMoney } from "@/lib/format";
import {
  loadRealAssetCatalogsAction,
  type RealAssetCatalogs,
} from "@/app/actions/setupRealAssets";

export type VehicleDraftRow = {
  key: string;
  catalogId: string;
  /** Display only — «پژو ۲۰۶» — so the summary reads without a second lookup. */
  label: string;
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
  currentValueToman: string;
  sizeSqm: string;
};

const newKey = () => Math.random().toString(36).slice(2);

export function emptyVehicleRow(): VehicleDraftRow {
  return {
    key: newKey(),
    catalogId: "",
    label: "",
    manufacturingYear: "",
    ownershipDate: "",
    purchasePriceToman: "",
    currentValueToman: "",
  };
}

export function emptyPropertyRow(): PropertyDraftRow {
  return {
    key: newKey(),
    cityId: "",
    neighborhoodId: "",
    propertyTypeId: "",
    label: "",
    acquisitionDate: "",
    purchasePriceToman: "",
    currentValueToman: "",
    sizeSqm: "",
  };
}

/** A vehicle row is complete enough to register. */
export function vehicleRowReady(row: VehicleDraftRow): boolean {
  return Boolean(
    row.catalogId &&
      Number(row.manufacturingYear) > 0 &&
      row.ownershipDate &&
      row.purchasePriceToman &&
      D(row.purchasePriceToman).gt(0),
  );
}

/** A property row is complete enough to register. */
export function propertyRowReady(row: PropertyDraftRow): boolean {
  return Boolean(
    row.cityId &&
      row.neighborhoodId &&
      row.propertyTypeId &&
      row.acquisitionDate &&
      row.purchasePriceToman &&
      D(row.purchasePriceToman).gt(0) &&
      row.currentValueToman &&
      D(row.currentValueToman).gt(0),
  );
}

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

export default function SetupRealAssetsStep({
  vehicles,
  properties,
  onVehiclesChange,
  onPropertiesChange,
}: {
  vehicles: VehicleDraftRow[];
  properties: PropertyDraftRow[];
  onVehiclesChange: (next: VehicleDraftRow[]) => void;
  onPropertiesChange: (next: PropertyDraftRow[]) => void;
}) {
  const [catalogs, setCatalogs] = useState<RealAssetCatalogs | null>(null);
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<"vehicle" | "property">("vehicle");
  const [brandId, setBrandId] = useState("");

  useEffect(() => {
    let alive = true;
    void loadRealAssetCatalogsAction().then((result) => {
      if (!alive) return;
      setCatalogs(result);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const patchVehicle = (key: string, next: Partial<VehicleDraftRow>) =>
    onVehiclesChange(vehicles.map((r) => (r.key === key ? { ...r, ...next } : r)));
  const patchProperty = (key: string, next: Partial<PropertyDraftRow>) =>
    onPropertiesChange(properties.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const modelsOfBrand = useMemo(
    () => (catalogs?.models ?? []).filter((m) => !brandId || m.brandId === brandId),
    [catalogs?.models, brandId],
  );

  const addVehicle = (catalogId: string) => {
    const model = catalogs?.models.find((m) => m.id === catalogId);
    if (!model) return;
    onVehiclesChange([
      ...vehicles,
      { ...emptyVehicleRow(), catalogId, label: `${model.brandName} ${model.modelName}` },
    ]);
  };

  const addProperty = () => onPropertiesChange([...properties, emptyPropertyRow()]);

  const totalToman = useMemo(() => {
    const v = vehicles.reduce(
      (sum, r) => sum.add(D(r.currentValueToman || r.purchasePriceToman || "0")),
      D("0"),
    );
    return properties.reduce(
      (sum, r) => sum.add(D(r.currentValueToman || r.purchasePriceToman || "0")),
      v,
    );
  }, [vehicles, properties]);

  return (
    <section className="space-y-4" dir="rtl">
      <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold">خودرو و ملک</h2>
        <p className="muted text-xs leading-6">
          اگر خودرو یا ملکی دارید، همین‌جا ثبت کنید. اگر ندارید، این مرحله را رد کنید.
        </p>
      </div>

      {loading && <p className="muted text-xs">در حال بارگذاری فهرست…</p>}

      {!loading && catalogs && !catalogs.ok && (
        <p
          className="card p-3 text-[length:var(--fs-xs)] leading-6"
          role="alert"
          style={{ borderColor: "var(--negative)", color: "var(--negative)" }}
        >
          {catalogs.message ?? "فهرست خودرو و ملک بارگذاری نشد."} می‌توانید این مرحله را رد کنید و
          بعداً از «دارایی‌های واقعی» ثبت کنید.
        </p>
      )}

      {!loading && catalogs?.ok && (
        <>
          <div className="seg flex-wrap" role="group" aria-label="نوع دارایی واقعی">
            <button
              type="button"
              aria-pressed={family === "vehicle"}
              className={family === "vehicle" ? "seg-on" : ""}
              onClick={() => setFamily("vehicle")}
            >
              خودرو {vehicles.length > 0 && `· ${faCount(vehicles.length)}`}
            </button>
            <button
              type="button"
              aria-pressed={family === "property"}
              className={family === "property" ? "seg-on" : ""}
              onClick={() => setFamily("property")}
            >
              ملک {properties.length > 0 && `· ${faCount(properties.length)}`}
            </button>
          </div>

          {/* ── خودرو ───────────────────────────────────────────────── */}
          {family === "vehicle" && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="label">برند</label>
                  <select
                    className="field"
                    value={brandId}
                    onChange={(event) => setBrandId(event.target.value)}
                  >
                    <option value="">همه برندها</option>
                    {catalogs.brands.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">افزودن مدل</label>
                  <select
                    className="field"
                    value=""
                    onChange={(event) => event.target.value && addVehicle(event.target.value)}
                  >
                    <option value="">انتخاب کنید…</option>
                    {modelsOfBrand.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.brandName} {m.modelName}
                      </option>
                    ))}
                  </select>
                  {/* The model list is the catalogue's, never free text — the
                      registry refuses a vehicle that is not in it, so offering
                      free entry here would only fail at the final step. */}
                  <p className="muted mt-1 text-[length:var(--fs-xs)]">
                    فقط از فهرست کاتالوگ. اگر مدل شما نیست، بعداً از «دارایی‌های واقعی» اضافه کنید.
                  </p>
                </div>
              </div>

              <ul className="space-y-2.5">
                {vehicles.map((row) => (
                  <li key={row.key} className="card space-y-3 p-3.5">
                    <div className="flex items-center gap-2.5">
                      <Plate kind="vehicle" />
                      <b className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">{row.label}</b>
                      <button
                        type="button"
                        className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
                        onClick={() => onVehiclesChange(vehicles.filter((r) => r.key !== row.key))}
                        aria-label={`حذف ${row.label}`}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label">سال ساخت</label>
                        <input
                          className="field num"
                          dir="ltr"
                          inputMode="numeric"
                          placeholder="1400"
                          value={row.manufacturingYear}
                          onChange={(event) =>
                            patchVehicle(row.key, {
                              manufacturingYear: event.target.value.replace(/[^0-9]/g, ""),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="label">تاریخ تملک</label>
                        <JalaliDatePicker
                          value={row.ownershipDate || undefined}
                          onChange={(iso) => patchVehicle(row.key, { ownershipDate: iso })}
                          showGregorian={false}
                          ariaLabel={`تاریخ تملک ${row.label}`}
                        />
                      </div>
                      <div>
                        <label className="label">قیمت خرید (تومان)</label>
                        <AmountInput
                          className="field num"
                          dir="ltr"
                          inputMode="numeric"
                          unit="toman"
                          value={row.purchasePriceToman}
                          onChange={(event) =>
                            patchVehicle(row.key, {
                              purchasePriceToman: event.target.value.replace(/[^0-9]/g, ""),
                            })
                          }
                        />
                      </div>
                      <div>
                        <label className="label">ارزش فعلی (تومان) — اختیاری</label>
                        <AmountInput
                          className="field num"
                          dir="ltr"
                          inputMode="numeric"
                          unit="toman"
                          value={row.currentValueToman}
                          onChange={(event) =>
                            patchVehicle(row.key, {
                              currentValueToman: event.target.value.replace(/[^0-9]/g, ""),
                            })
                          }
                        />
                        {/* Current value is a SNAPSHOT, never derived from the
                            purchase price — that is the registry's own rule. */}
                        <p className="muted mt-1 text-[length:var(--fs-xs)]">
                          خالی بگذارید تا فقط قیمت خرید ثبت شود.
                        </p>
                      </div>
                    </div>

                    {!vehicleRowReady(row) && (
                      <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                        برای ثبت، سال ساخت، تاریخ تملک و قیمت خرید لازم است.
                      </p>
                    )}
                  </li>
                ))}
                {vehicles.length === 0 && (
                  <li className="muted p-3 text-center text-[length:var(--fs-xs)]">
                    خودرویی اضافه نشده است.
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* ── ملک ─────────────────────────────────────────────────── */}
          {family === "property" && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={addProperty}
                className="btn btn-ghost !min-h-10 !px-3.5 text-[length:var(--fs-xs)]"
              >
                <Icon name="plus" size={14} />
                افزودن ملک
              </button>

              <ul className="space-y-2.5">
                {properties.map((row) => {
                  const hoods = catalogs.neighborhoods.filter((n) => n.cityId === row.cityId);
                  return (
                    <li key={row.key} className="card space-y-3 p-3.5">
                      <div className="flex items-center gap-2.5">
                        <Plate kind="property" />
                        <b className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)]">
                          {row.label || "ملک جدید"}
                        </b>
                        <button
                          type="button"
                          className="btn btn-ghost !min-h-9 !px-3 !py-1.5 text-[length:var(--fs-xs)]"
                          onClick={() => onPropertiesChange(properties.filter((r) => r.key !== row.key))}
                          aria-label="حذف ملک"
                        >
                          <Icon name="x" size={14} />
                        </button>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <label className="label">شهر</label>
                          <select
                            className="field"
                            value={row.cityId}
                            onChange={(event) =>
                              // Changing the city invalidates the neighbourhood:
                              // the registry refuses a pair that does not match.
                              patchProperty(row.key, {
                                cityId: event.target.value,
                                neighborhoodId: "",
                              })
                            }
                          >
                            <option value="">انتخاب کنید…</option>
                            {catalogs.cities.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nameFa}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">منطقه / محله</label>
                          <select
                            className="field"
                            value={row.neighborhoodId}
                            disabled={!row.cityId}
                            onChange={(event) => {
                              const hood = hoods.find((h) => h.id === event.target.value);
                              const ptype = catalogs.propertyTypes.find(
                                (p) => p.id === row.propertyTypeId,
                              );
                              patchProperty(row.key, {
                                neighborhoodId: event.target.value,
                                label: [ptype?.nameFa, hood?.nameFa].filter(Boolean).join(" — "),
                              });
                            }}
                          >
                            <option value="">{row.cityId ? "انتخاب کنید…" : "اول شهر را انتخاب کنید"}</option>
                            {hoods.map((h) => (
                              <option key={h.id} value={h.id}>
                                {h.nameFa}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">نوع ملک</label>
                          <select
                            className="field"
                            value={row.propertyTypeId}
                            onChange={(event) => {
                              const ptype = catalogs.propertyTypes.find(
                                (p) => p.id === event.target.value,
                              );
                              const hood = hoods.find((h) => h.id === row.neighborhoodId);
                              patchProperty(row.key, {
                                propertyTypeId: event.target.value,
                                label: [ptype?.nameFa, hood?.nameFa].filter(Boolean).join(" — "),
                              });
                            }}
                          >
                            <option value="">انتخاب کنید…</option>
                            {catalogs.propertyTypes.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.nameFa}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">متراژ — اختیاری</label>
                          <input
                            className="field num"
                            dir="ltr"
                            inputMode="decimal"
                            placeholder="120"
                            value={row.sizeSqm}
                            onChange={(event) =>
                              patchProperty(row.key, {
                                sizeSqm: event.target.value.replace(/[^0-9.]/g, ""),
                              })
                            }
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="label">تاریخ خرید</label>
                          <JalaliDatePicker
                            value={row.acquisitionDate || undefined}
                            onChange={(iso) => patchProperty(row.key, { acquisitionDate: iso })}
                            showGregorian={false}
                            ariaLabel="تاریخ خرید ملک"
                          />
                        </div>
                        <div>
                          <label className="label">قیمت خرید (تومان)</label>
                          <AmountInput
                            className="field num"
                            dir="ltr"
                            inputMode="numeric"
                            unit="toman"
                            value={row.purchasePriceToman}
                            onChange={(event) =>
                              patchProperty(row.key, {
                                purchasePriceToman: event.target.value.replace(/[^0-9]/g, ""),
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="label">ارزش فعلی (تومان)</label>
                          <AmountInput
                            className="field num"
                            dir="ltr"
                            inputMode="numeric"
                            unit="toman"
                            value={row.currentValueToman}
                            onChange={(event) =>
                              patchProperty(row.key, {
                                currentValueToman: event.target.value.replace(/[^0-9]/g, ""),
                              })
                            }
                          />
                        </div>
                      </div>

                      {!propertyRowReady(row) && (
                        <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--warning)" }}>
                          شهر، محله، نوع ملک، تاریخ خرید، قیمت خرید و ارزش فعلی لازم است.
                        </p>
                      )}
                    </li>
                  );
                })}
                {properties.length === 0 && (
                  <li className="muted p-3 text-center text-[length:var(--fs-xs)]">
                    ملکی اضافه نشده است.
                  </li>
                )}
              </ul>
            </div>
          )}

          {(vehicles.length > 0 || properties.length > 0) && D(totalToman).gt(0) && (
            <p className="soft rounded-[var(--r-md)] p-3 text-[length:var(--fs-xs)] leading-6">
              مجموع ارزش دارایی‌های واقعی:{" "}
              <b className="num" dir="rtl">{formatMoney(D(totalToman).toFixed(0), "IRT")}</b>
              {" — "}این مبلغ در «دارایی‌های واقعی» ثبت می‌شود و جدا از موجودی حساب‌هاست.
            </p>
          )}
        </>
      )}
    </section>
  );
}
