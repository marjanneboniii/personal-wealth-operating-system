"use client";

import { Fragment, useState } from "react";
import { formatDualDate, toFaDigits } from "@/lib/format";
import type { RealEstateDashboardItem, RealEstatePortfolioSummary } from "@/features/rwa/realEstate/service";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";
import MasterDataAdmin from "./MasterDataAdmin";
import RealEstateCard from "./RealEstateCard";
import RealEstateForm from "./RealEstateForm";
import { DeltaPct, DeltaToman, DeltaUsd, Hint, Metric, Toman, Usd, faNum } from "./shared";
import { getRealEstateDisplayLabel } from "@/features/rwa/realEstate/display";

type Tab = "list" | "add" | "master";

export default function RealEstateModule({
  dashboard,
  summary,
  cities,
  neighborhoods,
  propertyTypes,
  ownerName,
  fxRate,
}: {
  dashboard: RealEstateDashboardItem[];
  summary: RealEstatePortfolioSummary;
  cities: City[];
  neighborhoods: Neighborhood[];
  propertyTypes: PropertyType[];
  ownerName: string;
  fxRate: string;
}) {
  const [tab, setTab] = useState<Tab>(dashboard.length ? "list" : "add");
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="card p-5">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] sm:text-[14px] font-bold tracking-tight">🏠 دارایی واقعی ← ملک (Real Estate)</h2>
        </div>
        <div className="seg" role="group" aria-label="بخش املاک">
          <button type="button" onClick={() => setTab("list")} className={tab === "list" ? "seg-on" : ""} aria-pressed={tab === "list"}>
            املاک من
          </button>
          <button type="button" onClick={() => setTab("add")} className={tab === "add" ? "seg-on" : ""} aria-pressed={tab === "add"}>
            ثبت ملک
          </button>
          <button type="button" onClick={() => setTab("master")} className={tab === "master" ? "seg-on" : ""} aria-pressed={tab === "master"}>
            داده پایه (Master Data)
          </button>
        </div>
      </header>

      {summary.count > 0 && (
        <div className="mb-5 grid grid-cols-2 gap-4 border-y py-4 sm:grid-cols-3 lg:grid-cols-6" style={{ borderColor: "var(--border)" }}>
          <Metric
            label="مجموع ارزش املاک"
            value={<Toman value={summary.totalCurrentToman} />}
            sub={<>≈ <Usd value={summary.totalCurrentUsd} /></>}
          />
          <Metric label="مجموع قیمت خرید" value={<Toman value={summary.totalPurchaseToman} />} sub={<>≈ <Usd value={summary.totalPurchaseUsd} /></>} />
          <Metric label="سود/زیان تومانی کل" value={<DeltaToman value={summary.totalGainToman} />} sub={<>بازده: <DeltaPct value={summary.roiToman} /></>} />
          <Metric label="سود/زیان دلاری کل" value={<DeltaUsd value={summary.totalGainUsd} />} sub={<>بازده: <DeltaPct value={summary.roiUsd} /></>} />
          <Metric label="تعداد ملک" value={<span className="num">{faNum(summary.count)}</span>} sub="ثبت‌شده در سیستم" />
          <Metric
            label="نرخ جاری سیستم"
            value={<span className="num">{faNum(fxRate)}</span>}
            sub="فقط برای تاریخ‌های بدون نرخ ثبت‌شده"
          />
        </div>
      )}

      {tab === "list" && (
        <div className="space-y-4">
          {summary.unvaluedCount > 0 && (
            <Hint tone="warn">
              {faNum(summary.unvaluedCount)} ملک ارزش‌گذاری ثبت‌شده ندارد؛ تا ثبت ارزش‌گذاری، ارزش فعلی و سود/زیان از مبلغ
              خرید محاسبه نمی‌شود.
            </Hint>
          )}
          {dashboard.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-[13px] font-semibold">هنوز ملکی ثبت نشده است</p>
              <p className="muted mx-auto mt-1 max-w-md text-[11.5px] leading-6">
                شهر و محله و نوع ملک را از فهرست انتخاب کنید؛ نام و شناسه کوتاه به‌صورت خودکار تولید می‌شوند و معادل‌های
                دلاری با نرخ تاریخی همان روزها محاسبه می‌شوند.
              </p>
              <button className="btn btn-primary mt-3" onClick={() => setTab("add")}>
                ثبت ملک
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="table min-w-[1400px] text-[11.5px]">
                <thead>
                  <tr>
                    <th>نام دارایی</th>
                    <th>نمایش فارسی</th>
                    <th>شناسه دارایی</th>
                    <th>نوع ملک</th>
                    <th>شهر</th>
                    <th>منطقه / محله</th>
                    <th>تاریخ تملک</th>
                    <th>تاریخ ارزش‌گذاری</th>
                    <th className="td-num">قیمت خرید تومان</th>
                    <th className="td-num">قیمت خرید دلار</th>
                    <th className="td-num">ارزش فعلی تومان</th>
                    <th className="td-num">ارزش فعلی دلار</th>
                    <th className="td-num">سود/زیان تومان</th>
                    <th className="td-num">سود/زیان دلار</th>
                    <th className="td-num">٪ تومان</th>
                    <th className="td-num">٪ دلار</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.map((item) => {
                    const open = openId === item.id;
                    const p = item.performance;
                    const displayFa = getRealEstateDisplayLabel({
                      symbol: item.symbol,
                      assetName: item.assetName,
                      neighborhoodNameFa: item.neighborhoodNameFa,
                      cityNameFa: item.cityNameFa,
                    });
                    return (
                      <Fragment key={item.id}>
                        <tr
                          className="cursor-pointer"
                          onClick={() => setOpenId(open ? null : item.id)}
                          aria-expanded={open}
                        >
                          <td className="max-w-56 font-bold">
                            <span className="block truncate">{item.assetName}</span>
                          </td>
                          <td className="font-semibold">
                            {displayFa}
                          </td>
                          <td className="num text-[11.5px] font-semibold">
                            {toFaDigits(item.symbol)}
                          </td>
                          <td>{item.propertyTypeNameFa ?? item.propertyType ?? "—"}</td>
                          <td>{item.cityNameFa ?? item.cityNameEn ?? "—"}</td>
                          <td>{item.neighborhoodNameFa ?? item.area ?? "—"}</td>
                          <td className="num whitespace-nowrap">{item.acquisitionDate ? formatDualDate(item.acquisitionDate) : "—"}</td>
                          <td className="num whitespace-nowrap">{item.valuationDate ? formatDualDate(item.valuationDate) : "—"}</td>
                          <td className="td-num">
                            <Toman value={item.purchasePriceToman} />
                          </td>
                          <td className="td-num">
                            <Usd value={item.purchaseValueUsd} />
                          </td>
                          <td className="td-num">
                            <Toman value={item.currentValueToman} />
                          </td>
                          <td className="td-num">
                            <Usd value={item.currentValueUsd} />
                          </td>
                          <td className="td-num">
                            <DeltaToman value={p.gainToman} />
                          </td>
                          <td className="td-num">
                            <DeltaUsd value={p.gainUsd} />
                          </td>
                          <td className="td-num">
                            <DeltaPct value={p.roiToman} />
                          </td>
                          <td className="td-num">
                            <DeltaPct value={p.roiUsd} />
                          </td>
                          <td>
                            <span className="muted text-[10px]">{open ? "بستن ▲" : "جزئیات ▼"}</span>
                          </td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={17} className="!bg-transparent p-0">
                              <div className="border-t px-3 py-4" style={{ borderColor: "var(--border)", background: "var(--sunken)" }}>
                                <RealEstateCard item={item} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "add" && (
        <div className="space-y-3">
          <div className="soft flex flex-wrap items-center gap-2 rounded-[var(--r-md)] p-3 text-[11.5px]">
            <span className="muted">مالک:</span>
            <strong>{ownerName}</strong>
          </div>
          <RealEstateForm cities={cities} neighborhoods={neighborhoods} propertyTypes={propertyTypes} />
        </div>
      )}

      {tab === "master" && <MasterDataAdmin cities={cities} neighborhoods={neighborhoods} propertyTypes={propertyTypes} />}
    </section>
  );
}
