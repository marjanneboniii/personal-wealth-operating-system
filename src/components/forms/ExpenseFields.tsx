"use client";

/**
 * ثبت هزینه — the everyday path, redesigned to take a few taps:
 *
 *   مبلغ     one large field, with quick amounts
 *   دسته     recent categories first, then a search and icon tiles per group
 *   جزئیات   the paying account (pre-selected), the date and an optional note
 *
 * Only Toman bank and cash accounts are offered to pay: stablecoin wallets,
 * funds and exchanges are investment or savings places, not where daily
 * spending comes from. The account is chosen for the user — the one that paid
 * the last expense, else the first bank account — and stays one tap to change.
 *
 * PRESENTATION ONLY: every value is owned by TransactionForm, which posts the
 * same fields to `createTransactionAction` as before.
 */
import { useMemo, useState } from "react";
import { createCategoryAction } from "@/app/actions";
import { formatMoney, getDualDate } from "@/lib/format";
import { D } from "@/domain/decimal";
import AmountInput from "@/components/ui/AmountInput";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon, { type IconName } from "@/components/ui/Icon";
import type { AccountOption, CategoryGroupOption } from "./TransactionForm";

/** Icon per standard expense group; user-made groups fall back to «layers». */
const GROUP_ICON: Record<string, IconName> = {
  HSG: "home",
  TRN: "car",
  FOD: "food",
  HLT: "heart",
  HYG: "sparkle",
  CLT: "shirt",
  ENT: "ticket",
  COM: "phone",
  PUR: "bag",
  FAM: "users",
  INS: "shield",
  EDU: "book",
  WRK: "briefcase",
  TAX: "receipt",
  SOC: "gift",
  MSC: "more",
};

const QUICK_AMOUNTS: Array<[string, number]> = [
  ["۵۰ هزار", 50_000],
  ["۱۰۰ هزار", 100_000],
  ["۵۰۰ هزار", 500_000],
  ["۱ میلیون", 1_000_000],
];

/** Persian search: Arabic ي/ك, half-spaces and case never block a match. */
const norm = (s: string) =>
  s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

type Leaf = CategoryGroupOption["children"][number] & { group: CategoryGroupOption };

type Props = {
  groups: CategoryGroupOption[];
  setGroups: (update: (current: CategoryGroupOption[]) => CategoryGroupOption[]) => void;
  parentId: string;
  categoryId: string;
  onPick: (parentId: string, categoryId: string) => void;
  recentCategoryIds: string[];
  amount: string;
  setAmount: (value: string) => void;
  previewUsd: string;
  accounts: AccountOption[];
  balances: Record<string, string>;
  accountId: string;
  setAccountId: (id: string) => void;
  entryDate: string;
  setEntryDate: (iso: string) => void;
  today: string;
  description: string;
  setDescription: (value: string) => void;
  autoDescription: string;
};

export default function ExpenseFields({
  groups,
  setGroups,
  parentId,
  categoryId,
  onPick,
  recentCategoryIds,
  amount,
  setAmount,
  previewUsd,
  accounts,
  balances,
  accountId,
  setAccountId,
  entryDate,
  setEntryDate,
  today,
  description,
  setDescription,
  autoDescription,
}: Props) {
  const [browsing, setBrowsing] = useState(!categoryId);
  const [openGroupId, setOpenGroupId] = useState(parentId);
  const [query, setQuery] = useState("");
  const [newName, setNewName] = useState("");
  const [addingTo, setAddingTo] = useState("");
  const [message, setMessage] = useState("");
  const [pickingDate, setPickingDate] = useState(false);

  const leaves = useMemo<Leaf[]>(() => groups.flatMap((g) => g.children.map((c) => ({ ...c, group: g }))), [groups]);
  const leafById = useMemo(() => new Map(leaves.map((l) => [l.id, l])), [leaves]);
  const selected = leafById.get(categoryId) ?? null;
  const recent = recentCategoryIds.map((id) => leafById.get(id)).filter((l): l is Leaf => !!l);
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;

  const q = norm(query);
  const matches = q
    ? leaves.filter((l) => norm(l.name).includes(q) || norm(l.group.name).includes(q)).slice(0, 30)
    : [];

  const pick = (leaf: Leaf) => {
    onPick(leaf.group.id, leaf.id);
    setOpenGroupId(leaf.group.id);
    setBrowsing(false);
    setQuery("");
    setAddingTo("");
  };

  const createLeaf = async () => {
    const name = newName.trim();
    if (!addingTo || !name) return;
    const res = await createCategoryAction({ name, parentId: addingTo });
    if (!res.ok || !res.id) {
      setMessage(res.message || "افزودن دسته انجام نشد");
      return;
    }
    const id = res.id;
    setMessage("");
    setNewName("");
    setGroups((current) =>
      current.map((g) =>
        g.id === addingTo ? { ...g, children: [...g.children, { id, code: "", name, nature: "cash", description: null }] } : g,
      ),
    );
    onPick(addingTo, id);
    setAddingTo("");
    setBrowsing(false);
  };

  const amountValue = amount ? D(amount) : null;
  const balanceRaw = accountId ? balances[accountId] : undefined;
  const overBalance = !!amountValue && !!balanceRaw && amountValue.gt(0) && amountValue.gt(D(balanceRaw));
  const yesterday = shiftIso(today, -1);
  const dateChoice = entryDate === today ? "today" : entryDate === yesterday ? "yesterday" : "other";
  const isNonCash = selected?.nature === "non_cash";

  return (
    <div className="space-y-3">
      {/* ── Amount ── */}
      <section className="card expense-amount space-y-3 p-4 sm:p-5">
        <label htmlFor="expense-amount" className="muted block text-center text-[length:var(--fs-xs)]">
          مبلغ هزینه به تومان
        </label>
        <AmountInput
          id="expense-amount"
          value={amount}
          onValueChange={setAmount}
          placeholder="۰"
          className="field num expense-amount-input"
          unit="toman"
          aria-label="مبلغ هزینه به تومان"
        />
        <div className="flex flex-wrap justify-center gap-1.5">
          {QUICK_AMOUNTS.map(([label, add]) => (
            <button
              key={add}
              type="button"
              className="chip"
              onClick={() => setAmount(D(amount || "0").add(add).toFixed(0))}
              aria-label={`افزودن ${label} تومان`}
            >
              + {label}
            </button>
          ))}
        </div>
        {previewUsd && (
          <p className="muted text-center text-[length:var(--fs-xs)]">
            ≈ <span className="num">{formatMoney(previewUsd, "USD")}</span>
          </p>
        )}
      </section>

      {/* ── Category ── */}
      <section className="card space-y-3 p-4" aria-labelledby="expense-category-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="expense-category-title" className="text-[length:var(--fs-sm)] font-bold">
            برای چه؟
          </h2>
          {selected && browsing && (
            <button type="button" className="btn btn-ghost !min-h-9 !px-2 text-[length:var(--fs-xs)]" onClick={() => setBrowsing(false)}>
              انصراف
            </button>
          )}
        </div>

        {selected && !browsing ? (
          <button
            type="button"
            onClick={() => setBrowsing(true)}
            className="expense-selected flex w-full items-center gap-3 rounded-[var(--r-md)] p-2.5 text-right"
          >
            <span className="expense-icon" aria-hidden="true">
              <Icon name={GROUP_ICON[selected.group.code] ?? "layers"} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[length:var(--fs-sm)]">{selected.name}</b>
              <span className="muted block truncate text-[length:var(--fs-xs)]">{selected.group.name}</span>
            </span>
            <span className="muted shrink-0 text-[length:var(--fs-xs)]">تغییر</span>
          </button>
        ) : (
          <>
            <div className="relative">
              <Icon name="search" size={16} className="muted pointer-events-none absolute top-1/2 -translate-y-1/2" style={{ insetInlineStart: "0.75rem" }} />
              <input
                type="search"
                className="field"
                style={{ paddingInlineStart: "2.25rem" }}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="جست‌وجو: قبض برق، تاکسی، دارو…"
                aria-label="جست‌وجوی دسته هزینه"
              />
            </div>

            {q ? (
              matches.length ? (
                <ul className="expense-results" role="listbox" aria-label="نتیجه جست‌وجو">
                  {matches.map((l) => (
                    <li key={l.id}>
                      <button type="button" role="option" aria-selected={l.id === categoryId} onClick={() => pick(l)}>
                        <Icon name={GROUP_ICON[l.group.code] ?? "layers"} size={16} className="muted shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{l.name}</span>
                        <span className="muted shrink-0 truncate text-[length:var(--fs-xs)]">{l.group.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted py-2 text-center text-[length:var(--fs-xs)]">دسته‌ای با «{query}» پیدا نشد.</p>
              )
            ) : (
              <>
                {recent.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="muted text-[length:var(--fs-xs)]">پرکاربرد شما</p>
                    <div className="expense-scroll flex gap-2">
                      {recent.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className={`chip shrink-0 ${l.id === categoryId ? "chip-on" : ""}`}
                          aria-pressed={l.id === categoryId}
                          onClick={() => pick(l)}
                        >
                          <Icon name={GROUP_ICON[l.group.code] ?? "layers"} size={14} />
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8" role="radiogroup" aria-label="گروه هزینه">
                  {groups.map((g) => {
                    const on = openGroupId === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => {
                          setOpenGroupId(on ? "" : g.id);
                          setAddingTo("");
                        }}
                        className="expense-tile"
                        data-on={on || undefined}
                      >
                        <span className="expense-icon" aria-hidden="true">
                          <Icon name={GROUP_ICON[g.code] ?? "layers"} size={20} />
                        </span>
                        <span className="line-clamp-2 text-center leading-4">{g.name}</span>
                      </button>
                    );
                  })}
                </div>

                {openGroup && (
                  <div className="soft space-y-2 rounded-[var(--r-md)] p-3">
                    {openGroup.description && (
                      <p className="muted text-[length:var(--fs-xs)] leading-5">{openGroup.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={`زیردسته‌های ${openGroup.name}`}>
                      {openGroup.children.map((c) => {
                        const on = c.id === categoryId;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            role="radio"
                            aria-checked={on}
                            className={`chip ${on ? "chip-on" : ""}`}
                            onClick={() => pick({ ...c, group: openGroup })}
                          >
                            {c.name}
                            {c.nature === "non_cash" && <span className="badge badge-neutral !py-0">غیرنقدی</span>}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        className="chip"
                        style={{ borderStyle: "dashed" }}
                        onClick={() => setAddingTo(addingTo ? "" : openGroup.id)}
                      >
                        {addingTo ? "بستن" : "+ دسته جدید"}
                      </button>
                    </div>
                    {addingTo === openGroup.id && (
                      <div className="flex gap-2">
                        <input
                          className="field"
                          value={newName}
                          onChange={(e) => setNewName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void createLeaf();
                            }
                          }}
                          placeholder={`نام دسته جدید در «${openGroup.name}»`}
                        />
                        <button type="button" onClick={createLeaf} disabled={!newName.trim()} className="btn btn-soft shrink-0 disabled:opacity-40">
                          افزودن
                        </button>
                      </div>
                    )}
                    {message && (
                      <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--negative)" }} role="alert">
                        {message}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {selected?.description && !browsing && (
          <p className="muted text-[length:var(--fs-xs)] leading-5">{selected.description}</p>
        )}
        {isNonCash && (
          <p className="soft rounded-[var(--r-sm)] p-2 text-[length:var(--fs-xs)] leading-5" role="note">
            ثبت غیرنقدی (استهلاک یا ذخیره) است؛ از هیچ حسابی پول خارج نمی‌شود.
          </p>
        )}
      </section>

      {/* ── Details: account, date, note ── */}
      <section className="card expense-details">
        {!isNonCash && (
          <div className="expense-row">
            <span className="expense-row-label">پرداخت از</span>
            {accounts.length === 0 ? (
              <p className="muted text-[length:var(--fs-xs)] leading-5">
                حساب بانکی تومانی ندارید.{" "}
                <a href="/accounts" style={{ color: "var(--action)" }}>
                  افزودن حساب بانکی
                </a>
              </p>
            ) : (
              <div className="expense-scroll flex gap-2" role="radiogroup" aria-label="حساب پرداخت">
                {accounts.map((a) => {
                  const on = a.id === accountId;
                  const bal = balances[a.id];
                  return (
                    <button
                      key={a.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setAccountId(a.id)}
                      className="expense-account"
                      data-on={on || undefined}
                    >
                      <Icon name={a.walletKind === "cash" ? "wallet" : "accounts"} size={16} className="shrink-0" />
                      <span className="min-w-0 text-right">
                        <span className="block truncate text-[length:var(--fs-sm)] font-medium">{a.walletName || a.name}</span>
                        {bal !== undefined && (
                          <span className="muted num block truncate text-[length:var(--fs-micro)]">
                            {formatMoney(D(bal).toFixed(0), "IRT")}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
            {overBalance && (
              <p className="text-[length:var(--fs-xs)] leading-5" style={{ color: "var(--warning)" }} role="status">
                مبلغ از موجودی ثبت‌شدهٔ این حساب بیشتر است.
              </p>
            )}
          </div>
        )}

        <div className="expense-row">
          <span className="expense-row-label">تاریخ</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                ["today", "امروز", today],
                ["yesterday", "دیروز", yesterday],
              ] as const
            ).map(([key, label, iso]) => (
              <button
                key={key}
                type="button"
                className={`chip ${dateChoice === key && !pickingDate ? "chip-on" : ""}`}
                aria-pressed={dateChoice === key}
                onClick={() => {
                  setEntryDate(iso);
                  setPickingDate(false);
                }}
              >
                {label}
              </button>
            ))}
            <button
              type="button"
              className={`chip ${dateChoice === "other" || pickingDate ? "chip-on" : ""}`}
              aria-expanded={pickingDate}
              onClick={() => setPickingDate((v) => !v)}
            >
              <Icon name="calendar" size={14} />
              {dateChoice === "other" && entryDate ? getDualDate(entryDate).jalali : "تاریخ دیگر"}
            </button>
          </div>
          {pickingDate && (
            <DualDateInput name="entryDate" value={entryDate} onChange={setEntryDate} label="تاریخ هزینه" required showGregorian={false} />
          )}
        </div>

        <div className="expense-row">
          <label htmlFor="expense-note" className="expense-row-label">
            یادداشت
          </label>
          <input
            id="expense-note"
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={autoDescription}
          />
        </div>
      </section>
    </div>
  );
}
