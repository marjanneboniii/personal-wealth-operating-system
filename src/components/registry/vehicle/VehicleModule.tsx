"use client";

import { useState } from "react";
import type { VehicleDashboardItem, VehiclePortfolioSummary } from "@/features/rwa/vehicle/dto";
import type { VehicleBrand, VehicleCatalogModel } from "@/features/rwa/vehicle/types";
import CatalogAdmin from "./CatalogAdmin";
import VehicleCard from "./VehicleCard";
import VehicleForm from "./VehicleForm";
import { DeltaPct, DeltaToman, DeltaUsd, Hint, Metric, Toman, Usd, faNum } from "./shared";

type Tab = "vehicles" | "add" | "catalog";

/**
 * دارایی واقعی → خودرو (همان بخش موجود، اصلاح و تکمیل‌شده).
 *
 * اصل کلیدی: نرخ دلار یک شاخص تبدیل تاریخی است، نه موتور تغییر ارزش خودرو.
 *      تغییر نرخ دلار ≠ تغییر ارزش خودرو
 *      ثبت ارزش جدید  = Snapshot جدید = تغییر Current Value
 */
export default function VehicleModule({
  brands,
  models,
  dashboard,
  summary,
  ownerName,
}: {
  brands: VehicleBrand[];
  models: VehicleCatalogModel[];
  dashboard: VehicleDashboardItem[];
  summary: VehiclePortfolioSummary;
  ownerName: string;
}) {
  const [tab, setTab] = useState<Tab>(dashboard.length ? "vehicles" : "add");

  return (
    <section className="card p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold tracking-tight">🚗 دارایی واقعی ← خودرو</h2>
        </div>
        <div className="seg" role="group" aria-label="بخش خودرو">
          <button type="button" onClick={() => setTab("vehicles")} className={tab === "vehicles" ? "seg-on" : ""} aria-pressed={tab === "vehicles"}>
            خودروهای من
          </button>
          <button type="button" onClick={() => setTab("add")} className={tab === "add" ? "seg-on" : ""} aria-pressed={tab === "add"}>
            افزودن خودرو
          </button>
          <button type="button" onClick={() => setTab("catalog")} className={tab === "catalog" ? "seg-on" : ""} aria-pressed={tab === "catalog"}>
            کاتالوگ خودرو
          </button>
        </div>
      </header>

      {/* ── Vehicles portfolio strip ── */}
      {summary.count > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 border-y py-4 sm:grid-cols-3 lg:grid-cols-5" style={{ borderColor: "var(--border)" }}>
          <Metric
            label="ارزش خودروهای در اختیار"
            value={<Toman value={summary.totalCurrentToman} />}
            sub={<>≈ <Usd value={summary.totalCurrentUsd} /></>}
          />
          <Metric
            label="مجموع قیمت خرید"
            value={<Toman value={summary.totalPurchaseToman} />}
            sub={<>≈ <Usd value={summary.totalPurchaseUsd} /></>}
          />
          <Metric label="سود/زیان تومانی" value={<DeltaToman value={summary.totalGainToman} />} sub={<>ROI: <DeltaPct value={summary.roiToman} /></>} />
          <Metric label="سود/زیان دلاری" value={<DeltaUsd value={summary.totalGainUsd} />} sub={<>ROI: <DeltaPct value={summary.roiUsd} /></>} />
          <Metric
            label="تعداد خودرو"
            value={<span className="num">{faNum(summary.count)}</span>}
            sub={`${faNum(summary.activeCount)} فعال · ${faNum(summary.soldCount)} فروخته‌شده`}
          />
        </div>
      )}

      {summary.soldCount > 0 && (
        <p className="muted -mt-2 mb-4 text-[10.5px] leading-5">
          مجموع‌های بالا فقط خودروهای در اختیار را در بر می‌گیرد. {faNum(summary.soldCount)} خودروی فروخته‌شده با مبلغ
          فروش <Toman value={summary.soldProceedsToman} /> و سود/زیان تحقق‌یافته{" "}
          <DeltaToman value={summary.realisedGainToman} /> (<DeltaUsd value={summary.realisedGainUsd} />) جداگانه در کارت
          هر خودرو گزارش می‌شود.
        </p>
      )}

      {tab === "vehicles" && (
        <div className="space-y-4">
          {summary.unvaluedCount > 0 && (
            <Hint tone="warn">
              {faNum(summary.unvaluedCount)} خودرو هنوز هیچ ارزش‌گذاری ثبت‌شده ندارد؛ تا زمانی که Snapshot ثبت نشود، ارزش
              فعلی و سود/زیان محاسبه نمی‌شود (هیچ مقدار فرضی ساخته نمی‌شود).
            </Hint>
          )}
          {dashboard.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] font-semibold">هنوز خودرویی ثبت نشده است</p>
              <p className="muted mx-auto mt-1 max-w-md text-[11.5px] leading-6">
                برند و مدل را از کاتالوگ انتخاب کنید، سال ساخت، تاریخ تملک و قیمت خرید را وارد کنید؛ معادل دلاری با نرخ
                همان تاریخ ذخیره می‌شود.
              </p>
              <button className="btn btn-primary mt-3" onClick={() => setTab("add")}>
                افزودن خودرو
              </button>
            </div>
          ) : (
            dashboard.map((item) => <VehicleCard key={item.vehicle.id} item={item} />)
          )}
        </div>
      )}

      {tab === "add" && (
        <div className="space-y-3">
          <VehicleForm brands={brands} models={models} ownerName={ownerName} />
        </div>
      )}

      {tab === "catalog" && <CatalogAdmin brands={brands} models={models} />}
    </section>
  );
}
