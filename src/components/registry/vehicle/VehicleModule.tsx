"use client";

import { useState } from "react";
import type { VehicleDashboardItem, VehiclePortfolioSummary } from "@/features/rwa/vehicle/dto";
import type { VehicleBrand, VehicleCatalogModel } from "@/features/rwa/vehicle/types";
import { AutomobileLogo } from "@/components/ui/IranLogo";
import RealAssetQuickAdd from "@/components/registry/RealAssetQuickAdd";
import CatalogAdmin from "./CatalogAdmin";
import VehicleCard from "./VehicleCard";
import VehicleForm from "./VehicleForm";
import { DeltaPct, DeltaToman, Hint, Toman, Usd, faNum, yearLabel } from "./shared";

type Tab = "vehicles" | "add" | "catalog";

/**
 * دارایی واقعی ← خودرو
 *
 * Same shape as «املاک»: one figure strip (value · cost · result), then one
 * row per car. Everything about a car — its result, history and actions —
 * lives inside that car's row, so every figure is stated exactly once.
 *
 * Rule: the dollar rate converts, it never re-values. A car's value changes
 * only with a new valuation snapshot.
 */
export default function VehicleModule({
  brands,
  models,
  dashboard,
  summary,
  ownerName,
  payoutAccounts = [],
  bankAccounts = [],
}: {
  /** Toman bank accounts a car bought now may be paid from. */
  bankAccounts?: { id: string; name: string }[];
  brands: VehicleBrand[];
  models: VehicleCatalogModel[];
  dashboard: VehicleDashboardItem[];
  summary: VehiclePortfolioSummary;
  ownerName: string;
  /** Liquid accounts the sale proceeds may be credited to (unified ledger write). */
  payoutAccounts?: { id: string; name: string; symbol: string | null }[];
}) {
  const items = Array.isArray(dashboard) ? dashboard : [];
  const [tab, setTab] = useState<Tab>(items.length ? "vehicles" : "add");
  const [openId, setOpenId] = useState<string | null>(null);

  const subtitle =
    summary.count > 0
      ? summary.soldCount > 0
        ? `${faNum(summary.activeCount)} خودرو · ${faNum(summary.soldCount)} فروخته‌شده`
        : `${faNum(summary.activeCount)} خودرو`
      : null;

  return (
    <section className="card re-module" aria-labelledby="vehicle-module-title">
      <header className="re-head">
        <div className="min-w-0">
          <h2 id="vehicle-module-title" className="re-title">
            خودرو
          </h2>
          {subtitle && <p className="re-subtitle">{subtitle}</p>}
        </div>
        <div className="seg" role="group" aria-label="بخش خودرو">
          <button type="button" onClick={() => setTab("vehicles")} className={tab === "vehicles" ? "seg-on" : ""} aria-pressed={tab === "vehicles"}>
            خودروهای من
          </button>
          <button type="button" onClick={() => setTab("add")} className={tab === "add" ? "seg-on" : ""} aria-pressed={tab === "add"}>
            افزودن خودرو
          </button>
          <button type="button" onClick={() => setTab("catalog")} className={tab === "catalog" ? "seg-on" : ""} aria-pressed={tab === "catalog"}>
            کاتالوگ
          </button>
        </div>
      </header>

      {tab === "vehicles" && (
        <div className="re-body">
          {summary.activeCount > 0 && (
            <dl className="metric-strip re-summary">
              <div>
                <dt>ارزش روز خودروها</dt>
                <dd>
                  <Toman value={summary.totalCurrentToman} />
                </dd>
                <dd className="re-sub">
                  <Usd value={summary.totalCurrentUsd} />
                </dd>
              </div>
              <div>
                <dt>قیمت خرید</dt>
                <dd>
                  <Toman value={summary.totalPurchaseToman} />
                </dd>
                <dd className="re-sub">
                  <Usd value={summary.totalPurchaseUsd} />
                </dd>
              </div>
              <div>
                <dt>سود / زیان تحقق‌نیافته</dt>
                <dd>
                  <DeltaToman value={summary.totalGainToman} />
                </dd>
                <dd className="re-sub">
                  تومانی <DeltaPct value={summary.roiToman} /> · دلاری <DeltaPct value={summary.roiUsd} />
                </dd>
              </div>
            </dl>
          )}

          {summary.soldCount > 0 && (
            <p className="muted re-note">
              سود / زیان تحقق‌یافتهٔ خودروهای فروخته‌شده: <DeltaToman value={summary.realisedGainToman} />
            </p>
          )}

          {summary.unvaluedCount > 0 && (
            <Hint tone="warn">{faNum(summary.unvaluedCount)} خودرو هنوز ارزش‌گذاری ندارد و در ارزش روز محاسبه نمی‌شود.</Hint>
          )}

          {items.length === 0 ? (
            <div className="re-empty">
              <p className="re-empty-title">هنوز خودرویی ثبت نشده است</p>
              <p className="muted">خودرو را جست‌وجو کنید و با + اضافه کنید؛ معادل دلاری خودکار محاسبه می‌شود.</p>
              <button type="button" className="btn btn-primary" onClick={() => setTab("add")}>
                افزودن خودرو
              </button>
            </div>
          ) : (
            <ul className="re-list" aria-label="فهرست خودروها">
              {items.map((item) => {
                const { vehicle, valuation, gains } = item;
                const open = openId === vehicle.id;
                const sold = vehicle.status === "sold";
                const value = sold ? vehicle.salePriceToman : valuation.currentValueToman;
                const meta = [yearLabel(vehicle.year), item.holding?.label, sold ? "فروخته‌شده" : null].filter(Boolean);
                return (
                  <li key={vehicle.id} className={open ? "re-row is-open" : "re-row"}>
                    <button
                      type="button"
                      className="re-row-head"
                      onClick={() => setOpenId(open ? null : vehicle.id)}
                      aria-expanded={open}
                      aria-controls={`vehicle-detail-${vehicle.id}`}
                    >
                      <AutomobileLogo name={vehicle.brand} size={32} />
                      <span className="re-row-main">
                        <span className="re-row-title">{`${vehicle.brand} ${vehicle.model}`}</span>
                        <span className="re-row-meta">{meta.join(" · ")}</span>
                      </span>
                      <span className="re-row-value">
                        {value ? <Toman value={value} /> : <span className="muted re-row-delta">بدون ارزش‌گذاری</span>}
                        {gains.roiToman && (
                          <span className="re-row-delta">
                            <DeltaPct value={gains.roiToman} />
                          </span>
                        )}
                      </span>
                      <span className="re-chevron" aria-hidden="true" />
                    </button>
                    {open && (
                      <div id={`vehicle-detail-${vehicle.id}`} className="re-row-body">
                        <VehicleCard item={item} payoutAccounts={payoutAccounts} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === "add" && (
        <div className="re-body">
          <RealAssetQuickAdd kind="vehicle" bankAccounts={bankAccounts} />
          <details className="re-specs">
            <summary>ثبت با جزئیات کامل — مدل خارج از فهرست، پلاک، نرخ دستی</summary>
            <div>
              <VehicleForm brands={brands} models={models} ownerName={ownerName} bankAccounts={bankAccounts} />
            </div>
          </details>
        </div>
      )}

      {tab === "catalog" && (
        <div className="re-body">
          <CatalogAdmin brands={brands} models={models} />
        </div>
      )}
    </section>
  );
}
