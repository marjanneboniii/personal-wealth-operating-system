"use client";

/**
 * ردیاب تورم شخصی — the same plain cards as «ثبت هزینه»:
 *
 *   header      title and one «+ ثبت قیمت جدید» button
 *   strip       basket inflation (6m / 1m / 12m) and the item count
 *   کالاهای من  one row per item: latest price and its 6-month growth; a tap
 *               opens its growth windows and «تاریخچه قیمت»
 *   تحلیل       fastest / slowest risers · full growth comparison
 *
 * Adding a price happens in a sheet, card by card:
 *
 *   کالا        search, then square tiles of the user's items, or «+ کالای جدید»
 *               (name, category tiles, unit tiles)
 *   قیمت        amount field; the change against the last recorded price
 *   تاریخ       today / yesterday / another date
 *   جزئیات      store, region, note
 *
 * A price is an observation, not a purchase: no quantity, no purchase date, no
 * account. The sheet posts the same fields to `saveInflationPriceAction`.
 */
import { useActionState, useCallback, useEffect, useMemo, useState } from "react";
import {
  saveInflationPriceAction,
  updateInflationItemAction,
  updateInflationPriceAction,
  type InflationResult,
} from "@/app/actions/inflation";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import Sheet from "@/components/ui/Sheet";
import { EmptyState, Metric, PageHeader } from "@/components/ui/Card";
import { faCount, formatJalaliIso, formatMoney, formatPct, formatPercent, getDualDate } from "@/lib/format";
import {
  INFLATION_COMPARISON_WINDOWS,
  INFLATION_DEFAULT_UNIT,
  INFLATION_NO_CATEGORY_LABEL,
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
  today: string;
};

type View = "items" | "analysis" | "compare";

const VIEWS: { key: View; label: string }[] = [
  { key: "items", label: "کالاهای من" },
  { key: "analysis", label: "تحلیل تورم" },
  { key: "compare", label: "مقایسه رشد کالاها" },
];

/** Item tiles shown before the user searches. */
const TILE_LIMIT = 11;

/** Persian search: Arabic ي/ك, half-spaces and case never block a match. */
const norm = (s: string) =>
  s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** «+۴۰٪» / «−۸٪» / «—» — inflation growth in Persian digits. */
function faGrowth(g: string | null): string {
  if (g === null || g === undefined) return "—";
  const n = Number(g);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return formatPct(0, 1);
  // formatPercent forces the sign and keeps it (and the ٪) inside the numeric
  // isolate, so «−۸٪» can never render as «۸٪−» in an RTL row.
  return formatPercent(n.toFixed(1));
}

/** Rising prices are bad news for the household: up = negative tone. */
function growthColor(g: string | null): string {
  if (g === null) return "var(--text-3)";
  const n = Number(g);
  if (!Number.isFinite(n) || n === 0) return "var(--text-3)";
  return n > 0 ? "var(--negative)" : "var(--positive)";
}

function growthTone(g: string | null): "neutral" | "up" | "down" {
  const n = g === null ? 0 : Number(g);
  if (!Number.isFinite(n) || n === 0) return "neutral";
  return n > 0 ? "down" : "up";
}

function GrowthBadge({ value }: { value: string | null }) {
  return (
    <b className="num" style={{ color: growthColor(value) }} dir="rtl">
      {faGrowth(value)}
    </b>
  );
}

function Check() {
  return (
    <span className="expense-check" aria-hidden="true">
      <Icon name="check" size={11} strokeWidth={3} />
    </span>
  );
}

function Result({ state }: { state: InflationResult | null }) {
  if (!state || state.ok) return null;
  return (
    <p className="expense-note" role="alert" style={{ color: "var(--negative)" }}>
      {state.message}
    </p>
  );
}

/* ── «ثبت قیمت جدید» sheet ── */

function NewPriceSheet({
  open,
  onClose,
  items,
  categories,
  today,
  initialItemId,
}: {
  open: boolean;
  onClose: () => void;
  items: InflationItemRow[];
  categories: { id: string; name: string }[];
  today: string;
  initialItemId: string;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="ثبت قیمت جدید" wide>
      {/* Mounted per open: every visit starts from a clean form. */}
      {open && <NewPriceForm items={items} categories={categories} today={today} initialItemId={initialItemId} onDone={onClose} />}
    </Sheet>
  );
}

function NewPriceForm({
  items,
  categories,
  today,
  initialItemId,
  onDone,
}: {
  items: InflationItemRow[];
  categories: { id: string; name: string }[];
  today: string;
  initialItemId: string;
  onDone: () => void;
}) {
  const [state, action, pending] = useActionState(saveInflationPriceAction, null);

  const [itemId, setItemId] = useState(initialItemId);
  const [creating, setCreating] = useState(!initialItemId && items.length === 0);
  const [browsing, setBrowsing] = useState(!initialItemId);
  const [query, setQuery] = useState("");

  const [itemName, setItemName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [unit, setUnit] = useState<string>(INFLATION_DEFAULT_UNIT);
  const [customUnit, setCustomUnit] = useState(false);

  const [price, setPrice] = useState("");
  const [recordedAt, setRecordedAt] = useState(today);
  const [pickingDate, setPickingDate] = useState(false);

  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);

  const selected = items.find((x) => x.id === itemId) ?? null;
  const q = norm(query);
  const matches = useMemo(
    () => (q ? items.filter((x) => norm(x.name).includes(q) || norm(x.categoryName ?? "").includes(q)) : items.slice(0, TILE_LIMIT)),
    [items, q],
  );

  const pickItem = (id: string) => {
    const item = items.find((x) => x.id === id);
    setItemId(id);
    setCreating(false);
    setBrowsing(false);
    setQuery("");
    if (item) setUnit(item.latestUnit || item.unit);
  };

  const startCreating = () => {
    setItemId("");
    setCreating(true);
    setBrowsing(false);
    setItemName(query.trim());
    setQuery("");
    setUnit(INFLATION_DEFAULT_UNIT);
  };

  const lastPrice = selected?.latestPrice ? Number(selected.latestPrice) : null;
  const entered = Number(price);
  const change = lastPrice && lastPrice > 0 && entered > 0 ? (((entered - lastPrice) / lastPrice) * 100).toFixed(2) : null;

  const yesterday = shiftIso(today, -1);
  const dateChoice = recordedAt === today ? "today" : recordedAt === yesterday ? "yesterday" : "other";

  const ready = (selected || (creating && itemName.trim())) && entered > 0 && !!recordedAt;
  const knownUnit = (INFLATION_UNIT_SUGGESTIONS as readonly string[]).includes(unit);

  return (
    <form action={action} className="expense-form p-3 sm:p-4">
      <input type="hidden" name="commodityId" value={selected ? selected.id : ""} />
      {creating && (
        <>
          <input type="hidden" name="itemName" value={itemName} />
          <input type="hidden" name="categoryId" value={addingCategory ? "" : categoryId} />
          <input type="hidden" name="newCategory" value={addingCategory ? newCategory : ""} />
        </>
      )}
      <input type="hidden" name="unit" value={unit} />
      <input type="hidden" name="recordedAt" value={recordedAt} />

      {/* ── Item ── */}
      <section className="card expense-card" aria-labelledby="infl-item-title">
        <header className="expense-head">
          <h2 id="infl-item-title">کالا</h2>
          {!browsing && items.length > 0 && (
            <button type="button" className="expense-link" onClick={() => setBrowsing(true)}>
              تغییر
            </button>
          )}
          {browsing && (selected || creating) && (
            <button type="button" className="expense-link" onClick={() => setBrowsing(false)}>
              انصراف
            </button>
          )}
        </header>

        {browsing ? (
          <>
            {items.length > TILE_LIMIT && (
              <div className="expense-search">
                <Icon name="search" size={16} />
                <input
                  type="search"
                  className="field"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جست‌وجو: برنج، شیر، روغن…"
                  aria-label="جست‌وجوی کالا"
                />
              </div>
            )}
            <div className="expense-squares" role="radiogroup" aria-label="کالاهای من">
              {matches.map((x) => {
                const on = x.id === itemId;
                return (
                  <button
                    key={x.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="expense-square"
                    data-on={on || undefined}
                    onClick={() => pickItem(x.id)}
                  >
                    {on && <Check />}
                    <span className="expense-square-label">{x.name}</span>
                    <span className="expense-square-meta">{x.categoryName || INFLATION_NO_CATEGORY_LABEL}</span>
                  </button>
                );
              })}
              <button type="button" className="expense-square expense-square-add" onClick={startCreating}>
                <span className="expense-square-label">{q ? `+ «${query.trim()}»` : "+ کالای جدید"}</span>
              </button>
            </div>
            {q && matches.length === 0 && <p className="expense-empty">کالایی با «{query}» پیدا نشد.</p>}
          </>
        ) : selected ? (
          <div className="infl-picked">
            <span className="min-w-0">
              <b className="block truncate text-[length:var(--fs-sm)]">{selected.name}</b>
              <span className="expense-sub block truncate">
                {selected.categoryName || INFLATION_NO_CATEGORY_LABEL} · {faCount(selected.recordCount)} ثبت
              </span>
            </span>
            {selected.latestPrice && (
              <span className="shrink-0 text-left">
                <span className="expense-sub block">آخرین قیمت</span>
                <b className="num block text-[length:var(--fs-sm)] money-nowrap" dir="rtl">
                  {formatMoney(selected.latestPrice, "IRT")}
                </b>
              </span>
            )}
          </div>
        ) : (
          <>
            <div>
              <label htmlFor="infl-item-name" className="label">
                نام کالا
              </label>
              <input
                id="infl-item-name"
                className="field"
                value={itemName}
                autoFocus
                onChange={(e) => setItemName(e.target.value)}
                placeholder="مثلاً برنج ایرانی"
                maxLength={200}
              />
            </div>

            <p className="expense-sub">دسته‌بندی</p>
            <div className="expense-squares" role="radiogroup" aria-label="دسته‌بندی کالا">
              <button
                type="button"
                role="radio"
                aria-checked={!categoryId && !addingCategory}
                className="expense-square"
                data-on={(!categoryId && !addingCategory) || undefined}
                onClick={() => {
                  setCategoryId("");
                  setAddingCategory(false);
                }}
              >
                <span className="expense-square-label">{INFLATION_NO_CATEGORY_LABEL}</span>
              </button>
              {categories.map((c) => {
                const on = !addingCategory && c.id === categoryId;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="expense-square"
                    data-on={on || undefined}
                    onClick={() => {
                      setCategoryId(c.id);
                      setAddingCategory(false);
                    }}
                  >
                    {on && <Check />}
                    <span className="expense-square-label">{c.name}</span>
                  </button>
                );
              })}
              <button
                type="button"
                className="expense-square expense-square-add"
                data-on={addingCategory || undefined}
                aria-expanded={addingCategory}
                onClick={() => setAddingCategory((v) => !v)}
              >
                <span className="expense-square-label">+ دسته جدید</span>
              </button>
            </div>
            {addingCategory && (
              <input
                className="field"
                value={newCategory}
                autoFocus
                onChange={(e) => setNewCategory(e.target.value)}
                placeholder="نام دسته جدید، مثلاً میوه"
                maxLength={100}
              />
            )}
          </>
        )}

        {(selected || creating) && !browsing && (
          <div className="expense-row !p-0">
            <span className="expense-row-label">واحد</span>
            <div className="infl-units" role="radiogroup" aria-label="واحد اندازه‌گیری">
              {INFLATION_UNIT_SUGGESTIONS.map((u) => {
                const on = !customUnit && unit === u;
                return (
                  <button
                    key={u}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    className="expense-preset"
                    data-on={on || undefined}
                    onClick={() => {
                      setUnit(u);
                      setCustomUnit(false);
                    }}
                  >
                    {u}
                  </button>
                );
              })}
              <button
                type="button"
                className="expense-preset"
                data-on={customUnit || !knownUnit || undefined}
                aria-expanded={customUnit}
                onClick={() => {
                  setCustomUnit(true);
                  if (knownUnit) setUnit("");
                }}
              >
                {!customUnit && !knownUnit && unit ? unit : "سایر"}
              </button>
            </div>
            {customUnit && (
              <input
                className="field"
                value={unit}
                autoFocus
                onChange={(e) => setUnit(e.target.value)}
                placeholder="مثلاً شانه، بطری، متر"
                maxLength={50}
              />
            )}
          </div>
        )}
      </section>

      {/* ── Price ── */}
      <section className="card expense-card" aria-labelledby="infl-price-title">
        <header className="expense-head">
          <h2 id="infl-price-title">قیمت هر {unit || "واحد"}</h2>
          <span className="expense-sub">تومان</span>
        </header>
        <AmountInput
          id="infl-price"
          name="unitPrice"
          value={price}
          onValueChange={setPrice}
          placeholder="۰"
          className="field num"
          unit="toman"
          aria-labelledby="infl-price-title"
        />
        {change !== null && (
          <p className="expense-note" role="status">
            نسبت به آخرین قیمت ({formatJalaliIso(selected!.latestDate ?? today)}): <GrowthBadge value={change} />
          </p>
        )}
      </section>

      {/* ── Date & details ── */}
      <section className="card expense-card expense-details">
        <div className="expense-row">
          <span className="expense-row-label">تاریخ ثبت قیمت</span>
          <div className="expense-seg" role="group" aria-label="تاریخ ثبت قیمت">
            {(
              [
                ["today", "امروز", today],
                ["yesterday", "دیروز", yesterday],
              ] as const
            ).map(([key, label, iso]) => {
              const on = dateChoice === key && !pickingDate;
              return (
                <button
                  key={key}
                  type="button"
                  data-on={on || undefined}
                  aria-pressed={on}
                  onClick={() => {
                    setRecordedAt(iso);
                    setPickingDate(false);
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              data-on={dateChoice === "other" || pickingDate || undefined}
              aria-expanded={pickingDate}
              onClick={() => setPickingDate((v) => !v)}
            >
              <Icon name="calendar" size={14} />
              {dateChoice === "other" && recordedAt ? getDualDate(recordedAt).jalali : "تاریخ دیگر"}
            </button>
          </div>
          {pickingDate && (
            <DualDateInput name="recordedAtPicker" value={recordedAt} onChange={setRecordedAt} label="تاریخ ثبت قیمت" required showGregorian={false} />
          )}
        </div>
        <div className="expense-row">
          <label htmlFor="infl-merchant" className="expense-row-label">
            فروشگاه
          </label>
          <input id="infl-merchant" name="merchant" className="field" placeholder="اختیاری — مثلاً فروشگاه مرکزی" maxLength={200} />
        </div>
        <div className="expense-row">
          <label htmlFor="infl-region" className="expense-row-label">
            منطقه یا شهر
          </label>
          <input id="infl-region" name="region" className="field" placeholder="اختیاری — مثلاً تهران، سعادت‌آباد" maxLength={200} />
        </div>
        <div className="expense-row">
          <label htmlFor="infl-notes" className="expense-row-label">
            یادداشت
          </label>
          <input id="infl-notes" name="notes" className="field" placeholder="اختیاری — برند، کیفیت یا توضیحات" maxLength={1000} />
        </div>
      </section>

      <Result state={state} />

      <div className="sheet-submit">
        <button type="submit" className="btn btn-primary w-full disabled:opacity-40" disabled={pending || !ready}>
          {pending ? "در حال ثبت…" : entered > 0 ? `ثبت قیمت ${formatMoney(price, "IRT")}` : "ثبت قیمت"}
        </button>
        <p className="expense-sub mt-2 text-center">ثبت قیمت، مشاهده بازار است — نه خرید؛ هیچ سندی در سوابق مالی ایجاد نمی‌شود.</p>
      </div>
    </form>
  );
}

/* ── inline editors (own rows only; the server refuses shared rows) ── */

function ItemEdit({ item }: { item: InflationItemRow }) {
  const [mode, setMode] = useState(false);
  const [state, action, pending] = useActionState(updateInflationItemAction, null);
  if (!mode)
    return (
      <button type="button" className="expense-link" onClick={() => setMode(true)}>
        ویرایش کالا
      </button>
    );
  return (
    <form action={action} className="infl-inline-edit">
      <input type="hidden" name="id" value={item.id} />
      <input name="name" defaultValue={item.name} className="field" aria-label="نام کالا" />
      <input name="unit" defaultValue={item.unit} className="field" aria-label="واحد" list="inflation-unit-suggestions" />
      <button className="btn btn-primary shrink-0" disabled={pending}>
        ذخیره
      </button>
      <button type="button" className="btn btn-ghost shrink-0" onClick={() => setMode(false)}>
        بستن
      </button>
      {state && <span className="expense-sub basis-full">{state.message}</span>}
    </form>
  );
}

function PriceEdit({ price }: { price: InflationHistoryPoint }) {
  const [mode, setMode] = useState(false);
  const [state, action, pending] = useActionState(updateInflationPriceAction, null);
  if (!mode)
    return (
      <button type="button" className="expense-link" onClick={() => setMode(true)} aria-label="ویرایش این قیمت">
        ویرایش
      </button>
    );
  return (
    <form action={action} className="infl-inline-edit basis-full">
      <input type="hidden" name="id" value={price.id} />
      <AmountInput name="unitPrice" defaultValue={price.unitPrice} className="field" unit="toman" hintClassName="!mt-1 !text-[length:var(--fs-xs)]" />
      <input name="merchant" defaultValue={price.merchantName || ""} className="field" placeholder="فروشگاه" />
      <input name="region" defaultValue={price.region || ""} className="field" placeholder="منطقه/شهر" />
      <button className="btn btn-primary shrink-0" disabled={pending}>
        ذخیره
      </button>
      <button type="button" className="btn btn-ghost shrink-0" onClick={() => setMode(false)}>
        بستن
      </button>
      {state && <span className="expense-sub basis-full">{state.message}</span>}
    </form>
  );
}

/* ── lists ── */

function ItemRow({
  item,
  comparison,
  history,
  open,
  onToggle,
  onAddPrice,
}: {
  item: InflationItemRow;
  comparison: InflationItemComparison | undefined;
  history: InflationHistoryPoint[];
  open: boolean;
  onToggle: () => void;
  onAddPrice: () => void;
}) {
  const g6 = comparison?.growth["6m"] ?? null;
  return (
    <li className={`infl-row ${open ? "is-open" : ""}`}>
      <button type="button" className="infl-row-head" aria-expanded={open} onClick={onToggle}>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[length:var(--fs-sm)]">{item.name}</b>
          <span className="expense-sub block truncate">
            {item.categoryName || INFLATION_NO_CATEGORY_LABEL} · {faCount(item.recordCount)} ثبت
            {item.latestDate ? ` · ${formatJalaliIso(item.latestDate)}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-left">
          <span className="num block text-[length:var(--fs-sm)] font-semibold money-nowrap" dir="rtl">
            {item.latestPrice ? formatMoney(item.latestPrice, "IRT") : "—"}
          </span>
          <span className="expense-sub block">
            هر {item.latestUnit || item.unit}
            {g6 !== null && (
              <>
                {" · "}
                <GrowthBadge value={g6} />
              </>
            )}
          </span>
        </span>
        <span className="infl-chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="infl-row-body">
          <dl className="infl-windows">
            {INFLATION_COMPARISON_WINDOWS.map((w) => (
              <div key={w.key}>
                <dt>نسبت به {w.label}</dt>
                <dd>
                  <GrowthBadge value={comparison?.growth[w.key] ?? null} />
                </dd>
              </div>
            ))}
          </dl>

          <div className="expense-head">
            <h3 className="text-[length:var(--fs-xs)] font-bold">تاریخچه قیمت</h3>
            <div className="flex items-center gap-1">
              <ItemEdit item={item} />
              <button type="button" className="expense-link" onClick={onAddPrice}>
                <Icon name="plus" size={14} />
                قیمت تازه
              </button>
            </div>
          </div>

          {history.length === 0 ? (
            <p className="expense-empty">برای این کالا هنوز قیمتی ثبت نشده است.</p>
          ) : (
            <ul className="infl-history">
              {history.map((h, i) => {
                const prev = history[i + 1];
                const step =
                  prev && Number(prev.unitPrice) > 0
                    ? (((Number(h.unitPrice) - Number(prev.unitPrice)) / Number(prev.unitPrice)) * 100).toFixed(2)
                    : null;
                const meta = [h.merchantName, h.region, h.notes].filter(Boolean).join(" · ");
                return (
                  <li key={h.id}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[length:var(--fs-xs)]">
                        <b className="num money-nowrap" dir="rtl">
                          {formatMoney(h.unitPrice, "IRT")}
                        </b>
                        <span className="muted"> · هر {h.unit}</span>
                        {step !== null && (
                          <>
                            {" · "}
                            <GrowthBadge value={step} />
                          </>
                        )}
                      </span>
                      <span className="expense-sub block truncate">
                        {formatJalaliIso(h.recordedAt)}
                        {meta ? ` · ${meta}` : ""}
                      </span>
                    </span>
                    <PriceEdit price={h} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function RiserList({ rows }: { rows: InflationItemComparison[] }) {
  if (rows.length === 0) return <p className="expense-empty">هنوز برای این بازه داده کافی ثبت نشده است.</p>;
  return (
    <ul className="infl-history">
      {rows.map((r) => (
        <li key={r.itemId}>
          <span className="min-w-0 flex-1">
            <b className="block truncate text-[length:var(--fs-sm)]">{r.name}</b>
            <span className="expense-sub block truncate">
              {r.categoryName || INFLATION_NO_CATEGORY_LABEL} · هر {r.unit} {r.latestPrice ? formatMoney(r.latestPrice, "IRT") : "—"}
            </span>
          </span>
          <GrowthBadge value={r.growth["6m"]} />
        </li>
      ))}
    </ul>
  );
}

export default function InflationTracker({ items, histories, dashboard, categories, today }: Props) {
  const [view, setView] = useState<View>("items");
  const [openId, setOpenId] = useState("");
  const [sheet, setSheet] = useState<{ open: boolean; itemId: string }>({ open: false, itemId: "" });

  const comparisons = useMemo(() => new Map(dashboard.items.map((r) => [r.itemId, r])), [dashboard.items]);
  const addPrice = (itemId = "") => setSheet({ open: true, itemId });
  const closeSheet = useCallback(() => setSheet((s) => ({ ...s, open: false })), []);

  const month = dashboard.windows.find((w) => w.key === "1m")?.growthPercent ?? null;
  const year = dashboard.windows.find((w) => w.key === "12m")?.growthPercent ?? null;
  const headline = dashboard.headline.growthPercent;

  return (
    <div className="space-y-5">
      <PageHeader
        title="ردیاب تورم شخصی"
        subtitle="تورم سبد خودتان را بسنجید. این کالاها دارایی نیستند و در ارزش خالص اثری ندارند."
        action={
          <button type="button" className="btn btn-primary" onClick={() => addPrice()} aria-haspopup="dialog">
            <Icon name="plus" size={16} strokeWidth={2.2} />
            ثبت قیمت جدید
          </button>
        }
      />

      <section className="metric-strip">
        <Metric
          label="تورم سبد کالا · ۶ ماه"
          value={faGrowth(headline)}
          tone={growthTone(headline)}
          hint={dashboard.headline.itemsWithBaseline > 0 ? `بر اساس ${faCount(dashboard.headline.itemsWithBaseline)} کالا` : "داده کافی نیست"}
        />
        <Metric label="تورم سبد · یک ماه" value={faGrowth(month)} tone={growthTone(month)} />
        <Metric label="تورم سبد · یک سال" value={faGrowth(year)} tone={growthTone(year)} />
        <Metric label="کالاهای من" value={faCount(dashboard.totalItems)} hint={`${faCount(dashboard.totalObservations)} ثبت قیمت`} />
      </section>

      <div className="expense-seg infl-views" role="tablist" aria-label="بخش‌های ردیاب تورم">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} data-on={view === v.key || undefined} onClick={() => setView(v.key)}>
            {v.label}
          </button>
        ))}
      </div>

      {view === "items" &&
        (items.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="trend-up"
              title="هنوز کالایی ثبت نشده است"
              body="قیمت چند کالای پرمصرف را ثبت کنید و با ثبت‌های بعدی، تورم سبد خودتان را ببینید."
              action={
                <button type="button" className="btn btn-primary" onClick={() => addPrice()}>
                  <Icon name="plus" size={16} strokeWidth={2.2} />
                  ثبت اولین قیمت
                </button>
              }
            />
          </div>
        ) : (
          <section className="space-y-2">
            <p className="expense-sub">برای دیدن تاریخچه قیمت و رشد هر کالا، روی آن بزنید.</p>
            <ul className="card infl-list">
              {items.map((x) => (
                <ItemRow
                  key={x.id}
                  item={x}
                  comparison={comparisons.get(x.id)}
                  history={histories[x.id] ?? []}
                  open={openId === x.id}
                  onToggle={() => setOpenId((cur) => (cur === x.id ? "" : x.id))}
                  onAddPrice={() => addPrice(x.id)}
                />
              ))}
            </ul>
          </section>
        ))}

      {view === "analysis" && (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          <section className="card expense-card">
            <header className="expense-head">
              <h2>بیشترین افزایش قیمت</h2>
              <span className="expense-sub">۶ ماه اخیر</span>
            </header>
            <RiserList rows={dashboard.topRisers} />
          </section>
          <section className="card expense-card">
            <header className="expense-head">
              <h2>کمترین افزایش قیمت</h2>
              <span className="expense-sub">۶ ماه اخیر</span>
            </header>
            <RiserList rows={dashboard.leastRisers} />
          </section>
        </div>
      )}

      {view === "compare" && (
        <section className="card expense-card overflow-x-auto">
          <header className="expense-head">
            <h2>مقایسه رشد کالاها</h2>
          </header>
          <p className="expense-sub">قیمت امروز هر کالا در برابر یک ماه، سه ماه، شش ماه و یک سال قبل.</p>
          {dashboard.items.length === 0 ? (
            <p className="expense-empty">هنوز کالایی ثبت نشده است.</p>
          ) : (
            <table className="w-full min-w-[640px] text-[length:var(--fs-xs)]">
              <thead>
                <tr className="muted text-right">
                  <th scope="col" className="py-2 pl-2 font-medium">کالا</th>
                  <th scope="col" className="py-2 pl-2 font-medium">قیمت امروز</th>
                  {INFLATION_COMPARISON_WINDOWS.map((w) => (
                    <th key={w.key} scope="col" className="py-2 pl-2 font-medium">
                      {w.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.items.map((r) => (
                  <tr key={r.itemId} className="border-t" style={{ borderColor: "var(--border)" }}>
                    <td className="py-2 pl-2">
                      <b>{r.name}</b>
                      <small className="muted block">{r.categoryName || INFLATION_NO_CATEGORY_LABEL}</small>
                    </td>
                    <td className="num py-2 pl-2" dir="rtl">
                      {r.latestPrice ? formatMoney(r.latestPrice, "IRT") : "—"}
                      <small className="muted block">هر {r.unit}</small>
                    </td>
                    {INFLATION_COMPARISON_WINDOWS.map((w) => (
                      <td key={w.key} className="py-2 pl-2">
                        <GrowthBadge value={r.growth[w.key]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      <datalist id="inflation-unit-suggestions">
        {INFLATION_UNIT_SUGGESTIONS.map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>

      <p className="expense-sub">این ماژول صرفاً تحلیلی است: دارایی محسوب نمی‌شود و وارد سبد دارایی، ثروت خالص و سوابق مالی نمی‌شود.</p>

      <NewPriceSheet
        open={sheet.open}
        onClose={closeSheet}
        items={items}
        categories={categories}
        today={today}
        initialItemId={sheet.itemId}
      />
    </div>
  );
}
