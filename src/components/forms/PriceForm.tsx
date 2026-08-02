"use client";

import { useActionState } from "react";
import { updatePriceAction, type ActionResult } from "@/app/actions";

export default function PriceForm({
  assets,
}: {
  assets: { id: string; symbol: string; name: string; price: string | null }[];
}) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(updatePriceAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="min-w-48 flex-1">
        <label className="label">دارایی</label>
        <select name="assetId" className="field" defaultValue={assets[0]?.id}>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.symbol} — {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-40 flex-1">
        <label className="label">قیمت جدید (USD)</label>
        <input name="price" required inputMode="decimal" className="field num" dir="ltr" placeholder="0.00" />
      </div>
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "به‌روزرسانی قیمت"}
      </button>
      {state && (
        <p className="w-full text-[11px]" style={{ color: state.ok ? "var(--accent)" : "var(--danger)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
