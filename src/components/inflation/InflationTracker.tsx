"use client";

import { useActionState, useState } from "react";
import {
  saveInflationPriceAction,
  updateInflationItemAction,
  updateInflationPriceAction,
  type InflationResult,
} from "@/app/actions/inflation";
import AmountInput from "@/components/ui/AmountInput";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import { faCount, formatJalaliIso, formatMoney, toFaDigits, todayIso } from "@/lib/format";
import {
  INFLATION_CATEGORY_SUGGESTIONS,
  INFLATION_DEFAULT_UNIT,
  INFLATION_UNIT_SUGGESTIONS,
} from "@/features/inflation/constants";
import type {
  InflationDashboard,
  InflationHistoryPoint,
  InflationItemComparison,
  InflationItemRow,
} from "@/features/inflation/service";

type Props = {
  items: InflationItemRow[];
  histories: Record<string, InflationHistoryPoint[]>;
  dashboard: InflationDashboard;
  categories: { id: string; name: string }[];
};

type Tab = "items" | "new" | "history" | "analysis" | "compare";

const TABS: { key: Tab; label: string }[] = [
  { key: "items", label: "کالاهای من" },
  { key: "new", label: "ثبت قیمت جدید" },
  { key: "history", label: "تاریخچه قیمت" },
  { key: "analysis", label: "تحلیل تورم" },
  { key: "compare", label: "مقایسه رشد کالاها" },
];

/** «+۴۰٪» / «−۸٪» / «—» — inflation growth in Persian digits. */
function faGrowth(g: string | null): string {
  if (g === null || g === undefined) return "—";
  const n = Number(g);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "۰٪";
  const sign = n > 0 ? "+" : "−";
  return `${sign}${toFaDigits(Math.abs(n).toFixed(1))}٪`;
}

function growthColor(g: string | null): string {
  if (g === null) return "var(--text-3)";
  const n = Number(g);
  if (!Number.isFinite(n) || n === 0) return "var(--text-3)";
  return n > 0 ? "var(--negative)" : "var(--positive)";
}

function Result({ state }: { state: InflationResult | null }) {
  if (!state) return null;
  return (
    <p
      className="rounded-[var(--r-md)] p-3 text-xs"
      style={{ background: state.ok ? "var(--brand-soft)" : "var(--negative-soft)", color: state.ok ? "var(--brand)" : "var(--negative)" }}
    >
      {state.message}
    </p>
  );
}

/* ── «ثبت قیمت جدید کالا» — observation only: no quantity, no purchase date ── */

function NewPriceForm({ items, categories }: { items: InflationItemRow[]; categories: { id: string; name: string }[] }) {
  const [existing, setExisting] = useState("");
  const [state, action, pending] = useActionState(saveInflationPriceAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label className="label">کالا</label>
          <select className="field" name="commodityId" value={existing} onChange={(e) => setExisting(e.target.value)}>
            <option value="">+ کالای جدید</option>
            {items.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} {x.categoryName ? `— ${x.categoryName}` : ""}
              </option>
            ))}
          </select>
        </div>
        {!existing && (
          <>
            <div>
              <label className="label">نام کالا *</label>
              <input name="itemName" className="field" placeholder="مثلاً برنج ایرانی" />
            </div>
            <div>
              <label className="label">دسته‌بندی</label>
              <select name="categoryId" className="field" defaultValue="">
                <option value="">بدون دسته</option>
                {categories.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">یا دسته جدید</label>
              <input name="newCategory" className="field" list="inflation-category-suggestions" placeholder="مثلاً لبنیات" />
            </div>
          </>
        )}
        <div>
          <label className="label">واحد اندازه‌گیری</label>
          <input
            name="unit"
            className="field"
            list="inflation-unit-suggestions"
            defaultValue={INFLATION_DEFAULT_UNIT}
            placeholder={INFLATION_DEFAULT_UNIT}
          />
        </div>
        <div>
          <label className="label">قیمت هر واحد (تومان) *</label>
          <AmountInput name="unitPrice" className="field" unit="toman" required placeholder="مثلاً ۲۰۰٬۰۰۰" />
        </div>
        <JalaliDateInput name="recordedAt" label="تاریخ ثبت قیمت" value={todayIso()} required />
        <div>
          <label className="label">فروشگاه / فروشنده (اختیاری)</label>
          <input name="merchant" className="field" placeholder="مثلاً فروشگاه مرکزی" />
        </div>
        <div>
          <label className="label">منطقه یا شهر (اختیاری)</label>
          <input name="region" className="field" placeholder="مثلاً تهران — سعادت‌آباد" />
        </div>
        <div className="md:col-span-2">
          <label className="label">یادداشت (اختیاری)</label>
          <input name="notes" className="field" placeholder="برند، کیفیت یا توضیحات" />
        </div>
      </div>
      <datalist id="inflation-category-suggestions">
        {INFLATION_CATEGORY_SUGGESTIONS.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <datalist id="inflation-unit-suggestions">
        {INFLATION_UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <div className="flex gap-2">
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ثبت…" : "ثبت قیمت"}
        </button>
      </div>
      <Result state={state} />
      <p className="muted text-[11px]">ثبت قیمت، مشاهده بازار است — نه خرید دارایی؛ هیچ سندی در سوابق مالی ایجاد نمی‌شود.</p>
    </form>
  );
}

/* ── inline editors (own or shared rows) ── */

function ItemEdit({ item }: { item: InflationItemRow }) {
  const [mode, setMode] = useState(false);
  const [state, action, pending] = useActionState(updateInflationItemAction, null);
  if (!mode)
    return (
      <button className="text-xs" style={{ color: "var(--brand)" }} onClick={() => setMode(true)}>
        ویرایش
      </button>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={item.id} />
      <input name="name" defaultValue={item.name} className="field !w-28 !py-1" />
      <input name="unit" defaultValue={item.unit} className="field !w-20 !py-1" list="inflation-unit-suggestions" />
      <button className="btn btn-primary !px-2 !py-1 text-xs" disabled={pending}>
        ذخیره
      </button>
      {state && <span className="text-[10px]">{state.message}</span>}
    </form>
  );
}

function PriceEdit({ price }: { price: InflationHistoryPoint }) {
  const [mode, setMode] = useState(false);
  const [state, action, pending] = useActionState(updateInflationPriceAction, null);
  if (!mode)
    return (
      <button className="text-xs" style={{ color: "var(--brand)" }} onClick={() => setMode(true)}>
        ویرایش
      </button>
    );
  return (
    <form action={action} className="flex flex-wrap items-center gap-1">
      <input type="hidden" name="id" value={price.id} />
      <AmountInput name="unitPrice" defaultValue={price.unitPrice} className="field !w-24 !py-1" unit="toman" hintClassName="!mt-1 !text-[10px]" />
      <input name="merchant" defaultValue={price.merchantName || ""} className="field !w-24 !py-1" placeholder="فروشگاه" />
      <input name="region" defaultValue={price.region || ""} className="field !w-24 !py-1" placeholder="منطقه/شهر" />
      <button className="btn btn-primary !px-2 !py-1 text-xs" disabled={pending}>
        ذخیره
      </button>
      {state && <span className="text-[10px]">{state.message}</span>}
    </form>
  );
}

function GrowthBadge({ value }: { value: string | null }) {
  return (
    <b className="num" style={{ color: growthColor(value) }} dir="rtl">
      {faGrowth(value)}
    </b>
  );
}

function ComparisonMiniTable({ rows }: { rows: InflationItemComparison[] }) {
  if (rows.length === 0) return <p className="muted text-xs">هنوز برای این بازه داده کافی ثبت نشده است.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.itemId} className="soft flex items-center justify-between gap-2 rounded-[var(--r-md)] p-2">
          <span className="min-w-0">
            <b className="block truncate text-[13px]">{r.name}</b>
            <small className="muted block truncate">
              {r.categoryName || "بدون دسته"} · هر {r.unit} {r.latestPrice ? formatMoney(r.latestPrice, "IRT") : "—"}
            </small>
          </span>
          <GrowthBadge value={r.growth["6m"]} />
        </li>
      ))}
    </ul>
  );
}

export default function InflationTracker({ items, histories, dashboard, categories }: Props) {
  const [tab, setTab] = useState<Tab>("items");
  const [historyItem, setHistoryItem] = useState(items[0]?.id ?? "");
  const history = historyItem ? (histories[historyItem] ?? []) : [];

  return (
    <div className="space-y-5">
      {/* headline strip — «تورم کل سبد کالا» */}
      <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="card p-4">
          <div className="muted text-[11px]">تورم سبد کالا · ۶ ماه اخیر</div>
          <div className="num mt-1 text-2xl font-bold" style={{ color: growthColor(dashboard.headline.growthPercent) }} dir="rtl">
            {dashboard.headline.growthPercent !== null ? faGrowth(dashboard.headline.growthPercent) : "—"}
          </div>
          <div className="muted mt-1 text-[10.5px]">
            {dashboard.headline.itemsWithBaseline > 0
              ? `بر اساس ${faCount(dashboard.headline.itemsWithBaseline)} کالا`
              : "داده کافی نیست"}
          </div>
        </div>
        <div className="card p-4">
          <div className="muted text-[11px]">کالاهای من</div>
          <div className="num mt-1 text-2xl font-bold" dir="rtl">{faCount(dashboard.totalItems)}</div>
          <div className="muted mt-1 text-[10.5px]">{faCount(dashboard.totalObservations)} ثبت قیمت</div>
        </div>
        <div className="card p-4">
          <div className="muted text-[11px]">تورم سبد · یک ماه اخیر</div>
          <div className="num mt-1 text-2xl font-bold" style={{ color: growthColor(dashboard.windows[0]?.growthPercent ?? null) }} dir="rtl">
            {dashboard.windows[0]?.growthPercent !== null ? faGrowth(dashboard.windows[0]?.growthPercent ?? null) : "—"}
          </div>
          <div className="muted mt-1 text-[10.5px]">میانگین ساده رشد کالاها</div>
        </div>
        <div className="card p-4">
          <div className="muted text-[11px]">تورم سبد · یک سال اخیر</div>
          <div className="num mt-1 text-2xl font-bold" style={{ color: growthColor(dashboard.windows[3]?.growthPercent ?? null) }} dir="rtl">
            {dashboard.windows[3]?.growthPercent !== null ? faGrowth(dashboard.windows[3]?.growthPercent ?? null) : "—"}
          </div>
          <div className="muted mt-1 text-[10.5px]">میانگین ساده رشد کالاها</div>
        </div>
      </section>

      {/* tabs */}
      <div className="card p-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="بخش‌های ردیاب تورم">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-[var(--r-md)] px-3 py-2 text-[12.5px] font-medium ${tab === t.key ? "seg-on" : ""}`}
              style={tab === t.key ? {} : { color: "var(--text-2)" }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "items" && (
        <section className="card space-y-3 p-5">
          <h2 className="font-bold">کالاهای من</h2>
          {items.length === 0 ? (
            <p className="muted text-xs">هنوز کالایی ثبت نشده است. از بخش «ثبت قیمت جدید» اولین قیمت را وارد کنید.</p>
          ) : (
            items.map((x) => (
              <div key={x.id} className="soft flex items-center justify-between gap-2 rounded-[var(--r-md)] p-2">
                <span className="min-w-0">
                  <b className="block truncate">{x.name}</b>
                  <small className="muted block truncate">
                    {x.categoryName || "بدون دسته"} · هر {x.unit}
                    {x.latestPrice ? ` · آخرین قیمت ${formatMoney(x.latestPrice, "IRT")}` : " · بدون ثبت قیمت"}
                    {x.latestDate ? ` · ${formatJalaliIso(x.latestDate)}` : ""}
                    {` · ${faCount(x.recordCount)} ثبت`}
                  </small>
                </span>
                <ItemEdit item={x} />
              </div>
            ))
          )}
        </section>
      )}

      {tab === "new" && (
        <section className="card p-5">
          <h2 className="mb-1 font-bold">ثبت قیمت جدید کالا</h2>
          <p className="muted mb-5 text-xs">قیمت روز بازار را ثبت کنید؛ تعداد و تاریخ خرید پرسیده نمی‌شود چون اینجا خرید دارایی نیست.</p>
          <NewPriceForm items={items} categories={categories} />
        </section>
      )}

      {tab === "history" && (
        <section className="card space-y-3 p-5">
          <h2 className="font-bold">تاریخچه قیمت</h2>
          {items.length === 0 ? (
            <p className="muted text-xs">هنوز کالایی ثبت نشده است.</p>
          ) : (
            <>
              <div>
                <label className="label">کالا</label>
                <select className="field" value={historyItem} onChange={(e) => setHistoryItem(e.target.value)}>
                  {items.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                    </option>
                  ))}
                </select>
              </div>
              {history.length === 0 ? (
                <p className="muted text-xs">برای این کالا هنوز قیمتی ثبت نشده است.</p>
              ) : (
                <div className="space-y-2">
                  {history.map((h) => (
                    <div key={h.id} className="flex items-center justify-between gap-2 border-t pt-2" style={{ borderColor: "var(--border)" }}>
                      <span className="text-xs">
                        <b className="num" dir="rtl">{formatMoney(h.unitPrice, "IRT")}</b>
                        <span className="muted"> · هر {h.unit} · {formatJalaliIso(h.recordedAt)}</span>
                        {h.merchantName ? <span className="muted"> · {h.merchantName}</span> : null}
                        {h.region ? <span className="muted"> · {h.region}</span> : null}
                        {h.notes ? <span className="muted"> · {h.notes}</span> : null}
                      </span>
                      <PriceEdit price={h} />
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {tab === "analysis" && (
        <div className="grid gap-5 xl:grid-cols-2">
          <section className="card p-5">
            <h2 className="mb-1 font-bold">بیشترین افزایش قیمت · ۶ ماه اخیر</h2>
            <p className="muted mb-4 text-xs">کالاهایی که سریع‌ترین رشد را داشته‌اند.</p>
            <ComparisonMiniTable rows={dashboard.topRisers} />
          </section>
          <section className="card p-5">
            <h2 className="mb-1 font-bold">کمترین افزایش قیمت · ۶ ماه اخیر</h2>
            <p className="muted mb-4 text-xs">کالاهایی با آرام‌ترین رشد (یا کاهش قیمت).</p>
            <ComparisonMiniTable rows={dashboard.leastRisers} />
          </section>
        </div>
      )}

      {tab === "compare" && (
        <section className="card overflow-x-auto p-5">
          <h2 className="mb-1 font-bold">مقایسه رشد کالاها</h2>
          <p className="muted mb-4 text-xs">قیمت امروز هر کالا در برابر یک ماه، سه ماه، شش ماه و یک سال قبل.</p>
          {dashboard.items.length === 0 ? (
            <p className="muted text-xs">هنوز کالایی ثبت نشده است.</p>
          ) : (
            <table className="w-full min-w-[640px] text-[12.5px]">
              <thead>
                <tr className="muted text-right text-[11px]">
                  <th className="py-2 pl-2 font-medium">کالا</th>
                  <th className="py-2 pl-2 font-medium">قیمت امروز</th>
                  <th className="py-2 pl-2 font-medium">یک ماه قبل</th>
                  <th className="py-2 pl-2 font-medium">سه ماه قبل</th>
                  <th className="py-2 pl-2 font-medium">شش ماه قبل</th>
                  <th className="py-2 font-medium">یک سال قبل</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.items.map((r) => (
                  <tr key={r.itemId} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pl-2">
                      <b>{r.name}</b>
                      <small className="muted block">{r.categoryName || "بدون دسته"}</small>
                    </td>
                    <td className="num py-2 pl-2" dir="rtl">
                      {r.latestPrice ? formatMoney(r.latestPrice, "IRT") : "—"}
                      <small className="muted block">هر {r.unit}</small>
                    </td>
                    <td className="py-2 pl-2"><GrowthBadge value={r.growth["1m"]} /></td>
                    <td className="py-2 pl-2"><GrowthBadge value={r.growth["3m"]} /></td>
                    <td className="py-2 pl-2"><GrowthBadge value={r.growth["6m"]} /></td>
                    <td className="py-2"><GrowthBadge value={r.growth["12m"]} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <p className="muted flex items-center gap-1.5 text-[11px]">
        این ماژول صرفاً تحلیلی است: دارایی محسوب نمی‌شود و وارد سبد دارایی، ثروت خالص و سوابق مالی نمی‌شود.
      </p>
    </div>
  );
}
