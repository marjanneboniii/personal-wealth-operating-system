"use client";

/**
 * «بدهی‌ها و اقساط» — obligations the user already carries.
 *
 * AS THEY STAND TODAY. Someone arriving with a loan half paid off knows what
 * is left and how many instalments remain — not the original schedule. The
 * old labels («اصل بدهی», «تعداد اقساط», «اولین سررسید») invited the ORIGINAL
 * contract, which registered every already-paid instalment as still owed and
 * overstated the debt. Every debt is in Toman.
 *
 * PLANNING ONLY. A debt recorded here posts no journal entry.
 */
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
import StepIntro from "@/components/setup/StepIntro";
import { D } from "@/domain/decimal";
import { faCount, formatMoney, todayIso } from "@/lib/format";
import type { SetupDebtDraft } from "@/app/actions/setupDebts";

export type DebtDraftRow = SetupDebtDraft & { key: string };

export function emptyDebtRow(): DebtDraftRow {
  return {
    key: Math.random().toString(36).slice(2),
    title: "",
    creditor: "",
    principalIrt: "",
    interestRate: "0",
    startDate: todayIso(),
    installmentCount: 0,
    installmentIrt: "",
    firstDueDate: "",
  };
}

/** The per-instalment figure the user will actually be shown. */
function previewInstallment(row: DebtDraftRow): string | null {
  const count = Number(row.installmentCount ?? 0);
  if (count <= 0) return null;
  if (row.installmentIrt && D(row.installmentIrt).gt(0)) return D(row.installmentIrt).toString();
  if (!row.principalIrt || !D(row.principalIrt).gt(0)) return null;
  return D(row.principalIrt).div(String(count)).toFixed(0);
}

export default function SetupDebtsStep({
  rows,
  onChange,
  failedIndex,
}: {
  rows: DebtDraftRow[];
  onChange: (next: DebtDraftRow[]) => void;
  /** Row the server rejected, opened and marked. */
  failedIndex?: number | null;
}) {
  const [openKey, setOpenKey] = useState<string | null>(rows[0]?.key ?? null);
  const effectiveOpen = failedIndex != null && rows[failedIndex] ? rows[failedIndex].key : openKey;

  const patch = (key: string, updates: Partial<DebtDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...updates } : r)));

  const add = () => {
    const row = emptyDebtRow();
    onChange([...rows, row]);
    setOpenKey(row.key);
  };

  const total = useMemo(
    () => rows.reduce((sum, r) => (r.principalIrt && D(r.principalIrt).gt(0) ? sum.add(D(r.principalIrt)) : sum), D("0")),
    [rows],
  );

  return (
    <section className="space-y-5">
      <StepIntro title="بدهی‌ها و اقساط" text="وام، بدهی یا خرید قسطی را همان‌طور که امروز هست وارد کنید — مانده و اقساط باقی‌مانده." />

      {rows.length > 0 && (
        <ul className="space-y-2">
          {rows.map((row, index) => {
            const open = effectiveOpen === row.key;
            const count = Number(row.installmentCount ?? 0);
            const perInstallment = previewInstallment(row);
            const failed = failedIndex === index;
            return (
              <li key={row.key} className="card setup-row" style={failed ? { borderColor: "var(--negative)" } : undefined}>
                <div className="flex items-center gap-2.5">
                  <span className="flow-icon" aria-hidden="true">
                    <Icon name="debts" size={15} />
                  </span>
                  <button type="button" className="min-w-0 flex-1 text-right" onClick={() => setOpenKey(open ? null : row.key)} aria-expanded={open}>
                    <span className="block truncate text-[length:var(--fs-sm)] font-semibold">{row.title.trim() || `بدهی ${faCount(index + 1)}`}</span>
                    <span className="muted block truncate text-[length:var(--fs-xs)]" dir="rtl">
                      {row.principalIrt && D(row.principalIrt).gt(0) ? formatMoney(row.principalIrt, "IRT") : "مانده وارد نشده"}
                      {count > 0 ? ` · ${faCount(count)} قسط` : ""}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="icon-btn !min-h-9 !min-w-9"
                    onClick={() => onChange(rows.filter((r) => r.key !== row.key))}
                    aria-label={`حذف ${row.title.trim() || "بدهی"}`}
                  >
                    <Icon name="x" size={15} />
                  </button>
                </div>

                {open && (
                  <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="label">عنوان</label>
                        <input type="text" value={row.title} onChange={(e) => patch(row.key, { title: e.target.value })} placeholder="وام مسکن" className="field" />
                      </div>
                      <div>
                        <label className="label">بستانکار</label>
                        <input type="text" value={row.creditor} onChange={(e) => patch(row.key, { creditor: e.target.value })} placeholder="بانک مسکن" className="field" />
                      </div>
                      <div>
                        <label className="label">مانده فعلی (تومان)</label>
                        <AmountInput
                          type="text"
                          inputMode="numeric"
                          value={row.principalIrt}
                          onChange={(e) => patch(row.key, { principalIrt: e.target.value.replace(/[^\d]/g, "") })}
                          placeholder="۰"
                          className="field num"
                          dir="ltr"
                          unit="toman"
                        />
                      </div>
                      <div>
                        <label className="label">نرخ سود سالانه (٪)</label>
                        <AmountInput
                          inputMode="decimal"
                          value={row.interestRate ?? "0"}
                          onChange={(e) => patch(row.key, { interestRate: e.target.value.replace(/[^\d.]/g, "") })}
                          placeholder="۰"
                          className="field num"
                          showWords={false}
                          unit="none"
                        />
                      </div>
                      <div>
                        <label className="label">اقساط باقی‌مانده</label>
                        <AmountInput
                          inputMode="numeric"
                          value={String(row.installmentCount ?? 0)}
                          onChange={(e) => patch(row.key, { installmentCount: Number(e.target.value.replace(/[^\d]/g, "") || 0) })}
                          placeholder="۰ = بدون قسط"
                          className="field num"
                          showWords={false}
                          unit="none"
                          grouping={false}
                        />
                      </div>
                      {count > 0 && (
                        <div>
                          <label className="label">مبلغ هر قسط (تومان)</label>
                          <AmountInput
                            type="text"
                            inputMode="numeric"
                            value={row.installmentIrt ?? ""}
                            onChange={(e) => patch(row.key, { installmentIrt: e.target.value.replace(/[^\d]/g, "") })}
                            placeholder="خالی = تقسیم مساوی"
                            className="field num"
                            dir="ltr"
                            unit="toman"
                          />
                        </div>
                      )}
                      <div>
                        <label className="label">تاریخ شروع</label>
                        <JalaliDatePicker value={row.startDate} onChange={(iso) => patch(row.key, { startDate: iso })} />
                      </div>
                      {count > 0 && (
                        <div>
                          <label className="label">سررسید قسط بعدی</label>
                          <JalaliDatePicker value={row.firstDueDate ?? ""} onChange={(iso) => patch(row.key, { firstDueDate: iso })} />
                        </div>
                      )}
                    </div>
                    {perInstallment && (
                      <p className="muted num text-[length:var(--fs-xs)]" dir="rtl">
                        {faCount(count)} قسط × {formatMoney(perInstallment, "IRT")}
                      </p>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-soft" onClick={add}>
          <Icon name="plus" size={15} />
          {rows.length === 0 ? "افزودن بدهی" : "افزودن بدهی دیگر"}
        </button>
        {total.gt(0) && (
          <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
            مجموع مانده {formatMoney(total.toFixed(0), "IRT")}
          </span>
        )}
      </div>
    </section>
  );
}
