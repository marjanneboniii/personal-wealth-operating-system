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
import {
  isStablecoin,
  isTomanOnlyInstrument,
  priceUnitFor,
  quoteTrade,
  registrySaleError,
  tradePairError,
  type PriceUnit,
} from "@/features/trade/rules";
import { DOMESTIC_EXCHANGE_NAMES, venueTradeError, venueTransferError } from "@/features/trade/venues";
import { AutomobileLogo, RealEstateLogo } from "@/components/ui/IranLogo";
import { jalaliDayOf } from "@/features/income/recurring";

/** A property or vehicle the user owns, sellable from «فروش دارایی». */
export type RegistrySaleOption = {
  kind: "property" | "vehicle";
  id: string;
  /** «ملک ۱» / «خودرو ۲» */
  label: string;
  detail: string;
  valueToman: string | null;
};

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
  /** `wallets.name` — the place the account is held in (بیت‌پین، ربی والت…). */
  walletName?: string | null;
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
  /** Assignment rule of the group, shown under the picker. */
  description?: string | null;
  children: CategoryChildOption[];
};

/** Icon per standard income group; user-made groups fall back to «layers». */
const INCOME_GROUP_ICON = {
  "INC-SAL": "wallet",
  "INC-BIZ": "trend-up",
  "INC-INV": "coins",
  "INC-PEN": "calendar",
  "INC-SUP": "home",
  "INC-OTH": "more",
} as const;

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

/** Cut (never round up) to `decimals` places — «همه» must not exceed the holding. */
function cutDecimals(value: string, decimals: number): string {
  const [int, frac = ""] = value.split(".");
  const cut = frac.slice(0, decimals).replace(/0+$/, "");
  return cut ? `${int}.${cut}` : int;
}

/** A unit price or total in the price unit: Toman whole, Tether to 6 places. */
function formatInUnit(value: string | null | undefined, unit: PriceUnit): string {
  if (!value) return "—";
  return unit === "IRT" ? formatMoney(D(value).toFixed(0), "IRT") : `${formatQty(value, 6)} تتر`;
}

type Props = {
  accounts: AccountOption[];
  /** Posted quantity per account id, in the account's own unit. */
  balances?: Record<string, string>;
  registryAssets?: RegistrySaleOption[];
  /** symbol → network families, synced from CoinGecko platform data */
  assetNetworks?: Record<string, string[]>;
  /** Income sources — the income category tree (never ledger accounts). */
  incomeCategories?: CategoryGroupOption[];
  /** Income category codes to offer first, from the user's occupations. */
  incomeSuggestions?: string[];
  /** Opened from a recurring-income reminder: its values, to edit before recording. */
  initialIncome?: { planId: string; categoryId: string; parentId: string; accountId: string; amount: string } | null;
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
  balances = {},
  registryAssets = [],
  assetNetworks = {},
  incomeCategories = [],
  incomeSuggestions = [],
  initialIncome = null,
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
  // Buy / sell: the market price, or a limit price the user types.
  const [priceMode, setPriceMode] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  // Sell: a property or vehicle («property:<id>»), sold for a Toman price.
  const [registryKey, setRegistryKey] = useState("");
  const [salePrice, setSalePrice] = useState("");
  // A Toman buy: the Iranian exchange it happens at.
  const [placeName, setPlaceName] = useState("");
  const [fee, setFee] = useState("");
  const [entryDate, setEntryDate] = useState(initialEntryDate ?? today);
  const [description, setDescription] = useState(initialDescription ?? initialTitle ?? "");

  // One selection per ROLE, not per ledger column: a bank account chosen to
  // pay an expense is still selected when the user switches to «خرید دارایی».
  const [moneyAccountId, setMoneyAccountId] = useState(initialIncome?.accountId ?? "");
  const [assetAccountId, setAssetAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  // Income: a SOURCE from the income category tree (never a ledger account), an
  // amount in the receiving account's own unit, and an optional monthly repeat.
  const [incomeGroups, setIncomeGroups] = useState<CategoryGroupOption[]>(incomeCategories);
  const [incomeParentId, setIncomeParentId] = useState(initialIncome?.parentId ?? "");
  const [incomeCategoryId, setIncomeCategoryId] = useState(initialIncome?.categoryId ?? "");
  const [incomeAmount, setIncomeAmount] = useState(initialIncome?.amount ?? "");
  const [recurring, setRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState(() => jalaliDayOf(initialEntryDate ?? today));
  const planId = initialIncome?.planId ?? "";

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
      setLimitPrice("");
      setRegistryKey("");
      setSalePrice("");
      setIncomeAmount("");
      setRecurring(false);
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
  const incomeParent = incomeGroups.find((g) => g.id === incomeParentId) ?? null;
  const incomeCategory = incomeParent?.children.find((c) => c.id === incomeCategoryId) ?? null;
  const suggestedIncome = incomeSuggestions.flatMap((code) =>
    incomeGroups.flatMap((g) => g.children.filter((c) => c.code === code).map((c) => ({ ...c, parentId: g.id }))),
  );
  const byId = (id: string) => accountOptions.find((a) => a.id === id);
  const balanceOf = (id: string | undefined) => {
    const raw = id ? balances[id] : undefined;
    return raw ? D(raw) : null;
  };
  // Only what is actually held can be sold.
  const chipOptions = type === "sell" ? tradeOptions.filter((a) => balanceOf(a.id)?.gt(0)) : tradeOptions;
  const registryItem =
    type === "sell" ? (registryAssets.find((r) => `${r.kind}:${r.id}` === registryKey) ?? null) : null;
  const isRegistrySale = !!registryItem;

  const fromId = resolve(fromAccountId, assetAccounts, false);
  // A transfer can never land in the account it left.
  const toOptions = assetAccounts.filter((a) => a.id !== fromId);
  // …nor in a wallet that does not support the coin's network.
  const transferSymbol = (byId(fromId)?.symbol ?? "").toUpperCase();
  const transferTargets = toOptions.filter((a) => !venueTransferError(transferSymbol, a, assetNetworks[transferSymbol]));
  const toId = resolve(toAccountId, transferTargets, false);
  const assetId = isRegistrySale ? "" : resolve(assetAccountId, type === "sell" ? chipOptions : tradeOptions, false);
  const assetAccount = byId(assetId);
  const assetInstrument = {
    symbol: assetAccount?.symbol,
    classCode: assetAccount?.classCode,
    className: assetAccount?.className,
  };
  // The money a trade may settle in — the same rule the server enforces:
  // Toman or a stablecoin, and a Toman BANK account for Iranian-market assets,
  // properties and vehicles. Accounts that do not qualify are simply not listed.
  const assetPlace = { walletName: assetAccount?.walletName, walletKind: assetAccount?.walletKind };
  // WHERE it trades: a bank pays at an Iranian exchange; a stablecoin pays only
  // where it is held, in the coins that place trades (see features/trade/venues).
  const venueAllows = (a: AccountOption) => {
    if (!isTrade || isTomanOnlyInstrument(assetInstrument)) return true;
    const side = type === "sell" ? "sell" : "buy";
    const target =
      side === "sell"
        ? assetPlace
        : priceUnitFor(a.symbol) === "IRT"
          ? { walletName: placeName || DOMESTIC_EXCHANGE_NAMES[0], walletKind: "exchange" }
          : { walletName: a.walletName, walletKind: a.walletKind };
    return !venueTradeError(
      side,
      { ...assetInstrument, place: assetPlace, networks: assetNetworks[(assetAccount?.symbol ?? "").toUpperCase()] },
      { symbol: a.symbol, walletKind: a.walletKind, walletName: a.walletName, name: a.name },
      target,
    );
  };
  const settleOptions = isRegistrySale
    ? moneyOptions.filter((a) => !registrySaleError(a))
    : isTrade && assetAccount
      ? moneyOptions.filter((a) => !tradePairError(type, assetInstrument, a) && venueAllows(a))
      : moneyOptions;
  const moneyId = resolve(moneyAccountId, isTrade ? settleOptions : moneyOptions);

  const moneyAccount = byId(moneyId);
  const fromAccount = byId(fromId);
  const toAccount = byId(toId);

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
      // The income account is resolved on the server from the chosen source.
      primaryAccountId = moneyId;
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
    // Trades need prices; an income into a Tether wallet needs the Tether rate.
    if (!(isTrade || type === "income") || market.size > 0) return;
    let alive = true;
    loadMarketCatalog().then((result) => {
      if (alive && result.ok) setMarket(new Map(result.rows.map((row) => [row.symbol, row])));
    });
    return () => {
      alive = false;
    };
  }, [isTrade, type, market.size]);

  const marketRow = assetAccount?.symbol ? market.get(assetAccount.symbol.toUpperCase()) : undefined;
  const assetName = marketRow?.displayName ?? assetAccount?.name ?? "";
  const assetSymbol = (assetAccount?.symbol ?? "").toUpperCase();
  const amountValue = irtAmount ? D(irtAmount) : null;
  const quantityValue = quantity ? D(quantity) : null;
  const hasQuantity = !!quantityValue && quantityValue.gt(0);
  const qtyDecimals = Math.min(Math.max(assetAccount?.decimals ?? 8, 0), 8);
  const heldQty = balanceOf(assetId);

  /* ── Trade price: in the settlement unit (Toman, or Tether for a stablecoin wallet) ── */
  const priceUnit = priceUnitFor(moneyAccount?.symbol);
  const priceUnitLabel = priceUnit === "IRT" ? "تومان" : "تتر";
  // A coin bought with Toman is bought — and held — at an Iranian exchange.
  const needsPlace =
    type === "buy" &&
    !isRegistrySale &&
    !!assetAccount &&
    !!moneyAccount &&
    priceUnit === "IRT" &&
    !isTomanOnlyInstrument(assetInstrument) &&
    !isStablecoin(assetSymbol);
  const usdtToman = market.get("USDT")?.priceTmn ?? effectiveRate ?? null;
  const marketUnitPrice = !assetAccount
    ? null
    : priceUnit === "USDT" && isStablecoin(assetSymbol)
      ? "1"
      : priceUnit === "IRT"
        ? (marketRow?.priceTmn ?? null)
        : (marketRow?.priceUsdt ?? null);
  const usingMarket = priceMode === "market" && !!marketUnitPrice;
  const unitPrice = usingMarket ? (marketUnitPrice ?? "") : limitPrice;
  const quote = isTrade && hasQuantity && unitPrice ? quoteTrade({ quantity, unitPrice, priceUnit, usdtToman }) : null;
  const overHeld = type === "sell" && hasQuantity && !!heldQty && quantityValue!.gt(heldQty);
  // A trade's Toman amount is DERIVED from quantity × price; it is never typed.
  const salePriceValue = salePrice ? D(salePrice) : null;
  // Income is typed in the receiving account's unit; its Toman value is derived for the preview.
  const incomeSymbol = (type === "income" ? (moneyAccount?.symbol ?? "IRT") : "IRT").toUpperCase();
  const incomeIsToman = incomeSymbol === "IRT" || incomeSymbol === "IRR";
  const incomeValue = incomeAmount ? D(incomeAmount) : null;
  const incomeToman =
    !incomeValue || incomeValue.lte(0)
      ? ""
      : incomeIsToman
        ? (incomeSymbol === "IRR" ? incomeValue.div(10) : incomeValue).toFixed(0)
        : incomeSymbol === "USDT" && usdtToman
          ? incomeValue.mul(usdtToman).toFixed(0)
          : effectiveRate
            ? incomeValue.mul(effectiveRate).toFixed(0)
            : "";
  const postedIrt = isRegistrySale
    ? salePrice
    : isTrade
      ? quote
        ? D(quote.totalToman).toFixed(0)
        : ""
      : type === "income"
        ? incomeToman
        : irtAmount;
  const hasAmount = isRegistrySale
    ? !!salePriceValue && salePriceValue.gt(0)
    : isTrade
      ? !!quote
      : type === "income"
        ? !!incomeToman
        : !!amountValue && amountValue.gt(0);
  const settleTotalLabel = quote
    ? priceUnit === "IRT"
      ? formatMoney(D(quote.total).toFixed(0), "IRT")
      : `${formatQty(quote.total, 6)} ${currencyLabel(moneyAccount?.symbol)}`
    : "—";
  const qtyWithUnit = hasQuantity ? `${formatQty(quantity, qtyDecimals)} ${currencyLabel(assetSymbol)}` : "—";

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

  const previewUsd = hasAmount && effectiveRate ? D(postedIrt).div(effectiveRate).toFixed(2) : "";

  /* ── Description, filled in from what was chosen ──────────────────── */
  const autoDescription = (() => {
    switch (type) {
      case "expense":
        return selectedCategory ? `هزینه — ${selectedCategory.name}` : "هزینه";
      case "income":
        return incomeCategory ? `درآمد — ${incomeCategory.name}` : "درآمد";
      case "transfer":
        return fromAccount && toAccount ? `انتقال از ${fromAccount.name} به ${toAccount.name}` : "انتقال بین حساب‌ها";
      case "buy":
        return assetName ? `خرید ${hasQuantity ? `${formatQty(quantity, qtyDecimals)} ` : ""}${assetName}` : "خرید دارایی";
      case "sell":
        if (registryItem) return `فروش ${registryItem.label} — ${registryItem.detail}`;
        return assetName ? `فروش ${hasQuantity ? `${formatQty(quantity, qtyDecimals)} ` : ""}${assetName}` : "فروش دارایی";
      case "debt_repayment":
        if (selectedDebt && selectedInst) return `پرداخت قسط ${faCount(selectedInst.seq)} — ${selectedDebt.title}`;
        return selectedDebt ? `بازپرداخت بدهی — ${selectedDebt.title}` : "بازپرداخت بدهی";
    }
  })();
  const finalDescription = description.trim() || autoDescription;

  /* ── What is still missing — said by name ─────────────────────────── */
  const missing: string[] = [];
  if (type === "debt_repayment" && !selectedDebt) missing.push("بدهی یا قسط");
  if (isTrade && !assetId && !isRegistrySale) missing.push("دارایی");
  if (type === "expense" && !categoryId) missing.push("دسته هزینه");
  if (type === "income" && !incomeCategoryId) missing.push("منبع درآمد");
  if (type === "transfer" && !fromId) missing.push("حساب مبدأ");
  if (type === "transfer" && !toId) missing.push("حساب مقصد");
  if (type !== "transfer" && !isNonCash && !moneyId) {
    missing.push(isRegistrySale ? "حساب بانکی واریز" : type === "income" || type === "sell" ? "حساب واریز" : "حساب پرداخت");
  }
  if (isRegistrySale) {
    if (!hasAmount) missing.push("مبلغ فروش");
  } else if (isTrade) {
    if (!hasQuantity) missing.push("مقدار");
    else if (!unitPrice) missing.push("قیمت هر واحد");
    else if (!quote) missing.push("نرخ تتر");
    if (overHeld) missing.push("مقدار کمتر یا برابر موجودی");
    if (needsPlace && !placeName) missing.push("صرافی محل خرید");
  } else if (!hasAmount) missing.push("مبلغ");
  if (!entryDate) missing.push("تاریخ");
  const ready = missing.length === 0;

  /* ── Handlers ─────────────────────────────────────────────────────── */
  const pickType = (key: TxType) => {
    setType(key);
    setConfirming(false);
    setPickerOpen(false);
  };

  const handleCreateCategory = async () => {
    const forIncome = type === "income";
    const parentId = forIncome ? incomeParentId : categoryParentId;
    if (!parentId || !newCategoryName.trim()) return;
    const res = await createCategoryAction({ name: newCategoryName.trim(), parentId });
    if (!res.ok) {
      setCategoryMessage(res.message);
      return;
    }
    setCategoryMessage("");
    const created = newCategoryName.trim();
    setNewCategoryName("");
    setShowNewCategory(false);
    const addLeaf = (current: CategoryGroupOption[]) =>
      current.map((g) =>
        g.id === parentId && res.id
          ? { ...g, children: [...g.children, { id: res.id, code: "", name: created, nature: "cash", description: null }] }
          : g,
      );
    if (forIncome) {
      setIncomeGroups(addLeaf);
      if (res.id) setIncomeCategoryId(res.id);
    } else {
      setCategoryGroups(addLeaf);
      if (res.id) setCategoryId(res.id);
    }
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
  const summary: Array<[string, React.ReactNode]> = [["نوع", TYPES.find((t) => t.key === type)?.label]];
  if (!isTrade) {
    summary.push([
      "مبلغ",
      <>
        <b className="num">
          {!hasAmount
            ? "—"
            : type === "income" && !incomeIsToman
              ? `${formatQty(incomeAmount, 6)} ${currencyLabel(incomeSymbol)}`
              : formatMoney(postedIrt, "IRT")}
        </b>
        {previewUsd ? <span className="muted num"> ≈ {formatMoney(previewUsd, "USD")}</span> : null}
      </>,
    ]);
  }
  if (type === "expense") {
    summary.push(["دسته", selectedParent && selectedCategory ? `${selectedParent.name} › ${selectedCategory.name}` : "—"]);
  }
  if (type === "income") {
    summary.push(["منبع درآمد", incomeParent && incomeCategory ? `${incomeParent.name} › ${incomeCategory.name}` : "—"]);
    if (planId) summary.push(["یادآوری ماهانه", "این ماه ثبت می‌شود و ماه بعد دوباره یادآوری می‌شود"]);
    else if (recurring) summary.push(["تکرار", `هر ماه، روز ${faCount(recurringDay)}`]);
  }
  if (registryItem) {
    summary.push(
      ["دارایی", `${registryItem.label} — ${registryItem.detail}`],
      ["کم می‌شود از دارایی‌ها", <b key="ro" className="num" style={{ color: "var(--negative)" }}>− {registryItem.label}</b>],
      [
        `واریز می‌شود به ${accountLabel(moneyAccount)}`,
        <b key="ri" className="num" style={{ color: "var(--positive)" }}>
          + {hasAmount ? formatMoney(salePrice, "IRT") : "—"}
        </b>,
      ],
    );
  } else if (isTrade) {
    summary.push([
      "دارایی",
      <span key="a">
        {assetName || "—"} {assetSymbol ? <span className="muted num" dir="ltr">{assetSymbol}</span> : null}
      </span>,
    ]);
    const outRow: [string, React.ReactNode] =
      type === "buy"
        ? [`کم می‌شود از ${accountLabel(moneyAccount)}`, <b key="o" className="num" style={{ color: "var(--negative)" }}>− {settleTotalLabel}</b>]
        : [`کم می‌شود از ${assetName || "دارایی"}`, <b key="o" className="num" style={{ color: "var(--negative)" }}>− {qtyWithUnit}</b>];
    const inRow: [string, React.ReactNode] =
      type === "buy"
        ? [`اضافه می‌شود به ${assetName || "دارایی"}`, <b key="i" className="num" style={{ color: "var(--positive)" }}>+ {qtyWithUnit}</b>]
        : [`واریز می‌شود به ${accountLabel(moneyAccount)}`, <b key="i" className="num" style={{ color: "var(--positive)" }}>+ {settleTotalLabel}</b>];
    summary.push(outRow, inRow);
    if (needsPlace && placeName) summary.push(["محل خرید و نگهداری", placeName]);
    if (quote) {
      summary.push(
        [
          "قیمت هر واحد",
          <span key="u" className="num">
            {formatInUnit(quote.unitToman, "IRT")}
            {quote.unitUsdt ? ` · ${formatInUnit(quote.unitUsdt, "USDT")}` : ""}
          </span>,
        ],
        [
          "ارزش کل",
          <span key="t" className="num">
            {formatInUnit(quote.totalToman, "IRT")}
            {quote.totalUsdt ? ` · ${formatInUnit(quote.totalUsdt, "USDT")}` : ""}
          </span>,
        ],
        ["نوع قیمت", usingMarket ? "قیمت بازار" : "قیمت لیمیت (دلخواه)"],
      );
    }
  }
  if (type === "transfer") {
    summary.push(["از", accountLabel(fromAccount)], ["به", accountLabel(toAccount)]);
    if (hasQuantity) summary.push(["مقدار", <span key="tq" className="num">{formatQty(quantity, 8)}</span>]);
  } else if (!isNonCash && !isTrade) {
    summary.push([type === "income" ? "واریز به" : "پرداخت از", accountLabel(moneyAccount)]);
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
      <input type="hidden" name="irtAmount" value={postedIrt} />
      <input type="hidden" name="settleQuantity" value={isRegistrySale ? salePrice : isTrade && quote ? quote.total : ""} />
      <input type="hidden" name="unitPrice" value={isTrade && !isRegistrySale ? unitPrice : ""} />
      <input type="hidden" name="priceMode" value={isTrade && !isRegistrySale ? (usingMarket ? "market" : "limit") : ""} />
      <input type="hidden" name="registryKind" value={registryItem?.kind ?? ""} />
      <input type="hidden" name="registryId" value={registryItem?.id ?? ""} />
      <input type="hidden" name="placeName" value={needsPlace ? placeName : ""} />
      <input type="hidden" name="amount" value={previewUsd} />
      <input type="hidden" name="categoryId" value={type === "expense" ? categoryId : type === "income" ? incomeCategoryId : ""} />
      <input type="hidden" name="nativeAmount" value={type === "income" ? incomeAmount : ""} />
      <input type="hidden" name="recurring" value={type === "income" && recurring && !planId ? "monthly" : ""} />
      <input type="hidden" name="recurringDay" value={type === "income" && recurring ? String(recurringDay) : ""} />
      <input type="hidden" name="planId" value={type === "income" ? planId : ""} />
      <input type="hidden" name="primaryAccountId" value={primaryAccountId} />
      <input type="hidden" name="counterAccountId" value={counterAccountId} />
      <input type="hidden" name="quantity" value={(isTrade && !isRegistrySale) || type === "transfer" ? quantity : ""} />
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
          <div className="space-y-3">
            {suggestedIncome.length > 0 && (
              <div className="space-y-1.5">
                <p className="muted text-[length:var(--fs-xs)]">پرکاربرد برای شما</p>
                <div className="flex flex-wrap gap-2">
                  {suggestedIncome.map((c) => {
                    const on = incomeCategoryId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className="chip !py-1.5"
                        aria-pressed={on}
                        style={on ? { borderColor: "var(--action)", background: "var(--action-soft)", color: "var(--action)" } : undefined}
                        onClick={() => {
                          setIncomeParentId(c.parentId);
                          setIncomeCategoryId(c.id);
                          setShowNewCategory(false);
                        }}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step A — the kind of income, as cards: name, icon and what it covers. */}
            <div className="space-y-1.5">
              <p className="muted text-[length:var(--fs-xs)]">نوع درآمد</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="گروه درآمد">
                {incomeGroups.map((g) => {
                  const on = incomeParentId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => {
                        if (on) return;
                        setIncomeParentId(g.id);
                        setIncomeCategoryId("");
                        setShowNewCategory(false);
                      }}
                      className="flex min-h-[4.75rem] flex-col items-start gap-1 rounded-[var(--r-md)] border p-2.5 text-right"
                      style={{
                        borderColor: on ? "var(--action)" : "var(--border)",
                        background: on ? "var(--action-soft)" : "var(--surface)",
                        touchAction: "manipulation",
                      }}
                    >
                      <span className="flex items-center gap-1.5 text-[length:var(--fs-sm)] font-semibold" style={on ? { color: "var(--action)" } : undefined}>
                        <Icon name={INCOME_GROUP_ICON[g.code as keyof typeof INCOME_GROUP_ICON] ?? "layers"} size={16} />
                        {g.name}
                      </span>
                      <span className="muted line-clamp-2 text-[length:var(--fs-xs)] leading-5">
                        {g.children.slice(0, 3).map((c) => c.name).join("، ")}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Step B — the exact source inside the chosen kind. */}
            {incomeParent && (
              <div className="soft space-y-2.5 rounded-[var(--r-md)] p-3">
                <p className="text-[length:var(--fs-xs)] font-semibold">از کدام منبع «{incomeParent.name}»؟</p>
                {incomeParent.description && (
                  <p className="muted text-[length:var(--fs-xs)] leading-5">{incomeParent.description}</p>
                )}
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="منبع درآمد">
                  {incomeParent.children.map((c) => {
                    const on = incomeCategoryId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className="chip !py-1.5"
                        style={on ? { borderColor: "var(--action)", background: "var(--action-soft)", color: "var(--action)" } : undefined}
                        onClick={() => setIncomeCategoryId(c.id)}
                      >
                        {on && <Icon name="check" size={12} />}
                        {c.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setShowNewCategory((v) => !v)}
                    className="chip !py-1.5"
                    style={{ borderStyle: "dashed" }}
                  >
                    {showNewCategory ? "بستن" : "+ منبع دیگر"}
                  </button>
                </div>
                {incomeCategory?.description && (
                  <p className="muted text-[length:var(--fs-xs)] leading-5">{incomeCategory.description}</p>
                )}
                {categoryMessage && <p className="text-[length:var(--fs-xs)]">{categoryMessage}</p>}
                {showNewCategory && (
                  <div className="flex gap-2">
                    <input
                      className="field"
                      value={newCategoryName}
                      onChange={(e) => setNewCategoryName(e.target.value)}
                      placeholder={`نام منبع جدید در «${incomeParent.name}»`}
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

            <details className="text-[length:var(--fs-xs)]">
              <summary className="muted cursor-pointer">چه چیزی درآمد حساب نمی‌شود؟</summary>
              <ul className="muted mt-1.5 list-disc space-y-1 pr-5 leading-5">
                <li>جابه‌جایی پول بین حساب‌های خودتان — از «انتقال» استفاده کنید.</li>
                <li>وامی که گرفته‌اید یا طلبی که پس گرفته‌اید.</li>
                <li>سود فروش سهام، طلا، رمزارز، ملک یا خودرو — هنگام «فروش دارایی» خودکار محاسبه می‌شود.</li>
                <li>پول برگشتی یک خرید — هزینه را کم می‌کند.</li>
              </ul>
            </details>
          </div>
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
            <AccountSelect label="به حساب" value={toId} options={transferTargets} onChange={setToAccountId} />
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
            {registryItem ? (
              <div className="soft flex items-center gap-3 rounded-[var(--r-md)] p-3">
                {registryItem.kind === "property" ? <RealEstateLogo size={36} /> : <AutomobileLogo name={registryItem.detail} size={36} />}
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[length:var(--fs-sm)]">{registryItem.label}</b>
                  <span className="muted block truncate text-[length:var(--fs-xs)]">{registryItem.detail}</span>
                </div>
                <button type="button" className="btn btn-ghost !min-h-9 shrink-0" onClick={() => setRegistryKey("")}>
                  تغییر
                </button>
              </div>
            ) : assetAccount && !pickerOpen ? (
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
                  <b className="flex min-w-0 items-baseline gap-1.5 text-[length:var(--fs-sm)]">
                    <span className="truncate">{assetName}</span>
                    <span className="muted num shrink-0 text-[length:var(--fs-xs)] font-medium" dir="ltr">
                      {assetSymbol}
                    </span>
                  </b>
                  <span className="muted block text-[length:var(--fs-xs)]">
                    موجودی شما: <span className="num">{heldQty ? formatQty(heldQty.toString(), qtyDecimals) : "۰"}</span>
                  </span>
                  {(marketRow?.priceTmn || marketRow?.priceUsdt) && (
                    <span className="muted block text-[length:var(--fs-xs)]">
                      قیمت بازار: <span className="num">{marketRow?.priceTmn ? formatInUnit(marketRow.priceTmn, "IRT") : "—"}</span>
                      {marketRow?.priceUsdt ? <span className="num"> · {formatInUnit(marketRow.priceUsdt, "USDT")}</span> : null}
                    </span>
                  )}
                </div>
                <button type="button" className="btn btn-ghost !min-h-9 shrink-0" onClick={() => setPickerOpen(true)}>
                  تغییر
                </button>
              </div>
            ) : (
              <>
                {chipOptions.length > 0 && !pickerOpen && (
                  <>
                    <p className="muted text-[length:var(--fs-xs)]">دارایی‌های شما:</p>
                    <div className="flex flex-wrap gap-2">
                      {chipOptions.slice(0, 24).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className="chip !py-1.5"
                          onClick={() => {
                            setAssetAccountId(a.id);
                            setRegistryKey("");
                          }}
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
                          <span className="muted num text-[length:var(--fs-xs)]" dir="ltr">
                            {a.symbol}
                          </span>
                          {balanceOf(a.id)?.gt(0) && (
                            <span className="num text-[length:var(--fs-xs)]">
                              {formatQty(balanceOf(a.id)!.toString(), Math.min(Math.max(a.decimals, 0), 8))}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {type === "buy" && !pickerOpen && (
                  <div className="flex flex-wrap gap-2">
                    <a href="/asset-registry" className="chip !py-1.5">
                      <RealEstateLogo size={18} />
                      خرید ملک
                    </a>
                    <a href="/asset-registry" className="chip !py-1.5">
                      <AutomobileLogo size={18} />
                      خرید خودرو
                    </a>
                  </div>
                )}
                {type === "sell" && registryAssets.length > 0 && (
                  <>
                    <p className="muted text-[length:var(--fs-xs)]">ملک و خودرو:</p>
                    <div className="flex flex-wrap gap-2">
                      {registryAssets.map((r) => (
                        <button
                          key={`${r.kind}:${r.id}`}
                          type="button"
                          className="chip !py-1.5"
                          onClick={() => {
                            setRegistryKey(`${r.kind}:${r.id}`);
                            setAssetAccountId("");
                          }}
                        >
                          {r.kind === "property" ? <RealEstateLogo size={18} /> : <AutomobileLogo name={r.detail} size={18} />}
                          {r.label}
                          <span className="muted text-[length:var(--fs-xs)]">{r.detail}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {type === "sell" ? (
                  chipOptions.length === 0 && registryAssets.length === 0 ? (
                    <p className="soft rounded-[var(--r-md)] p-3 text-[length:var(--fs-xs)] leading-5" role="note">
                      هنوز دارایی‌ای برای فروش ثبت نشده است.
                    </p>
                  ) : null
                ) : pickerOpen || chipOptions.length === 0 ? (
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
                    {chipOptions.length > 0 && (
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
      <Step
        n={2}
        title={
          isRegistrySale
            ? "به چه مبلغ و به کدام حساب بانکی؟"
            : isTrade
              ? type === "buy"
                ? "چه مقدار، با چه پولی و چه قیمتی؟"
                : "چه مقدار، به کجا و با چه قیمتی؟"
              : "چقدر؟"
        }
      >
        {registryItem ? (
          <div className="space-y-3">
            <AccountSelect
              label="واریز به حساب بانکی"
              value={moneyId}
              options={settleOptions}
              onChange={setMoneyAccountId}
              empty={
                <p className="muted mt-1.5 text-[length:var(--fs-xs)] leading-5">
                  حساب بانکی تومانی ثبت نشده است.{" "}
                  <a href="/accounts" style={{ color: "var(--action)" }}>
                    افزودن حساب بانکی
                  </a>
                </p>
              }
            />
            <div>
              <label className="label">مبلغ فروش به تومان</label>
              <AmountInput
                value={salePrice}
                onValueChange={setSalePrice}
                placeholder="مثلاً ۴٬۵۰۰٬۰۰۰٬۰۰۰"
                className="field num !text-2xl !font-bold"
                unit="toman"
                aria-label="مبلغ فروش به تومان"
              />
              {registryItem.valueToman && D(registryItem.valueToman).gt(0) && (
                <button
                  type="button"
                  className="chip mt-1.5"
                  onClick={() => setSalePrice(D(registryItem.valueToman!).toFixed(0))}
                >
                  آخرین ارزش ثبت‌شده: <span className="num">{formatMoney(D(registryItem.valueToman).toFixed(0), "IRT")}</span>
                </button>
              )}
            </div>
          </div>
        ) : isTrade ? (
          <div className="space-y-3">
            <AccountSelect
              label={type === "buy" ? "پرداخت با" : "واریز وجه فروش به"}
              value={moneyId}
              options={settleOptions}
              onChange={(id) => {
                setMoneyAccountId(id);
                // A limit price is typed in the settlement unit; a new unit needs a new price.
                setLimitPrice("");
              }}
              empty={noMoneyAccounts}
            />

            {needsPlace && (
              <div>
                <label className="label">خرید در صرافی</label>
                <select className="field" value={placeName} onChange={(e) => setPlaceName(e.target.value)}>
                  <option value="" disabled>
                    انتخاب صرافی…
                  </option>
                  {DOMESTIC_EXCHANGE_NAMES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <label className="label">
                  مقدار {assetName || "دارایی"}
                  {assetSymbol ? ` (${assetSymbol})` : ""}
                </label>
                {assetAccount && (
                  <span className="muted text-[length:var(--fs-xs)]">
                    موجودی: <span className="num">{heldQty ? formatQty(heldQty.toString(), qtyDecimals) : "۰"}</span>
                  </span>
                )}
              </div>
              <AmountInput
                inputMode="decimal"
                maxDecimals={qtyDecimals}
                value={quantity}
                onValueChange={setQuantity}
                placeholder="مثلاً ۰٫۵"
                className="field num !text-2xl !font-bold"
                showWords={false}
                unit="none"
                aria-label="مقدار دارایی"
              />
              {type === "sell" && heldQty?.gt(0) && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {(
                    [
                      ["۲۵٪", "0.25"],
                      ["۵۰٪", "0.5"],
                      ["همه", "1"],
                    ] as const
                  ).map(([label, share]) => (
                    <button
                      key={share}
                      type="button"
                      className="chip"
                      onClick={() => setQuantity(cutDecimals(heldQty.mul(share).toString(), qtyDecimals))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {overHeld && (
                <p className="mt-1 text-[length:var(--fs-xs)]" style={{ color: "var(--negative)" }} role="alert">
                  مقدار واردشده از موجودی شما بیشتر است.
                </p>
              )}
            </div>

            <div>
              <span className="label">قیمت</span>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="نوع قیمت">
                {(
                  [
                    ["market", "قیمت بازار"],
                    ["limit", "قیمت لیمیت"],
                  ] as const
                ).map(([key, label]) => {
                  const on = key === "market" ? usingMarket : !usingMarket;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      disabled={key === "market" && !marketUnitPrice}
                      onClick={() => setPriceMode(key)}
                      className="btn !min-h-10 disabled:opacity-40"
                      style={{
                        borderColor: on ? "var(--action)" : "var(--border)",
                        background: on ? "var(--action-soft)" : "var(--surface)",
                        color: on ? "var(--action)" : "inherit",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
              {usingMarket ? (
                <p className="muted mt-1.5 text-[length:var(--fs-xs)]">
                  قیمت بازار هر واحد: <span className="num">{formatInUnit(marketUnitPrice, priceUnit)}</span>
                </p>
              ) : (
                <div className="mt-2">
                  <label className="label">قیمت هر واحد به {priceUnitLabel}</label>
                  <AmountInput
                    inputMode="decimal"
                    maxDecimals={priceUnit === "IRT" ? 0 : 6}
                    value={limitPrice}
                    onValueChange={setLimitPrice}
                    placeholder={marketUnitPrice ? formatInUnit(marketUnitPrice, priceUnit) : priceUnit === "IRT" ? "مثلاً ۱۲۰٬۰۰۰" : "مثلاً ۳٬۲۰۰"}
                    className="field num"
                    unit={priceUnit === "IRT" ? "toman" : "USDT"}
                    aria-label="قیمت لیمیت هر واحد"
                  />
                  {!marketUnitPrice && assetAccount && (
                    <p className="muted mt-1 text-[length:var(--fs-xs)]">قیمت بازار این دارایی در دسترس نیست؛ قیمت هر واحد را وارد کنید.</p>
                  )}
                </div>
              )}
            </div>

            {quote && (
              <dl className="soft space-y-1.5 rounded-[var(--r-md)] p-3 text-[length:var(--fs-xs)]" aria-live="polite">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="muted">{type === "buy" ? "از حساب کم می‌شود" : "به حساب واریز می‌شود"}</dt>
                  <dd className="num text-[length:var(--fs-sm)] font-bold">{settleTotalLabel}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="muted">ارزش کل</dt>
                  <dd className="num">
                    {formatInUnit(quote.totalToman, "IRT")}
                    {quote.totalUsdt ? ` · ${formatInUnit(quote.totalUsdt, "USDT")}` : ""}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="muted">قیمت هر واحد</dt>
                  <dd className="num">
                    {formatInUnit(quote.unitToman, "IRT")}
                    {quote.unitUsdt ? ` · ${formatInUnit(quote.unitUsdt, "USDT")}` : ""}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        ) : type === "income" ? (
          <div className="space-y-3">
            <AccountSelect label="واریز به حساب" value={moneyId} options={moneyOptions} onChange={setMoneyAccountId} empty={noMoneyAccounts} />
            <div>
              <label className="label">
                {incomeCategory?.code?.startsWith("INC-SAL") ? "خالص دریافتی" : "مبلغ دریافتی"}
                {moneyAccount ? ` به ${incomeIsToman ? "تومان" : currencyLabel(incomeSymbol)}` : ""}
              </label>
              <AmountInput
                inputMode={incomeIsToman ? "numeric" : "decimal"}
                maxDecimals={incomeIsToman ? 0 : 6}
                value={incomeAmount}
                onValueChange={setIncomeAmount}
                placeholder={incomeIsToman ? "مثلاً ۴۵٬۰۰۰٬۰۰۰" : "مثلاً ۲۵۰"}
                className="field num !text-2xl !font-bold"
                unit={incomeIsToman ? "toman" : incomeSymbol}
                aria-label="مبلغ دریافتی"
              />
              {hasAmount && !incomeIsToman && (
                <p className="muted mt-1 text-[length:var(--fs-xs)]">
                  معادل تقریبی <span className="num">{formatMoney(postedIrt, "IRT")}</span>
                </p>
              )}
            </div>
            {planId ? (
              <p className="soft rounded-[var(--r-md)] p-2 text-[length:var(--fs-xs)] leading-5" role="note">
                ثبت یادآوری ماهانه — مبلغ را اگر تغییر کرده اصلاح کنید؛ ماه بعد با همین مبلغ یادآوری می‌شود.
              </p>
            ) : (
              <div className="space-y-2">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 text-[length:var(--fs-sm)]">
                  <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
                  این درآمد هر ماه تکرار می‌شود
                </label>
                {recurring && (
                  <div>
                    <label className="label">روز واریز در ماه</label>
                    <select className="field" value={recurringDay} onChange={(e) => setRecurringDay(Number(e.target.value))}>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                        <option key={day} value={day}>
                          {faCount(day)}
                        </option>
                      ))}
                    </select>
                    <p className="muted mt-1 text-[length:var(--fs-xs)] leading-5">
                      هر ماه در همین روز در «نمای کلی» یادآوری می‌شود تا با یک لمس ثبت کنید. هیچ مبلغی بدون تأیید شما ثبت نمی‌شود.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
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
        )}

        {type === "transfer" && (
          <div>
            <label className="label">مقدار (اختیاری — اگر خالی بماند از مبلغ محاسبه می‌شود)</label>
            <AmountInput
              inputMode="decimal"
              maxDecimals={8}
              value={quantity}
              onValueChange={setQuantity}
              placeholder="مثلاً ۰٫۰۵"
              className="field num"
              showWords={false}
              unit="none"
              aria-label="مقدار دارایی"
            />
          </div>
        )}

        {!isRegistrySale && (
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
        )}
      </Step>

      {/* ── ۳. From where, and when ── */}
      <Step n={3} title={isTrade || type === "transfer" || type === "income" ? "کی؟" : "از کجا و کی؟"}>
        {type !== "transfer" && !isNonCash && !isTrade && type !== "income" && (
          <AccountSelect
            label="پرداخت از حساب"
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
          {isTrade && (
            <p className="muted text-[length:var(--fs-xs)] leading-5">
              پیش‌نمایش معامله — پس از تأیید، موجودی‌ها مطابق ردیف‌های زیر تغییر می‌کنند و مقدار، قیمت تومانی و تتری در تاریخچه فریز می‌شود.
            </p>
          )}
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
