"use client";

/**
 * ثبت هزینه — tap, tap, type the amount:
 *
 *   مبلغ        the one typed field, large and centred, with preset amounts
 *   برای چه؟    coloured group tiles (مسکن، خودرو، خوراک…); a group opens its
 *               subcategories as tiles in the same colour. Recent picks first.
 *               The last tile, «+ دسته جدید», opens NewCategorySheet.
 *   پرداخت از   the Toman bank and cash accounts, as logo tiles with balance
 *   کی؟         امروز · دیروز · پریروز · تقویم
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
import { formatMoney } from "@/lib/format";
import { D } from "@/domain/decimal";
import AmountInput from "@/components/ui/AmountInput";
import Icon from "@/components/ui/Icon";
import NewCategorySheet, { NewCategoryTile } from "./NewCategorySheet";
import { AccountTiles, AmountHero, DateChips, EXPENSE_GROUP_LOOK, FALLBACK_LOOK, Presets, Tile, TxCard } from "./txKit";
import type { AccountOption, CategoryGroupOption } from "./TransactionForm";

const PRESET_AMOUNTS = [
  { label: "۱۰۰ هزار", value: "100000" },
  { label: "۵۰۰ هزار", value: "500000" },
  { label: "۱ میلیون", value: "1000000" },
  { label: "۲ میلیون", value: "2000000" },
  { label: "۵ میلیون", value: "5000000" },
  { label: "۱۰ میلیون", value: "10000000" },
];

/** Recent picks fill at most one row of tiles on a phone. */
const RECENT_LIMIT = 6;

type Leaf = CategoryGroupOption["children"][number] & { group: CategoryGroupOption };

const lookOf = (g: CategoryGroupOption) => EXPENSE_GROUP_LOOK[g.code] ?? FALLBACK_LOOK;

type Props = {
  groups: CategoryGroupOption[];
  parentId: string;
  categoryId: string;
  onPick: (parentId: string, categoryId: string) => void;
  /** A category made in «دسته جدید» — added to the group and selected. */
  onCreate: (parentId: string, leaf: CategoryGroupOption["children"][number]) => void;
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
};

export default function ExpenseFields({
  groups,
  parentId,
  categoryId,
  onPick,
  onCreate,
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
}: Props) {
  const [browsing, setBrowsing] = useState(!categoryId);
  const [openGroupId, setOpenGroupId] = useState(parentId);
  const [adding, setAdding] = useState(false);

  const leaves = useMemo<Leaf[]>(() => groups.flatMap((g) => g.children.map((c) => ({ ...c, group: g }))), [groups]);
  const leafById = useMemo(() => new Map(leaves.map((l) => [l.id, l])), [leaves]);
  const selected = leafById.get(categoryId) ?? null;
  const recent = recentCategoryIds
    .map((id) => leafById.get(id))
    .filter((l): l is Leaf => !!l)
    .slice(0, RECENT_LIMIT);
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;

  const pick = (leaf: Leaf) => {
    onPick(leaf.group.id, leaf.id);
    setOpenGroupId(leaf.group.id);
    setBrowsing(false);
  };

  const amountValue = amount ? D(amount) : null;
  const balanceRaw = accountId ? balances[accountId] : undefined;
  const overBalance = !!amountValue && !!balanceRaw && amountValue.gt(0) && amountValue.gt(D(balanceRaw));
  const isNonCash = selected?.nature === "non_cash";

  return (
    <div className="txr-stack">
      {/* ── Amount ── */}
      <section className="txr-card">
        <AmountHero
          label="مبلغ هزینه"
          unit="تومان"
          foot={previewUsd ? <p className="txr-sub">≈ <span className="num">{formatMoney(previewUsd, "USD")}</span></p> : null}
        >
          <AmountInput id="expense-amount" value={amount} onValueChange={setAmount} placeholder="۰" className="txr-amount num" unit="toman" aria-label="مبلغ هزینه" />
        </AmountHero>
        <Presets items={PRESET_AMOUNTS} current={amount} onPick={setAmount} label="مبلغ‌های آماده" />
      </section>

      {/* ── Category ── */}
      <TxCard
        icon="layers"
        title="برای چه خرج کردید؟"
        aside={
          selected && (
            <button type="button" className="txr-link" onClick={() => setBrowsing((v) => !v)}>
              {browsing ? "انصراف" : "تغییر"}
            </button>
          )
        }
      >
        {selected && !browsing ? (
          <div className="txr-picked" style={{ "--tile": lookOf(selected.group).color } as React.CSSProperties}>
            <span className="txr-tile-icon" aria-hidden="true">
              <Icon name={lookOf(selected.group).icon} size={18} />
            </span>
            <span className="txr-picked-text">
              <b>{selected.name}</b>
              <span className="txr-sub">{selected.group.name}</span>
            </span>
            <span className="txr-tick txr-tick-static" aria-hidden="true">
              <Icon name="check" size={10} strokeWidth={3} />
            </span>
          </div>
        ) : openGroup ? (
          /* One group's subcategories replace the group tiles. */
          <>
            <div className="txr-crumb">
              <button type="button" className="txr-link" onClick={() => setOpenGroupId("")}>
                <Icon name="arrow-start" size={16} />
                همه گروه‌ها
              </button>
              <b className="min-w-0 truncate">{openGroup.name}</b>
            </div>
            {openGroup.description && <p className="txr-sub">{openGroup.description}</p>}
            <div className="txr-tiles" role="radiogroup" aria-label={`زیردسته‌های ${openGroup.name}`}>
              {openGroup.children.map((c) => (
                <Tile
                  key={c.id}
                  on={c.id === categoryId}
                  onClick={() => pick({ ...c, group: openGroup })}
                  label={c.name}
                  meta={c.nature === "non_cash" ? "غیرنقدی" : undefined}
                  icon={lookOf(openGroup).icon}
                  color={lookOf(openGroup).color}
                />
              ))}
              <NewCategoryTile onClick={() => setAdding(true)} />
            </div>
            <NewCategorySheet
              open={adding}
              onClose={() => setAdding(false)}
              group={openGroup}
              look={lookOf(openGroup)}
              onCreated={(leaf) => {
                onCreate(openGroup.id, leaf);
                pick({ ...leaf, group: openGroup });
              }}
              onPickExisting={(id) => {
                const leaf = openGroup.children.find((c) => c.id === id);
                if (leaf) pick({ ...leaf, group: openGroup });
              }}
            />
          </>
        ) : (
          <>
            {recent.length > 0 && (
              <>
                <p className="txr-sub">پرکاربرد شما</p>
                <div className="txr-tiles" role="radiogroup" aria-label="دسته‌های پرکاربرد">
                  {recent.map((l) => (
                    <Tile key={l.id} on={l.id === categoryId} onClick={() => pick(l)} label={l.name} icon={lookOf(l.group).icon} color={lookOf(l.group).color} />
                  ))}
                </div>
                <p className="txr-sub">همه گروه‌ها</p>
              </>
            )}
            <div className="txr-tiles" role="list" aria-label="گروه‌های هزینه">
              {groups.map((g) => (
                <Tile
                  key={g.id}
                  role="button"
                  on={g.id === selected?.group.id}
                  onClick={() => setOpenGroupId(g.id)}
                  label={g.name}
                  icon={lookOf(g).icon}
                  color={lookOf(g).color}
                />
              ))}
            </div>
          </>
        )}

        {selected?.description && !browsing && <p className="txr-sub">{selected.description}</p>}
        {isNonCash && (
          <p className="txr-note" role="note">
            ثبت غیرنقدی (استهلاک یا ذخیره) است؛ از هیچ حسابی پول خارج نمی‌شود.
          </p>
        )}
      </TxCard>

      {/* ── Paying account ── */}
      {!isNonCash && (
        <TxCard icon="wallet" title="پرداخت از">
          {accounts.length === 0 ? (
            <p className="txr-empty">
              حساب بانکی تومانی ندارید.{" "}
              <a href="/accounts" className="txr-link">
                افزودن حساب بانکی
              </a>
            </p>
          ) : (
            <AccountTiles value={accountId} options={accounts} balances={balances} onChange={setAccountId} placeholder="انتخاب حساب پرداخت" sheetTitle="پرداخت از کدام حساب؟" />
          )}
          {overBalance && (
            <p className="txr-note txr-note-warn" role="status">
              مبلغ از موجودی ثبت‌شدهٔ این حساب بیشتر است.
            </p>
          )}
        </TxCard>
      )}

      {/* ── Date ── */}
      <TxCard icon="calendar" title="کی؟">
        <DateChips value={entryDate} onChange={setEntryDate} today={today} label="تاریخ هزینه" />
        <input type="hidden" name="entryDate" value={entryDate} />
      </TxCard>
    </div>
  );
}
