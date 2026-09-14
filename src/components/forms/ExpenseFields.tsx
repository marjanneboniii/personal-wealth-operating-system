"use client";

/**
 * ثبت هزینه — the everyday path, in three calm cards:
 *
 *   مبلغ        one large field and preset amounts (a tap sets the amount)
 *   دسته‌بندی   search, recent picks, then a group grid that drills into its
 *               subcategories (the grid and the list never stack on screen)
 *   پرداخت      account cards with their balance, a segmented date, a note
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

/** Preset amounts: a tap SETS the amount (it no longer adds to it). */
const PRESET_AMOUNTS: Array<[string, number]> = [
  ["۵۰۰ هزار", 500_000],
  ["۱ میلیون", 1_000_000],
  ["۲ میلیون", 2_000_000],
  ["۵ میلیون", 5_000_000],
  ["۱۰ میلیون", 10_000_000],
  ["۱۰۰ میلیون", 100_000_000],
];

/** Persian search: Arabic ي/ك, half-spaces and case never block a match. */
const norm = (s: string) =>
  s.replace(/ي/g, "ی").replace(/ك/g, "ک").replace(/[‌\s]+/g, " ").trim().toLowerCase();

function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const iconOf = (code: string): IconName => GROUP_ICON[code] ?? "layers";

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
  const [adding, setAdding] = useState(false);
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
    setAdding(false);
  };

  const openGroupPanel = (id: string) => {
    setOpenGroupId(id);
    setAdding(false);
    setMessage("");
  };

  const createLeaf = async () => {
    const name = newName.trim();
    if (!openGroup || !name) return;
    const groupId = openGroup.id;
    const res = await createCategoryAction({ name, parentId: groupId });
    if (!res.ok || !res.id) {
      setMessage(res.message || "افزودن دسته انجام نشد");
      return;
    }
    const id = res.id;
    setMessage("");
    setNewName("");
    setGroups((current) =>
      current.map((g) =>
        g.id === groupId ? { ...g, children: [...g.children, { id, code: "", name, nature: "cash", description: null }] } : g,
      ),
    );
    onPick(groupId, id);
    setAdding(false);
    setBrowsing(false);
  };

  const amountValue = amount ? D(amount) : null;
  const balanceRaw = accountId ? balances[accountId] : undefined;
  const overBalance = !!amountValue && !!balanceRaw && amountValue.gt(0) && amountValue.gt(D(balanceRaw));
  const yesterday = shiftIso(today, -1);
  const dateChoice = entryDate === today ? "today" : entryDate === yesterday ? "yesterday" : "other";
  const isNonCash = selected?.nature === "non_cash";

  return (
    <div className="expense-form">
      {/* ── Amount ── */}
      <section className="card expense-card expense-amount">
        <label htmlFor="expense-amount" className="expense-eyebrow">
          مبلغ هزینه <span aria-hidden="true">·</span> تومان
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
        {previewUsd && (
          <p className="expense-eyebrow">
            ≈ <span className="num">{formatMoney(previewUsd, "USD")}</span>
          </p>
        )}
        <div className="expense-presets" role="group" aria-label="مبلغ‌های آماده">
          {PRESET_AMOUNTS.map(([label, value]) => {
            const on = !!amountValue && amountValue.raw === D(value).raw;
            return (
              <button
                key={value}
                type="button"
                className="expense-preset"
                data-on={on || undefined}
                aria-pressed={on}
                onClick={() => setAmount(String(value))}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Category ── */}
      <section className="card expense-card" aria-labelledby="expense-category-title">
        <header className="expense-head">
          <h2 id="expense-category-title">دسته‌بندی</h2>
          {selected && browsing && (
            <button type="button" className="expense-link" onClick={() => setBrowsing(false)}>
              انصراف
            </button>
          )}
        </header>

        {selected && !browsing ? (
          <button type="button" onClick={() => setBrowsing(true)} className="expense-picked">
            <span className="expense-icon" data-on aria-hidden="true">
              <Icon name={iconOf(selected.group.code)} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate">{selected.name}</b>
              <span className="expense-sub block truncate">{selected.group.name}</span>
            </span>
            <span className="expense-link">تغییر</span>
          </button>
        ) : (
          <>
            <div className="expense-search">
              <Icon name="search" size={16} aria-hidden="true" />
              <input
                type="search"
                className="field"
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
                        <Icon name={iconOf(l.group.code)} size={16} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{l.name}</span>
                        <span className="expense-sub shrink-0 truncate">{l.group.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="expense-empty">دسته‌ای با «{query}» پیدا نشد.</p>
              )
            ) : openGroup ? (
              /* Drill-in: one group's subcategories replace the grid. */
              <div className="expense-panel">
                <div className="expense-panel-head">
                  <button type="button" className="expense-back" onClick={() => openGroupPanel("")} aria-label="بازگشت به همه گروه‌ها">
                    <Icon name="arrow-start" size={18} />
                  </button>
                  <span className="expense-icon" data-on aria-hidden="true">
                    <Icon name={iconOf(openGroup.code)} size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className="block truncate">{openGroup.name}</b>
                    {openGroup.description && <span className="expense-sub block">{openGroup.description}</span>}
                  </span>
                </div>
                <div className="expense-options" role="radiogroup" aria-label={`زیردسته‌های ${openGroup.name}`}>
                  {openGroup.children.map((c) => {
                    const on = c.id === categoryId;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className="expense-option"
                        data-on={on || undefined}
                        onClick={() => pick({ ...c, group: openGroup })}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        {c.nature === "non_cash" && <span className="badge badge-neutral !py-0">غیرنقدی</span>}
                        {on && <Icon name="check" size={16} className="shrink-0" />}
                      </button>
                    );
                  })}
                  {!adding && (
                    <button type="button" className="expense-option expense-option-add" onClick={() => setAdding(true)}>
                      <Icon name="plus" size={16} className="shrink-0" />
                      <span>دسته جدید</span>
                    </button>
                  )}
                </div>
                {adding && (
                  <div className="flex gap-2">
                    <input
                      className="field"
                      value={newName}
                      autoFocus
                      onChange={(e) => setNewName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void createLeaf();
                        }
                      }}
                      placeholder={`نام دسته جدید در «${openGroup.name}»`}
                    />
                    <button type="button" onClick={createLeaf} disabled={!newName.trim()} className="btn btn-primary shrink-0 disabled:opacity-40">
                      افزودن
                    </button>
                    <button type="button" onClick={() => setAdding(false)} className="btn btn-ghost shrink-0" aria-label="بستن">
                      <Icon name="x" size={16} />
                    </button>
                  </div>
                )}
                {message && (
                  <p className="text-[length:var(--fs-xs)]" style={{ color: "var(--negative)" }} role="alert">
                    {message}
                  </p>
                )}
              </div>
            ) : (
              <>
                {recent.length > 0 && (
                  <div className="expense-recent">
                    <p className="expense-sub">پرکاربرد شما</p>
                    <div className="expense-scroll">
                      {recent.map((l) => (
                        <button
                          key={l.id}
                          type="button"
                          className="expense-pill"
                          data-on={l.id === categoryId || undefined}
                          aria-pressed={l.id === categoryId}
                          onClick={() => pick(l)}
                        >
                          <Icon name={iconOf(l.group.code)} size={14} />
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="expense-grid" role="list" aria-label="گروه‌های هزینه">
                  {groups.map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      role="listitem"
                      title={g.name}
                      onClick={() => openGroupPanel(g.id)}
                      className="expense-tile"
                      data-on={g.id === selected?.group.id || undefined}
                    >
                      <span className="expense-icon" aria-hidden="true">
                        <Icon name={iconOf(g.code)} size={20} />
                      </span>
                      <span className="expense-tile-label">{g.name}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </>
        )}

        {selected?.description && !browsing && <p className="expense-sub leading-5">{selected.description}</p>}
        {isNonCash && (
          <p className="expense-note" role="note">
            ثبت غیرنقدی (استهلاک یا ذخیره) است؛ از هیچ حسابی پول خارج نمی‌شود.
          </p>
        )}
      </section>

      {/* ── Paying account ── */}
      {!isNonCash && (
        <section className="card expense-card" aria-labelledby="expense-account-title">
          <header className="expense-head">
            <h2 id="expense-account-title">پرداخت از</h2>
            {accounts.length > 0 && <span className="expense-sub">{accounts.length.toLocaleString("fa-IR")} حساب</span>}
          </header>
          {accounts.length === 0 ? (
            <p className="expense-empty">
              حساب بانکی تومانی ندارید.{" "}
              <a href="/accounts" style={{ color: "var(--action)" }}>
                افزودن حساب بانکی
              </a>
            </p>
          ) : (
            <div className="expense-accounts" role="radiogroup" aria-label="حساب پرداخت">
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
                    <span className="expense-account-top">
                      <span className="expense-icon expense-icon-sm" aria-hidden="true">
                        <Icon name={a.walletKind === "cash" ? "wallet" : "accounts"} size={16} />
                      </span>
                      <span className="expense-radio" aria-hidden="true">
                        {on && <Icon name="check" size={12} strokeWidth={2.6} />}
                      </span>
                    </span>
                    <span className="expense-account-name">{a.walletName || a.name}</span>
                    <span className="expense-account-balance num">
                      {bal !== undefined ? formatMoney(D(bal).toFixed(0), "IRT") : "—"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {overBalance && (
            <p className="expense-note expense-note-warn" role="status">
              مبلغ از موجودی ثبت‌شدهٔ این حساب بیشتر است.
            </p>
          )}
        </section>
      )}

      {/* ── Date & note ── */}
      <section className="card expense-card expense-details">
        <div className="expense-row">
          <span className="expense-row-label">تاریخ</span>
          <div className="expense-seg" role="group" aria-label="تاریخ هزینه">
            {(
              [
                ["today", "امروز", today],
                ["yesterday", "دیروز", yesterday],
              ] as const
            ).map(([key, label, iso]) => {
              const on = dateChoice === key && !pickingDate;
              return (
                <button
                  key={key}
                  type="button"
                  data-on={on || undefined}
                  aria-pressed={on}
                  onClick={() => {
                    setEntryDate(iso);
                    setPickingDate(false);
                  }}
                >
                  {label}
                </button>
              );
            })}
            <button
              type="button"
              data-on={dateChoice === "other" || pickingDate || undefined}
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
