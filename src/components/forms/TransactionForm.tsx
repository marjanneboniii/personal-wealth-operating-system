"use client";

import { useActionState, useMemo, useState } from "react";
import { createTransactionAction, type ActionResult } from "@/app/actions";
import { formatMoney } from "@/lib/format";

export type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  symbol: string | null;
  decimals: number;
};

const TYPES = [
  { key: "expense", label: "هزینه", primary: "پرداخت از حساب", counter: "دسته هزینه" },
  { key: "income", label: "درآمد", primary: "واریز به حساب", counter: "دسته درآمد" },
  { key: "transfer", label: "انتقال", primary: "از حساب", counter: "به حساب" },
  { key: "buy", label: "خرید دارایی", primary: "حساب دارایی خریداری‌شده", counter: "پرداخت از حساب" },
  { key: "sell", label: "فروش دارایی", primary: "حساب دارایی فروخته‌شده", counter: "واریز به حساب" },
] as const;

type TxType = (typeof TYPES)[number]["key"];

export default function TransactionForm({
  accounts,
  defaultType = "expense",
  today,
}: {
  accounts: AccountOption[];
  defaultType?: TxType;
  today: string;
}) {
  const [type, setType] = useState<TxType>(defaultType);
  const [amount, setAmount] = useState("");
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    createTransactionAction,
    null,
  );

  const meta = TYPES.find((t) => t.key === type)!;
  const cash = accounts.filter((a) => a.type === "asset");
  const primaryOptions = useMemo(() => {
    if (type === "buy" || type === "sell") return cash.filter((a) => !["IRT", "USD"].includes(a.symbol ?? ""));
    return cash;
  }, [type, cash]);
  const counterOptions = useMemo(() => {
    if (type === "expense") return accounts.filter((a) => a.type === "expense");
    if (type === "income") return accounts.filter((a) => a.type === "income");
    return cash;
  }, [type, accounts, cash]);

  const needsQty = type === "buy" || type === "sell" || type === "transfer";

  return (
    <form action={formAction} className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setType(t.key)}
            className="chip !px-4 !py-2"
            style={type === t.key ? { background: "var(--accent-soft)", color: "var(--accent)", fontWeight: 600 } : undefined}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input type="hidden" name="type" value={type} />

      <div className="card space-y-3 p-4">
        <div>
          <label className="label">مبلغ (به ارز پایه USD)</label>
          <input
            name="amount"
            inputMode="decimal"
            required
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))}
            placeholder="0.00"
            className="field num !text-2xl !font-bold"
            dir="ltr"
          />
          {amount && <p className="muted mt-1 text-[11px]">{formatMoney(amount)}</p>}
        </div>

        {needsQty && (
          <div>
            <label className="label">
              مقدار دارایی {type === "transfer" ? "(اختیاری — اگر خالی باشد از مبلغ محاسبه می‌شود)" : ""}
            </label>
            <input name="quantity" inputMode="decimal" className="field num" dir="ltr" placeholder="0.00000000" />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{meta.primary}</label>
            <select name="primaryAccountId" required className="field" defaultValue="">
              <option value="" disabled>
                انتخاب کنید…
              </option>
              {primaryOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name} {a.symbol ? `(${a.symbol})` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">{meta.counter}</label>
            <select name="counterAccountId" required className="field" defaultValue="">
              <option value="" disabled>
                انتخاب کنید…
              </option>
              {counterOptions.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} — {a.name} {a.symbol ? `(${a.symbol})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">تاریخ سند</label>
            <input name="entryDate" type="date" required defaultValue={today} className="field num" dir="ltr" />
          </div>
          <div>
            <label className="label">کارمزد (اختیاری)</label>
            <input name="fee" inputMode="decimal" className="field num" dir="ltr" placeholder="0" />
          </div>
        </div>

        <div>
          <label className="label">شرح</label>
          <input name="description" required className="field" placeholder="مثلاً خرید ماهانه خوراک" />
        </div>
      </div>

      <div className="card soft p-3 text-[11px] leading-6">
        <strong>پیش‌نمایش قاعده حسابداری:</strong>{" "}
        {type === "buy" && "دارایی بدهکار می‌شود، حساب نقدی بستانکار؛ یک بسته FIFO باز می‌شود."}
        {type === "sell" && "دارایی به بهای تمام‌شده FIFO خارج می‌شود و اختلاف در «سود سرمایه‌ای تحقق‌یافته» ثبت می‌گردد."}
        {type === "transfer" && "ثروت تغییر نمی‌کند؛ فقط محل نگهداری جابه‌جا می‌شود (کارمزد هزینه است)."}
        {type === "income" && "حساب نقدی بدهکار و حساب درآمد بستانکار می‌شود."}
        {type === "expense" && "حساب هزینه بدهکار و حساب نقدی بستانکار می‌شود."}
        {" "}مجموع ارزش پایه سند همیشه باید صفر باشد.
      </div>

      {state && (
        <p
          className="rounded-2xl px-4 py-3 text-xs"
          style={{
            background: state.ok ? "var(--accent-soft)" : "rgba(225,29,72,0.12)",
            color: state.ok ? "var(--accent)" : "var(--danger)",
          }}
        >
          {state.message}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? "در حال ثبت…" : "ثبت در دفترکل"}
      </button>
    </form>
  );
}
