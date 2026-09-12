"use client";

/**
 * Registering صندوق‌ها و سهام during initial setup.
 *
 * WHY THIS STEP EXISTS
 * The wizard collected a bank balance, optional cash, ONE crypto and gold —
 * and nothing else. A user whose savings are three gold funds and a few
 * bourse symbols finished setup with a net worth that was simply wrong, and
 * had no hint that the app could hold those at all. The debts step was added
 * for the mirror-image reason; this is the asset half of the same gap.
 *
 * A LIST, not a form, and for the same reason the debts step is one: a person
 * arriving here typically owns several — «عیار» and «کهربا» and a little
 * «فولاد» — so «افزودن مورد دیگر» is the default shape, not an afterthought.
 *
 * Everything is optional. A user who owns none presses nothing and moves on.
 *
 * A row with NO quantity is still worth keeping: the user is telling us they
 * own the instrument but not how much, and registering it (identity + the
 * asset account a purchase needs) means they can enter the numbers later from
 * the transactions module. Only a row WITH a quantity contributes an opening
 * position, and that position goes through the same single opening entry and
 * the same FIFO lot machinery as every other balance — never a shortcut.
 */
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import { FUND_KIND_MARKS } from "@/components/ui/AssetTypeMarks";
import { D } from "@/domain/decimal";
import { faCount, formatMoney } from "@/lib/format";
import {
  searchFunds,
  searchStocks,
  type FundKind,
} from "@/features/funds/search";

export type InstrumentDraftRow = {
  key: string;
  kind: "fund" | "stock";
  symbol: string;
  name: string;
  /** Sub-kind of a fund, for the mark only. Stocks carry none. */
  fundKind?: FundKind;
  quantity: string;
  unitPrice: string;
};

export function emptyInstrumentRow(): InstrumentDraftRow {
  return {
    key: Math.random().toString(36).slice(2),
    kind: "fund",
    symbol: "",
    name: "",
    quantity: "",
    unitPrice: "",
  };
}

function Mark({ row, size }: { row: InstrumentDraftRow; size: number }) {
  const FundMark = row.fundKind ? FUND_KIND_MARKS[row.fundKind] : null;
  return (
    <span
      className="inline-flex shrink-0 overflow-hidden"
      style={{ width: size, height: size, borderRadius: Math.round(size * 0.28) }}
      aria-hidden="true"
    >
      {FundMark ? (
        <FundMark size={size} />
      ) : (
        <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="48" height="48" rx="12" fill="#FFFFFF" />
          <path
            d="M12.5 31.5l7.5-7.8 5.6 4.9 10.4-11.4"
            stroke="#4B4DC4"
            strokeWidth="4.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="20" cy="23.7" r="2.6" fill="#4B4DC4" />
          <circle cx="25.6" cy="28.6" r="2.6" fill="#4B4DC4" />
        </svg>
      )}
    </span>
  );
}

export default function SetupInstrumentsStep({
  rows,
  onChange,
  baseUnit,
}: {
  rows: InstrumentDraftRow[];
  onChange: (next: InstrumentDraftRow[]) => void;
  /** Unit label for the price field — the wizard's base currency. */
  baseUnit?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(rows[0]?.key ?? null);
  const [query, setQuery] = useState("");
  const [family, setFamily] = useState<"fund" | "stock">("fund");

  const patch = (key: string, next: Partial<InstrumentDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));

  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));

  /** Catalogue matches, excluding anything already on the list. */
  const results = useMemo(() => {
    const taken = new Set(rows.map((r) => r.symbol));
    if (family === "stock") {
      return searchStocks(query, { limit: 8 })
        .filter((s) => !taken.has(s.symbol))
        .map((s) => ({ symbol: s.symbol, name: s.name, label: s.sectorLabel, fundKind: undefined }));
    }
    return searchFunds(query, { limit: 8 })
      .filter((f) => !taken.has(f.symbol))
      .map((f) => ({ symbol: f.symbol, name: f.name, label: f.kindLabel, fundKind: f.kind }));
  }, [query, family, rows]);

  const add = (pick: { symbol: string; name: string; fundKind?: FundKind }) => {
    const row: InstrumentDraftRow = {
      ...emptyInstrumentRow(),
      kind: family,
      symbol: pick.symbol,
      name: pick.name,
      fundKind: pick.fundKind,
    };
    onChange([...rows, row]);
    setOpenKey(row.key);
    setQuery("");
  };

  const total = rows.reduce((sum, r) => {
    const qty = D(r.quantity || "0");
    const price = D(r.unitPrice || "0");
    return qty.gt(0) && price.gt(0) ? sum.add(qty.mul(price)) : sum;
  }, D("0"));

  return (
    <div className="space-y-4">
      <div className="border-b pb-3" style={{ borderColor: "var(--border)" }}>
        <h2 className="text-base font-semibold">صندوق و سهام</h2>
        <p className="muted text-xs">
          اگر صندوق سرمایه‌گذاری یا سهام بورسی دارید، اینجا انتخاب کنید. اگر ندارید، همین‌طور رد شوید.
        </p>
      </div>

      {/* ── Picker ── */}
      <div className="space-y-2">
        <div className="seg" role="group" aria-label="نوع دارایی">
          <button
            type="button"
            onClick={() => setFamily("fund")}
            className={family === "fund" ? "seg-on" : ""}
            aria-pressed={family === "fund"}
          >
            صندوق
          </button>
          <button
            type="button"
            onClick={() => setFamily("stock")}
            className={family === "stock" ? "seg-on" : ""}
            aria-pressed={family === "stock"}
          >
            سهام بورسی
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            family === "stock"
              ? "جست‌وجوی سهم: فولاد، شستا، وبملت…"
              : "جست‌وجوی صندوق: عیار، کهربا، اعتماد…"
          }
          className="field"
          aria-label={family === "stock" ? "جست‌وجوی سهام" : "جست‌وجوی صندوق"}
        />

        <ul className="space-y-1.5">
          {results.map((r) => (
            <li key={r.symbol}>
              <button
                type="button"
                onClick={() => add(r)}
                className="card flex w-full items-center gap-2.5 p-2.5 text-right hover:bg-[color:var(--hover)]"
              >
                <Mark row={{ ...emptyInstrumentRow(), kind: family, fundKind: r.fundKind }} size={26} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[length:var(--fs-xs)] font-semibold">{r.name}</span>
                  <span className="muted block text-[length:var(--fs-xs)]">{r.label}</span>
                </span>
                <span className="chip shrink-0 text-[length:var(--fs-xs)]">{r.symbol}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && query.trim().length > 0 && (
            <li className="muted card p-3 text-center text-[length:var(--fs-xs)]">
              موردی پیدا نشد. بعد از راه‌اندازی می‌توانید از «ثبت صندوق و سهام» نماد دلخواه را اضافه کنید.
            </li>
          )}
        </ul>
      </div>

      {/* ── Chosen rows ── */}
      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row) => {
            const open = openKey === row.key;
            const qty = D(row.quantity || "0");
            const price = D(row.unitPrice || "0");
            const value = qty.gt(0) && price.gt(0) ? qty.mul(price) : null;
            return (
              <li key={row.key} className="card p-3">
                <div className="flex items-center gap-2.5">
                  <Mark row={row} size={28} />
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-right"
                    onClick={() => setOpenKey(open ? null : row.key)}
                  >
                    <span className="block truncate text-[length:var(--fs-xs)] font-semibold">{row.name}</span>
                    <span className="muted block text-[length:var(--fs-xs)]">
                      {qty.gt(0) ? (
                        <>
                          مقدار <span className="num">{row.quantity}</span>
                          {value ? (
                            <>
                              {" · "}
                              <span className="num">{formatMoney(value.toString())}</span>
                            </>
                          ) : null}
                        </>
                      ) : (
                        "فقط ثبت می‌شود — مقدار بعداً"
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(row.key)}
                    className="btn btn-ghost !min-h-9 !px-2.5 text-[length:var(--fs-xs)]"
                    aria-label={`حذف ${row.name}`}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </div>

                {open && (
                  <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
                    <div>
                      <label className="label">مقدار (تعداد واحد)</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.quantity}
                        onChange={(e) => patch(row.key, { quantity: e.target.value.replace(/[^\d.]/g, "") })}
                        placeholder="0"
                        className="field num"
                        dir="ltr"
                      />
                    </div>
                    <div>
                      <label className="label">قیمت خرید هر واحد — فقط بهای تمام‌شده</label>
                      <AmountInput
                        type="text"
                        inputMode="decimal"
                        value={row.unitPrice}
                        onChange={(e) => patch(row.key, { unitPrice: e.target.value.replace(/[^\d.]/g, "") })}
                        placeholder="0"
                        className="field num"
                        dir="ltr"
                        unit={baseUnit}
                      />
                    </div>
                    <p className="muted text-[length:var(--fs-xs)] leading-5 sm:col-span-2">
                      اگر مقدار را خالی بگذارید، فقط نماد ثبت می‌شود و بعداً می‌توانید خرید را از بخش
                      تراکنش‌ها وارد کنید.
                    </p>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {rows.length > 0 && (
        <p className="muted text-[length:var(--fs-xs)]">
          {faCount(rows.length)} مورد انتخاب شده
          {total.gt(0) ? (
            <>
              {" · ارزش افتتاحیه "}
              <span className="num">{formatMoney(total.toString())}</span>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
