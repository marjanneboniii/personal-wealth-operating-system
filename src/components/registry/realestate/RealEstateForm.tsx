"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import {
  previewRealEstateIdentityAction,
  previewRealEstateUsdAction,
  saveRealEstateAction,
} from "@/app/actions/realEstate";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { formatMoney, toFaDigits } from "@/lib/format";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";
import { Hint, Labeled, Result } from "./shared";

type UsdPreview = { usd: string; rate: string; effectiveDate: string; source: string; isExact: boolean } | null;

const RATE_SOURCE_LABEL: Record<string, string> = {
  exact: "نرخ ثبت‌شده همان تاریخ",
  nearest: "نزدیک‌ترین نرخ ثبت‌شده قبل از تاریخ",
  current: "نرخ جاری کاربر (برای آن تاریخ نرخی ثبت نشده است)",
  fallback: "نرخ پیش‌فرض سیستم",
  manual: "نرخ واردشده به‌صورت دستی",
};

function digitsOnly(v: string) {
  return v.replace(/[^\d]/g, "");
}

/**
 * فرم ثبت ملک — دارایی واقعی → ملک.
 *
 * ❌ هیچ فیلد آزاد برای نام دارایی، Symbol، شهر، محله یا نوع ملک وجود ندارد.
 * ✅ شهر → محله → نوع ملک از Master Data انتخاب می‌شوند (کاوش‌گر مرحله‌ای).
 * ✅ نام و Symbol توسط سیستم تولید می‌شوند و به‌صورت زنده پیش‌نمایش می‌شوند.
 * ✅ تاریخ‌ها فقط شمسی وارد می‌شوند؛ میلادی خودکار محاسبه می‌شود.
 * ✅ معادل دلاری با نرخِ همان تاریخِ تملک/ارزش‌گذاری محاسبه می‌شود.
 */
export default function RealEstateForm({
  cities,
  neighborhoods,
  propertyTypes,
}: {
  cities: City[];
  neighborhoods: Neighborhood[];
  propertyTypes: PropertyType[];
}) {
  const [state, action, pending] = useActionState(saveRealEstateAction, null);

  const activeCities = cities.filter((c) => c.isActive);
  const [cityId, setCityId] = useState(activeCities[0]?.id ?? "");
  const [neighborhoodId, setNeighborhoodId] = useState("");
  const [propertyTypeId, setPropertyTypeId] = useState("");

  /* جست‌وجو فقط داخل گزینه‌های Master Data — امکان ایجاد متن جدید وجود ندارد */
  const [hoodFilter, setHoodFilter] = useState("");
  const cityNeighborhoods = useMemo(
    () => neighborhoods.filter((n) => n.cityId === cityId && n.isActive),
    [neighborhoods, cityId],
  );
  const filteredNeighborhoods = useMemo(() => {
    const q = hoodFilter.trim().toLowerCase();
    if (!q) return cityNeighborhoods;
    return cityNeighborhoods.filter(
      (n) => n.nameFa.toLowerCase().includes(q) || n.nameEn.toLowerCase().includes(q) || n.code.toLowerCase().includes(q),
    );
  }, [cityNeighborhoods, hoodFilter]);

  const [acquisitionIso, setAcquisitionIso] = useState("");
  const [valuationIso, setValuationIso] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [manualPurchaseRate, setManualPurchaseRate] = useState("");
  const [manualValuationRate, setManualValuationRate] = useState("");

  const [identity, setIdentity] = useState<{ assetName?: string; symbol?: string; sequence?: number } | null>(null);
  const [purchasePreview, setPurchasePreview] = useState<UsdPreview>(null);
  const [valuationPreview, setValuationPreview] = useState<UsdPreview>(null);
  const [loadingIdentity, setLoadingIdentity] = useState(false);
  const [loadingPurchase, setLoadingPurchase] = useState(false);
  const [loadingValuation, setLoadingValuation] = useState(false);

  /* پیش‌نمایش نام و Symbol تولیدشده */
  const canPreviewIdentity = !!cityId && !!neighborhoodId && !!propertyTypeId;
  useEffect(() => {
    if (!canPreviewIdentity) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingIdentity(true);
      try {
        const res = await previewRealEstateIdentityAction(cityId, neighborhoodId, propertyTypeId);
        if (!cancelled && res.ok) setIdentity(res);
      } catch {
        /* keep previous preview */
      } finally {
        if (!cancelled) setLoadingIdentity(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [canPreviewIdentity, cityId, neighborhoodId, propertyTypeId]);

  /* پیش‌نمایش معادل دلاری قیمت خرید — نرخ تاریخ تملک */
  const cleanPurchase = digitsOnly(purchasePrice);
  const canPreviewPurchase = !!cleanPurchase && !!acquisitionIso;
  useEffect(() => {
    if (!canPreviewPurchase) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingPurchase(true);
      try {
        const res = await previewRealEstateUsdAction(cleanPurchase, acquisitionIso, digitsOnly(manualPurchaseRate) || undefined);
        if (!cancelled) setPurchasePreview(res.ok ? res : null);
      } catch {
        /* keep previous preview */
      } finally {
        if (!cancelled) setLoadingPurchase(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [canPreviewPurchase, cleanPurchase, acquisitionIso, manualPurchaseRate]);

  /* پیش‌نمایش معادل دلاری ارزش فعلی — نرخ تاریخ ارزش‌گذاری */
  const cleanCurrent = digitsOnly(currentValue);
  const canPreviewValuation = !!cleanCurrent && !!valuationIso;
  useEffect(() => {
    if (!canPreviewValuation) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoadingValuation(true);
      try {
        const res = await previewRealEstateUsdAction(cleanCurrent, valuationIso, digitsOnly(manualValuationRate) || undefined);
        if (!cancelled) setValuationPreview(res.ok ? res : null);
      } catch {
        /* keep previous preview */
      } finally {
        if (!cancelled) setLoadingValuation(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [canPreviewValuation, cleanCurrent, valuationIso, manualValuationRate]);

  /* پیش‌نمایش معتبر فقط وقتی ورودی‌های لازم موجود باشند (اشتقاقی — بدون پاک‌کردن state). */
  const identityPreview = canPreviewIdentity ? identity : null;
  const purchaseUsdPreview = canPreviewPurchase ? purchasePreview : null;
  const valuationUsdPreview = canPreviewValuation ? valuationPreview : null;

  const city = activeCities.find((c) => c.id === cityId);
  const ptype = propertyTypes.find((p) => p.id === propertyTypeId && p.isActive);

  return (
    <form action={action} className="space-y-6">
      <section className="space-y-3">
        <h3 className="type-section-title">اطلاعات اصلی</h3>
      {/* ── Explorer: دارایی واقعی ← ملک ← شهر ← محله ← نوع ملک ── */}
      <div className="grid gap-3 md:grid-cols-1 lg:grid-cols-3">
        <Labeled label="شهر" required>
          <select
            className="field"
            name="cityId"
            value={cityId}
            onChange={(e) => {
              setCityId(e.target.value);
              setNeighborhoodId("");
              setHoodFilter("");
            }}
            required
          >
            {activeCities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nameFa} / {c.nameEn} ({c.code})
              </option>
            ))}
          </select>
        </Labeled>

        <div>
          <Labeled label="منطقه / محله" required>
            <select
              className="field"
              name="neighborhoodId"
              value={neighborhoodId}
              onChange={(e) => setNeighborhoodId(e.target.value)}
              disabled={!cityId}
              required
            >
              <option value="">— انتخاب محله —</option>
              {filteredNeighborhoods.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nameFa} ({n.code})
                </option>
              ))}
            </select>
          </Labeled>
          {cityId && (
            <input
              className="field num mt-2 !py-1.5 text-[11px]"
              value={hoodFilter}
              onChange={(e) => setHoodFilter(e.target.value)}
              placeholder={`جست‌وجو در ${toFaDigits(String(cityNeighborhoods.length))} محلهٔ «${city?.nameFa ?? ""}»…`}
            />
          )}
        </div>

        <Labeled label="نوع ملک" required>
          <select
            className="field"
            name="propertyTypeId"
            value={propertyTypeId}
            onChange={(e) => setPropertyTypeId(e.target.value)}
            required
          >
            <option value="">— انتخاب نوع ملک —</option>
            {propertyTypes
              .filter((p) => p.isActive)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nameFa} ({p.code})
                </option>
              ))}
          </select>
        </Labeled>
      </div>

      </section>

      {/* ── نام و Symbol — تولید خودکار ── */}
      <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--brand-soft)" }}>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="min-w-0">
            <div className="mt-0.5 text-[13px] font-bold" style={{ color: "var(--brand)" }}>
              {loadingIdentity ? "…" : identityPreview?.assetName ?? (ptype && city && cityId && neighborhoodId ? "در حال تولید…" : "—")}
            </div>
          </div>
          <div className="min-w-0">
            <div className="mt-0.5 font-mono text-[12.5px] font-semibold" dir="ltr" style={{ color: "var(--brand)" }}>
              {loadingIdentity ? "…" : identityPreview?.symbol ?? "—"}
            </div>
          </div>
          {identityPreview?.sequence && identityPreview.sequence > 1 && (
            <span className="rounded-full px-2 py-0.5 text-[10px]" style={{ background: "var(--sunken)" }}>
              {toFaDigits(String(identityPreview.sequence))}مین ملک مشابه در این محله
            </span>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="type-section-title">مالکیت</h3>
      {/* ── تاریخ‌ها — ورودی شمسی، میلادی خودکار ── */}
      <div className="grid gap-3 md:grid-cols-2">
        <JalaliDateInput
          name="acquisitionDate"
          label="تاریخ تملک (شمسی)"
          value={acquisitionIso}
          onChange={setAcquisitionIso}
          required
        />
      </div>
      </section>

      <section className="space-y-3">
        <h3 className="type-section-title">ارزش‌گذاری</h3>
        <JalaliDateInput
          name="valuationDate"
          label="تاریخ ارزش‌گذاری (شمسی)"
          value={valuationIso}
          onChange={setValuationIso}
          required
        />

      {/* ── مبالغ ── */}
      <div className="grid gap-3 md:grid-cols-1 lg:grid-cols-2">
        <div className="space-y-3">
          <Labeled label="قیمت خرید (تومان)" required>
            <input
              className="field num"
              name="purchasePriceToman"
              inputMode="numeric"
              dir="ltr"
              value={purchasePrice}
              onChange={(e) => setPurchasePrice(e.target.value)}
              placeholder="4500000000"
              required
            />
          </Labeled>
          <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--brand-soft)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium">معادل دلاری قیمت خرید (نرخ تاریخ تملک)</span>
              <strong className="num text-[13.5px]" dir="ltr" style={{ color: "var(--brand)" }}>
                {canPreviewPurchase && loadingPurchase ? "…" : purchaseUsdPreview ? formatMoney(purchaseUsdPreview.usd, "USD") : "—"}
              </strong>
            </div>
            <div className="muted mt-1 text-[10px] leading-5">
              {purchaseUsdPreview ? (
                <>
                  نرخ: <span className="num">{formatMoney(purchaseUsdPreview.rate, "IRT")}</span> ·{" "}
                  {RATE_SOURCE_LABEL[purchaseUsdPreview.source] ?? purchaseUsdPreview.source}
                </>
              ) : (
                "قیمت خرید و تاریخ تملک را وارد کنید."
              )}
            </div>
            <input
              className="field num mt-2"
              dir="ltr"
              inputMode="numeric"
              value={manualPurchaseRate}
              onChange={(e) => setManualPurchaseRate(e.target.value)}
              placeholder="نرخ دلار تاریخ خرید (اختیاری)"
            />
            <input type="hidden" name="purchaseFxRate" value={digitsOnly(manualPurchaseRate)} />
          </div>
        </div>

        <div className="space-y-3">
          <Labeled label="ارزش فعلی (تومان)" required>
            <input
              className="field num"
              name="currentValueToman"
              inputMode="numeric"
              dir="ltr"
              value={currentValue}
              onChange={(e) => setCurrentValue(e.target.value)}
              placeholder="7000000000"
              required
            />
          </Labeled>
          <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--brand-soft)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium">معادل دلاری ارزش فعلی (نرخ تاریخ ارزش‌گذاری)</span>
              <strong className="num text-[13.5px]" dir="ltr" style={{ color: "var(--brand)" }}>
                {canPreviewValuation && loadingValuation ? "…" : valuationUsdPreview ? formatMoney(valuationUsdPreview.usd, "USD") : "—"}
              </strong>
            </div>
            <div className="muted mt-1 text-[10px] leading-5">
              {valuationUsdPreview ? (
                <>
                  نرخ: <span className="num">{formatMoney(valuationUsdPreview.rate, "IRT")}</span> ·{" "}
                  {RATE_SOURCE_LABEL[valuationUsdPreview.source] ?? valuationUsdPreview.source}
                </>
              ) : (
                "ارزش فعلی و تاریخ ارزش‌گذاری را وارد کنید."
              )}
            </div>
            <input
              className="field num mt-2"
              dir="ltr"
              inputMode="numeric"
              value={manualValuationRate}
              onChange={(e) => setManualValuationRate(e.target.value)}
              placeholder="نرخ دلار تاریخ ارزش‌گذاری (اختیاری)"
            />
            <input type="hidden" name="valuationFxRate" value={digitsOnly(manualValuationRate)} />
          </div>
        </div>
      </div>
      </section>

      {/* ── مشخصات فیزیکی (اختیاری) ── */}
      <details className="rounded-[var(--r-md)] border p-3" style={{ borderColor: "var(--border)" }}>
        <summary className="type-section-title cursor-pointer list-none marker:hidden [&::-webkit-details-marker]:hidden">
          مشخصات تکمیلی
        </summary>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Labeled label="نشانی">
            <input className="field" name="address" placeholder="نشانی دقیق یا پلاک ثبتی" />
          </Labeled>
          <Labeled label="متراژ (متر مربع)">
            <input className="field num" name="sizeSqm" inputMode="numeric" dir="ltr" placeholder="120" />
          </Labeled>
          <Labeled label="طبقه">
            <input className="field num" name="floor" inputMode="numeric" dir="ltr" placeholder="۳" />
          </Labeled>
          <Labeled label="سال ساخت">
            <input className="field num" name="yearBuilt" inputMode="numeric" dir="ltr" placeholder="1395" />
          </Labeled>
          <Labeled label="شماره سند">
            <input className="field" name="deedNumber" placeholder="شماره سند مالکیت" />
          </Labeled>
          <Labeled label="یادداشت">
            <input className="field" name="notes" placeholder="توضیحات تکمیلی" />
          </Labeled>
        </div>
      </details>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ثبت…" : "تأیید نهایی و ثبت ملک"}
        </button>
      </div>

      <Result state={state} />
    </form>
  );
}
