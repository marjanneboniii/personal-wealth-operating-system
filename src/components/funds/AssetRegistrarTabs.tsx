"use client";

import { useState } from "react";
import InstrumentRegistrar from "@/components/funds/InstrumentRegistrar";
import WallexAssetPicker from "@/components/assets/WallexAssetPicker";

type Source = "instrument" | "market";

/**
 * The two registration SOURCES, kept visibly apart.
 *
 * They are not two styles of the same list — they differ in where the identity
 * comes from and, more importantly, in how the thing gets priced:
 *
 *   صندوق و سهام بورسی — a hand-maintained Tehran-exchange catalogue, and the
 *     price is entered by hand, because no reachable feed publishes NAV or a
 *     TSE last trade from where this runs. Saying so on the screen is the
 *     honest alternative to a «live» badge that would be a lie.
 *
 *   رمزارز و فلز توکنیزه — the والکس feed: Persian names published by the
 *     source itself, and BOTH quotes, تومانی and تتری, read from the two
 *     markets that actually quote them.
 *
 * A single merged list would have had to pick one of those two price shapes
 * and misrepresent the other half of its rows.
 */
export default function AssetRegistrarTabs() {
  const [source, setSource] = useState<Source>("instrument");

  return (
    <div className="space-y-4">
      <div className="seg flex-wrap" role="group" aria-label="نوع دارایی برای ثبت">
        <button
          type="button"
          aria-pressed={source === "instrument"}
          className={source === "instrument" ? "seg-on" : ""}
          onClick={() => setSource("instrument")}
        >
          صندوق و سهام بورسی
        </button>
        <button
          type="button"
          aria-pressed={source === "market"}
          className={source === "market" ? "seg-on" : ""}
          onClick={() => setSource("market")}
        >
          رمزارز و فلز توکنیزه
        </button>
      </div>

      {source === "instrument" ? (
        <InstrumentRegistrar />
      ) : (
        <div className="card space-y-3 p-4 sm:p-5">
          <div>
            <h2 className="text-[length:var(--fs-sm)] font-bold">رمزارز و فلز توکنیزه</h2>
            <p className="muted mt-1 text-[length:var(--fs-xs)] leading-6">
              فهرست و قیمت‌ها از والکس می‌آید: نام فارسی از خودِ منبع، و دو قیمت مستقل —
              <strong> قیمت تومانی</strong> از بازار تومانی و <strong>قیمت تتری</strong> از بازار
              تتری. هیچ‌کدام از روی دیگری محاسبه نمی‌شود.
            </p>
          </div>
          <WallexAssetPicker />
        </div>
      )}
    </div>
  );
}
