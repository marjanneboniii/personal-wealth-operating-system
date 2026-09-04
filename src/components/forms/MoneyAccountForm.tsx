"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createMoneyAccountAction } from "@/app/actions";
import { D } from "@/domain/decimal";
import { formatMoney } from "@/lib/format";
import AmountInput from "@/components/ui/AmountInput";
import { BankLogo } from "@/components/ui/IranLogo";

export type MoneyCurrencyOption = {
  id: string;
  symbol: "IRT" | "USD" | "USDT";
  name: string;
  decimals: number;
};

const KINDS = [
  ["bank", "حساب بانکی"],
  ["cash", "نقد / صندوق"],
  ["exchange", "صرافی"],
  ["hot", "کیف پول"],
  ["cold", "کیف پول سرد"],
  ["fund", "صندوق / کارگزاری"],
] as const;

export default function MoneyAccountForm({
  currencies,
  usdIrtRate,
}: {
  currencies: MoneyCurrencyOption[];
  usdIrtRate: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("bank");
  const [assetId, setAssetId] = useState("");
  const [openingQty, setOpeningQty] = useState("");
  const [openingDate, setOpeningDate] = useState("");
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  const kindLabel = KINDS.find(([v]) => v === kind)?.[1];
  const currency = currencies.find((item) => item.id === assetId) ?? null;
  const openingUnit =
    currency?.symbol === "IRT" ? "toman" : currency?.symbol === "USD" ? "usd" : currency?.symbol === "USDT" ? "usdt" : "none";
  const qty = openingQty ? D(openingQty) : D("0");
  const rate = D(usdIrtRate || "0");
  const previewBaseUsd =
    currency?.symbol === "IRT"
      ? rate.gt(0) && qty.gt(0) ? qty.div(rate) : D("0")
      : qty;

  function confirm() {
    startTransition(async () => {
      const result = await createMoneyAccountAction({
        name,
        kind,
        assetId,
        openingQty,
        openingDate,
        note,
      });
      setMessage(result.message);
      if (result.ok) {
        setName("");
        setOpeningQty("");
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
          <span className="label">واحد حساب (Denomination)</span>
          <select className="field" value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="" disabled>
              انتخاب کنید…
            </option>
            {currencies.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <span className="muted block text-[10px] leading-5">
            واحدی که موجودی این حساب در آن نگهداری می‌شود. جمع‌بندی داخلی برای همه حساب‌ها دلار است و قابل تغییر نیست.
          </span>
          <span className="chip mt-1 inline-block">واحد جمع‌بندی: دلار (فقط خواندنی)</span>
        </label>
        <label className="space-y-1">
          <span className="label">موجودی اولیه به واحد ارز انتخاب‌شده</span>
          <AmountInput
            className="field num"
            dir="ltr"
            inputMode="decimal"
            value={openingQty}
            onChange={(e) => setOpeningQty(e.target.value.replace(/[^0-9.]/g, ""))}
            unit={openingUnit}
            placeholder={
              currency?.symbol === "IRT"
                ? "مثلاً 50000000 تومان"
                : currency?.symbol === "USD"
                  ? "مثلاً 10000 دلار"
                  : currency?.symbol === "USDT"
                    ? "مثلاً 8000 تتر"
                    : "موجودی"
            }
          />
        </label>
      </div>

      <label className="block space-y-1 sm:max-w-[calc(50%-0.375rem)]">
        <span className="label">تاریخ افتتاحیه (اختیاری)</span>
        <input
          className="field num"
          dir="ltr"
          type="date"
          value={openingDate}
          onChange={(e) => setOpeningDate(e.target.value)}
        />
      </label>

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
            {kind === "bank" && <BankLogo name={name} size={32} />}
            <strong>{name}</strong>
            <span className="chip">{kindLabel}</span>
            {currency && <span className="chip">{currency.name}</span>}
          </div>
          {qty.gt(0) && (
            <div className="mt-2">
              <p className="muted text-[10px]">ارزش پایه دلاری افتتاحیه:</p>
              <p className="num font-bold" dir="rtl">
                {formatMoney(previewBaseUsd.toString())}
              </p>
              {currency?.symbol === "IRT" && rate.gt(0) && (
                <p className="muted mt-1 text-[10px]">
                  نرخ تبدیل جاری: هر دلار ≈ {formatMoney(usdIrtRate, "IRT")}
                </p>
              )}
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
