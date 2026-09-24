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
import TagInput from "@/components/transactions/TagInput";
import { parseTags } from "@/features/tags/normalize";
import { createTransactionAction, createCategoryAction, createTransferDestinationAction, type ActionResult } from "@/app/actions";
import { KNOWN_WALLETS } from "@/features/setup/holdingWallets";
import { currencyLabel, faCount, formatMoney, formatQty, getDualDate } from "@/lib/format";
import { useLatestRate } from "@/components/ui/SmartPreview";
import DualDateInput from "@/components/ui/DualDateInput";
import AmountInput from "@/components/ui/AmountInput";
import Icon, { type IconName } from "@/components/ui/Icon";
import { loadMarketCatalog } from "@/components/assets/marketCatalogClient";
import DebtRepaymentFields, { type DebtOption } from "./DebtRepaymentFields";
import ExpenseFields from "./ExpenseFields";
import TradeFields from "./TradeFields";
import TransferFields from "./TransferFields";
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
import { sameWallet, transferDestinationError, venueTradeError } from "@/features/trade/venues";
import { networksForHolding } from "@/features/trade/networks";
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
  /** Expense categories the user reaches for most, most used first. */
  expenseRecentCategoryIds?: string[];
  /** The user's hashtags, most used first. */
  tagSuggestions?: string[];
  /** Recording this pending cheque as cleared (دفتر چک). */
  cheque?: { id: string; direction: "issued" | "received"; counterparty: string; amountToman: string; accountId: string | null } | null;
  /** The account that paid the user's latest expense — pre-selected. */
  lastExpenseAccountId?: string | null;
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
  /** Pre-selected money account (a missed transaction found by «تطبیق با بانک»). */
  initialAccountId?: string;
  /** The user's cars and properties, and the tag each one's costs (and a property's rent) are recorded under. */
  assetTags?: { label: string; tag: string; kind: "vehicle" | "property" }[];
  /**
   * Values to start from — an insurance premium reminder (its occurrence to
   * close, its insurance category or the policy's savings account), a repeated
   * transaction or a saved shortcut. Everything stays editable before recording.
   */
  prefill?: {
    planId?: string | null;
    categoryId: string | null;
    parentId: string | null;
    toAccountId: string | null;
    tags?: string;
  } | null;
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
  expenseRecentCategoryIds = [],
  tagSuggestions = [],
  cheque = null,
  lastExpenseAccountId = null,
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
  initialAccountId,
  prefill = null,
  assetTags = [],
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
  const [fee, setFee] = useState("");
  const [entryDate, setEntryDate] = useState(initialEntryDate ?? today);
  const [description, setDescription] = useState(initialDescription ?? initialTitle ?? "");
  // Kept after a save: a trip is usually several expenses in a row.
  const [tagsText, setTagsText] = useState(prefill?.tags ?? "");
  // The cheque link is spent by the first successful save.
  const [chequeOpen, setChequeOpen] = useState(!!cheque);

  // One selection per ROLE, not per ledger column: a bank account chosen to
  // pay an expense is still selected when the user switches to «خرید دارایی».
  const [moneyAccountId, setMoneyAccountId] = useState(initialIncome?.accountId ?? cheque?.accountId ?? initialAccountId ?? "");
  const [assetAccountId, setAssetAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState(prefill?.toAccountId ? (initialAccountId ?? "") : "");
  const [toAccountId, setToAccountId] = useState(prefill?.toAccountId ?? "");
  // Income: a SOURCE from the income category tree (never a ledger account), an
  // amount in the receiving account's own unit, and an optional monthly repeat.
  const [incomeGroups, setIncomeGroups] = useState<CategoryGroupOption[]>(incomeCategories);
  const [incomeParentId, setIncomeParentId] = useState(initialIncome?.parentId ?? (defaultType === "income" ? (prefill?.parentId ?? "") : ""));
  const [incomeCategoryId, setIncomeCategoryId] = useState(initialIncome?.categoryId ?? (defaultType === "income" ? (prefill?.categoryId ?? "") : ""));
  const [incomeAmount, setIncomeAmount] = useState(
    initialIncome?.amount ?? cheque?.amountToman ?? (defaultType === "income" && prefill ? (initialIrtAmount ?? "") : ""),
  );
  const [recurring, setRecurring] = useState(false);
  const [recurringDay, setRecurringDay] = useState(() => jalaliDayOf(initialEntryDate ?? today));
  const planId = initialIncome?.planId ?? "";

  const [categoryGroups, setCategoryGroups] = useState<CategoryGroupOption[]>(categories);
  const [categoryParentId, setCategoryParentId] = useState(defaultType === "expense" ? (prefill?.parentId ?? "") : "");
  const [categoryId, setCategoryId] = useState(defaultType === "expense" ? (prefill?.categoryId ?? "") : "");
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
      setChequeOpen(false);
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
  // …and only where this money may go: Toman between banks, exchange Toman and
  // brokerage Toman; a coin or a tokenised asset to the same asset at an
  // exchange or a wallet on a network it supports.
  const transferFrom = byId(fromId);
  const transferSymbol = (transferFrom?.symbol ?? "").toUpperCase();
  const transferTargets = transferFrom
    ? toOptions.filter(
        (a) =>
          !transferDestinationError(
            transferFrom,
            a,
            networksForHolding(transferSymbol, transferFrom.classCode, assetNetworks[transferSymbol]),
          ),
      )
    : [];
  // «+ افزودن»: catalogue places that may receive this money and hold no account for it yet.
  const transferNewPlaces = transferFrom
    ? KNOWN_WALLETS.filter(
        (w) =>
          !sameWallet(transferFrom, { walletName: w.name }) &&
          !transferTargets.some((t) => sameWallet(t, { walletName: w.name })) &&
          !transferDestinationError(
            transferFrom,
            { symbol: transferFrom.symbol, walletKind: w.kind, walletName: w.name },
            networksForHolding(transferSymbol, transferFrom.classCode, assetNetworks[transferSymbol]),
          ),
      )
    : [];
  const addTransferDestination = async (placeName: string): Promise<string | null> => {
    const result = await createTransferDestinationAction({ sourceAccountId: fromId, placeName });
    if (!result.ok || !result.account) return result.message;
    const created = result.account;
    setAccountOptions((current) => (current.some((a) => a.id === created.id) ? current : [...current, created]));
    setToAccountId(created.id);
    return null;
  };
  const transferIsToman = transferSymbol === "" || transferSymbol === "IRT" || transferSymbol === "IRR";
  const transferQtyDecimals = Math.min(Math.max(transferFrom?.decimals ?? 8, 0), 8);
  // The unit in Persian: «تتر», or the asset's own name («آمازون ایکس») — never a Latin ticker.
  const transferUnitLabel = !transferFrom
    ? ""
    : currencyLabel(transferSymbol) !== transferSymbol
      ? currencyLabel(transferSymbol)
      : transferFrom.name.split(" - ")[0];
  const toId = resolve(toAccountId, transferTargets, false);
  const assetId = isRegistrySale ? "" : resolve(assetAccountId, type === "sell" ? chipOptions : tradeOptions, false);
  const assetAccount = byId(assetId);
  const assetInstrument = {
    symbol: assetAccount?.symbol,
    classCode: assetAccount?.classCode,
    className: assetAccount?.className,
  };
  // The money a trade may settle in — the same rule the server enforces:
  // Toman at an Iranian exchange or a stablecoin for crypto and tokenised
  // assets, Toman at a brokerage for Iranian-market assets, and a Toman bank
  // account for properties and vehicles. Accounts that do not qualify are not listed.
  const assetPlace = { walletName: assetAccount?.walletName, walletKind: assetAccount?.walletKind };
  // WHERE it trades: money pays only where it is held, in what that place
  // trades (see features/trade/venues) — a buy is held at the paying place.
  const venueAllows = (a: AccountOption) => {
    if (!isTrade || isTomanOnlyInstrument(assetInstrument)) return true;
    const side = type === "sell" ? "sell" : "buy";
    const target = side === "sell" ? assetPlace : { walletName: a.walletName, walletKind: a.walletKind };
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
  const settleHint = isRegistrySale
    ? "حساب بانکی تومانی ثبت نشده است."
    : isTomanOnlyInstrument(assetInstrument)
      ? "موجودی تومانی در کارگزاری ندارید؛ مثلاً «تومان - کارگزاری مفید» را در حساب‌ها اضافه کنید."
      : "موجودی تومان در صرافی داخلی یا تتر در همان صرافی یا کیف پول ندارید؛ مثلاً «تومان - نوبیتکس» یا «تتر - بیت‌پین».";
  // Everyday spending leaves a Toman bank account or the cash box — never a
  // stablecoin wallet, a fund or an exchange. Banks first.
  const expenseOptions = moneyOptions
    .filter((a) => {
      const unit = (a.symbol ?? "").toUpperCase();
      const kind = (a.walletKind ?? "").toLowerCase();
      return (unit === "IRT" || unit === "IRR") && (!kind || kind === "bank" || kind === "cash");
    })
    .sort((a, b) => Number(a.walletKind === "cash") - Number(b.walletKind === "cash"));
  // The expense account is chosen for the user: their pick, else the one that
  // paid the last expense, else the first bank account.
  const moneyId =
    type === "expense"
      ? resolve(moneyAccountId, expenseOptions, false) ||
        resolve(lastExpenseAccountId ?? "", expenseOptions, false) ||
        (expenseOptions[0]?.id ?? "")
      : resolve(moneyAccountId, isTrade ? settleOptions : moneyOptions);

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

  // Which real assets a one-tap tag is offered for: a car under «خودرو و
  // حمل‌ونقل», a property under housing costs or as the source of rent.
  const chipKind: "vehicle" | "property" | null =
    type === "expense" && selectedParent?.code === "TRN"
      ? "vehicle"
      : (type === "expense" && selectedParent?.code === "HSG") || (type === "income" && incomeParent?.code === "INC-INV")
        ? "property"
        : null;
  const chipAssets = chipKind ? assetTags.filter((a) => a.kind === chipKind) : [];

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
    // Trades need prices; an income into a Tether wallet, or a coin moved, needs the market rate.
    if (!(isTrade || type === "income" || type === "transfer") || market.size > 0) return;
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
  const usdtToman = market.get("USDT")?.priceTmn ?? effectiveRate ?? null;
  // A coin is moved by its quantity; its Toman value comes from the market price.
  const transferUnitToman = transferIsToman
    ? null
    : (market.get(transferSymbol)?.priceTmn ?? (isStablecoin(transferSymbol) ? usdtToman : null));
  const transferQuantityToman =
    type === "transfer" && !transferIsToman && hasQuantity && transferUnitToman ? D(quantity).mul(transferUnitToman).toFixed(0) : "";
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
        : type === "transfer" && transferQuantityToman
          ? transferQuantityToman
          : irtAmount;
  const hasAmount = isRegistrySale
    ? !!salePriceValue && salePriceValue.gt(0)
    : isTrade
      ? !!quote
      : type === "income"
        ? !!incomeToman
        : type === "transfer" && transferQuantityToman
          ? true
          : !!amountValue && amountValue.gt(0);
  const qtyWithUnit = hasQuantity
    ? `${formatQty(quantity, qtyDecimals)} ${currencyLabel(assetSymbol) !== assetSymbol ? currencyLabel(assetSymbol) : assetName}`
    : "—";

  /* ── Fee: in the unit of the account that pays it ─────────────────── */
  const feePayAccount = type === "transfer" ? fromAccount : moneyAccount;
  const feeSymbol = (feePayAccount?.symbol ?? "IRT").toUpperCase();
  const feeInToman = !feePayAccount || feeSymbol === "IRT" || feeSymbol === "IRR";
  const feeValue = fee && D(fee).gt(0) ? D(fee) : null;

  /* ── What actually moves in the settlement account ────────────────── */
  // The trade fee is typed in the settlement account's unit (Toman, or Tether for
  // a stablecoin wallet) — the same unit as `quote.total` — and the ledger books
  // it exactly this way: a sale deposits proceeds − fee, a buy withdraws value + fee.
  const settleNet = quote
    ? feeValue
      ? type === "sell"
        ? D(quote.total).sub(feeValue)
        : D(quote.total).add(feeValue)
      : D(quote.total)
    : null;
  const settleTotalLabel = settleNet
    ? priceUnit === "IRT"
      ? formatMoney(settleNet.toFixed(0), "IRT")
      : `${formatQty(settleNet.toString(), 6)} ${currencyLabel(moneyAccount?.symbol)}`
    : "—";
  const registryNet = isRegistrySale && salePrice && D(salePrice).gt(0)
    ? feeValue
      ? D(salePrice).sub(feeValue)
      : D(salePrice)
    : null;
  const feeExceedsProceeds =
    (type === "sell" && !!settleNet && settleNet.lte(0)) || (!!registryNet && registryNet.lte(0));

  const transferTargetHint = transferIsToman
    ? "حساب بانکی، تومانِ صرافی داخلی یا تومانِ کارگزاری دیگری ندارید."
    : `«${transferUnitLabel}» در صرافی یا کیف پول دیگری ندارید.`;

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
  if (type === "transfer" && fromId && !transferIsToman && !hasQuantity) missing.push("مقدار");
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
  } else if (!hasAmount) missing.push("مبلغ");
  if (feeExceedsProceeds) missing.push("کارمزد کمتر از مبلغ فروش");
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
          + {registryNet ? formatMoney(registryNet.toFixed(0), "IRT") : "—"}
        </b>,
      ],
    );
  } else if (isTrade) {
    summary.push([
      "دارایی",
      <span key="a">
        {assetName || "—"}
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
    if (!transferIsToman && hasQuantity) {
      summary.push(["مقدار", <span key="tq" className="num">{`${formatQty(quantity, transferQtyDecimals)} ${transferUnitLabel}`}</span>]);
    }
  } else if (!isNonCash && !isTrade) {
    summary.push([type === "income" ? "واریز به" : "پرداخت از", accountLabel(moneyAccount)]);
  }
  if (type === "debt_repayment" && selectedDebt) {
    summary.push(["بدهی", selectedInst ? `${selectedDebt.title} — قسط ${faCount(selectedInst.seq)}` : selectedDebt.title]);
  }
  if (type !== "expense" && fee && D(fee).gt(0)) {
    summary.push(["کارمزد", <span key="f" className="num">{formatMoney(fee, feeInToman ? "IRT" : feeSymbol)}</span>]);
  }
  summary.push(["تاریخ", entryDate ? getDualDate(entryDate).jalali : "—"], ["شرح", finalDescription]);
  const parsedTags = parseTags(tagsText);
  if (parsedTags.length) summary.push(["برچسب", parsedTags.map((t) => `#${t}`).join(" ")]);

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
      {isTrade && !isRegistrySale && <input type="hidden" name="priceMode" value={usingMarket ? "market" : "limit"} />}
      <input type="hidden" name="registryKind" value={registryItem?.kind ?? ""} />
      <input type="hidden" name="registryId" value={registryItem?.id ?? ""} />
      <input type="hidden" name="placeName" value="" />
      <input type="hidden" name="amount" value={previewUsd} />
      <input type="hidden" name="categoryId" value={type === "expense" ? categoryId : type === "income" ? incomeCategoryId : ""} />
      <input type="hidden" name="nativeAmount" value={type === "income" ? incomeAmount : ""} />
      <input type="hidden" name="recurring" value={type === "income" && recurring && !planId ? "monthly" : ""} />
      <input type="hidden" name="recurringDay" value={type === "income" && recurring ? String(recurringDay) : ""} />
      <input type="hidden" name="planId" value={type === "income" ? planId : (type === "expense" || type === "transfer") && prefill?.planId ? prefill.planId : ""} />
      <input type="hidden" name="primaryAccountId" value={primaryAccountId} />
      <input type="hidden" name="counterAccountId" value={counterAccountId} />
      <input type="hidden" name="quantity" value={(isTrade && !isRegistrySale) || (type === "transfer" && !transferIsToman) ? quantity : ""} />
      <input type="hidden" name="fee" value={type === "expense" ? "" : fee} />
      <input type="hidden" name="feeMode" value={feeInToman ? "irt" : "native"} />
      <input type="hidden" name="description" value={finalDescription} />
      <input type="hidden" name="tags" value={tagsText} />
      <input type="hidden" name="chequeId" value={cheque && chequeOpen ? cheque.id : ""} />

      {cheque && chequeOpen && (
        <div className="card flex items-start gap-2 p-3 text-[length:var(--fs-sm)]" style={{ borderColor: "var(--action)" }} role="note">
          <Icon name="note" size={16} />
          <span>
            ثبت پاس شدن چک {cheque.direction === "issued" ? "صادره در وجه" : "دریافتی از"} «{cheque.counterparty}» به مبلغ{" "}
            <b className="num">{formatMoney(cheque.amountToman, "IRT")}</b>. با ثبت این تراکنش، چک در دفتر چک «پاس شد» می‌شود.
          </span>
        </div>
      )}
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

      {type === "expense" ? (
        <ExpenseFields
          groups={categoryGroups}
          setGroups={setCategoryGroups}
          parentId={categoryParentId}
          categoryId={categoryId}
          onPick={(parentId, leafId) => {
            setCategoryParentId(parentId);
            setCategoryId(leafId);
          }}
          recentCategoryIds={expenseRecentCategoryIds}
          amount={irtAmount}
          setAmount={setIrtAmount}
          previewUsd={previewUsd}
          accounts={expenseOptions}
          balances={balances}
          accountId={moneyId}
          setAccountId={setMoneyAccountId}
          entryDate={entryDate}
          setEntryDate={setEntryDate}
          today={today}
          description={description}
          setDescription={setDescription}
          autoDescription={autoDescription}
        />
      ) : type === "debt_repayment" ? (
        <DebtRepaymentFields
          debts={debts}
          selectedDebt={selectedDebt}
          selectedInst={selectedInst}
          onSelectDebt={handleSelectDebt}
          onSelectInstallment={handleSelectInstallment}
          onClear={() => {
            setSelectedDebt(null);
            setSelectedInst(null);
          }}
          amount={irtAmount}
          setAmount={setIrtAmount}
          previewUsd={previewUsd}
          accounts={moneyOptions}
          balances={balances}
          accountId={moneyId}
          setAccountId={setMoneyAccountId}
          fee={fee}
          setFee={setFee}
          feeInToman={feeInToman}
          feeSymbol={feeSymbol}
          entryDate={entryDate}
          setEntryDate={setEntryDate}
          today={today}
          description={description}
          setDescription={setDescription}
          autoDescription={autoDescription}
        />
      ) : type === "transfer" ? (
        <TransferFields
          sources={assetAccounts}
          targets={transferTargets}
          balances={balances}
          fromId={fromId}
          setFromId={(id) => {
            setFromAccountId(id);
            setToAccountId("");
            setQuantity("");
          }}
          toId={toId}
          setToId={setToAccountId}
          targetHint={transferTargetHint}
          newPlaces={transferNewPlaces}
          onAddDestination={addTransferDestination}
          isToman={transferIsToman}
          amount={irtAmount}
          setAmount={setIrtAmount}
          previewUsd={previewUsd}
          quantity={quantity}
          setQuantity={setQuantity}
          qtyDecimals={transferQtyDecimals}
          heldQty={
            fromId && balances[fromId] ? (transferSymbol === "IRR" ? D(balances[fromId]).div(10).toString() : balances[fromId]) : null
          }
          quantityToman={transferQuantityToman}
          fee={fee}
          setFee={setFee}
          feeInToman={feeInToman}
          feeSymbol={feeSymbol}
          entryDate={entryDate}
          setEntryDate={setEntryDate}
          today={today}
          description={description}
          setDescription={setDescription}
          autoDescription={autoDescription}
        />
      ) : isTrade ? (
        <TradeFields
          type={type}
          asset={assetAccount ?? null}
          assetName={assetName}
          assetLogoUrl={marketRow?.logoUrl ?? assetAccount?.logoUrl ?? null}
          heldQty={heldQty ? heldQty.toString() : null}
          qtyDecimals={qtyDecimals}
          marketRow={marketRow}
          ownedAssets={chipOptions}
          market={market}
          balances={balances}
          onPickAsset={(id) => {
            setAssetAccountId(id);
            setRegistryKey("");
            setPickerOpen(false);
          }}
          registryAssets={registryAssets}
          registryItem={registryItem}
          onPickRegistry={(key) => {
            setRegistryKey(key);
            setAssetAccountId("");
          }}
          onClearAsset={() => {
            setRegistryKey("");
            setAssetAccountId("");
            setQuantity("");
            setSalePrice("");
          }}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          onRegistered={({ account, row }) => {
            if (!account) return;
            setAccountOptions((current) => (current.some((a) => a.id === account.id) ? current : [...current, account]));
            setAssetAccountId(account.id);
            setMarket((current) => (current.has(row.symbol) ? current : new Map(current).set(row.symbol, row)));
            setPickerOpen(false);
          }}
          settleOptions={settleOptions}
          moneyId={moneyId}
          onMoneyChange={(id) => {
            setMoneyAccountId(id);
            // A limit price is typed in the settlement unit; a new unit needs a new price.
            setLimitPrice("");
          }}
          settleHint={settleHint}
          quantity={quantity}
          setQuantity={setQuantity}
          overHeld={overHeld}
          usingMarket={usingMarket}
          setPriceMode={setPriceMode}
          marketUnitPrice={marketUnitPrice}
          priceUnit={priceUnit}
          limitPrice={limitPrice}
          setLimitPrice={setLimitPrice}
          quote={quote}
          settleTotalLabel={settleTotalLabel}
          feeApplied={!!feeValue && !!settleNet}
          feeExceedsProceeds={feeExceedsProceeds}
          salePrice={salePrice}
          setSalePrice={setSalePrice}
          fee={fee}
          setFee={setFee}
          feeInToman={feeInToman}
          feeSymbol={feeSymbol}
          entryDate={entryDate}
          setEntryDate={setEntryDate}
          today={today}
          description={description}
          setDescription={setDescription}
          autoDescription={autoDescription}
        />
      ) : (
      <>
      {/* ── ۱. What ── */}
      <Step n={1} title={stepOneTitle[type]}>
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

      </Step>

      {/* ── ۲. How much ── */}
      <Step n={2} title="چقدر؟">
        {type === "income" ? (
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
        ) : null}

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
      <Step n={3} title="کی؟">
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
      </>
      )}

      {/* A car or property expense — or a property's rent: one tap files it under that asset. */}
      {!confirming && chipAssets.length > 0 && (
        <div className="card flex flex-wrap items-center gap-2 p-3" role="group" aria-label={chipAssets[0].kind === "vehicle" ? "برای کدام خودرو؟" : "برای کدام ملک؟"}>
          <span className="muted text-[length:var(--fs-xs)]">{chipAssets[0].kind === "vehicle" ? "برای کدام خودرو؟" : "برای کدام ملک؟"}</span>
          {chipAssets.map((v) => {
            const token = `#${v.tag}`;
            const on = tagsText.split(/\s+/).includes(token);
            return (
              <button
                key={v.tag}
                type="button"
                className="shortcut-chip"
                aria-pressed={on}
                style={on ? { background: "var(--action-soft)", color: "var(--action)" } : undefined}
                onClick={() =>
                  setTagsText(on ? tagsText.split(/\s+/).filter((t) => t && t !== token).join(" ") : `${tagsText} ${token}`.trim())
                }
              >
                <Icon name={v.kind === "vehicle" ? "car" : "home"} size={13} />
                {v.label}
              </button>
            );
          })}
        </div>
      )}

      {!confirming && (
        <details className="card p-4" open={tagsText !== "" || undefined}>
          <summary className="cursor-pointer text-[length:var(--fs-sm)] font-semibold">برچسب (اختیاری)</summary>
          <div className="mt-3">
            <TagInput id="tx-tags" value={tagsText} onChange={setTagsText} suggestions={tagSuggestions} />
          </div>
        </details>
      )}

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
        <div className="tx-submit-bar space-y-1.5">
          <button
            type="button"
            disabled={!ready}
            onClick={() => setConfirming(true)}
            className="btn btn-primary w-full disabled:opacity-40"
          >
            {type === "expense" && hasAmount ? (
              <>
                ثبت هزینه <span className="num">{formatMoney(irtAmount, "IRT")}</span>
              </>
            ) : (
              "بررسی و ثبت"
            )}
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
