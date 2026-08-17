"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMoneyAccountAction } from "@/app/actions";
import { D } from "@/domain/decimal";
import { formatMoney } from "@/lib/format";

export type MoneyAssetOption = {
  id: string;
  symbol: string;
  name: string;
  decimals: number;
  className: string | null;
  latestPriceUsd: string | null;
};

const KINDS = [
  ["bank", "حساب بانکی"],
  ["cash", "نقد / صندوق"],
  ["exchange", "صرافی"],
  ["hot", "کیف پول گرم"],
  ["cold", "کیف پول سرد"],
  ["fund", "صندوق / کارگزاری"],
] as const;

export default function MoneyAccountForm({ assets }: { assets: MoneyAssetOption[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [assetId, setAssetId] = useState("");
  const [openingQty, setOpeningQty] = useState("");
  const [openingUnitPriceUsd, setOpeningUnitPriceUsd] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const kindLabel = KINDS.find(([v]) => v === kind)?.[1];
  const asset = assets.find((a) => a.id === assetId) ?? null;
  const effectivePrice = openingUnitPriceUsd ? D(openingUnitPriceUsd) : asset?.latestPriceUsd ? D(asset.latestPriceUsd) : null;
  const qty = openingQty ? D(openingQty) : D("0");
  const previewBaseUsd = effectivePrice && qty.gt(0) ? qty.mul(effectivePrice) : D("0");

  function confirm() {
    startTransition(async () => {
      const result = await createMoneyAccountAction({
        name,
        kind,
        assetId,
        openingQty,
        openingUnitPriceUsd,
        openingDate,
        note,
      });
      setMessage(result.message);
      if (result.ok) {
        setName("");
        setOpeningQty("");
        setOpeningUnitPriceUsd("");
        setOpeningDate("");
        setNote("");
        setAssetId("");
        setPreview(false);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-3 text-xs">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">نام کامل حساب / صندوق / کیف‌پول</span>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="مثلاً بانک ملت — حساب جاری"
          />
        </label>
        <label className="space-y-1">
          <span className="label">نوع حساب</span>
          <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">ارز / دارایی حساب</span>
          <select className="field" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="" disabled>
              انتخاب کنید…
            </option>
            {assets.map((a) => (
              <option key={a.id} value={a.id}>
                {a.symbol} — {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="label">موجودی اولیه (به واحد همان دارایی)</span>
          <input
            className="field num"
            dir="ltr"
            inputMode="decimal"
            value={openingQty}
            onChange={(e) => setOpeningQty(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={asset ? `مثلاً ${asset.symbol === "IRT" ? "50,000,000 تومان" : "0.00000000"}` : "موجودی"}
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="label">قیمت واحد (دلار) — اختیاری</span>
          <input
            className="field num"
            dir="ltr"
            inputMode="decimal"
            value={openingUnitPriceUsd}
            onChange={(e) => setOpeningUnitPriceUsd(e.target.value.replace(/[^0-9.]/g, ""))}
            placeholder={asset?.latestPriceUsd ? `آخرین قیمت: ${asset.latestPriceUsd}` : "آخرین قیمت به‌صورت خودکار"}
          />
        </label>
        <label className="space-y-1">
          <span className="label">تاریخ افتتاحیه (اختیاری)</span>
          <input
            className="field num"
            dir="ltr"
            type="date"
            value={openingDate}
            onChange={(e) => setOpeningDate(e.target.value)}
          />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="label">یادداشت (اختیاری)</span>
        <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
      </label>

      {!preview ? (
        <button className="btn btn-ghost" type="button" disabled={!name.trim() || !assetId} onClick={() => setPreview(true)}>
          پیش‌نمایش
        </button>
      ) : (
        <div className="soft rounded-xl p-3">
          <div className="muted mb-2">پیش‌نمایش — هنوز حسابی ایجاد نشده است</div>
          <div className="flex flex-wrap items-center gap-2">
            <strong>{name}</strong>
            <span className="chip">{kindLabel}</span>
            {asset && <span className="chip">{asset.symbol}</span>}
          </div>
          {qty.gt(0) && (
            <div className="mt-2">
              <p className="muted text-[10px]">ارزش پایه (دلار) — تقریبی:</p>
              <p className="num font-bold" dir="ltr">
                {formatMoney(previewBaseUsd.toString())}
              </p>
            </div>
          )}
          {note && <div className="muted mt-1">{note}</div>}
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary" type="button" disabled={pending} onClick={confirm}>
              {pending ? "در حال ثبت…" : "تأیید نهایی و ایجاد حساب"}
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setPreview(false)}>
              ویرایش
            </button>
          </div>
        </div>
      )}

      {message && <p className="muted">{message}</p>}
    </div>
  );
}
