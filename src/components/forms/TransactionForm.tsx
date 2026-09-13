"use client";

/**
 * ثبت تراکنش — rebuilt around the three questions a person actually answers:
 *
 *   ۱. چه اتفاقی افتاد؟   the type, then WHAT: a category, an income source,
 *                          two accounts, an asset, or a debt
 *   ۲. چقدر؟              the amount (and, for an asset, the quantity)
 *   ۳. از کجا و کی؟       the money account, the date, a note
 *
 * WHAT THE OLD FORM GOT WRONG, AND WHAT REPLACED IT
 *   • Account CODES («WLX-BTC — …», «1010 — …») were shown to users. Accounts
 *     are now shown by name and unit only; codes stay in the ledger.
 *   • The amount came first, before the user had said what the money was for.
 *   • Buying an asset meant a search list AND a separate account select that
 *     listed the same thing twice. The user's own assets are now one tap away,
 *     the market list is behind «دارایی دیگر», and the pick shows its price.
 *   • A transfer could name the same account as source and destination.
 *   • A USDT commission was previewed as Toman.
 *   • «شرح» was mandatory; it is now filled in from what was chosen, and only
 *     overridden when the user types one.
 *   • The disabled button said «complete the form» without saying WHAT was
 *     missing. It now lists the missing items.
 *   • Every number field accepts Persian or Latin digits and shows ۱٬۰۰۰٬۰۰۰.
 *
 * THE SERVER CONTRACT IS UNCHANGED. The same fields reach
 * `createTransactionAction` with the same meanings (primaryAccountId /
 * counterAccountId per type, irtAmount, quantity, fee + feeMode, categoryId,
 * debtId / installmentId); only how they are collected changed. No accounting
 * rule moved into the UI, and nothing is written before «تأیید و ثبت».
 */
import { useActionState, useEffect, useRef, useState } from "react";
import { createTransactionAction, createCategoryAction, type ActionResult } from "@/app/actions";
import { currencyLabel, faCount, formatMoney, formatQty, getDualDate } from "@/lib/format";
import { useLatestRate } from "@/components/ui/SmartPreview";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import Icon, { type IconName } from "@/components/ui/Icon";
import AssetLogo from "@/components/ui/AssetLogo";
import WallexAssetPicker from "@/components/assets/WallexAssetPicker";
import { loadMarketCatalog } from "@/components/assets/marketCatalogClient";
import DebtInstallmentExplorer, { type DebtOption } from "./DebtInstallmentExplorer";
import { D } from "@/domain/decimal";
import { isLiquidAccount } from "@/features/accounts/classification";
import type { MarketRow } from "@/features/pricing/marketSearch";
import { normalizeNumericInput } from "@/lib/numericInput";
import { FormStatus } from "@/components/ui/FormStatus";

export type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  symbol: string | null;
  decimals: number;
  logoUrl?: string | null;
  coingeckoId?: string | null;
  /**
   * Optional classification hints (`asset_classes.code`, its name and
   * `wallets.kind`). When present, the Money/Assets separation defined in
   * `@/features/accounts/classification` decides where the account may be
   * used; when absent the account is treated by its symbol only.
   */
  classCode?: string | null;
  className?: string | null;
  walletKind?: string | null;
};

/** Hierarchical expense categories (parent → leaf children). */
export type CategoryChildOption = {
  id: string;
  code: string;
  name: string;
  nature: string; // cash | non_cash
  description: string | null;
};
export type CategoryGroupOption = {
  id: string;
  code: string;
  name: string;
  children: CategoryChildOption[];
};

const TYPES = [
  { key: "expense", label: "هزینه", icon: "card" },
  { key: "income", label: "درآمد", icon: "download" },
  { key: "transfer", label: "انتقال", icon: "swap" },
  { key: "buy", label: "خرید دارایی", icon: "plus" },
  { key: "sell", label: "فروش دارایی", icon: "upload" },
  { key: "debt_repayment", label: "پرداخت بدهی", icon: "debts" },
] as const satisfies ReadonlyArray<{ key: string; label: string; icon: IconName }>;

type TxType = (typeof TYPES)[number]["key"];

/** Units a money account holds that are never «an asset you trade». */
const FIAT_SYMBOLS = new Set(["IRT", "IRR", "USD"]);
/** Units the existing FX engine can anchor a cross-unit transfer on. */
const SWAP_ANCHOR_ASSETS = new Set(["IRT", "USD", "USDT", "USDC", "USDG", "USDE", "USDS"]);

/** An account by NAME and unit — never by its ledger code. */
function accountLabel(a: AccountOption | undefined | null): string {
  if (!a) return "—";
  const unit = a.symbol ? currencyLabel(a.symbol) : "";
  const named = unit && (a.name.includes(unit) || (a.symbol && a.name.includes(a.symbol)));
  return unit && !named ? `${a.name} · ${unit}` : a.name;
}

/**
 * The chosen id when it is still valid for this list; otherwise the only
 * option when there is exactly one (a user with one bank account should never
 * have to pick it); otherwise nothing.
 */
function resolve(id: string, options: AccountOption[], autoSingle = true): string {
  if (id && options.some((o) => o.id === id)) return id;
  return autoSingle && options.length === 1 ? options[0].id : "";
}

type Props = {
  accounts: AccountOption[];
  categories?: CategoryGroupOption[];
  debts?: DebtOption[];
  defaultType?: TxType;
  today: string;
  initialRate?: string | null;
  initialRateDate?: string;
  initialRateSource?: string;
  initialIrtAmount?: string;
  initialTitle?: string;
  initialDescription?: string;
  initialEntryDate?: string;
  initialDebtId?: string;
  initialInstallmentId?: string;
};

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-[length:var(--fs-sm)] font-bold">
        <span
          className="num inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[length:var(--fs-xs)]"
          style={{ background: "var(--action-soft)", color: "var(--action)" }}
          aria-hidden="true"
        >
          {faCount(n)}
        </span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function AccountSelect({
  label,
  value,
  options,
  onChange,
  empty,
}: {
  label: string;
  value: string;
  options: AccountOption[];
  onChange: (id: string) => void;
  empty?: React.ReactNode;
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <select className="field" value={value} onChange={(e) => onChange(e.target.value)} disabled={options.length === 0}>
        <option value="" disabled>
          {options.length === 0 ? "حسابی موجود نیست" : "انتخاب کنید…"}
        </option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {accountLabel(a)}
          </option>
        ))}
      </select>
      {options.length === 0 ? empty : null}
    </div>
  );
}

export default function TransactionForm({
  accounts,
  categories = [],
  debts = [],
  defaultType = "expense",
  today,
  initialRate,
  initialRateDate,
  initialRateSource,
  initialIrtAmount,
  initialTitle,
  initialDescription,
  initialEntryDate,
  initialDebtId,
  initialInstallmentId,
}: Props) {
  const [type, setType] = useState<TxType>(defaultType);
  const [irtAmount, setIrtAmount] = useState(() => normalizeNumericInput(initialIrtAmount ?? ""));
  const [quantity, setQuantity] = useState("");
  const [fee, setFee] = useState("");
  const [entryDate, setEntryDate] = useState(initialEntryDate ?? today);
  const [description, setDescription] = useState(initialDescription ?? initialTitle ?? "");

  // One selection per ROLE, not per ledger column: a bank account chosen to
  // pay an expense is still selected when the user switches to «خرید دارایی».
  const [moneyAccountId, setMoneyAccountId] = useState("");
  const [assetAccountId, setAssetAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [incomeAccountId, setIncomeAccountId] = useState("");

  const [categoryGroups, setCategoryGroups] = useState<CategoryGroupOption[]>(categories);
  const [categoryParentId, setCategoryParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryMessage, setCategoryMessage] = useState("");

  const [selectedDebt, setSelectedDebt] = useState<DebtOption | null>(null);
  const [selectedInst, setSelectedInst] = useState<DebtOption["installments"][number] | null>(null);

  const [accountOptions, setAccountOptions] = useState(accounts);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [market, setMarket] = useState<Map<string, MarketRow>>(() => new Map());
  const [confirming, setConfirming] = useState(false);

  const { rate, date: rateDate, source: rateSource } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveRateDate = initialRateDate ?? rateDate;
  const effectiveRateSource = initialRateSource ?? rateSource;

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(createTransactionAction, null);

  // A successful save clears the amounts for the next entry. Done while
  // rendering (React's pattern for reacting to a changed value), not in an
  // effect, so the cleared form never flashes the old numbers.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    setConfirming(false);
    if (state?.ok) {
      setIrtAmount("");
      setQuantity("");
      setFee("");
      setDescription("");
      setSelectedDebt(null);
      setSelectedInst(null);
    }
  }

  const isTrade = type === "buy" || type === "sell";

  /* ── Option lists ─────────────────────────────────────────────────── */
  const assetAccounts = accountOptions.filter((a) => a.type === "asset");
  // Daily money — bank, cash box, stablecoin wallets (audit F-11).
  const moneyOptions = assetAccounts.filter((a) => isLiquidAccount(a));
  // What can be bought or sold: any position that is not plain fiat.
  const tradeOptions = assetAccounts.filter((a) => !FIAT_SYMBOLS.has((a.symbol ?? "").toUpperCase()));
  const incomeOptions = accountOptions.filter((a) => a.type === "income");

  const fromId = resolve(fromAccountId, assetAccounts, false);
  // A transfer can never land in the account it left.
  const toOptions = assetAccounts.filter((a) => a.id !== fromId);
  const toId = resolve(toAccountId, toOptions, false);
  const moneyId = resolve(moneyAccountId, moneyOptions);
  const assetId = resolve(assetAccountId, tradeOptions, false);
  const incomeId = resolve(incomeAccountId, incomeOptions);

  const byId = (id: string) => accountOptions.find((a) => a.id === id);
  const moneyAccount = byId(moneyId);
  const assetAccount = byId(assetId);
  const fromAccount = byId(fromId);
  const toAccount = byId(toId);
  const incomeAccount = byId(incomeId);

  /* ── Expense category ─────────────────────────────────────────────── */
  const selectedParent = categoryGroups.find((g) => g.id === categoryParentId) ?? null;
  const selectedCategory = selectedParent?.children.find((c) => c.id === categoryId) ?? null;
  const isNonCash = type === "expense" && selectedCategory?.nature === "non_cash";

  /**
   * Counter for a repayment of a PLANNING-ONLY debt (no ledger liability
   * account): 5960 «پرداخت اقساط», never 5900 «هزینه متفرقه» (audit F-3). A
   * debt WITH a liability account needs no counter — the server reduces it.
   */
  const installmentBucket =
    accountOptions.find((a) => a.type === "expense" && a.code === "5960") ??
    accountOptions.find((a) => a.type === "expense");

  /* ── What the server receives, per type ───────────────────────────── */
  let primaryAccountId = "";
  let counterAccountId = "";
  switch (type) {
    case "expense":
      primaryAccountId = isNonCash ? "" : moneyId;
      break;
    case "income":
      primaryAccountId = moneyId;
      counterAccountId = incomeId;
      break;
    case "transfer":
      primaryAccountId = fromId;
      counterAccountId = toId;
      break;
    case "buy":
    case "sell":
      primaryAccountId = assetId;
      counterAccountId = moneyId;
      break;
    case "debt_repayment":
      primaryAccountId = moneyId;
      counterAccountId = selectedDebt?.accountId ? "" : installmentBucket?.id ?? "";
      break;
  }

  /* ── Market price for the chosen asset ────────────────────────────── */
  useEffect(() => {
    if (!isTrade || market.size > 0) return;
    let alive = true;
    loadMarketCatalog().then((result) => {
      if (alive && result.ok) setMarket(new Map(result.rows.map((row) => [row.symbol, row])));
    });
    return () => {
      alive = false;
    };
  }, [isTrade, market.size]);

  const marketRow = assetAccount?.symbol ? market.get(assetAccount.symbol.toUpperCase()) : undefined;
  const assetName = marketRow?.displayName ?? assetAccount?.name ?? "";
  const marketPrice = marketRow?.priceTmn ? D(marketRow.priceTmn) : null;
  const amountValue = irtAmount ? D(irtAmount) : null;
  const quantityValue = quantity ? D(quantity) : null;
  const hasAmount = !!amountValue && amountValue.gt(0);
  const hasQuantity = !!quantityValue && quantityValue.gt(0);
  const qtyDecimals = Math.min(Math.max(assetAccount?.decimals ?? 8, 0), 8);
  const tradeUnitPrice = hasAmount && hasQuantity ? amountValue!.div(quantityValue!) : null;

  const trimQty = (fixed: string) => (fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed);

  /* ── Fee: in the unit of the account that pays it ─────────────────── */
  const feePayAccount = type === "transfer" ? fromAccount : moneyAccount;
  const feeSymbol = (feePayAccount?.symbol ?? "IRT").toUpperCase();
  const feeInToman = !feePayAccount || feeSymbol === "IRT" || feeSymbol === "IRR";

  /* ── Transfer across units ────────────────────────────────────────── */
  const isCrossUnitTransfer =
    type === "transfer" && !!fromAccount?.symbol && !!toAccount?.symbol && fromAccount.symbol !== toAccount.symbol;
  const swapSupported =
    isCrossUnitTransfer &&
    (SWAP_ANCHOR_ASSETS.has(fromAccount?.symbol ?? "") || SWAP_ANCHOR_ASSETS.has(toAccount?.symbol ?? ""));

  const previewUsd = hasAmount && effectiveRate ? amountValue!.div(effectiveRate).toFixed(2) : "";

  /* ── Description, filled in from what was chosen ──────────────────── */
  const autoDescription = (() => {
    switch (type) {
      case "expense":
        return selectedCategory ? `هزینه — ${selectedCategory.name}` : "هزینه";
      case "income":
        return incomeAccount ? `درآمد — ${incomeAccount.name}` : "درآمد";
      case "transfer":
        return fromAccount && toAccount ? `انتقال از ${fromAccount.name} به ${toAccount.name}` : "انتقال بین حساب‌ها";
      case "buy":
        return assetName ? `خرید ${assetName}` : "خرید دارایی";
      case "sell":
        return assetName ? `فروش ${assetName}` : "فروش دارایی";
      case "debt_repayment":
        if (selectedDebt && selectedInst) return `پرداخت قسط ${faCount(selectedInst.seq)} — ${selectedDebt.title}`;
        return selectedDebt ? `بازپرداخت بدهی — ${selectedDebt.title}` : "بازپرداخت بدهی";
    }
  })();
  const finalDescription = description.trim() || autoDescription;

  /* ── What is still missing — said by name ─────────────────────────── */
  const missing: string[] = [];
  if (type === "debt_repayment" && !selectedDebt) missing.push("بدهی یا قسط");
  if (isTrade && !assetId) missing.push("دارایی");
  if (type === "expense" && !categoryId) missing.push("دسته هزینه");
  if (type === "income" && !incomeId) missing.push("منبع درآمد");
  if (type === "transfer" && !fromId) missing.push("حساب مبدأ");
  if (type === "transfer" && !toId) missing.push("حساب مقصد");
  if (type !== "transfer" && !isNonCash && !moneyId) {
    missing.push(type === "income" || type === "sell" ? "حساب واریز" : "حساب پرداخت");
  }
  if (!hasAmount) missing.push("مبلغ");
  if (!entryDate) missing.push("تاریخ");
  const ready = missing.length === 0;

  /* ── Handlers ─────────────────────────────────────────────────────── */
  const pickType = (key: TxType) => {
    setType(key);
    setConfirming(false);
    setPickerOpen(false);
  };

  const handleCreateCategory = async () => {
    if (!categoryParentId || !newCategoryName.trim()) return;
    const res = await createCategoryAction({ name: newCategoryName.trim(), parentId: categoryParentId });
    if (!res.ok) {
      setCategoryMessage(res.message);
      return;
    }
    setCategoryMessage("");
    const created = newCategoryName.trim();
    setNewCategoryName("");
    setShowNewCategory(false);
    setCategoryGroups((current) =>
      current.map((g) =>
        g.id === categoryParentId && res.id
          ? { ...g, children: [...g.children, { id: res.id, code: "", name: created, nature: "cash", description: null }] }
          : g,
      ),
    );
    if (res.id) setCategoryId(res.id);
  };

  const handleSelectDebt = (d: DebtOption) => {
    setSelectedDebt(d);
    setSelectedInst(null);
    const pendingInst = d.installments.find((i) => i.status === "pending");
    // The contractual Toman amount is authoritative — never re-derived from a
    // stored USD value, so an FX change cannot alter the Toman amount.
    const amtToman = pendingInst ? pendingInst.amountToman : d.outstandingToman;
    const amtUsd = pendingInst ? pendingInst.amountBase : d.outstandingBase;
    setIrtAmount(
      amtToman ? D(amtToman).toFixed(0) : effectiveRate ? D(amtUsd).mul(effectiveRate).toFixed(0) : normalizeNumericInput(amtUsd),
    );
    setEntryDate(today);
    setType("debt_repayment");
  };

  const handleSelectInstallment = (d: DebtOption, inst: DebtOption["installments"][number]) => {
    setSelectedDebt(d);
    setSelectedInst(inst);
    setIrtAmount(
      inst.amountToman
        ? D(inst.amountToman).toFixed(0)
        : effectiveRate
          ? D(inst.amountBase).mul(effectiveRate).toFixed(0)
          : normalizeNumericInput(inst.amountBase),
    );
    setEntryDate(inst.dueDate);
    setType("debt_repayment");
  };

  // Auto-populate from ?debtId / ?installmentId — deferred so no setState runs
  // during render (mobile hydration fix).
  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current || !debts.length) return;
    if (initialInstallmentId) {
      for (const d of debts) {
        const inst = d.installments.find((i) => i.id === initialInstallmentId);
        if (inst) {
          autoPopulatedRef.current = true;
          window.setTimeout(() => handleSelectInstallment(d, inst), 0);
          return;
        }
      }
    }
    if (initialDebtId) {
      const d = debts.find((x) => x.id === initialDebtId);
      if (d) {
        autoPopulatedRef.current = true;
        window.setTimeout(() => handleSelectDebt(d), 0);
      }
    }
    if (initialDebtId || initialInstallmentId) autoPopulatedRef.current = true;
    // The handlers are stable for this one-time auto-population path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debts, initialDebtId, initialInstallmentId]);

  const noMoneyAccounts = (
    <p className="muted mt-1.5 text-[length:var(--fs-xs)] leading-5">
      هنوز حساب نقد یا بانکی ندارید.{" "}
      <a href="/accounts" style={{ color: "var(--action)" }}>
        افزودن حساب
      </a>
    </p>
  );

  /* ── Summary rows shown before the final confirm ──────────────────── */
  const summary: Array<[string, React.ReactNode]> = [
    ["نوع", TYPES.find((t) => t.key === type)?.label],
    [
      "مبلغ",
      <>
        <b className="num">{hasAmount ? formatMoney(irtAmount, "IRT") : "—"}</b>
        {previewUsd ? <span className="muted num"> ≈ {formatMoney(previewUsd, "USD")}</span> : null}
      </>,
    ],
  ];
  if (type === "expense") {
    summary.push(["دسته", selectedParent && selectedCategory ? `${selectedParent.name} › ${selectedCategory.name}` : "—"]);
  }
  if (type === "income") summary.push(["منبع درآمد", accountLabel(incomeAccount)]);
  if (isTrade) {
    summary.push(["دارایی", assetName || "—"]);
    if (hasQuantity) summary.push(["مقدار", <span key="q" className="num">{formatQty(quantity, qtyDecimals)}</span>]);
    if (tradeUnitPrice) summary.push(["قیمت هر واحد", <span key="u" className="num">{formatMoney(tradeUnitPrice.toFixed(0), "IRT")}</span>]);
  }
  if (type === "transfer") {
    summary.push(["از", accountLabel(fromAccount)], ["به", accountLabel(toAccount)]);
    if (hasQuantity) summary.push(["مقدار", <span key="tq" className="num">{formatQty(quantity, 8)}</span>]);
  } else if (!isNonCash) {
    summary.push([type === "income" || type === "sell" ? "واریز به" : "پرداخت از", accountLabel(moneyAccount)]);
  }
  if (type === "debt_repayment" && selectedDebt) {
    summary.push(["بدهی", selectedInst ? `${selectedDebt.title} — قسط ${faCount(selectedInst.seq)}` : selectedDebt.title]);
  }
  if (fee && D(fee).gt(0)) {
    summary.push(["کارمزد", <span key="f" className="num">{formatMoney(fee, feeInToman ? "IRT" : feeSymbol)}</span>]);
  }
  summary.push(["تاریخ", entryDate ? getDualDate(entryDate).jalali : "—"], ["شرح", finalDescription]);

  const stepOneTitle: Record<TxType, string> = {
    expense: "برای چه خرج کردید؟",
    income: "این درآمد از کجا آمد؟",
    transfer: "از کدام حساب به کدام حساب؟",
    buy: "چه دارایی‌ای خریدید؟",
    sell: "چه دارایی‌ای فروختید؟",
    debt_repayment: "کدام بدهی یا قسط را پرداخت کردید؟",
  };

  return (
    <form action={formAction} className="space-y-4" style={{ touchAction: "manipulation" }}>
      {/* ── What reaches the server — one place, every field. ── */}
      <input type="hidden" name="type" value={type} />
      <input type="hidden" name="irtAmount" value={irtAmount} />
      <input type="hidden" name="amount" value={previewUsd} />
      <input type="hidden" name="categoryId" value={type === "expense" ? categoryId : ""} />
      <input type="hidden" name="primaryAccountId" value={primaryAccountId} />
      <input type="hidden" name="counterAccountId" value={counterAccountId} />
      <input type="hidden" name="quantity" value={isTrade || type === "transfer" ? quantity : ""} />
      <input type="hidden" name="fee" value={fee} />
      <input type="hidden" name="feeMode" value={feeInToman ? "irt" : "native"} />
      <input type="hidden" name="description" value={finalDescription} />
      <input type="hidden" name="fxRate" value={effectiveRate ?? ""} />
      <input type="hidden" name="fxRateDate" value={effectiveRateDate ?? ""} />
      <input type="hidden" name="debtId" value={type === "debt_repayment" ? selectedDebt?.id ?? "" : ""} />
      <input type="hidden" name="installmentId" value={type === "debt_repayment" ? selectedInst?.id ?? "" : ""} />

      {/* ── Type ── */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" role="group" aria-label="نوع تراکنش">
        {TYPES.map((t) => {
          const on = type === t.key;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => pickType(t.key)}
              aria-pressed={on}
              className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-[var(--r-md)] border px-1 py-2 text-[length:var(--fs-xs)] font-medium"
              style={{
                borderColor: on ? "var(--action)" : "var(--border)",
                background: on ? "var(--action-soft)" : "var(--surface)",
                color: on ? "var(--action)" : "inherit",
                touchAction: "manipulation",
              }}
            >
              <Icon name={t.icon} size={18} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── ۱. What ── */}
      <Step n={1} title={stepOneTitle[type]}>
        {type === "expense" && (
          <div className="space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="field"
                value={categoryParentId}
                onChange={(e) => {
                  setCategoryParentId(e.target.value);
                  setCategoryId("");
                }}
                aria-label="دسته اصلی"
              >
                <option value="" disabled>
                  دسته اصلی…
                </option>
                {categoryGroups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <select
                className="field"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!selectedParent}
                aria-label="زیردسته"
              >
                <option value="" disabled>
                  {selectedParent ? "زیردسته…" : "ابتدا دسته اصلی"}
                </option>
                {selectedParent?.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.nature === "non_cash" ? " (غیرنقدی)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedCategory?.description && (
              <p className="muted text-[length:var(--fs-xs)] leading-5">{selectedCategory.description}</p>
            )}
            {isNonCash && (
              <p className="soft rounded-[var(--r-sm)] p-2 text-[length:var(--fs-xs)] leading-5" role="note">
                ثبت غیرنقدی (استهلاک یا ذخیره) است؛ از هیچ حسابی پول خارج نمی‌شود.
              </p>
            )}
            {selectedParent && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => setShowNewCategory((v) => !v)} className="chip">
                  {showNewCategory ? "بستن" : "+ زیردسته جدید"}
                </button>
                {categoryMessage && <span className="text-[length:var(--fs-xs)]">{categoryMessage}</span>}
              </div>
            )}
            {showNewCategory && selectedParent && (
              <div className="flex gap-2">
                <input
                  className="field"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={`زیردسته جدید زیر «${selectedParent.name}»`}
                />
                <button
                  type="button"
                  onClick={handleCreateCategory}
                  disabled={!newCategoryName.trim()}
                  className="btn btn-soft shrink-0 disabled:opacity-40"
                >
                  افزودن
                </button>
              </div>
            )}
          </div>
        )}

        {type === "income" && (
          <AccountSelect label="منبع درآمد" value={incomeId} options={incomeOptions} onChange={setIncomeAccountId} />
        )}

        {type === "transfer" && (
          <div className="grid items-end gap-2 sm:grid-cols-[1fr_auto_1fr]">
            <AccountSelect label="از حساب" value={fromId} options={assetAccounts} onChange={setFromAccountId} />
            <button
              type="button"
              className="btn btn-ghost !min-h-11 justify-self-center"
              aria-label="جابه‌جایی مبدأ و مقصد"
              onClick={() => {
                setFromAccountId(toId);
                setToAccountId(fromId);
              }}
            >
              <Icon name="swap" size={16} />
            </button>
            <AccountSelect label="به حساب" value={toId} options={toOptions} onChange={setToAccountId} />
            {isCrossUnitTransfer && (
              <p
                className="rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5 sm:col-span-3"
                style={
                  swapSupported
                    ? { background: "var(--action-soft)" }
                    : { background: "var(--warning-soft)", border: "1px solid var(--warning)" }
                }
                role="note"
              >
                {swapSupported
                  ? `تبدیل ${currencyLabel(fromAccount?.symbol)} به ${currencyLabel(toAccount?.symbol)} — نه هزینه است و نه درآمد؛ فقط ترکیب دارایی‌ها تغییر می‌کند.`
                  : `تبدیل مستقیم ${currencyLabel(fromAccount?.symbol)} به ${currencyLabel(toAccount?.symbol)} پشتیبانی نمی‌شود؛ ابتدا به تومان، دلار یا تتر تبدیل کنید.`}
              </p>
            )}
          </div>
        )}

        {isTrade && (
          <div className="space-y-2">
            {assetAccount && !pickerOpen ? (
              <div className="soft flex items-center gap-3 rounded-[var(--r-md)] p-3">
                <AssetLogo
                  symbol={assetAccount.symbol}
                  name={assetName}
                  logoUrl={marketRow?.logoUrl ?? assetAccount.logoUrl ?? null}
                  coingeckoId={assetAccount.coingeckoId ?? null}
                  assetClassName={assetAccount.className ?? null}
                  size={36}
                  radius={10}
                />
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[length:var(--fs-sm)]">{assetName}</b>
                  <span className="muted text-[length:var(--fs-xs)]">
                    {marketRow?.priceTmn ? (
                      <>
                        قیمت بازار هر واحد: <span className="num">{formatMoney(marketRow.priceTmn, "IRT")}</span>
                      </>
                    ) : (
                      <span className="num" dir="ltr">{assetAccount.symbol}</span>
                    )}
                  </span>
                </div>
                <button type="button" className="btn btn-ghost !min-h-9 shrink-0" onClick={() => setPickerOpen(true)}>
                  تغییر
                </button>
              </div>
            ) : (
              <>
                {tradeOptions.length > 0 && !pickerOpen && (
                  <>
                    <p className="muted text-[length:var(--fs-xs)]">دارایی‌های شما:</p>
                    <div className="flex flex-wrap gap-2">
                      {tradeOptions.slice(0, 16).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="chip !py-1.5"
                          onClick={() => setAssetAccountId(a.id)}
                        >
                          <AssetLogo
                            symbol={a.symbol}
                            name={a.name}
                            logoUrl={a.logoUrl ?? null}
                            coingeckoId={a.coingeckoId ?? null}
                            assetClassName={a.className ?? null}
                            size={18}
                            radius={5}
                          />
                          {market.get((a.symbol ?? "").toUpperCase())?.displayName ?? a.name}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {pickerOpen || tradeOptions.length === 0 ? (
                  <>
                    <WallexAssetPicker
                      actionLabel="انتخاب"
                      hideFootnote
                      onRegistered={({ account, row }) => {
                        if (!account) return;
                        setAccountOptions((current) =>
                          current.some((a) => a.id === account.id) ? current : [...current, account],
                        );
                        setAssetAccountId(account.id);
                        setMarket((current) => (current.has(row.symbol) ? current : new Map(current).set(row.symbol, row)));
                        setPickerOpen(false);
                      }}
                    />
                    {tradeOptions.length > 0 && (
                      <button type="button" className="btn btn-ghost w-full" onClick={() => setPickerOpen(false)}>
                        بازگشت به دارایی‌های من
                      </button>
                    )}
                  </>
                ) : (
                  <button type="button" className="btn btn-soft w-full" onClick={() => setPickerOpen(true)}>
                    <Icon name="search" size={15} />
                    دارایی دیگر — جست‌وجو در بازار
                  </button>
                )}
              </>
            )}
          </div>
        )}

        {type === "debt_repayment" &&
          (debts.length === 0 ? (
            <p className="rounded-[var(--r-md)] px-3 py-2 text-[length:var(--fs-xs)]" style={{ background: "var(--negative-soft)", color: "var(--negative)" }}>
              هنوز بدهی یا قسطی ثبت نشده است.{" "}
              <a href="/debts" style={{ color: "inherit", textDecoration: "underline" }}>
                افزودن بدهی
              </a>
            </p>
          ) : selectedDebt ? (
            <div className="soft flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] p-3 text-[length:var(--fs-xs)]">
              <span>
                <b>{selectedDebt.title}</b>
                {selectedInst ? ` — قسط ${faCount(selectedInst.seq)}` : ""}
                <span className="muted">
                  {" "}
                  · {selectedDebt.accountId ? "از مانده بدهی کم می‌شود" : "در «پرداخت اقساط» ثبت می‌شود، نه در هزینه‌ها"}
                </span>
              </span>
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setSelectedDebt(null);
                  setSelectedInst(null);
                }}
              >
                تغییر
              </button>
            </div>
          ) : (
            <DebtInstallmentExplorer
              debts={debts}
              onSelectDebt={handleSelectDebt}
              onSelectInstallment={handleSelectInstallment}
              rate={effectiveRate}
            />
          ))}
      </Step>

      {/* ── ۲. How much ── */}
      <Step n={2} title="چقدر؟">
        <div>
          <label className="label">مبلغ به تومان</label>
          <AmountInput
            value={irtAmount}
            onValueChange={setIrtAmount}
            placeholder="مثلاً ۲۵٬۰۰۰٬۰۰۰"
            className="field num !text-2xl !font-bold"
            unit="toman"
            aria-label="مبلغ به تومان"
          />
          {hasAmount && (
            <p className="muted mt-1 text-[length:var(--fs-xs)]">
              {previewUsd ? (
                <>
                  معادل تقریبی <span className="num">{formatMoney(previewUsd, "USD")}</span>
                  {effectiveRate ? (
                    <>
                      {" "}
                      · نرخ <span className="num">{formatMoney(effectiveRate, "IRT")}</span>
                    </>
                  ) : null}
                </>
              ) : (
                <>
                  نرخ دلار ثبت نشده است؛ پیش از ثبت، نرخ را در{" "}
                  <a href="/settings" style={{ color: "var(--action)" }}>
                    تنظیمات
                  </a>{" "}
                  وارد کنید.
                </>
              )}
            </p>
          )}
        </div>

        {(isTrade || type === "transfer") && (
          <div>
            <label className="label">
              {isTrade ? `مقدار ${assetName || "دارایی"}` : "مقدار (اختیاری — اگر خالی بماند از مبلغ محاسبه می‌شود)"}
            </label>
            <AmountInput
              inputMode="decimal"
              maxDecimals={isTrade ? qtyDecimals : 8}
              value={quantity}
              onValueChange={setQuantity}
              placeholder="مثلاً ۰٫۰۵"
              className="field num"
              showWords={false}
              unit="none"
              aria-label="مقدار دارایی"
            />
            {isTrade && (
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[length:var(--fs-xs)]">
                {tradeUnitPrice && (
                  <span className="muted">
                    قیمت هر واحد در این معامله: <span className="num">{formatMoney(tradeUnitPrice.toFixed(0), "IRT")}</span>
                  </span>
                )}
                {marketPrice && hasQuantity && !hasAmount && (
                  <button type="button" className="chip" onClick={() => setIrtAmount(quantityValue!.mul(marketPrice).toFixed(0))}>
                    مبلغ از قیمت بازار
                  </button>
                )}
                {marketPrice && hasAmount && !hasQuantity && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setQuantity(trimQty(amountValue!.div(marketPrice).toFixed(qtyDecimals)))}
                  >
                    مقدار از قیمت بازار
                  </button>
                )}
                {!hasQuantity && !marketPrice && (
                  <span className="muted">اگر مقدار را وارد نکنید، از مبلغ و آخرین قیمت محاسبه می‌شود.</span>
                )}
              </div>
            )}
          </div>
        )}

        <details className="rounded-[var(--r-md)] border px-3 py-1" style={{ borderColor: "var(--border)" }}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-[length:var(--fs-sm)] font-medium marker:hidden [&::-webkit-details-marker]:hidden">
            کارمزد (اختیاری)
            <Icon name="chevronDown" size={15} className="muted" />
          </summary>
          <div className="border-t pb-3 pt-3" style={{ borderColor: "var(--border)" }}>
            <label className="label">{feeInToman ? "کارمزد به تومان" : `کارمزد به ${currencyLabel(feeSymbol)}`}</label>
            <AmountInput
              inputMode={feeInToman ? "numeric" : "decimal"}
              value={fee}
              onValueChange={setFee}
              className="field num"
              unit={feeInToman ? "toman" : feeSymbol}
              placeholder="۰"
            />
          </div>
        </details>
      </Step>

      {/* ── ۳. From where, and when ── */}
      <Step n={3} title={type === "income" || type === "sell" ? "به کجا و کی؟" : type === "transfer" ? "کی؟" : "از کجا و کی؟"}>
        {type !== "transfer" && !isNonCash && (
          <AccountSelect
            label={type === "income" || type === "sell" ? "واریز به حساب" : "پرداخت از حساب"}
            value={moneyId}
            options={moneyOptions}
            onChange={setMoneyAccountId}
            empty={noMoneyAccounts}
          />
        )}
        <DualDateInput name="entryDate" value={entryDate} onChange={setEntryDate} label="تاریخ" required />
        <div>
          <label className="label">شرح (اختیاری)</label>
          <input
            className="field"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={autoDescription}
          />
        </div>
      </Step>

      {/* ── Review, then confirm. Nothing is written before «تأیید و ثبت». ── */}
      {confirming && ready ? (
        <section className="card space-y-3 p-4" style={{ borderColor: "var(--action)" }} aria-live="polite">
          <h2 className="text-[length:var(--fs-sm)] font-bold" style={{ color: "var(--action)" }}>
            بررسی قبل از ثبت
          </h2>
          <dl className="divide-y text-[length:var(--fs-sm)]" style={{ borderColor: "var(--border)" }}>
            {summary.map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-3 py-2">
                <dt className="muted shrink-0">{label}</dt>
                <dd className="min-w-0 text-end">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="btn btn-ghost flex-1">
              ویرایش
            </button>
            <button type="submit" disabled={pending} className="btn btn-primary flex-1">
              {pending ? "در حال ثبت…" : "تأیید و ثبت"}
            </button>
          </div>
        </section>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            disabled={!ready}
            onClick={() => setConfirming(true)}
            className="btn btn-primary w-full disabled:opacity-40"
          >
            بررسی و ثبت
          </button>
          {!ready && (
            <p className="muted text-center text-[length:var(--fs-xs)]" role="status">
              باقی مانده: {missing.join("، ")}
            </p>
          )}
        </div>
      )}

      <FormStatus state={state} />
    </form>
  );
}
