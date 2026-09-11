"use client";

/**
 * Registering existing debts during initial setup.
 *
 * WHY THIS STEP EXISTS
 * The wizard used to collect assets only, so every new account opened with a
 * net worth that was simply wrong — assets with no liabilities against them —
 * until the user happened to find the debts module by themselves. A person
 * arriving at this app typically has more than one obligation: a mortgage, a
 * car instalment plan, a loan from family. So this is a LIST, not a form: the
 * same «افزودن مورد دیگر» shape the checklist uses for property and vehicles.
 *
 * Everything is optional. A user with no debts presses nothing and moves on.
 *
 * PLANNING ONLY. A debt recorded here posts no journal entry and gets no
 * ledger account — it is an obligation being written down, not money moving.
 */
import { useMemo, useState } from "react";
import Icon from "@/components/ui/Icon";
import AmountInput from "@/components/ui/AmountInput";
import JalaliDatePicker from "@/components/ui/JalaliDatePicker";
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
  return D(row.principalIrt).div(String(count)).toString();
}

export default function SetupDebtsStep({
  rows,
  onChange,
}: {
  rows: DebtDraftRow[];
  onChange: (next: DebtDraftRow[]) => void;
}) {
  const [openKey, setOpenKey] = useState<string | null>(rows[0]?.key ?? null);

  const patch = (key: string, updates: Partial<DebtDraftRow>) =>
    onChange(rows.map((r) => (r.key === key ? { ...r, ...updates } : r)));

  const add = () => {
    const row = emptyDebtRow();
    onChange([...rows, row]);
    setOpenKey(row.key);
  };

  const remove = (key: string) => onChange(rows.filter((r) => r.key !== key));

  const totalPrincipal = useMemo(
    () =>
      rows
        .reduce((sum, r) => (r.principalIrt ? sum.add(D(r.principalIrt)) : sum), D("0"))
        .toString(),
    [rows],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[length:var(--fs-md)] font-bold">بدهی‌ها، وام‌ها و اقساط</h2>
        <p className="muted mt-1 text-[length:var(--fs-xs)] leading-6">
          اگر وام، بدهی یا خرید قسطی دارید اینجا ثبت کنید. هر تعداد که دارید می‌توانید اضافه کنید.
          بدون ثبت بدهی‌ها، ارزش خالص شما بیشتر از واقعیت نشان داده می‌شود.
        </p>
      </div>

      {rows.length === 0 && (
        <div className="card p-4 text-center">
          <p className="muted text-[length:var(--fs-xs)] leading-6">
            بدهی‌ای ثبت نشده است. اگر بدهی ندارید، همین مرحله را رد کنید.
          </p>
        </div>
      )}

      <ul className="space-y-2.5">
        {rows.map((row, index) => {
          const open = openKey === row.key;
          const count = Number(row.installmentCount ?? 0);
          const perInstallment = previewInstallment(row);
          return (
            <li key={row.key} className="card p-3.5">
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-right"
                  onClick={() => setOpenKey(open ? null : row.key)}
                  aria-expanded={open}
                >
                  <span className="block text-[length:var(--fs-sm)] font-semibold">
                    {row.title.trim() || `بدهی ${faCount(index + 1)}`}
                  </span>
                  <span className="muted block text-[length:var(--fs-xs)]" dir="rtl">
                    {row.principalIrt && D(row.principalIrt).gt(0)
                      ? formatMoney(row.principalIrt, "IRT")
                      : "مبلغ وارد نشده"}
                    {count > 0 ? ` · ${faCount(count)} قسط` : " · بدون قسط"}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn-ghost !min-h-9 !px-2.5 text-[length:var(--fs-xs)]"
                  onClick={() => remove(row.key)}
                  aria-label={`حذف ${row.title.trim() || "بدهی"}`}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>

              {open && (
                <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">عنوان بدهی</label>
                      <input
                        type="text"
                        value={row.title}
                        onChange={(e) => patch(row.key, { title: e.target.value })}
                        placeholder="وام مسکن"
                        className="field"
                      />
                    </div>
                    <div>
                      <label className="label">بستانکار</label>
                      <input
                        type="text"
                        value={row.creditor}
                        onChange={(e) => patch(row.key, { creditor: e.target.value })}
                        placeholder="بانک مسکن"
                        className="field"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">اصل بدهی (تومان)</label>
                      <AmountInput
                        type="text"
                        inputMode="decimal"
                        value={row.principalIrt}
                        onChange={(e) =>
                          patch(row.key, { principalIrt: e.target.value.replace(/[^\d.]/g, "") })
                        }
                        placeholder="۱٬۲۰۰٬۰۰۰٬۰۰۰"
                        className="field num"
                        dir="ltr"
                        unit="toman"
                      />
                    </div>
                    <div>
                      <label className="label">نرخ سود سالانه (٪) — اختیاری</label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.interestRate ?? "0"}
                        onChange={(e) =>
                          patch(row.key, { interestRate: e.target.value.replace(/[^\d.]/g, "") })
                        }
                        placeholder="۱۸"
                        className="field num"
                        dir="ltr"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="label">تاریخ شروع بدهی</label>
                    <JalaliDatePicker
                      value={row.startDate}
                      onChange={(iso) => patch(row.key, { startDate: iso })}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="label">تعداد اقساط — صفر یعنی بدون قسط</label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={String(row.installmentCount ?? 0)}
                        onChange={(e) =>
                          patch(row.key, {
                            installmentCount: Number(e.target.value.replace(/[^\d]/g, "") || 0),
                          })
                        }
                        placeholder="۲۴"
                        className="field num"
                        dir="ltr"
                      />
                    </div>
                    {count > 0 && (
                      <div>
                        <label className="label">مبلغ هر قسط (تومان) — اختیاری</label>
                        <AmountInput
                          type="text"
                          inputMode="decimal"
                          value={row.installmentIrt ?? ""}
                          onChange={(e) =>
                            patch(row.key, {
                              installmentIrt: e.target.value.replace(/[^\d.]/g, ""),
                            })
                          }
                          placeholder="محاسبه خودکار"
                          className="field num"
                          dir="ltr"
                          unit="toman"
                        />
                      </div>
                    )}
                  </div>

                  {count > 0 && (
                    <div>
                      <label className="label">تاریخ اولین سررسید</label>
                      <JalaliDatePicker
                        value={row.firstDueDate ?? ""}
                        onChange={(iso) => patch(row.key, { firstDueDate: iso })}
                      />
                    </div>
                  )}

                  {/* Preview before commit — the same shape every other
                      registration flow in this app uses. */}
                  {perInstallment && (
                    <p className="muted text-[length:var(--fs-xs)] leading-6" dir="rtl">
                      {faCount(count)} قسط ×{" "}
                      <strong className="num">{formatMoney(perInstallment, "IRT")}</strong>
                      {!row.installmentIrt && " (تقسیم مساوی اصل بدهی)"}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn btn-ghost !min-h-11" onClick={add}>
          <Icon name="plus" size={15} />
          {rows.length === 0 ? "افزودن بدهی" : "افزودن بدهی دیگر"}
        </button>
        {rows.length > 0 && D(totalPrincipal).gt(0) && (
          <span className="muted num text-[length:var(--fs-xs)]" dir="rtl">
            مجموع: <strong>{formatMoney(totalPrincipal, "IRT")}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
