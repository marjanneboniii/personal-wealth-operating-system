"use client";

import { useState } from "react";
import type { RealEstateDashboardItem, RealEstatePortfolioSummary } from "@/features/rwa/realEstate/service";
import type { MarketSegmentSummary, PropertyMarketView } from "@/features/rwa/realEstate/market/service";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";
import { RealEstateLogo } from "@/components/ui/IranLogo";
import type { PickerAccount } from "@/components/ui/AccountPicker";
import RealAssetQuickAdd from "@/components/registry/RealAssetQuickAdd";
import type { MarketReminder } from "@/features/rwa/realEstate/market/reminders";
import MarketPriceTracker from "./MarketPriceTracker";
import MasterDataAdmin from "./MasterDataAdmin";
import RealEstateCard from "./RealEstateCard";
import RealEstateForm from "./RealEstateForm";
import { DeltaPct, DeltaToman, Hint, Toman, Usd, faNum } from "./shared";

type Tab = "list" | "add" | "market" | "master";

/**
 * The module is a client component fed by a server read model. If a value ever
 * arrives with the wrong shape, the previous behaviour was to throw
 * (`dashboard.map is not a function`) and take the WHOLE page down behind the
 * global error boundary. Never let a read-model shape problem become a
 * page-wide failure: coerce to a safe empty value and render the empty state.
 */
function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const EMPTY_SUMMARY: RealEstatePortfolioSummary = {
  count: 0,
  unvaluedCount: 0,
  totalCurrentToman: "0",
  totalCurrentUsd: "0",
  totalPurchaseToman: "0",
  totalPurchaseUsd: "0",
  totalGainToman: "0",
  totalGainUsd: "0",
  roiToman: null,
  roiUsd: null,
};

function asSummary(value: unknown): RealEstatePortfolioSummary {
  if (!value || typeof value !== "object" || Array.isArray(value)) return EMPTY_SUMMARY;
  const s = value as Partial<RealEstatePortfolioSummary>;
  return typeof s.count === "number" ? (s as RealEstatePortfolioSummary) : EMPTY_SUMMARY;
}

function asRecord<T>(value: unknown): Record<string, T> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, T>) : {};
}

/**
 * دارایی واقعی ← املاک
 *
 * One figure strip (value · cost · result), then one row per property. Every
 * detail — performance periods, market evidence, history — lives inside the
 * property it belongs to, so the page never scrolls sideways.
 */
export default function RealEstateModule({
  dashboard,
  summary,
  cities,
  neighborhoods,
  propertyTypes,
  bankAccounts = [],
  marketViews,
  marketSegments,
  marketReminders,
  canManageMasterData = false,
}: {
  bankAccounts?: PickerAccount[];
  dashboard?: RealEstateDashboardItem[] | null;
  summary?: RealEstatePortfolioSummary | null;
  cities?: City[] | null;
  neighborhoods?: Neighborhood[] | null;
  propertyTypes?: PropertyType[] | null;
  ownerName?: string;
  fxRate?: string | null;
  /** Market insight per property id (read model; may be empty). */
  marketViews?: Record<string, PropertyMarketView> | null;
  /** The user's tracked market segments — «قیمت بازار» tab. */
  marketSegments?: MarketSegmentSummary[] | null;
  /** Properties whose market has no price yet or a price older than a month. */
  marketReminders?: MarketReminder[] | null;
  /** Master data is reference data shared by every user — owner/admin only. */
  canManageMasterData?: boolean;
}) {
  const items = asArray<RealEstateDashboardItem>(dashboard);
  const totals = asSummary(summary);
  const views = asRecord<PropertyMarketView>(marketViews);
  const reminders = asArray<MarketReminder>(marketReminders);
  const cityList = asArray<City>(cities);
  const neighborhoodList = asArray<Neighborhood>(neighborhoods);
  const propertyTypeList = asArray<PropertyType>(propertyTypes);

  const [tab, setTab] = useState<Tab>(items.length ? "list" : "add");
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <section className="card re-module" aria-labelledby="re-module-title">
      <header className="re-head">
        <div className="min-w-0">
          <h2 id="re-module-title" className="re-title">
            املاک
          </h2>
          {totals.count > 0 && <p className="re-subtitle">{`${faNum(totals.count)} ملک ثبت‌شده`}</p>}
        </div>
        <div className="seg" role="group" aria-label="بخش املاک">
          <button type="button" onClick={() => setTab("list")} className={tab === "list" ? "seg-on" : ""} aria-pressed={tab === "list"}>
            املاک من
          </button>
          <button type="button" onClick={() => setTab("add")} className={tab === "add" ? "seg-on" : ""} aria-pressed={tab === "add"}>
            ثبت ملک
          </button>
          <button type="button" onClick={() => setTab("market")} className={tab === "market" ? "seg-on" : ""} aria-pressed={tab === "market"}>
            قیمت بازار
          </button>
          {canManageMasterData && (
            <button type="button" onClick={() => setTab("master")} className={tab === "master" ? "seg-on" : ""} aria-pressed={tab === "master"}>
              داده پایه
            </button>
          )}
        </div>
      </header>

      {tab === "list" && (
        <div className="re-body">
          {totals.count > 0 && (
            <dl className="metric-strip re-summary">
              <div>
                <dt>ارزش روز املاک</dt>
                <dd>
                  <Toman value={totals.totalCurrentToman} />
                </dd>
                <dd className="re-sub">
                  <Usd value={totals.totalCurrentUsd} />
                </dd>
              </div>
              <div>
                <dt>قیمت خرید</dt>
                <dd>
                  <Toman value={totals.totalPurchaseToman} />
                </dd>
                <dd className="re-sub">
                  <Usd value={totals.totalPurchaseUsd} />
                </dd>
              </div>
              <div>
                <dt>سود / زیان تحقق‌نیافته</dt>
                <dd>
                  <DeltaToman value={totals.totalGainToman} />
                </dd>
                <dd className="re-sub">
                  تومانی <DeltaPct value={totals.roiToman} /> · دلاری <DeltaPct value={totals.roiUsd} />
                </dd>
              </div>
            </dl>
          )}

          {totals.unvaluedCount > 0 && (
            <Hint tone="warn">{faNum(totals.unvaluedCount)} ملک هنوز ارزش‌گذاری ندارد و در ارزش روز محاسبه نمی‌شود.</Hint>
          )}

          {reminders.length > 0 && (
            <Hint tone="warn">
              {reminders
                .map((r) =>
                  r.status === "missing"
                    ? `«${r.label}» هنوز قیمت بازار ندارد`
                    : `قیمت بازار «${r.label}» ${faNum(r.daysSinceLatest)} روز است به‌روز نشده`,
                )
                .join("؛ ")}
              .{" "}
              <button type="button" className="re-link" onClick={() => setTab("market")}>
                ثبت قیمت بازار
              </button>
            </Hint>
          )}

          {items.length === 0 ? (
            <div className="re-empty">
              <p className="re-empty-title">هنوز ملکی ثبت نشده است</p>
              <p className="muted">محله را جست‌وجو کنید و با + اضافه کنید؛ معادل دلاری خودکار محاسبه می‌شود.</p>
              <button className="btn btn-primary" onClick={() => setTab("add")}>
                ثبت ملک
              </button>
            </div>
          ) : (
            <ul className="re-list" aria-label="فهرست املاک">
              {items.map((item) => {
                const open = openId === item.id;
                const meta = [
                  item.propertyTypeNameFa ?? item.propertyType,
                  item.neighborhoodNameFa ?? item.area,
                  item.cityNameFa ?? item.cityNameEn,
                  item.sizeSqm ? `${faNum(item.sizeSqm)} متر` : null,
                ].filter(Boolean);
                return (
                  <li key={item.id} className={open ? "re-row is-open" : "re-row"}>
                    <button
                      type="button"
                      className="re-row-head"
                      onClick={() => setOpenId(open ? null : item.id)}
                      aria-expanded={open}
                      aria-controls={`re-detail-${item.id}`}
                    >
                      <RealEstateLogo size={32} />
                      <span className="re-row-main">
                        <span className="re-row-title">{item.label}</span>
                        <span className="re-row-meta">{meta.join(" · ")}</span>
                      </span>
                      <span className="re-row-value">
                        <Toman value={item.currentValueToman} />
                        <span className="re-row-delta">
                          <DeltaPct value={item.performance.roiToman} />
                        </span>
                      </span>
                      <span className="re-chevron" aria-hidden="true" />
                    </button>
                    {open && (
                      <div id={`re-detail-${item.id}`} className="re-row-body">
                        <RealEstateCard item={item} marketView={views[item.id]} />
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
          <RealAssetQuickAdd kind="property" bankAccounts={bankAccounts} />
          <details className="re-specs">
            <summary>ثبت با جزئیات کامل — نشانی، سند، طبقه، نرخ دستی</summary>
            <div>
              <RealEstateForm cities={cityList} neighborhoods={neighborhoodList} propertyTypes={propertyTypeList} bankAccounts={bankAccounts} />
            </div>
          </details>
        </div>
      )}

      {tab === "market" && (
        <div className="re-body">
          <MarketPriceTracker
            cities={cityList}
            neighborhoods={neighborhoodList}
            propertyTypes={propertyTypeList}
            segments={asArray<MarketSegmentSummary>(marketSegments)}
          />
        </div>
      )}

      {tab === "master" && canManageMasterData && (
        <div className="re-body">
          <MasterDataAdmin cities={cityList} neighborhoods={neighborhoodList} propertyTypes={propertyTypeList} />
        </div>
      )}
    </section>
  );
}
