"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { previewPurchaseUsdAction, saveVehicleAction } from "@/app/actions/registry";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { formatMoney, toFaDigits, toJalali, todayIso } from "@/lib/format";
import type { VehicleBrand, VehicleCatalogModel } from "@/features/rwa/vehicle/types";
import { Labeled, Result } from "./shared";

type RateInfo = { usd: string; rate: string; effectiveDate: string; source: string; isExact: boolean } | null;

const RATE_SOURCE_LABEL: Record<string, string> = {
  exact: "نرخ ثبت‌شده همان تاریخ",
  nearest: "نزدیک‌ترین نرخ ثبت‌شده قبل از تاریخ خرید",
  current: "نرخ جاری کاربر (برای تاریخ خرید نرخی ثبت نشده است)",
  fallback: "نرخ پیش‌فرض سیستم",
  manual: "نرخ واردشده به‌صورت دستی",
};

function digitsOnly(v: string) {
  return v.replace(/[^\d]/g, "");
}

/**
 * فرم ثبت خودرو (همان فرم موجود «ثبت دارایی واقعی → خودرو»، اصلاح‌شده).
 *
 * • نام و مدل فقط از کاتالوگ · سال ساخت، تاریخ تملک و قیمت خرید اجباری
 * • معادل دلاری قیمت خرید با نرخ دلارِ «تاریخ تملک» محاسبه و ذخیره می‌شود
 * • هیچ فیلد مالکیت مشاع/درصدی/ارثی/رهنی و هیچ «قیمت نمایندگی» وجود ندارد
 */
export default function VehicleForm({
  brands,
  models,
  ownerName,
}: {
  brands: VehicleBrand[];
  models: VehicleCatalogModel[];
  ownerName: string;
}) {
  const [state, action, pending] = useActionState(saveVehicleAction, null);
  const today = todayIso();

  const [brandId, setBrandId] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [customModel, setCustomModel] = useState("");
  const [ownershipDate, setOwnershipDate] = useState(today);
  const [price, setPrice] = useState("");
  const [manualRate, setManualRate] = useState("");
  const [rateInfo, setRateInfo] = useState<RateInfo>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [withValuation, setWithValuation] = useState(false);

  const brand = brands.find((b) => b.id === brandId) ?? null;
  const brandModels = useMemo(() => models.filter((m) => m.brandId === brandId), [models, brandId]);
  const allowCustom = !!brand?.allowsCustomModel;

  const years = useMemo(() => {
    const jNow = toJalali(today).y;
    const gNow = Number(today.slice(0, 4));
    const jalali: number[] = [];
    for (let y = jNow + 1; y >= 1360; y--) jalali.push(y);
    const gregorian: number[] = [];
    for (let y = gNow + 1; y >= 1980; y--) gregorian.push(y);
    return { jalali, gregorian };
  }, [today]);

  // معادل دلاری قیمت خرید — محاسبه خودکار با نرخ همان تاریخ تملک.
  // مقدار قبلی هرگز نمایش داده نمی‌شود: تا وقتی ورودی کامل نباشد `preview`
  // خودش null است، پس نیازی به پاک‌کردن state داخل افکت نیست.
  const cleanPrice = digitsOnly(price);
  const canPreview = !!cleanPrice && !!ownershipDate;

  useEffect(() => {
    if (!canPreview) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setRateLoading(true);
      try {
        const res = await previewPurchaseUsdAction(cleanPrice, ownershipDate, digitsOnly(manualRate) || undefined);
        if (!cancelled) setRateInfo(res.ok ? res : null);
      } catch {
        if (!cancelled) setRateInfo(null);
      } finally {
        if (!cancelled) setRateLoading(false);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [canPreview, cleanPrice, ownershipDate, manualRate]);

  /** پیش‌نمایش معتبر فقط وقتی ورودی‌های لازم موجود باشند. */
  const preview = canPreview ? rateInfo : null;

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="catalogId" value={allowCustom ? "" : catalogId} />

      <div className="soft flex flex-wrap items-center gap-2 rounded-[var(--r-md)] p-3 text-[11.5px]">
        <span className="muted">مالک:</span>
        <strong>{ownerName}</strong>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Labeled label="برند / شرکت سازنده" required>
          <select
            className="field"
            value={brandId}
            onChange={(e) => {
              setBrandId(e.target.value);
              setCatalogId("");
              setCustomModel("");
            }}
            required
          >
            <option value="">— انتخاب برند —</option>
            <optgroup label="تولید داخل / مونتاژی">
              {brands
                .filter((b) => b.origin === "domestic")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.nameEn ? ` · ${b.nameEn}` : ""}
                  </option>
                ))}
            </optgroup>
            <optgroup label="وارداتی">
              {brands
                .filter((b) => b.origin !== "domestic")
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.nameEn ? ` · ${b.nameEn}` : ""}
                  </option>
                ))}
            </optgroup>
          </select>
        </Labeled>

        <Labeled
          label="نام / مدل خودرو"
          required
          hint={
            allowCustom
              ? "برای این برند، نام مدل را وارد کنید؛ پس از ثبت به کاتالوگ اضافه می‌شود و دفعه بعد از فهرست انتخاب می‌شود."
              : undefined
          }
        >
          {allowCustom ? (
            <input
              className="field"
              name="customModelName"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              placeholder="مثلاً کمری هیبرید 2024"
              required
            />
          ) : (
            <select
              className="field"
              value={catalogId}
              onChange={(e) => setCatalogId(e.target.value)}
              disabled={!brandId}
              required
            >
              <option value="">{brandId ? "— انتخاب مدل —" : "ابتدا برند را انتخاب کنید"}</option>
              {brandModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.modelName}
                </option>
              ))}
            </select>
          )}
        </Labeled>

        <Labeled label="سال ساخت خودروی شما" required>
          <select className="field num" name="manufacturingYear" defaultValue="" required>
            <option value="">— انتخاب سال —</option>
            <optgroup label="شمسی">
              {years.jalali.map((y) => (
                <option key={`j${y}`} value={y}>
                  {toFaDigits(String(y))}
                </option>
              ))}
            </optgroup>
            <optgroup label="میلادی">
              {years.gregorian.map((y) => (
                <option key={`g${y}`} value={y}>
                  {y}
                </option>
              ))}
            </optgroup>
          </select>
        </Labeled>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <DualDateInput
            name="ownershipDate"
            label="تاریخ تملک *"
            value={ownershipDate}
            onChange={setOwnershipDate}
            required
          />
        </div>

        <div className="space-y-3">
          <Labeled label="قیمت خرید (تومان)" required hint="مبلغ واقعی پرداخت‌شده توسط شما — از کاتالوگ گرفته نمی‌شود.">
            <AmountInput
              className="field num"
              name="purchasePriceToman"
              inputMode="numeric"
              dir="ltr"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="3500000000"
              unit="toman"
              required
            />
          </Labeled>

          <div className="rounded-[var(--r-md)] p-3" style={{ background: "var(--brand-soft)" }}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11px] font-medium">معادل دلاری قیمت خرید (محاسبه خودکار)</span>
              <strong className="num text-[13.5px]" dir="ltr" style={{ color: "var(--brand)" }}>
                {canPreview && rateLoading ? "…" : preview ? formatMoney(preview.usd, "USD") : "—"}
              </strong>
            </div>
            <div className="muted mt-1 text-[10px] leading-5">
              {preview ? (
                <>
                  نرخ دلار استفاده‌شده: <span className="num">{formatMoney(preview.rate, "IRT")}</span> ·{" "}
                  {RATE_SOURCE_LABEL[preview.source] ?? preview.source}
                  {!preview.isExact && " — در صورت نیاز نرخ دقیق آن روز را دستی وارد کنید."}
                </>
              ) : (
                null
              )}
            </div>
            <input type="hidden" name="purchaseUsdRate" value={digitsOnly(manualRate)} />
            <input
              className="field num mt-2"
              dir="ltr"
              inputMode="numeric"
              value={manualRate}
              onChange={(e) => setManualRate(e.target.value)}
              placeholder="نرخ دلار تاریخ خرید (اختیاری) — مثلاً 190000"
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Labeled label="پلاک (اختیاری)">
          <input className="field" name="plate" placeholder="۱۲ الف ۳۴۵ ایران ۱۱" />
        </Labeled>
        <Labeled label="کارکرد (اختیاری) — کیلومتر">
          <input className="field num" name="mileage" inputMode="numeric" dir="ltr" placeholder="32500" />
        </Labeled>
        <Labeled label="یادداشت (اختیاری)">
          <input className="field" name="notes" placeholder="رنگ، وضعیت بدنه، توضیحات…" />
        </Labeled>
      </div>

      <div className="rounded-[var(--r-lg)] border p-3" style={{ borderColor: "var(--border)" }}>
        <label className="flex cursor-pointer items-center gap-2 text-[12px] font-medium">
          <input type="checkbox" checked={withValuation} onChange={(e) => setWithValuation(e.target.checked)} />
          ثبت «ارزش فعلی» به‌عنوان اولین Snapshot ارزش‌گذاری (اختیاری)
        </label>
        {withValuation && (
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <Labeled label="ارزش فعلی (تومان)">
              <AmountInput className="field num" name="initialValuation" inputMode="numeric" dir="ltr" placeholder="4200000000" unit="toman" />
            </Labeled>
            <Labeled label="تاریخ ارزش‌گذاری">
              <input className="field num" type="date" name="initialValuationDate" defaultValue={today} dir="ltr" />
            </Labeled>
            <Labeled label="نرخ دلار (اختیاری)" hint="خالی بماند: نرخ همان تاریخ از سیستم نرخ ارز خوانده می‌شود.">
              <input className="field num" name="initialValuationRate" inputMode="numeric" dir="ltr" placeholder="190000" />
            </Labeled>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ثبت…" : "ثبت خودرو"}
        </button>
      </div>

      <Result state={state} />
    </form>
  );
}
