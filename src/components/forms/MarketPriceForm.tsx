"use client";

import { useActionState } from "react";
import { recordManualPriceAction, type ActionResult } from "@/app/actions";

export default function MarketPriceForm({
  assets,
  currencies,
  sources,
  today,
}: {
  assets: { id: string; symbol: string; name: string }[];
  currencies: { id: string; code: string; name: string }[];
  sources: { id: string; name: string; type: string }[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    recordManualPriceAction,
    null,
  );

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">دارایی</label>
          <select name="assetId" required className="field" defaultValue={assets[0]?.id}>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol} — {a.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">قیمت جدید بازار</label>
          <input
            name="price"
            required
            inputMode="decimal"
            placeholder="0.00"
            className="field num font-bold"
            dir="ltr"
          />
        </div>

        <div>
          <label className="label">ارز قیمت (Market Currency)</label>
          <select
            name="currencyId"
            className="field"
            defaultValue={currencies.find((c) => c.code === "USD")?.id ?? currencies[0]?.id}
          >
            {currencies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} ({c.name})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label">تاریخ اسنپ‌شات</label>
          <input
            name="asOfDate"
            type="date"
            required
            defaultValue={today}
            className="field num"
            dir="ltr"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <label className="label !mb-0">سورس قیمت:</label>
          <select name="sourceName" className="field !py-1 text-xs" defaultValue="MANUAL">
            {sources.map((s) => (
              <option key={s.id} value={s.name}>
                {s.name} ({s.type})
              </option>
            ))}
          </select>
        </div>

        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "در حال ثبت…" : "ثبت قیمت در لایه Market Data"}
        </button>
      </div>

      {state && (
        <p
          className="rounded-[var(--r-md)] px-4 py-3 text-xs"
          style={{
            background: state.ok ? "var(--brand-soft)" : "rgba(225,29,72,0.12)",
            color: state.ok ? "var(--brand)" : "var(--negative)",
          }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
