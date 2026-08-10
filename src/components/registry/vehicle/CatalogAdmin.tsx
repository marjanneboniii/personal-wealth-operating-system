"use client";

import { useActionState, useMemo, useState } from "react";
import { createVehicleBrandAction, createVehicleModelAction } from "@/app/actions/registry";
import type { VehicleBrand, VehicleCatalogModel } from "@/features/rwa/vehicle/types";
import { Hint, Labeled, Result, faNum } from "./shared";

/**
 * کاتالوگ خودرو — کاملاً Dynamic.
 * افزودن برند و خودروی جدید بدون تغییر ساختار دیتابیس یا کد؛
 * ثبت تکراری (همان برند + همان نام) قبل از ایجاد رکورد بررسی و رد می‌شود.
 */
export default function CatalogAdmin({
  brands,
  models,
}: {
  brands: VehicleBrand[];
  models: VehicleCatalogModel[];
}) {
  const [brandState, brandAction, brandPending] = useActionState(createVehicleBrandAction, null);
  const [modelState, modelAction, modelPending] = useActionState(createVehicleModelAction, null);
  const [filter, setFilter] = useState("");

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) =>
        m.modelName.toLowerCase().includes(q) ||
        m.brandName.toLowerCase().includes(q) ||
        (m.brandNameEn ?? "").toLowerCase().includes(q),
    );
  }, [models, filter]);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <form action={modelAction} className="space-y-3">
          <h4 className="text-[13px] font-semibold">افزودن خودروی جدید به کاتالوگ</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="برند / شرکت سازنده" required>
              <select className="field" name="brandId" required defaultValue="">
                <option value="">— انتخاب برند —</option>
                {brands.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {b.nameEn ? ` · ${b.nameEn}` : ""}
                  </option>
                ))}
              </select>
            </Labeled>
            <Labeled label="نام خودرو" required>
              <input className="field" name="modelName" placeholder="مثلاً تیگو 8 پرومکس F8" required />
            </Labeled>
            <Labeled label="شرکت مونتاژکننده / واردکننده">
              <input className="field" name="manufacturer" placeholder="در صورت وجود" />
            </Labeled>
            <Labeled label="سال مدل کاتالوگ (اختیاری)">
              <input className="field num" name="modelYear" inputMode="numeric" dir="ltr" placeholder="2025" />
            </Labeled>
            <Labeled label="دسته‌بندی خودرو">
              <select className="field" name="category" defaultValue="">
                <option value="">بدون دسته</option>
                <option value="sedan">سدان</option>
                <option value="suv">شاسی‌بلند / SUV</option>
                <option value="crossover">کراس‌اوور</option>
                <option value="hatchback">هاچ‌بک</option>
                <option value="pickup">وانت / پیکاپ</option>
                <option value="van">ون</option>
                <option value="ev">برقی</option>
                <option value="hybrid">هیبریدی</option>
                <option value="other">سایر</option>
              </select>
            </Labeled>
            <Labeled label="توضیحات (اختیاری)">
              <input className="field" name="description" placeholder="توضیح کوتاه" />
            </Labeled>
          </div>
          <Hint>
            اگر خودرویی با همین برند و نام قبلاً ثبت شده باشد، سیستم پیش از ایجاد رکورد جدید هشدار می‌دهد و رکورد تکراری
            ساخته نمی‌شود.
          </Hint>
          <button className="btn btn-primary" disabled={modelPending}>
            {modelPending ? "در حال ثبت…" : "افزودن به کاتالوگ"}
          </button>
          <Result state={modelState} />
        </form>

        <form action={brandAction} className="space-y-3">
          <h4 className="text-[13px] font-semibold">افزودن برند / شرکت سازنده جدید</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Labeled label="نام برند" required>
              <input className="field" name="name" placeholder="مثلاً چری" required />
            </Labeled>
            <Labeled label="نام لاتین (اختیاری)">
              <input className="field" name="nameEn" dir="ltr" placeholder="Chery" />
            </Labeled>
            <Labeled label="نوع">
              <select className="field" name="origin" defaultValue="imported">
                <option value="domestic">تولید داخل / مونتاژی</option>
                <option value="imported">وارداتی</option>
              </select>
            </Labeled>
            <label className="mt-6 flex items-center gap-2 text-[11.5px]">
              <input type="checkbox" name="allowsCustomModel" />
              اجازه ورود دستی نام مدل توسط کاربر
            </label>
          </div>
          <Hint>
            برندهایی مانند تویوتا، رنو، رووی، سوزوکی، مرسدس بنز و هوندا با این گزینه ثبت شده‌اند: کاربر نام مدل را وارد
            می‌کند و مدل بلافاصله به کاتالوگ اضافه می‌شود.
          </Hint>
          <button className="btn" disabled={brandPending}>
            {brandPending ? "در حال ثبت…" : "افزودن برند"}
          </button>
          <Result state={brandState} />
        </form>
      </div>

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-[13px] font-semibold">
            فهرست کاتالوگ · {faNum(brands.length)} برند · {faNum(models.length)} خودرو
          </h4>
          <input
            className="field !w-56"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="جستجوی برند یا خودرو…"
          />
        </div>
        <div className="max-h-80 overflow-auto rounded-[var(--r-md)] border" style={{ borderColor: "var(--border)" }}>
          <table className="table">
            <thead>
              <tr>
                <th>برند</th>
                <th>نام خودرو</th>
                <th className="hidden sm:table-cell">سازنده / مونتاژکننده</th>
                <th className="hidden sm:table-cell">دسته</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 400).map((m) => (
                <tr key={m.id}>
                  <td className="whitespace-nowrap text-[11.5px]">{m.brandName}</td>
                  <td className="text-[11.5px] font-medium">{m.modelName}</td>
                  <td className="muted hidden text-[11px] sm:table-cell">{m.manufacturer ?? "—"}</td>
                  <td className="muted hidden text-[11px] sm:table-cell">{m.category ?? "—"}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={4} className="muted py-6 text-center text-[11.5px]">
                    موردی یافت نشد.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
