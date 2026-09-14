"use client";

import { useActionState, useMemo, useState, useTransition } from "react";
import { deleteMarketPriceAction, recordMarketPriceAction } from "@/app/actions/marketPrices";
import JalaliDateInput from "@/components/ui/JalaliDateInput";
import AmountInput from "@/components/ui/AmountInput";
import { AREA_BANDS } from "@/features/rwa/realEstate/market/forward";
import { MARKET_REMINDER_DAYS } from "@/features/rwa/realEstate/market/reminders";
import type { MarketSegmentSummary } from "@/features/rwa/realEstate/market/service";
import type { City, Neighborhood, PropertyType } from "@/features/rwa/realEstate/types";
import { Hint, Labeled, Result } from "./shared";
import { compactToman, faInt, jalaliDate } from "./marketFormat";

/**
 * «قیمت بازار» — the user records the reference price per m² of the markets of
 * their own properties. One price per neighborhood + type + size band per day,
 * for today or at most 31 days back. Growth is built forward from the first
 * entry of each market.
 */
export default function MarketPriceTracker({
  cities,
  neighborhoods,
  propertyTypes,
  segments,
}: {
  cities: City[];
  neighborhoods: Neighborhood[];
  propertyTypes: PropertyType[];
  segments: MarketSegmentSummary[];
}) {
  const [state, action, pending] = useActionState(recordMarketPriceAction, null);
  const activeCities = cities.filter((c) => c.isActive);
  const [cityId, setCityId] = useState(activeCities[0]?.id ?? "");
  const cityHoods = useMemo(() => neighborhoods.filter((n) => n.cityId === cityId && n.isActive), [neighborhoods, cityId]);
  const [deleting, startDelete] = useTransition();
  const [deleteMessage, setDeleteMessage] = useState<string | null>(null);

  return (
    <div className="re-panel">
      <Hint>
        قیمت مرجع هر متر بازار ملک‌تان را ثبت کنید. رشد ۱ ماهه، ۳ ماهه، ۶ ماهه و سالانه از اولین ثبت هر بازار به بعد
        محاسبه می‌شود؛ ثبت ماهانه دقت را بالا نگه می‌دارد.
      </Hint>

      <form action={action} className="re-revalue">
        <p className="re-section-title">ثبت قیمت بازار</p>
        <div className="market-form-grid">
          <Labeled label="شهر" required>
            <select className="field" name="cityId" value={cityId} onChange={(e) => setCityId(e.target.value)} required>
              {activeCities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nameFa}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="محله" required>
            <select className="field" name="neighborhoodId" defaultValue="" key={cityId} required>
              <option value="" disabled>
                انتخاب محله
              </option>
              {cityHoods.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.nameFa}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled label="نوع ملک" required>
            <select className="field" name="propertyTypeId" defaultValue="" required>
              <option value="" disabled>
                انتخاب نوع
              </option>
              {propertyTypes
                .filter((t) => t.isActive)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.nameFa}
                  </option>
                ))}
            </select>
          </Labeled>
          <Labeled label="متراژ">
            <select className="field" name="areaBand" defaultValue="all">
              {AREA_BANDS.map((b) => (
                <option key={b.key} value={b.key}>
                  {b.label}
                </option>
              ))}
            </select>
          </Labeled>
          <JalaliDateInput name="observedOn" label="تاریخ" required />
          <Labeled label="قیمت مرجع هر متر (تومان)" required>
            <AmountInput className="field num" name="pricePerSqmToman" inputMode="numeric" dir="ltr" unit="toman" required />
          </Labeled>
          <Labeled label="کمترین قیمت هر متر" hint="اختیاری">
            <AmountInput className="field num" name="lowPpsqmToman" inputMode="numeric" dir="ltr" unit="toman" />
          </Labeled>
          <Labeled label="بیشترین قیمت هر متر" hint="اختیاری">
            <AmountInput className="field num" name="highPpsqmToman" inputMode="numeric" dir="ltr" unit="toman" />
          </Labeled>
          <Labeled label="تعداد نمونه" hint="اختیاری">
            <AmountInput className="field num" name="sampleCount" inputMode="numeric" showWords={false} unit="none" grouping={false} />
          </Labeled>
        </div>
        <Labeled label="یادداشت" hint="اختیاری">
          <input className="field" name="note" maxLength={200} />
        </Labeled>
        <div className="re-actions">
          <button className="btn btn-primary" disabled={pending}>
            {pending ? "در حال ثبت…" : "ثبت قیمت"}
          </button>
        </div>
        <Result state={state} />
      </form>

      {segments.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="table re-periods">
            <caption className="market-caption">بازارهای شما</caption>
            <thead>
              <tr>
                <th scope="col">بازار</th>
                <th scope="col" className="td-num">آخرین قیمت هر متر</th>
                <th scope="col" className="td-num">آخرین ثبت</th>
                <th scope="col" className="td-num">شروع</th>
                <th scope="col" className="td-num">ثبت‌ها</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {segments.map((s) => (
                <tr key={s.key}>
                  <td>
                    {s.neighborhoodLabel} · {s.propertyTypeLabel} · {s.areaBandLabel}
                    <span className="muted"> ({s.cityLabel})</span>
                  </td>
                  <td className="td-num">{compactToman(s.latestPpsqmToman)}</td>
                  <td className="td-num">
                    {jalaliDate(s.latestDate)}
                    {s.daysSinceLatest >= MARKET_REMINDER_DAYS && <span className="market-chip is-low"> زمان ثبت ماهانه</span>}
                  </td>
                  <td className="td-num">{jalaliDate(s.firstDate)}</td>
                  <td className="td-num">{faInt(s.entries)}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost re-danger"
                      disabled={deleting}
                      onClick={() => {
                        if (!window.confirm("آخرین ثبت این بازار حذف شود؟")) return;
                        startDelete(async () => setDeleteMessage((await deleteMarketPriceAction(s.latestId)).message));
                      }}
                    >
                      حذف آخرین ثبت
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted re-note">هنوز قیمت بازاری ثبت نکرده‌اید.</p>
      )}
      {deleteMessage && <p className="muted re-note">{deleteMessage}</p>}
    </div>
  );
}
