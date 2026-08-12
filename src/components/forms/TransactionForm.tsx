"use client";
/* eslint-disable @next/next/no-img-element */

import { useActionState, useEffect, useMemo, useState, useRef, useTransition } from "react";
import { createTransactionAction, createCategoryAction, type ActionResult } from "@/app/actions";
import {
  refreshMarketCatalogAction,
  registerMarketAssetAction,
  searchMarketCatalogAction,
} from "@/app/actions/pricing";
import { formatMoney, getDualDate } from "@/lib/format";
import { SmartAmountPreview, DualDatePreview, PreviewCard, useLatestRate } from "@/components/ui/SmartPreview";
import DualDateInput from "@/components/ui/DualDateInput";
import Icon from "@/components/ui/Icon";
import DebtInstallmentExplorer, { type DebtOption } from "./DebtInstallmentExplorer";
import { D } from "@/domain/decimal";

export type AccountOption = {
  id: string;
  code: string;
  name: string;
  type: string;
  symbol: string | null;
  decimals: number;
  logoUrl?: string | null;
  coingeckoId?: string | null;
};

export type MarketAssetOption = {
  coingeckoId: string;
  symbol: string;
  name: string;
  logoUrl: string;
};

export type MarketCatalogStatus = {
  total: number;
  crypto: number;
  bootstrapOnly: boolean;
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
  { key: "expense", label: "هزینه", primary: "پرداخت از حساب", counter: "حساب معین هزینه" },
  { key: "income", label: "درآمد", primary: "واریز به حساب", counter: "دسته درآمد" },
  { key: "transfer", label: "انتقال", primary: "از حساب", counter: "به حساب" },
  { key: "debt_repayment", label: "بازپرداخت بدهی", primary: "پرداخت از حساب", counter: "حساب هزینه (در صورت نیاز)" },
  { key: "buy", label: "خرید دارایی", primary: "حساب دارایی خریداری‌شده", counter: "پرداخت از حساب" },
  { key: "sell", label: "فروش دارایی", primary: "حساب دارایی فروخته‌شده", counter: "واریز به حساب" },
] as const;

type TxType = (typeof TYPES)[number]["key"];

type Props = {
  accounts: AccountOption[];
  categories?: CategoryGroupOption[];
  marketAssets?: MarketAssetOption[];
  marketCatalogStatus?: MarketCatalogStatus;
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

export default function TransactionForm({
  accounts,
  categories = [],
  marketAssets = [],
  marketCatalogStatus,
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
  const [irtAmount, setIrtAmount] = useState(initialIrtAmount ?? "");
  /* Hierarchical expense category: parent group → leaf sub-category */
  const [categoryParentId, setCategoryParentId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [categoryGroups, setCategoryGroups] = useState<CategoryGroupOption[]>(categories);
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categoryMessage, setCategoryMessage] = useState("");
  const [quantity, setQuantity] = useState("");
  const [primaryAccountId, setPrimaryAccountId] = useState("");
  const [counterAccountId, setCounterAccountId] = useState(() =>
    defaultType === "expense" || defaultType === "debt_repayment"
      ? accounts.find((a) => a.type === "expense")?.id ?? ""
      : "",
  );
  const [entryDate, setEntryDate] = useState(initialEntryDate ?? today);
  const [description, setDescription] = useState(initialDescription ?? initialTitle ?? "");
  const [fee, setFee] = useState("");
  const [selectedDebt, setSelectedDebt] = useState<DebtOption | null>(null);
  const [selectedInst, setSelectedInst] = useState<DebtOption["installments"][number] | null>(null);
  const [showExplorer, setShowExplorer] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [accountOptions, setAccountOptions] = useState(accounts);
  const [assetSearch, setAssetSearch] = useState("");
  const [catalogMessage, setCatalogMessage] = useState("");
  const [registering, startRegistration] = useTransition();
  const [catalogResults, setCatalogResults] = useState<MarketAssetOption[]>(marketAssets);
  const [catalogSearching, setCatalogSearching] = useState(false);
  const [catalogStatus, setCatalogStatus] = useState<MarketCatalogStatus>(
    marketCatalogStatus ?? {
      total: marketAssets.length,
      crypto: marketAssets.length,
      bootstrapOnly: false,
    },
  );
  const [refreshingCatalog, startCatalogRefresh] = useTransition();

  const { rate, date: rateDate, source: rateSource } = useLatestRate(initialRate ?? null);
  const effectiveRate = initialRate ?? rate;
  const effectiveRateDate = initialRateDate ?? rateDate;
  const effectiveRateSource = initialRateSource ?? rateSource;

  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(createTransactionAction, null);

  const meta = TYPES.find((t) => t.key === type)!;
  const cash = accountOptions.filter((a) => a.type === "asset");
  const primaryOptions = useMemo(() => {
    if (type === "buy" || type === "sell") return cash.filter((a) => !["IRT", "USD"].includes(a.symbol ?? ""));
    return cash;
  }, [type, cash]);
  const counterOptions = useMemo(() => {
    if (type === "expense") return accountOptions.filter((a) => a.type === "expense");
    if (type === "income") return accountOptions.filter((a) => a.type === "income");
    if (type === "debt_repayment") return accountOptions.filter((a) => a.type === "expense");
    return cash;
  }, [type, accountOptions, cash]);
  const isAssetPicker = type === "buy" || type === "sell";

  /* ── Expense category derivation ── */
  const selectedParent = categoryGroups.find((g) => g.id === categoryParentId) ?? null;
  const selectedCategory = selectedParent?.children.find((c) => c.id === categoryId) ?? null;
  const isNonCashCategory = selectedCategory?.nature === "non_cash";
  const selectedDebtHasLedgerAccount = !!selectedDebt?.accountId;

  /**
   * Type switch handler — expense / debt-repayment entries always need a
   * counter expense account for the double-entry ledger, so it is defaulted
   * to the first one here (in the event handler, not in an effect), keeping
   * the category picker as the user's main decision.
   */
  const pickType = (key: TxType) => {
    setType(key);
    if (key === "expense" || key === "debt_repayment") {
      const valid = accountOptions.some((a) => a.id === counterAccountId && a.type === "expense");
      const first = accountOptions.find((a) => a.type === "expense");
      if (!valid && first) setCounterAccountId(first.id);
    } else if (key === "income") {
      const valid = accountOptions.some((a) => a.id === counterAccountId && a.type === "income");
      const first = accountOptions.find((a) => a.type === "income");
      if (!valid && first) setCounterAccountId(first.id);
    }
  };

  const handleCreateCategory = async () => {
    if (!categoryParentId || !newCategoryName.trim()) return;
    const res = await createCategoryAction({ name: newCategoryName.trim(), parentId: categoryParentId });
    if (!res.ok) {
      setCategoryMessage(res.message);
      return;
    }
    setCategoryMessage("");
    setNewCategoryName("");
    setShowNewCategory(false);
    // Refresh the tree in place (server revalidated the path for others).
    setCategoryGroups((current) =>
      current.map((g) =>
        g.id === categoryParentId && res.id
          ? {
              ...g,
              children: [...g.children, { id: res.id, code: "", name: newCategoryName.trim(), nature: "cash", description: null }],
            }
          : g,
      ),
    );
    if (res.id) setCategoryId(res.id);
  };

  /**
   * The picker queries the FULL server-side catalog instead of filtering the
   * small slice embedded in the page, so every synced crypto identity is
   * reachable even when it is far down the market-cap ordering.
   */
  useEffect(() => {
    if (!isAssetPicker) return;
    const query = assetSearch.trim();
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      setCatalogSearching(true);
      const response = await searchMarketCatalogAction(query);
      if (cancelled) return;
      setCatalogSearching(false);
      if (!response.ok) {
        setCatalogMessage(response.message ?? "جستجوی کاتالوگ ناموفق بود.");
        return;
      }
      setCatalogResults(response.assets);
      setCatalogStatus({
        total: response.total,
        crypto: response.total,
        bootstrapOnly: response.bootstrapOnly,
      });
    }, query ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [assetSearch, isAssetPicker]);

  const catalogMatches = catalogResults;

  const handleCatalogRefresh = () => {
    startCatalogRefresh(async () => {
      const response = await refreshMarketCatalogAction();
      setCatalogMessage(response.message ?? "");
      if (!response.assets.length) return;
      setCatalogStatus({
        total: response.total,
        crypto: response.total,
        bootstrapOnly: response.bootstrapOnly,
      });
      // Re-run the active query against the freshly synced catalog.
      const refreshed = await searchMarketCatalogAction(assetSearch.trim());
      if (refreshed.ok) setCatalogResults(refreshed.assets);
    });
  };

  const selectCatalogAsset = (asset: MarketAssetOption) => {
    const existing = accountOptions.find(
      (account) => account.coingeckoId === asset.coingeckoId,
    );
    if (existing) {
      setPrimaryAccountId(existing.id);
      setCatalogMessage(`${asset.symbol} از حساب‌های شما انتخاب شد.`);
      return;
    }

    startRegistration(async () => {
      const response = await registerMarketAssetAction(asset.coingeckoId);
      setCatalogMessage(response.message);
      if (!response.ok || !response.account) return;
      const account: AccountOption = { ...response.account, coingeckoId: asset.coingeckoId };
      setAccountOptions((current) => [...current, account]);
      setPrimaryAccountId(account.id);
    });
  };

  const needsQty = type === "buy" || type === "sell" || type === "transfer";

  const handleSelectDebt = (d: DebtOption) => {
    setSelectedDebt(d);
    setSelectedInst(null);
    const pendingInst = d.installments.find((i) => i.status === "pending");
    const amt = pendingInst ? pendingInst.amountBase : d.outstandingBase;
    const irt = effectiveRate ? D(amt).mul(effectiveRate).toFixed(0) : amt;
    setIrtAmount(irt);
    setDescription(`بازپرداخت بدهی — ${d.title} (${d.creditor})`);
    setEntryDate(today);
    setType("debt_repayment");
    setCategoryId("");
    setCategoryParentId("");
    setShowExplorer(false);
    if (!d.accountId) {
      const expAcc = accountOptions.find((a) => a.type === "expense");
      if (expAcc) setCounterAccountId(expAcc.id);
    }
    const cashAcc = accountOptions.find((a) => a.type === "asset");
    if (cashAcc) setPrimaryAccountId(cashAcc.id);
  };

  const handleSelectInstallment = (d: DebtOption, inst: DebtOption["installments"][number]) => {
    setSelectedDebt(d);
    setSelectedInst(inst);
    const irt = effectiveRate ? D(inst.amountBase).mul(effectiveRate).toFixed(0) : inst.amountBase;
    setIrtAmount(irt);
    setDescription(`پرداخت قسط ${inst.seq} — ${d.title}`);
    setEntryDate(inst.dueDate);
    setType("debt_repayment");
    setCategoryId("");
    setCategoryParentId("");
    setShowExplorer(false);
    if (!d.accountId) {
      const expAcc = accountOptions.find((a) => a.type === "expense");
      if (expAcc) setCounterAccountId(expAcc.id);
    }
    const cashAcc = accountOptions.find((a) => a.type === "asset");
    if (cashAcc) setPrimaryAccountId(cashAcc.id);
  };

  // Auto-populate from initialDebt/Installment ids — useEffect to avoid setState during render (mobile hydration fix)
  const autoPopulatedRef = useRef(false);
  useEffect(() => {
    if (autoPopulatedRef.current) return;
    if (!debts.length) return;
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

  const previewUsd = irtAmount && effectiveRate ? D(irtAmount).div(effectiveRate).toFixed(2) : "";
  const primaryNeeded = !(type === "expense" && isNonCashCategory);
  const counterNeeded = !(type === "debt_repayment" && selectedDebt && selectedDebtHasLedgerAccount);
  const canPreview =
    irtAmount &&
    D(irtAmount).gt(0) &&
    description &&
    entryDate &&
    (!primaryNeeded || primaryAccountId) &&
    (!counterNeeded || counterAccountId) &&
    (type !== "debt_repayment" || selectedDebt) &&
    (type !== "expense" || !!categoryId);

  const debtStatusAfter = useMemo(() => {
    if (!selectedDebt) return null;
    if (selectedInst) {
      const remaining = selectedDebt.installments.filter((i) => i.status === "pending").length - 1;
      if (remaining <= 0) return "پرداخت کامل — بدهی تسویه می‌شود";
      return `پرداخت بخشی — ${remaining} قسط باقی می‌ماند`;
    }
    return D(selectedDebt.outstandingBase).lte(previewUsd || "0") ? "پرداخت کامل" : "پرداخت بخشی از مانده";
  }, [selectedDebt, selectedInst, previewUsd]);

  return (
    <form action={formAction} className="space-y-4" style={{ touchAction: "manipulation" }}>
      {/* Type selector */}
      <div className="seg max-w-full overflow-x-auto" role="group" aria-label="نوع تراکنش" style={{ touchAction: "pan-x" }}>
        {TYPES.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => pickType(t.key)}
            className={`!px-4 !min-h-9 ${type === t.key ? "seg-on" : ""}`}
            aria-pressed={type === t.key}
            style={{ touchAction: "manipulation" }}
          >
            {t.label}
          </button>
        ))}
      </div>
      <input type="hidden" name="type" value={type} />
      {/* hidden FX + debt linkage + expense category (leaf) */}
      <input type="hidden" name="irtAmount" value={irtAmount} />
      <input type="hidden" name="categoryId" value={type === "expense" ? categoryId : ""} />
      <input type="hidden" name="fxRate" value={effectiveRate ?? ""} />
      <input type="hidden" name="fxRateDate" value={effectiveRateDate ?? ""} />
      <input type="hidden" name="debtId" value={selectedDebt?.id ?? ""} />
      <input type="hidden" name="installmentId" value={selectedInst?.id ?? ""} />
      {/* Explorer toggle — pick a debt/installment (debt repayment flow) */}
      {(type === "expense" || type === "debt_repayment") && debts.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowExplorer((v) => !v)} className="btn btn-ghost w-full !justify-between" style={{ touchAction: "manipulation" }}>
            <span className="inline-flex items-center gap-1.5">
              <Icon name="search" size={15} />
              انتخاب بدهی / قسط (Explorer)
            </span>
            <span className="chip">{showExplorer ? "بستن" : "نمایش"} · {debts.length} بدهی</span>
          </button>
          {showExplorer && (
            <div className="mt-3">
              <DebtInstallmentExplorer
                debts={debts}
                onSelectDebt={handleSelectDebt}
                onSelectInstallment={handleSelectInstallment}
                rate={effectiveRate}
              />
            </div>
          )}
          {(selectedDebt || selectedInst) && (
            <div className="soft mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[var(--r-md)] p-3 text-xs">
              <span>انتخاب شده: <strong>{selectedDebt?.title}</strong>{selectedInst ? ` — قسط ${selectedInst.seq}` : ""}</span>
              <button type="button" onClick={() => { setSelectedDebt(null); setSelectedInst(null); }} className="chip" style={{ touchAction: "manipulation" }}>حذف انتخاب</button>
            </div>
          )}
        </div>
      )}

      <div className="card space-y-3 p-4">
        <div>
          <label className="label">مبلغ به تومان (IRT) — مرجع برنامه‌ریزی</label>
          <input
            name="irtAmountInput"
            inputMode="numeric"
            required
            value={irtAmount}
            onChange={(e) => setIrtAmount(e.target.value.replace(/[^0-9]/g, ""))}
            placeholder="مثال: 25000000"
            className="field num !text-2xl !font-bold"
            dir="ltr"
            style={{ touchAction: "manipulation" }}
          />
          <div className="mt-2">
            <SmartAmountPreview irtAmount={irtAmount} rate={effectiveRate ?? null} rateDate={effectiveRateDate} rateSource={effectiveRateSource} />
          </div>
          {/* hidden USD amount for server fallback (computed) */}
          <input type="hidden" name="amount" value={previewUsd} />
        </div>

        {needsQty && (
          <div>
            <label className="label">
              مقدار دارایی {type === "transfer" ? "(اختیاری — اگر خالی باشد از مبلغ محاسبه می‌شود)" : ""}
            </label>
            <input
              name="quantity"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              className="field num"
              dir="ltr"
              placeholder="0.00000000"
              style={{ touchAction: "manipulation" }}
            />
          </div>
        )}

        {isAssetPicker && (
          <div className="space-y-2">
            <label className="label">انتخاب دارایی از CoinGecko — نام یا نماد را جستجو کنید</label>
            <input
              type="search"
              value={assetSearch}
              onChange={(event) => setAssetSearch(event.target.value)}
              className="field"
              placeholder="BTC، USDC، PAXG، WBTC…"
              autoComplete="off"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleCatalogRefresh}
                disabled={refreshingCatalog}
                className="chip"
                style={{ touchAction: "manipulation" }}
              >
                {refreshingCatalog ? "در حال به‌روزرسانی…" : "به‌روزرسانی کاتالوگ"}
              </button>
              <span className="muted text-[10.5px]">
                {catalogStatus.total} دارایی
                {catalogSearching ? " · در حال جستجو…" : ""}
              </span>
            </div>
            {catalogStatus.bootstrapOnly && (
              <p className="soft rounded-[var(--r-md)] p-2 text-[10.5px] leading-5" role="status">
                اتصال به CoinGecko برقرار نشده است؛ فعلاً فقط فهرست آفلاین در دسترس است.
                برای دریافت فهرست کامل، دسترسی شبکهٔ سرور به <span dir="ltr">api.coingecko.com</span> یا مقدار
                <span dir="ltr"> COINGECKO_API_KEY </span> را بررسی و سپس «به‌روزرسانی کاتالوگ» را بزنید.
              </p>
            )}
            <div className="grid max-h-52 gap-1.5 overflow-y-auto rounded-[var(--r-md)] border p-2 sm:grid-cols-2" style={{ borderColor: "var(--border)" }}>
              {catalogMatches.map((asset) => {
                const registered = accountOptions.some(
                  (account) => account.coingeckoId === asset.coingeckoId,
                );
                return (
                  <button
                    key={asset.coingeckoId}
                    type="button"
                    disabled={registering}
                    onClick={() => selectCatalogAsset(asset)}
                    className="flex min-h-12 items-center gap-2 rounded-[var(--r-sm)] px-2.5 py-2 text-start hover:bg-[var(--surface-2)] disabled:opacity-60"
                  >
                    <img src={asset.logoUrl} alt="" width={28} height={28} className="h-7 w-7 rounded-full" referrerPolicy="no-referrer" />
                    <span className="min-w-0 flex-1">
                      <b className="block text-xs" dir="ltr">{asset.symbol}</b>
                      <small className="muted block truncate">{asset.name}</small>
                    </span>
                    <span className="chip">{registered ? "انتخاب" : "ثبت"}</span>
                  </button>
                );
              })}
              {!catalogMatches.length && (
                <p className="muted p-2 text-xs">
                  {catalogSearching ? "در حال جستجو…" : "دارایی مطابق جستجو یافت نشد — «به‌روزرسانی کاتالوگ» را امتحان کنید."}
                </p>
              )}
            </div>
            {catalogMessage && <p className="text-xs" role="status">{catalogMessage}</p>}
          </div>
        )}

        {/* Expense category — hierarchical picker, active ONLY for expenses */}
        {type === "expense" && (
          <div className="soft space-y-2 rounded-[var(--r-md)] p-3">
            <label className="label !mb-0">دسته هزینه</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <select
                className="field"
                value={categoryParentId}
                onChange={(e) => {
                  setCategoryParentId(e.target.value);
                  setCategoryId("");
                }}
                style={{ touchAction: "manipulation" }}
              >
                <option value="" disabled>دسته اصلی…</option>
                {categoryGroups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
              <select
                name="categorySelect"
                className="field"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={!selectedParent}
                style={{ touchAction: "manipulation" }}
              >
                <option value="" disabled>{selectedParent ? "زیردسته…" : "ابتدا دسته اصلی را انتخاب کنید"}</option>
                {selectedParent?.children.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.nature === "non_cash" ? " (غیرنقدی)" : ""}
                  </option>
                ))}
              </select>
            </div>
            {selectedCategory?.description && (
              <p className="muted text-[10.5px] leading-5">{selectedCategory.description}</p>
            )}
            {isNonCashCategory && (
              <p className="rounded-[var(--r-sm)] p-2 text-[11px] leading-5" style={{ background: "var(--surface-2)" }} role="note">
                <strong>ثبت غیرنقدی (استهلاک/ذخیره):</strong> این دسته خروج وجه نیست؛ هیچ حساب نقدی تغییر نمی‌کند و طرف مقابل به‌صورت خودکار حساب «ذخیره استهلاک و تعمیرات آتی» است. در گزارش هزینه منظور می‌شود ولی از جریان نقدی خارج می‌ماند.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => setShowNewCategory((v) => !v)} disabled={!selectedParent} className="chip disabled:opacity-40" style={{ touchAction: "manipulation" }}>
                {showNewCategory ? "بستن" : "+ زیردسته جدید"}
              </button>
              <span className="muted text-[10px]">
                {categoryMessage || "در صورت تکرار یک هزینهٔ متفرقه، برای آن زیردسته مستقل بسازید."}
              </span>
            </div>
            {showNewCategory && selectedParent && (
              <div className="flex gap-2">
                <input
                  className="field"
                  value={newCategoryName}
                  onChange={(e) => setNewCategoryName(e.target.value)}
                  placeholder={`زیردسته جدید زیر «${selectedParent.name}»`}
                  style={{ touchAction: "manipulation" }}
                />
                <button type="button" onClick={handleCreateCategory} disabled={!newCategoryName.trim()} className="btn btn-soft shrink-0 disabled:opacity-40" style={{ touchAction: "manipulation" }}>
                  افزودن
                </button>
              </div>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">{meta.primary}</label>
            {type === "expense" && isNonCashCategory ? (
              <input type="hidden" name="primaryAccountId" value="" />
            ) : null}
            {type === "expense" && isNonCashCategory ? (
              <div className="soft rounded-[var(--r-md)] p-3 text-[11px] leading-5">
                ثبت غیرنقدی — حساب نقدی درگیر نیست؛ طرف مقابل، خودکار «ذخیره استهلاک و تعمیرات آتی» است.
              </div>
            ) : (
              <select name="primaryAccountId" required className="field" value={primaryAccountId} onChange={(e) => setPrimaryAccountId(e.target.value)} style={{ touchAction: "manipulation" }}>
                <option value="" disabled>انتخاب کنید…</option>
                {primaryOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name} {a.symbol ? `(${a.symbol})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="label">{meta.counter}</label>
            {type === "debt_repayment" && selectedDebt && selectedDebtHasLedgerAccount ? (
              <input type="hidden" name="counterAccountId" value="" />
            ) : null}
            {type === "debt_repayment" && selectedDebt && selectedDebtHasLedgerAccount ? (
              <div className="soft rounded-[var(--r-md)] p-3 text-[11px] leading-5">
                بازپرداخت اصل بدهی — مستقیماً از مانده بدهی «{selectedDebt.title}» کسر می‌شود و <strong>هزینه محسوب نمی‌شود</strong>.
              </div>
            ) : (
              <select name="counterAccountId" required className="field" value={counterAccountId} onChange={(e) => setCounterAccountId(e.target.value)} style={{ touchAction: "manipulation" }}>
                <option value="" disabled>انتخاب کنید…</option>
                {counterOptions.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name} {a.symbol ? `(${a.symbol})` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Dual Date Engine — shared single source of truth */}
        <DualDateInput name="entryDate" value={entryDate} onChange={setEntryDate} label="تاریخ سند" required />
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">کارمزد (اختیاری) — به تومان</label>
            <input
              name="fee"
              value={fee}
              onChange={(e) => setFee(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              className="field num"
              dir="ltr"
              placeholder="0"
              style={{ touchAction: "manipulation" }}
            />
            {fee && effectiveRate && <p className="muted mt-1 text-[10px]">کارمزد دلاری ≈ {D(fee).div(effectiveRate).toFixed(2)} $</p>}
          </div>
          <div className="flex items-end">
            <div className="muted text-[11px] leading-5">
              کارمزد نیز با همین نرخ تبدیل و در همان سند ثبت می‌شود.
            </div>
          </div>
        </div>

        <div>
          <label className="label">شرح</label>
          <input
            name="description"
            required
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="field"
            placeholder="مثلاً پرداخت قسط ۳ — وام مسکن"
            style={{ touchAction: "manipulation" }}
          />
        </div>
      </div>

      {/* Smart Preview Before Commit */}
      {showPreview ? (
        <PreviewCard title="پیش‌نمایش هوشمند قبل از ثبت نهایی — فقط نمایشی">
          <div className="space-y-2 text-xs leading-6">
            <div><span className="muted">نوع تراکنش:</span> <strong>{TYPES.find(t=>t.key===type)?.label}</strong></div>
            <div><span className="muted">عنوان/شرح:</span> <strong>{description || "—"}</strong></div>
            {type === "expense" && (
              <div>
                <span className="muted">دسته هزینه:</span>{" "}
                <strong>{selectedParent && selectedCategory ? `${selectedParent.name} › ${selectedCategory.name}` : "—"}</strong>
                {isNonCashCategory && <span className="chip">غیرنقدی — بدون خروج وجه</span>}
              </div>
            )}
            {type === "debt_repayment" && selectedDebt && (
              <div>
                <span className="muted">بدهی:</span> <strong>{selectedDebt.title}</strong>{" "}
                <span className="chip">{selectedDebtHasLedgerAccount ? "کسر از مانده بدهی — هزینه نیست" : "ثبت با حساب هزینه"}</span>
              </div>
            )}
            <div className="soft rounded-xl p-2">
              <div className="muted text-[10px]">مبلغ به تومان و معادل دلاری (با نرخ لحظه‌ای)</div>
              <div className="num font-bold" dir="rtl">{irtAmount ? formatMoney(irtAmount, "IRT") : "—"}</div>
              <div className="num" dir="ltr" style={{ color:"var(--brand)" }}>{previewUsd ? formatMoney(previewUsd, "USD") : "—"} <span className="muted text-[10px]"> نرخ: {effectiveRate ? formatMoney(effectiveRate, "IRT")+" ≈ $1" : "ثبت نشده"}</span></div>
              {effectiveRateDate && <div className="muted text-[10px]">تاریخ نرخ: <span dir="ltr" className="num">{effectiveRateDate}</span> · منبع: {effectiveRateSource ?? "—"}</div>}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div><span className="muted">حساب مبدأ:</span> <strong>{accountOptions.find(a=>a.id===primaryAccountId)?.name ?? "—"}</strong> <span className="chip">{accountOptions.find(a=>a.id===primaryAccountId)?.code ?? ""}</span></div>
              <div><span className="muted">حساب مقابل:</span> <strong>{accountOptions.find(a=>a.id===counterAccountId)?.name ?? "—"}</strong> <span className="chip">{accountOptions.find(a=>a.id===counterAccountId)?.code ?? ""}</span></div>
            </div>
            <div>
              <span className="muted">تاریخ شمسی / میلادی:</span>
              <div className="soft rounded-xl p-2 mt-1 flex flex-wrap gap-3 text-[11px]">
                <span>شمسی: <strong dir="rtl">{entryDate ? getDualDate(entryDate).jalali : "—"}</strong></span>
                <span>میلادی: <strong dir="ltr" className="num">{entryDate || "—"}</strong></span>
              </div>
            </div>
            {needsQty && <div><span className="muted">مقدار دارایی:</span> <strong dir="ltr" className="num">{quantity || "محاسبه خودکار از مبلغ"}</strong></div>}
            {fee && <div><span className="muted">کارمزد:</span> <strong dir="ltr" className="num">{formatMoney(fee, "IRT")}</strong> ≈ {effectiveRate ? formatMoney(D(fee).div(effectiveRate).toFixed(2), "USD") : "—"}</div>}
            {(selectedDebt || selectedInst) && (
              <div className="soft rounded-xl p-2 border" style={{ borderColor:"var(--border)" }}>
                <div className="font-bold">مرجع بدهی/قسط</div>
                <div>بدهی: <strong>{selectedDebt?.title}</strong> — {selectedDebt?.creditor}</div>
                {selectedInst && <div>قسط: <strong>#{selectedInst.seq}</strong> — سررسید {getDualDate(selectedInst.dueDate).jalali} / <span dir="ltr">{selectedInst.dueDate}</span> — مبلغ <span dir="ltr">{formatMoney(selectedInst.amountBase,"USD")}</span></div>}
                <div>وضعیت پس از پرداخت: <strong style={{ color:"var(--brand)" }}>{debtStatusAfter}</strong></div>
                <div className="muted text-[10px]">شناسه مرجع در سند حسابداری ذخیره و قابل پیگیری از هر دو سمت خواهد بود.</div>
              </div>
            )}
            <div className="muted text-[10px] leading-5">
              تا قبل از «تأیید نهایی ثبت تراکنش» هیچ اطلاعاتی وارد Accounting Core, Ledger یا FIFO نمی‌شود. پس از تأیید، مبلغ تاریخی به تومان، معادل به دلار و نرخ زمان ثبت Freeze می‌شوند (Historical Immutability).
            </div>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowPreview(false)} className="btn btn-ghost flex-1" style={{ touchAction: "manipulation" }}>بازگشت به ویرایش</button>
            <button type="submit" disabled={pending} className="btn btn-primary flex-1" style={{ touchAction: "manipulation" }}>
              {pending ? "در حال ثبت…" : "تأیید نهایی ثبت تراکنش"}
            </button>
          </div>
        </PreviewCard>
      ) : (
        <button
          type="button"
          disabled={!canPreview}
          onClick={() => setShowPreview(true)}
          className="btn btn-primary w-full disabled:opacity-40"
          style={{ touchAction: "manipulation" }}
        >
          {canPreview ? "پیش‌نمایش هوشمند قبل از ثبت نهایی" : "برای پیش‌نمایش، مبلغ، تاریخ و حساب‌ها را تکمیل کنید"}
        </button>
      )}

      {state && (
        <p
          className="rounded-[var(--r-md)] px-4 py-3 text-xs font-medium"
          role="status"
          style={{
            background: state.ok ? "var(--positive-soft)" : "var(--negative-soft)",
            color: state.ok ? "var(--positive)" : "var(--negative)",
          }}
        >
          {state.message}
        </p>
      )}

      {/* entryDate is provided by DualDateInput hidden input */}
    </form>
  );
}
