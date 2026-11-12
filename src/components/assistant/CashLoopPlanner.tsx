"use client";

import { useMemo, useState } from "react";
import type { FinancialSnapshot } from "@/features/assistant/snapshot";
import { fmtToman } from "@/features/assistant/analysis";
import { daysUntilIso, formatShortDate, toFaDigits, todayIso } from "@/lib/format";
import Icon from "@/components/ui/Icon";

const short = (n: number) => fmtToman(n).replace(/ تومان$/, "");
const full = (n: number) => `${Math.round(n).toLocaleString("fa-IR")} تومان`;
const num = (n: number) => Math.round(n).toLocaleString("fa-IR");

interface Props {
  s: FinancialSnapshot;
}

type Horizon = 1 | 2 | 3 | 6;

export interface CategoryMeta {
  key: string;
  label: string;
  icon: import("@/components/ui/Icon").IconName;
}

export const KNOWN_PURCHASE_CATEGORIES: Record<string, { label: string; icon: import("@/components/ui/Icon").IconName }> = {
  ceremony: { label: "مراسم عقد و محضر", icon: "ring" },
  wedding: { label: "طلا و مراسم عروسی", icon: "sparkle" },
  home: { label: "لوازم خانه و جهیزیه", icon: "home" },
  apparel: { label: "پوشاک و ملزومات", icon: "shirt" },
  gold: { label: "طلا و سرمایه‌گذاری", icon: "coins" },
  transport: { label: "خودرو و حمل‌ونقل", icon: "car" },
  digital: { label: "کالای دیجیتال", icon: "phone" },
  other: { label: "سایر خریدهای احتمالی", icon: "gift" },
};

export interface PurchaseItem {
  id: string;
  title: string;
  category: string;
  categoryLabel?: string;
  estimatedToman: number;
  selected: boolean;
}

const INITIAL_PURCHASES: PurchaseItem[] = [
  // ── مراسم عقد و محضر ──
  { id: "c-dress", title: "لباس دوشیزه", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 10_000_000, selected: true },
  { id: "c-makeup", title: "آرایش دوشیزه", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 12_000_000, selected: true },
  { id: "c-shoes", title: "کفش دوشیزه", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 3_500_000, selected: true },
  { id: "c-flower", title: "دسته گل عقد", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 2_500_000, selected: true },
  { id: "c-ring-bride", title: "حلقه طلا / نشان", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 35_000_000, selected: true },
  { id: "c-ring-groom", title: "حلقه نقره مردانه", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 3_000_000, selected: true },
  { id: "c-photo-notary", title: "عکاسی سالن عقد + محضر + ثبت سیستمی عقد", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 15_000_000, selected: true },
  { id: "c-groom-suit", title: "ست لباس داماد (کفش، شلوار، پیراهن، کمربند)", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 12_000_000, selected: true },
  { id: "c-sweets", title: "شیرینی و پذیرایی عقد", category: "ceremony", categoryLabel: "مراسم عقد", estimatedToman: 5_000_000, selected: true },

  // ── طلا، تالار و عروسی ──
  { id: "w-gold", title: "خرید طلای عروس (سرویس طلا)", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 160_000_000, selected: true },
  { id: "w-hall", title: "تالار عروسی و ورودی سالن", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 70_000_000, selected: true },
  { id: "w-dinner", title: "شام و پذیرایی مراسم عروسی", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 110_000_000, selected: true },
  { id: "w-studio", title: "آتلیه، فیلمبرداری و عکس‌برداری حرفه‌ای", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 45_000_000, selected: true },
  { id: "w-groom-makeup", title: "گریم و اصلاح داماد", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 6_000_000, selected: true },
  { id: "w-groom-wedding-suit", title: "لباس مراسم عروسی داماد", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 20_000_000, selected: true },
  { id: "w-decor", title: "تشریفات و گل‌آرایی ماشین عروس و سالن", category: "wedding", categoryLabel: "طلا و عروسی", estimatedToman: 18_000_000, selected: true },

  // ── لوازم خانگی و تجهیز خانه (جهیزیه) ──
  { id: "h-vacuum", title: "جاروبرقی", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 12_000_000, selected: true },
  { id: "h-heater", title: "بخاری / سیستم گرمایشی", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 8_500_000, selected: true },
  { id: "h-curtain-hall", title: "پرده سالن پذیرایی", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 15_000_000, selected: true },
  { id: "h-curtain-bed", title: "پرده اتاق خواب", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 7_000_000, selected: true },
  { id: "h-iron", title: "اتو بخار", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 4_500_000, selected: true },
  { id: "h-console", title: "کنسول و آینه", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 18_000_000, selected: true },
  { id: "h-shoe-rack", title: "جاکفشی", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 6_500_000, selected: true },
  { id: "h-coffee-bar", title: "کافه بار", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 10_000_000, selected: true },
  { id: "h-chandelier", title: "لوستر پذیرایی و اتاق خواب", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 14_000_000, selected: true },
  { id: "h-bedroom-set", title: "سرویس خواب کامل", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 32_000_000, selected: true },
  { id: "h-cloth-rack", title: "رگال لباس", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 3_500_000, selected: true },
  { id: "h-bride-luggage", title: "چمدان عروس، لباس زیر و ملزومات شخصی", category: "home", categoryLabel: "لوازم خانه و جهیزیه", estimatedToman: 16_000_000, selected: true },
];

export type JobScenario = "unemployed" | "contract_3m" | "contract_renewed" | "stable";

export const HIGH_INFLATION_PRESET_RATES = [
  320_000,
  370_000,
  420_000,
  450_000,
  500_000,
  550_000,
];

export const ASSISTANT_QUICK_QUESTIONS = [
  {
    title: "قرارداد ۳ ماهه و ریسک بیکاری مجدد",
    badge: "امنیت شغلی",
    desc: "برنامه‌ریزی مالی با فرض قرارداد ۳ ماهه و سناریوی اتمام قرارداد بدون تمدید یا تمدید مجدد",
    prompt: "وضعیت شغلی من فعلاً ممکن است یک قرارداد موقت ۳ ماهه باشد و بعد از ۳ ماه ممکن است دوباره بیکار شوم یا تمدید شود. با توجه به کل بدهی ۴۵٫۹ میلیونی، اقساط ۶ ماه آینده (> ۲ م.ت) و هزینه‌های عقد و جهیزیه، چطور تترها و حقوق ۳ ماهه را فازبندی کنم که اگر تمدید نشد به بحران نخورم و تترهایم نسوزد؟",
  },
  {
    title: "سناریوی جهش تتر به ۳۲۰ تا ۵۵۰ هزار تومان",
    badge: "تورم و تتر",
    desc: "بررسی تأثیر صعود قیمت تتر تا سال آینده به ۳۲۰، ۴۲۰ یا ۵۵۰ هزار تومان بر بدهی‌ها و حفظ سرمایه",
    prompt: "ممکن است تا سال آینده قیمت تتر در ایران از ۳۲۰،۰۰۰ تومان فراتر رفته و به ۳۷۰،۰۰۰، ۴۲۰،۰۰۰، ۴۵۰،۰۰۰، ۵۰۰،۰۰۰ یا ۵۵۰،۰۰۰ تومان یا بین این ارقام برسد. این جهش تورمی دلار چه تأثیری بر توان تسویه بدهی ۴۵٫۹ میلیونی و هزینه‌های من دارد و استراتژی بهینه برای زمان‌بندی فروش پله‌ای تتر چیست؟",
  },
  {
    title: "فازبندی خریدهای عقد، جهیزیه و طلا",
    badge: "خریدهای آینده",
    desc: "دسته‌بندی ۲۸ قلم خرید ضروری، تفکیک سرمایه‌گذاری طلا از هزینه‌های مصرفی جشن و تالار",
    prompt: "من در پیش‌رو خریدهای بزرگی (عقد، جهیزیه، لوازم خانه، طلا و مراسم عروسی) دارم. چطور این خریدها را فازبندی کنم تا طلای عروس به عنوان حفظ ارزش دارایی حفظ شود و هزینه‌های مصرفی تالار و تشریفات باعث فروش عجولانه تتر در کف قیمتی نشود؟",
  },
  {
    title: "به‌روزرسانی تحلیل با تغییر درآمد و مخارج",
    badge: "تحلیل پویا",
    desc: "چگونه با دریافت درآمد جدید، تغییر هزینه‌ها یا تغییر نرخ، تحلیل و پیشنهادهای دستیار آپدیت شود؟",
    prompt: "اگر در ماه‌های آینده وضعیت شغلی‌ام تغییر کرد، درآمد جدیدی ایجاد شد یا هزینه‌های غیرمنتظره‌ای اضافه شد، چطور این اطلاعات را به تو بدهم تا تحلیل ترازنامه، صندوق تتر و استراتژی بقای مالی مرا مجدداً به‌روزرسانی کنی؟",
  },
  {
    title: "جبران تترهای مصرف‌شده و مثبت کردن PnL دلاری سبد",
    badge: "جبران تتر و PnL",
    desc: "محاسبه تترهای فروخته‌شده در بیت‌پین برای تنقلات و اقساط، استراتژی بازخرید و مثبت کردن سود دلاری",
    prompt: "تترهایی که تاکنون برای هزینه‌های جاری زندگی، خریدهای روزمره، تنقلات و اقساط فروخته شده و از تومان-بیت‌پین به حساب‌های بانکی منتقل شده را بررسی کن. چطور این تترهای سوخته را جبران کنم و چه برنامه‌ای برای بازخرید آن‌ها داشته باشم؟ همچنین برای سود و زیان تحقق‌نیافته دلاری سبد که هم‌اکنون منفی است، چه استراتژی مهندسی‌شده‌ای پیاده کنم تا در چرخه‌های بعدی مثبت شود؟",
  },
];

export default function CashLoopPlanner({ s }: Props) {
  // ── Existing accounts & liquid positions ──
  const bankToman = s?.netWorth?.availableCashToman ?? 0;
  const exchangeToman = s?.netWorth?.exchangeTomanToman ?? 0;
  const stablecoinToman = s?.netWorth?.stablecoinToman ?? 0;
  const baseRate = s?.usdToToman && s.usdToToman > 0 ? s.usdToToman : 70000;

  // Filter bank and exchange accounts
  const accounts = Array.isArray(s?.accounts) ? s.accounts : [];
  const bankAccounts = accounts.filter(
    (a) => a && (a.kind === "bank" || (["IRT", "IRR"].includes(a.currency ?? "") && a.kind !== "exchange")),
  );
  const stablecoinAccounts = accounts.filter(
    (a) =>
      a &&
      (["USDT", "USDC", "DAI"].includes(a.currency ?? "") ||
        (typeof a.name === "string" && a.name.includes("تتر"))),
  );

  // Exact USDT quantity from accounts or derived
  const actualUsdtHoldings = stablecoinAccounts.reduce((sum, a) => sum + (a && a.balance > 0 ? a.balance : 0), 0);
  const totalUsdt = actualUsdtHoldings > 0 ? Math.round(actualUsdtHoldings) : Math.round(stablecoinToman / Math.max(1, baseRate));

  // Debts details
  const debtsList = Array.isArray(s?.debts) ? s.debts : [];
  const totalDebtFromNetWorth = s?.netWorth?.totalDebtToman ?? 0;
  const totalDebtFromDebts = debtsList.reduce((sum, d) => sum + (d?.outstandingToman ?? 0), 0);
  const totalOutstandingDebt = Math.max(totalDebtFromNetWorth, totalDebtFromDebts, 45_900_000);

  // Default monthly expense from actual system analysis, with sane fallback
  const defaultMonthlyExpense =
    s?.cashflow?.avgMonthlyExpenseToman && s.cashflow.avgMonthlyExpenseToman > 0
      ? s.cashflow.avgMonthlyExpenseToman
      : s?.cashflow?.currentMonth?.expenseToman && s.cashflow.currentMonth.expenseToman > 0
        ? s.cashflow.currentMonth.expenseToman
        : 18_000_000;

  // ── Interactive user controls ──
  const [horizon, setHorizon] = useState<Horizon>(6); // Default to 6 months as requested
  const [monthlyExpense, setMonthlyExpense] = useState<number>(defaultMonthlyExpense);
  const [rate, setRate] = useState<number>(baseRate);
  const [bufferPct, setBufferPct] = useState<number>(5);
  const [tradingPortionPct, setTradingPortionPct] = useState<number>(10);

  // ── Debt Strategy: فقط اقساط سررسید شده دوره یا تسویه کامل بدهی ۴۵٫۹ میلیونی ──
  const [debtStrategy, setDebtStrategy] = useState<"schedule" | "full">("schedule");

  // ── Dual Scenario Controls (اشتغال در آینده، قرارداد ۳ ماهه و عدم اشتغال) ──
  const [jobScenario, setJobScenario] = useState<JobScenario>("contract_3m");
  const [contractMonths, setContractMonths] = useState<number>(3);
  const [monthlySalary, setMonthlySalary] = useState<number>(25_000_000);
  const [customQuestion, setCustomQuestion] = useState("");

  // ── Unbudgeted Major Life Purchases (عقد، عروسی، لوازم خانه) ──
  const [purchases, setPurchases] = useState<PurchaseItem[]>(INITIAL_PURCHASES);
  const [includePurchases, setIncludePurchases] = useState<boolean>(true);
  const [purchaseFilter, setPurchaseFilter] = useState<string>("all");
  const [newTitle, setNewTitle] = useState("");
  const [newAmount, setNewAmount] = useState<number>(10_000_000);
  const [newCategory, setNewCategory] = useState<string>("home");

  // Inline editing state for purchases
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editAmount, setEditAmount] = useState<number>(0);
  const [editCategory, setEditCategory] = useState<string>("home");

  // Dynamic category list derived from current items
  const dynamicCategories = useMemo(() => {
    const map = new Map<string, { label: string; icon: import("@/components/ui/Icon").IconName; count: number; totalToman: number }>();
    for (const p of purchases) {
      const meta = KNOWN_PURCHASE_CATEGORIES[p.category];
      const label = meta?.label ?? p.categoryLabel ?? p.category;
      const icon = meta?.icon ?? "gift";
      const existing = map.get(p.category) ?? { label, icon, count: 0, totalToman: 0 };
      existing.count += 1;
      if (p.selected) existing.totalToman += p.estimatedToman;
      map.set(p.category, existing);
    }
    return Array.from(map.entries()).map(([key, data]) => ({ key, ...data }));
  }, [purchases]);

  // Filtered purchases
  const visiblePurchases = useMemo(() => {
    if (purchaseFilter === "all") return purchases;
    return purchases.filter((p) => p.category === purchaseFilter);
  }, [purchases, purchaseFilter]);

  // Total selected purchases budget
  const totalSelectedPurchasesToman = useMemo(() => {
    return purchases.filter((p) => p.selected).reduce((sum, p) => sum + p.estimatedToman, 0);
  }, [purchases]);

  const togglePurchase = (id: string) => {
    setPurchases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p)),
    );
  };

  const updatePurchaseAmount = (id: string, amount: number) => {
    setPurchases((prev) =>
      prev.map((p) => (p.id === id ? { ...p, estimatedToman: Math.max(0, amount) } : p)),
    );
  };

  const startEditPurchase = (item: PurchaseItem) => {
    setEditingPurchaseId(item.id);
    setEditTitle(item.title);
    setEditAmount(item.estimatedToman);
    setEditCategory(item.category);
  };

  const saveEditPurchase = () => {
    if (!editingPurchaseId || !editTitle.trim()) return;
    setPurchases((prev) =>
      prev.map((p) => {
        if (p.id !== editingPurchaseId) return p;
        const meta = KNOWN_PURCHASE_CATEGORIES[editCategory];
        return {
          ...p,
          title: editTitle.trim(),
          estimatedToman: Math.max(0, editAmount),
          category: editCategory,
          categoryLabel: meta?.label ?? editCategory,
        };
      }),
    );
    setEditingPurchaseId(null);
  };

  const cancelEditPurchase = () => {
    setEditingPurchaseId(null);
  };

  const deletePurchase = (id: string) => {
    setPurchases((prev) => prev.filter((p) => p.id !== id));
    if (editingPurchaseId === id) setEditingPurchaseId(null);
  };

  const resetPurchases = () => {
    setPurchases(INITIAL_PURCHASES);
    setEditingPurchaseId(null);
  };

  const addNewPurchase = () => {
    if (!newTitle.trim()) return;
    const meta = KNOWN_PURCHASE_CATEGORIES[newCategory];
    const newItem: PurchaseItem = {
      id: `custom-${Date.now()}`,
      title: newTitle.trim(),
      category: newCategory,
      categoryLabel: meta?.label ?? newCategory,
      estimatedToman: newAmount,
      selected: true,
    };
    setPurchases((prev) => [newItem, ...prev]);
    setNewTitle("");
  };

  // ── Obligations within the selected horizon (up to 180 days) ──
  const today = s?.asOf || todayIso();
  const maxDays = horizon * 30;
  const upcoming = Array.isArray(s?.obligations?.upcoming) ? s.obligations.upcoming : [];

  const obligationsInWindow = useMemo(() => {
    return upcoming.filter((u) => {
      if (!u || !u.date) return false;
      const days = daysUntilIso(u.date, today);
      return days >= 0 && days <= maxDays;
    });
  }, [upcoming, today, maxDays]);

  // Installment obligations sum (normally > 2,000,000 Toman for 6 months)
  const scheduledInstallmentsToman = useMemo(() => {
    const sum = obligationsInWindow.reduce((s, u) => s + (u.toman || 0), 0);
    // If system shows small mock, ensure at least contractual reality if user has ~2M in 6 months
    return sum > 0 ? sum : 2_200_000;
  }, [obligationsInWindow]);

  // Active debt burden in calculations
  const activeDebtBurdenToman = debtStrategy === "full" ? totalOutstandingDebt : scheduledInstallmentsToman;

  // ── Calculations for Base Scenario (بدون شغل) ──
  const totalLivingToman = monthlyExpense * horizon;
  const purchasesToman = includePurchases ? totalSelectedPurchasesToman : 0;
  const baseNeedToman = totalLivingToman + activeDebtBurdenToman + purchasesToman;
  const bufferToman = Math.round(baseNeedToman * (bufferPct / 100));
  const grossNeedToman = baseNeedToman + bufferToman;

  // Ready Toman liquidity (Bank + Exchange Toman already available)
  const readyToman = bankToman + exchangeToman;
  const deficitTomanBase = Math.max(0, grossNeedToman - readyToman);
  const neededUsdtBase = deficitTomanBase > 0 ? Math.ceil(deficitTomanBase / Math.max(1, rate)) : 0;
  const remainingUsdtBase = Math.max(0, totalUsdt - neededUsdtBase);

  // ── Calculations for Job / Temporary Contract Scenario ──
  const activeSalaryMonths = useMemo(() => {
    if (jobScenario === "unemployed") return 0;
    if (jobScenario === "contract_3m") return Math.min(contractMonths, horizon);
    if (jobScenario === "contract_renewed") return Math.min(contractMonths * 2, horizon);
    return horizon;
  }, [jobScenario, contractMonths, horizon]);

  const isJobActive = jobScenario !== "unemployed";
  const totalSalaryInHorizon = isJobActive ? monthlySalary * activeSalaryMonths : 0;
  const monthsAtRisk = Math.max(0, horizon - activeSalaryMonths);

  const deficitTomanJob = Math.max(0, grossNeedToman - readyToman - totalSalaryInHorizon);
  const neededUsdtJob = deficitTomanJob > 0 ? Math.ceil(deficitTomanJob / Math.max(1, rate)) : 0;
  const remainingUsdtJob = Math.max(0, totalUsdt - neededUsdtJob);

  // Active scenario outputs
  const activeDeficitToman = isJobActive ? deficitTomanJob : deficitTomanBase;
  const activeNeededUsdt = isJobActive ? neededUsdtJob : neededUsdtBase;
  const activeRemainingUsdt = isJobActive ? remainingUsdtJob : remainingUsdtBase;
  const savedUsdtWithJob = Math.max(0, neededUsdtBase - activeNeededUsdt);

  // Runway calculation (months until liquid cash + stablecoins exhaust)
  const totalLiquidNetWorthToman = readyToman + totalUsdt * rate;
  const monthlyBurnBase = monthlyExpense + (horizon > 0 ? activeDebtBurdenToman / horizon : 0);
  const runwayMonthsBase =
    monthlyBurnBase > 0 ? Math.round((totalLiquidNetWorthToman / monthlyBurnBase) * 10) / 10 : 0;

  const monthlyNetBurnJob = Math.max(
    0,
    monthlyBurnBase - (activeSalaryMonths > 0 ? totalSalaryInHorizon / horizon : 0),
  );
  const runwayMonthsJob =
    monthlyNetBurnJob > 0
      ? Math.round((totalLiquidNetWorthToman / monthlyNetBurnJob) * 10) / 10
      : Infinity;

  const activeRunwayMonths = isJobActive ? runwayMonthsJob : runwayMonthsBase;

  // Trading allocation
  const safeTradingUsdt = Math.round((totalUsdt * tradingPortionPct) / 100);
  const emergencyReserveUsdt = Math.max(0, totalUsdt - safeTradingUsdt);

  // FX Sensitivity Matrix - includes baseRate, current rate, and future inflation target rates (320k to 550k)
  const sensitivityRates = useMemo(() => {
    const set = new Set<number>([
      Math.round(baseRate),
      Math.round(rate),
      ...HIGH_INFLATION_PRESET_RATES,
    ]);
    return Array.from(set).sort((a, b) => a - b);
  }, [baseRate, rate]);

  // Dispatch question to AI Assistant
  const askAssistantQuestion = (question: string) => {
    const jobDescription =
      jobScenario === "unemployed"
        ? "بدون شغل فعلی / اتکای کامل به صندوق تتر"
        : jobScenario === "contract_3m"
          ? `قرارداد موقت ۳ ماهه با حقوق ماهانه ${full(monthlySalary)} (ریسک بازگشت به بیکاری در ماه ۴ به بعد)`
          : jobScenario === "contract_renewed"
            ? `قرارداد ۳ ماهه با تمدید دوره‌ای با حقوق ماهانه ${full(monthlySalary)}`
            : `استخدام دائم و باثبات با حقوق ماهانه ${full(monthlySalary)}`;

    const text = `من برنامه‌ریزی جامع مالی و صندوق مخارج تتر را بررسی کردم:
۱. وضعیت بدهی‌ها:
- کل بدهی‌های باقی‌مانده: ${full(totalOutstandingDebt)}
- اقساط ۶ ماه آینده (آبان تا اردیبهشت): ${full(scheduledInstallmentsToman)}
- استراتژی انتخابی بدهی: ${debtStrategy === "full" ? "تسویه کامل کل بدهی ۴۵٫۹ میلیونی" : "پرداخت اقساط ۶ ماهه در سررسید"}

۲. خریدهای پیش‌رو و مراسم عقد، عروسی و تجهیز خانه:
- جمع بودجه برنامه‌ریزی‌شده خریدهای عقد، طلا، عروسی و لوازم خانه: ${full(totalSelectedPurchasesToman)}
- وضعیت اعمال در محاسبات نقدینگی: ${includePurchases ? "لحاظ‌شده در نیاز نقدی" : "صرفاً برآورد جداگانه"}

۳. نقدینگی و سناریوی شغلی و نرخ تتر:
- افق انتخابی: ${toFaDigits(String(horizon))} ماهه
- مخارج زندگی ماهانه: ${full(monthlyExpense)}
- نیاز کل نقدینگی این دوره: ${full(grossNeedToman)}
- موجودی ریالی آماده در بانک و صرافی: ${full(readyToman)}
- وضعیت شغلی: ${jobDescription}
- ماه‌های پوشش با حقوق: ${toFaDigits(String(activeSalaryMonths))} ماه | ماه‌های در معرض ریسک بیکاری: ${toFaDigits(String(monthsAtRisk))} ماه
- نرخ تتر مبنا: ${num(rate)} تومان (با پیش‌بینی جهش‌های احتمالی تا ۵۵۰ هزار تومان)
- کسری خالص نهایی این دوره: ${full(activeDeficitToman)}
- تتر مورد نیاز برای فروش در بیت‌پین: ${num(activeNeededUsdt)} تتر (به نرخ ${num(rate)} تومان)
- مانده تتر پس از تأمین: ${num(activeRemainingUsdt)} تتر

پرسش تخصصی کاربر از دستیار هوشمند:
${question}`;

    window.dispatchEvent(new CustomEvent("assistant:ask", { detail: text }));
  };

  const askAssistantWithScenario = () => {
    askAssistantQuestion(
      "لطفاً یک تحلیل جامع، دقیق و مهندسی‌شده بدهید: با توجه به وضعیت شغلی (قرارداد ۳ ماهه یا بیکاری) و سناریوی صعود نرخ تتر تا ۵۵۰ هزار تومان، چطور هزینه‌های مراسم عقد، خرید لوازم منزل و اقساط ۶ ماه آینده را فازبندی کنم تا کمترین فشار به دارایی‌های تتر و سرمایه ترید وارد شود و چطور با تغییرات آینده این تحلیل را آپدیت کنم؟",
    );
  };

  return (
    <div className="ai-loop space-y-5" dir="rtl">
      {/* ── کاشی هدر مجلل Kashi 2.0: تاب‌آوری، افق زمانی و چشم‌انداز ── */}
      <section className="card p-6 border border-[var(--border)] rounded-2xl bg-gradient-to-br from-[var(--surface)] via-[var(--surface)] to-[var(--sunken)] shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]/20">
                <Icon name="sparkle" size={13} />
                معماری جامع ثروت، بدهی‌ها و مراسم زندگی
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] bg-[var(--sunken)] text-[var(--text-3)] border border-[var(--border)]">
                افق {toFaDigits(String(horizon))} ماهه (از آبان‌ماه)
              </span>
            </div>
            <h2 className="text-2xl font-black text-[var(--text)] tracking-tight">
              صندوق مخارج تتری، پوشش اقساط و بودجه‌بندی عقد و زندگی
            </h2>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              این پلتفرم مهندسی‌شده، کل بدهی‌های شما ({short(totalOutstandingDebt)} تومان)، اقساط ۶ ماه آینده (بالای ۲ میلیون تومان)، هزینه‌های خرید خانه، عقد و عروسی، و تترهای صرافی بیت‌پین را در دو سناریوی **بدون شغل** و **شغل آینده** به‌طور دقیق بالانس می‌کند.
            </p>
          </div>

          <div className="text-center px-5 py-4 rounded-2xl bg-[var(--surface)] border-2 border-[var(--border-strong)] shadow-sm shrink-0 min-w-[210px]">
            <p className="text-xs text-[var(--text-3)] mb-1 font-medium">
              {isJobActive
                ? jobScenario === "contract_3m"
                  ? "تاب‌آوری (قرارداد ۳ ماهه)"
                  : "تاب‌آوری در سناریوی اشتغال"
                : "تاب‌آوری در سناریوی بدون شغل"}
            </p>
            <p className="text-3xl font-black num text-[var(--positive)]">
              {isJobActive && runwayMonthsJob === Infinity
                ? "پایدار (نامحدود)"
                : `${toFaDigits(activeRunwayMonths.toFixed(1))} ماه`}
            </p>
            <p className="text-[11px] text-[var(--text-3)] mt-1">
              {isJobActive && runwayMonthsJob === Infinity
                ? "حقوق هزینه‌ها و اقساط را کامل جبران می‌کند"
                : isJobActive
                  ? `${toFaDigits(String(activeSalaryMonths))} ماه حقوق + ${toFaDigits(String(monthsAtRisk))} ماه اتکا به تتر`
                  : "پوشش مخارج جاری و اقساط از تتر"}
            </p>
          </div>
        </div>
      </section>

      {/* ── کاشی ویژه: مدیریت بدهی ۴۵٫۹ میلیونی و اقساط ۶ ماهه از آبان ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[var(--negative-soft)] text-[var(--negative)] flex items-center justify-center">
              <Icon name="installments" size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-[var(--text)]">
                مدیریت کل بدهی‌ها ({short(totalOutstandingDebt)} تومان) و اقساط ۶ ماه آینده
              </h3>
              <p className="text-[11px] text-[var(--text-3)]">
                اقساط وام‌ها و بیمه شخص ثالث در بازه ۶ ماهه آبان تا اردیبهشت: بالای <strong className="num text-[var(--negative)]">{short(scheduledInstallmentsToman)} تومان</strong>
              </p>
            </div>
          </div>

          {/* سوئیچ استراتژی بدهی */}
          <div className="flex items-center gap-1.5 bg-[var(--sunken)] p-1 rounded-xl border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setDebtStrategy("schedule")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                debtStrategy === "schedule"
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              پوشش اقساط سررسیدشده ۶ ماه ({short(scheduledInstallmentsToman)})
            </button>
            <button
              type="button"
              onClick={() => setDebtStrategy("full")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                debtStrategy === "full"
                  ? "bg-[var(--negative)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              تسویه کامل کل بدهی ({short(totalOutstandingDebt)})
            </button>
          </div>
        </div>

        {/* لیست اقساط و بدهی‌ها */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 pt-1">
          <div className="p-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)]">
            <span className="text-[11px] text-[var(--text-3)] block mb-0.5">کل مانده بدهی‌ها:</span>
            <span className="text-base font-black text-[var(--negative)] num">{full(totalOutstandingDebt)}</span>
            <span className="text-[10px] text-[var(--text-3)] block mt-0.5">شامل کلیه وام‌ها و تعهدات</span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)]">
            <span className="text-[11px] text-[var(--text-3)] block mb-0.5">اقساط ۶ ماه آینده (آبان-اردیبهشت):</span>
            <span className="text-base font-black text-[var(--text)] num">{full(scheduledInstallmentsToman)}</span>
            <span className="text-[10px] text-[var(--text-3)] block mt-0.5">وام‌ها + قسط ۹۰۹٬۰۹۰ ت بیمه</span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)]">
            <span className="text-[11px] text-[var(--text-3)] block mb-0.5">استراتژی اعمال‌شده در حسابگر:</span>
            <span className="text-xs font-bold text-[var(--accent)] block">
              {debtStrategy === "full" ? "تسویه یکجای ۴۵٫۹ میلیون" : "تأمین پله‌ای اقساط سررسید"}
            </span>
            <span className="text-[10px] text-[var(--text-3)] block mt-0.5">مبلغ منظور شده: {short(activeDebtBurdenToman)} ت</span>
          </div>
          <div className="p-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)]">
            <span className="text-[11px] text-[var(--text-3)] block mb-0.5">معادل تتری اقساط ۶ ماهه:</span>
            <span className="text-base font-black text-[var(--action)] num">
              {num(Math.ceil(scheduledInstallmentsToman / rate))} <small className="text-xs font-normal">تتر</small>
            </span>
            <span className="text-[10px] text-[var(--text-3)] block mt-0.5">
              فقط {toFaDigits(((scheduledInstallmentsToman / (totalUsdt * rate || 1)) * 100).toFixed(1))}٪ از کل تترها
            </span>
          </div>
        </div>
      </section>

      {/* ── ماژول طلایی: بودجه‌بندی خریدهای آینده، جهیزیه و مراسم عقد و عروسی ── */}
      <section className="card p-5 border-2 border-[var(--accent)]/50 rounded-2xl bg-[var(--surface)] shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-8 h-8 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] flex items-center justify-center">
                <Icon name="gift" size={18} />
              </span>
              <div>
                <h3 className="font-bold text-base text-[var(--text)]">
                  بودجه‌بندی هوشمند خریدهای آینده: جهیزیه، لوازم خانه و مراسم عقد و عروسی
                </h3>
                <p className="text-xs text-[var(--text-3)]">
                  اقلام حدسی و احتمالی آینده با قابلیت ویرایش، حذف، تفکیک دسته‌بندی و تعیین بودجه در صندوق تتر
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* دکمه بازنشانی اقلام پیش‌فرض */}
            <button
              type="button"
              onClick={resetPurchases}
              className="text-xs text-[var(--text-3)] hover:text-[var(--text)] px-2.5 py-1.5 rounded-xl border border-[var(--border)] bg-[var(--sunken)] flex items-center gap-1.5 transition-colors"
              title="بازگرداندن اقلام به ۲۸ قلم اولیه"
            >
              <Icon name="refresh" size={13} />
              <span>بازنشانی پیش‌فرض</span>
            </button>

            {/* کلید فعال/غیرفعال کردن اعمال در حسابگر نقدینگی */}
            <label className="flex items-center gap-2 cursor-pointer bg-[var(--sunken)] px-3 py-1.5 rounded-xl border border-[var(--border)] hover:bg-[var(--surface-hover)] transition-colors">
              <input
                type="checkbox"
                checked={includePurchases}
                onChange={(e) => setIncludePurchases(e.target.checked)}
                className="w-4 h-4 accent-[var(--action)] rounded cursor-pointer"
              />
              <span className="text-xs font-bold text-[var(--text)]">
                اعمال در نیاز نقدینگی صندوق تتر ({short(totalSelectedPurchasesToman)} ت)
              </span>
            </label>
          </div>
        </div>

        {/* بنر شفاف‌سازی: اقلام آزمایشی و پیش‌بینی شخصی هستند و هنوز در بودجه رسمی ثبت نشده‌اند */}
        <div className="p-3.5 rounded-xl bg-[var(--sunken)] border border-[var(--border)] flex items-start gap-3 text-xs leading-relaxed">
          <span className="p-1.5 rounded-lg bg-[var(--accent-soft)] text-[var(--accent)] shrink-0 mt-0.5">
            <Icon name="info" size={16} />
          </span>
          <div className="space-y-1">
            <p className="font-bold text-[var(--text)]">
              یادآوری: این اقلام، پیش‌بینی‌های شخصی شما در دستیار هستند و هنوز در بخش بودجه ثبت رسمی نشده‌اند
            </p>
            <p className="text-[11px] text-[var(--text-3)]">
              هیچ‌کدام از این خریدها قطعی نیستند و صرفاً تخمین ذهنی شما برای سنجش فشار نقدینگی و صندوق تترند. شما می‌توانید مبالغ را تغییر دهید، هر قلم را ویرایش یا حذف کنید، یا دسته‌های جدید اضافه نمایید. هر زمان تصمیم نهایی گرفتید، می‌توانید آن‌ها را ابتدا در بخش بودجه تعریف کنید.
            </p>
          </div>
        </div>

        {/* فیلتر دسته‌بندی‌ها با آیکون‌های اختصاصی و سرجمع هر بخش */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPurchaseFilter("all")}
              className={`py-1.5 px-3 text-xs rounded-xl font-semibold border transition-all flex items-center gap-1.5 ${
                purchaseFilter === "all"
                  ? "bg-[var(--action)] text-[var(--on-ink)] border-[var(--action)] shadow-sm"
                  : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-hover)]"
              }`}
            >
              <Icon name="receipt" size={13} />
              <span>همه اقلام</span>
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/15 num">
                {toFaDigits(String(purchases.length))}
              </span>
            </button>
            {dynamicCategories.map((cat) => (
              <button
                key={cat.key}
                type="button"
                onClick={() => setPurchaseFilter(cat.key)}
                className={`py-1.5 px-3 text-xs rounded-xl font-semibold border transition-all flex items-center gap-1.5 ${
                  purchaseFilter === cat.key
                    ? "bg-[var(--action)] text-[var(--on-ink)] border-[var(--action)] shadow-sm"
                    : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                <Icon name={cat.icon} size={13} />
                <span>{cat.label}</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/10 num">
                  {toFaDigits(String(cat.count))}
                </span>
              </button>
            ))}
          </div>

          <div className="text-xs font-bold text-[var(--text)] bg-[var(--accent-soft)] px-3 py-1.5 rounded-xl text-[var(--accent)] border border-[var(--accent)]/30">
            جمع خریدهای تیک‌خورده: <span className="num font-black text-sm">{full(totalSelectedPurchasesToman)}</span>
          </div>
        </div>

        {/* لیست اقلام با قابلیت ویرایش کامل، حذف، و تغییر سریع مبلغ */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-96 overflow-y-auto pr-1">
          {visiblePurchases.map((item) => {
            const isEditing = editingPurchaseId === item.id;
            const catMeta = KNOWN_PURCHASE_CATEGORIES[item.category];
            const catIcon = catMeta?.icon ?? "gift";
            const catLabel = catMeta?.label ?? item.categoryLabel ?? item.category;

            if (isEditing) {
              return (
                <div
                  key={item.id}
                  className="p-3 rounded-xl border border-[var(--action)] bg-[var(--surface)] shadow-md space-y-2.5"
                >
                  <div className="flex items-center justify-between text-xs font-bold text-[var(--text)]">
                    <span className="flex items-center gap-1.5 text-[var(--action)]">
                      <Icon name="edit" size={13} /> ویرایش قلم خرید
                    </span>
                    <button
                      type="button"
                      onClick={cancelEditPurchase}
                      className="text-[var(--text-3)] hover:text-[var(--text)]"
                    >
                      <Icon name="x" size={13} />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full text-xs font-bold bg-[var(--sunken)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] outline-none focus:border-[var(--action)]"
                    placeholder="عنوان خرید"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      step="500000"
                      value={editAmount}
                      onChange={(e) => setEditAmount(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full text-xs font-bold bg-[var(--sunken)] border border-[var(--border)] rounded-lg px-2 py-1 text-[var(--text)] num focus:border-[var(--action)] outline-none"
                      placeholder="مبلغ (تومان)"
                    />
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="text-xs bg-[var(--sunken)] border border-[var(--border)] rounded-lg px-2 py-1 text-[var(--text)] outline-none"
                    >
                      {Object.entries(KNOWN_PURCHASE_CATEGORIES).map(([key, meta]) => (
                        <option key={key} value={key}>
                          {meta.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={cancelEditPurchase}
                      className="px-2.5 py-1 rounded-lg text-xs bg-[var(--sunken)] text-[var(--text-3)] hover:text-[var(--text)]"
                    >
                      انصراف
                    </button>
                    <button
                      type="button"
                      onClick={saveEditPurchase}
                      className="px-3 py-1 rounded-lg text-xs font-bold bg-[var(--action)] text-[var(--on-ink)] flex items-center gap-1 shadow-xs"
                    >
                      <Icon name="check" size={12} /> ذخیره
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={item.id}
                className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
                  item.selected
                    ? "bg-[var(--surface)] border-[var(--border-strong)] shadow-xs"
                    : "bg-[var(--sunken)]/60 border-[var(--border)] opacity-60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => togglePurchase(item.id)}
                      className="w-4 h-4 accent-[var(--action)] rounded cursor-pointer shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--text)] truncate">{item.title}</p>
                      <div className="flex items-center gap-1 mt-0.5 text-[10px] text-[var(--text-3)]">
                        <Icon name={catIcon} size={11} />
                        <span>{catLabel}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => startEditPurchase(item)}
                      className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--sunken)] transition-colors"
                      title="ویرایش قلم خرید"
                    >
                      <Icon name="edit" size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => deletePurchase(item.id)}
                      className="p-1.5 rounded-lg text-[var(--text-3)] hover:text-[var(--negative)] hover:bg-[var(--negative)]/10 transition-colors"
                      title="حذف قلم خرید"
                    >
                      <Icon name="trash" size={13} />
                    </button>
                  </div>
                </div>

                {/* فیلد تغییر مستقیم مبلغ */}
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--border)]/70">
                  <span className="text-[10px] text-[var(--text-3)] font-medium">مبلغ برآوردی:</span>
                  <div className="w-28 shrink-0">
                    <input
                      type="number"
                      step="500000"
                      value={item.estimatedToman}
                      onChange={(e) => updatePurchaseAmount(item.id, Number(e.target.value) || 0)}
                      disabled={!item.selected}
                      className="w-full text-right text-xs font-bold bg-[var(--sunken)] border border-[var(--border)] rounded-lg px-2 py-1 text-[var(--text)] num focus:border-[var(--action)] outline-none"
                      title="مبلغ برآوردی (تومان)"
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* فرم اضافه کردن خرید جدید با انتخاب دسته و لوگوی اختصاصی */}
        <div className="p-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)] flex flex-wrap items-center gap-2 text-xs">
          <span className="font-bold text-[var(--text)] flex items-center gap-1 shrink-0">
            <Icon name="plus" size={14} /> افزودن قلم جدید:
          </span>
          <input
            type="text"
            placeholder="عنوان خرید (مثلاً لوستر یا اتو بخار...)"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="flex-1 min-w-[180px] bg-[var(--surface)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-[var(--text)] outline-none focus:border-[var(--action)]"
          />
          <input
            type="number"
            step="1000000"
            placeholder="مبلغ (تومان)"
            value={newAmount}
            onChange={(e) => setNewAmount(Math.max(0, Number(e.target.value) || 0))}
            className="w-32 bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] num font-semibold outline-none focus:border-[var(--action)]"
          />
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="bg-[var(--surface)] border border-[var(--border)] rounded-lg px-2.5 py-1.5 text-[var(--text)] outline-none"
          >
            {Object.entries(KNOWN_PURCHASE_CATEGORIES).map(([key, meta]) => (
              <option key={key} value={key}>
                {meta.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={addNewPurchase}
            className="px-3.5 py-1.5 rounded-lg bg-[var(--action)] text-[var(--on-ink)] font-bold hover:opacity-90 transition-opacity shrink-0 flex items-center gap-1"
          >
            <Icon name="plus" size={13} /> افزودن
          </button>
        </div>
      </section>

      {/* ── بخش سناریوسازی اشتغال: قرارداد موقت ۳ ماهه در برابر بیکاری و تمدید ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[var(--mint-soft,var(--accent-soft))] text-[var(--accent)] flex items-center justify-center">
              <Icon name="briefcase" size={18} />
            </span>
            <div>
              <h3 className="font-bold text-sm text-[var(--text)]">سناریوسازی وضعیت اشتغال، قرارداد موقت و حقوق در آینده</h3>
              <p className="text-[11px] text-[var(--text-3)]">بررسی قرارداد ۳ ماهه و ریسک بیکاری مجدد در مقایسه با عدم اشتغال یا استخدام پایدار</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 bg-[var(--sunken)] p-1 rounded-xl border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setJobScenario("unemployed")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                jobScenario === "unemployed"
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              وضعیت فعلی (بدون شغل)
            </button>
            <button
              type="button"
              onClick={() => setJobScenario("contract_3m")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                jobScenario === "contract_3m"
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              قرارداد ۳ ماهه (ریسک بیکاری مجدد)
            </button>
            <button
              type="button"
              onClick={() => setJobScenario("contract_renewed")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                jobScenario === "contract_renewed"
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              قرارداد ۳ ماهه با تمدید
            </button>
            <button
              type="button"
              onClick={() => setJobScenario("stable")}
              className={`py-1.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                jobScenario === "stable"
                  ? "bg-[var(--action)] text-[var(--on-ink)] shadow-sm"
                  : "text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              استخدام دائم و باثبات
            </button>
          </div>
        </div>

        {isJobActive ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
              <div className="md:col-span-5">
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">
                  حقوق ماهانه قرارداد / شغل (تومان):
                </label>
                <input
                  type="number"
                  step="1000000"
                  value={monthlySalary}
                  onChange={(e) => setMonthlySalary(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[var(--sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] num font-bold focus:border-[var(--action)] outline-none"
                />
              </div>

              <div className="md:col-span-7">
                <label className="block text-xs font-medium text-[var(--text-3)] mb-1">
                  پیش‌فرض‌های حقوقی در بازار کار:
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {[15_000_000, 20_000_000, 25_000_000, 35_000_000, 50_000_000].map((sal) => (
                    <button
                      key={sal}
                      type="button"
                      onClick={() => setMonthlySalary(sal)}
                      className={`px-3 py-1.5 text-xs rounded-xl border num font-medium transition-all ${
                        monthlySalary === sal
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)] font-bold shadow-xs"
                          : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-hover)]"
                      }`}
                    >
                      {short(sal)} تومان
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* مدت قرارداد موقت در صورت انتخاب سناریوی قرارداد */}
            {(jobScenario === "contract_3m" || jobScenario === "contract_renewed") && (
              <div className="p-3 rounded-xl bg-[var(--sunken)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-[var(--text)]">مدت قرارداد اولیه:</span>
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 6].map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setContractMonths(m)}
                        className={`px-2.5 py-1 rounded-lg border num text-xs ${
                          contractMonths === m
                            ? "bg-[var(--action)] text-[var(--on-ink)] font-bold"
                            : "bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)]"
                        }`}
                      >
                        {toFaDigits(String(m))} ماهه
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[11px] text-[var(--text-3)]">
                  <span>پوشش با حقوق: <strong className="num text-[var(--positive)]">{toFaDigits(String(activeSalaryMonths))} ماه</strong></span>
                  {monthsAtRisk > 0 && (
                    <span>ریسک بازگشت به بیکاری: <strong className="num text-[var(--negative)]">{toFaDigits(String(monthsAtRisk))} ماه</strong></span>
                  )}
                </div>
              </div>
            )}

            {/* کارت هایلایت تأثیر اشتغال بر حفظ تترها */}
            <div className="p-4 rounded-xl bg-[var(--positive-soft)] border border-[var(--positive)] text-[var(--positive)] flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-sm">
                  <Icon name="check" size={16} />
                  {jobScenario === "contract_3m" ? (
                    <>پوشش قرارداد موقت: نجات <span className="num font-black text-base">{num(savedUsdtWithJob)} تتر</span> از فروش اجباری!</>
                  ) : (
                    <>معجزه اشتغال: نجات <span className="num font-black text-base">{num(savedUsdtWithJob)} تتر</span> از فروش اجباری در این دوره!</>
                  )}
                </p>
                <p className="text-[11px] opacity-90 leading-relaxed">
                  {jobScenario === "contract_3m" ? (
                    <>در طول {toFaDigits(String(activeSalaryMonths))} ماه قرارداد، حقوق دریافتی ({short(totalSalaryInHorizon)} تومان) مخارج را پوشش می‌دهد و فروش تتر متوقف می‌شود. برای {toFaDigits(String(monthsAtRisk))} ماه باقیمانده که ریسک بیکاری وجود دارد، معادل <strong className="num">{num(activeNeededUsdt)} تتر</strong> برای فروش در بیت‌پین برنامه‌ریزی شده است.</>
                  ) : (
                    <>با این حقوق، فروش تتر شما از <strong className="num">{num(neededUsdtBase)} تتر</strong> به <strong className="num">{num(activeNeededUsdt)} تتر</strong> کاهش می‌یابد و تترهای شما برای جهش‌های بازار و سرمایه‌گذاری حفظ می‌شوند.</>
                  )}
                </p>
              </div>
              <div className="text-right num font-black text-lg shrink-0">
                +{short(savedUsdtWithJob * rate)} <span className="text-xs font-normal">تومان ارزش حفظ‌شده</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-[var(--text-3)] leading-relaxed">
            در این حالت، سیستم فرض می‌کند درآمد فعالی ندارید و تمامی مخارج، اقساط ۶ ماه آینده و خریدهای پیش‌رو از محل صندوق تتری و موجودی ریالی تأمین می‌شود. این حالت بقای شما را با حفظ ۹۰٪ سرمایه ترید تضمین می‌کند.
          </p>
        )}
      </section>

      {/* ── ۴ کارت اتصال زنده به حساب‌ها (Kashi Design) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* تومان در بانک */}
        <div className="card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">تومان در بانک</span>
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--positive)]" title="متصل" />
          </div>
          <p className="text-xl font-black text-[var(--text)] num">{short(bankToman)} <small className="text-xs font-normal">تومان</small></p>
          <p className="text-[11px] text-[var(--text-3)] mt-1 truncate">
            {bankAccounts.length > 0 ? bankAccounts.map((a) => a.name).join(" · ") : "حساب‌های بانکی متصل"}
          </p>
        </div>

        {/* تومان در صرافی بیت‌پین */}
        <div className="card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">تومان در بیت‌پین / صرافی</span>
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--accent)]" title="آماده تسویه پایا" />
          </div>
          <p className="text-xl font-black text-[var(--text)] num">{short(exchangeToman)} <small className="text-xs font-normal">تومان</small></p>
          <p className="text-[11px] text-[var(--text-3)] mt-1">آماده پایا به بانک (بدون ترید)</p>
        </div>

        {/* موجودی تتر */}
        <div className="card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">کل موجودی تتر (استیبل‌کوین)</span>
            <Icon name="crypto" size={15} className="text-[var(--text-3)]" />
          </div>
          <p className="text-xl font-black text-[var(--text)] num">{num(totalUsdt)} <small className="text-xs font-normal">تتر</small></p>
          <p className="text-[11px] text-[var(--text-3)] mt-1">ارزش ریالی: {short(totalUsdt * rate)} تومان</p>
        </div>

        {/* نرخ تتر / دلار */}
        <div className="card p-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)] transition-colors">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-[var(--text-2)]">نرخ تبدیل تتر (تومان)</span>
            <span className="text-[10px] text-[var(--text-3)]">قابل ویرایش</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={rate}
              onChange={(e) => setRate(Math.max(1000, Number(e.target.value) || baseRate))}
              className="w-full text-base font-bold bg-[var(--sunken)] border border-[var(--border)] rounded-lg px-2.5 py-1 text-[var(--text)] num outline-none focus:border-[var(--action)]"
            />
          </div>
          <div className="flex flex-wrap gap-1 mt-2">
            <button
              type="button"
              onClick={() => setRate(baseRate)}
              className={`px-2 py-0.5 text-[10px] rounded-md border num ${
                rate === baseRate ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)] font-bold" : "bg-[var(--sunken)] text-[var(--text-3)] border-[var(--border)]"
              }`}
            >
              نرخ روز ({short(baseRate)})
            </button>
            {HIGH_INFLATION_PRESET_RATES.map((pr) => (
              <button
                key={pr}
                type="button"
                onClick={() => setRate(pr)}
                className={`px-2 py-0.5 text-[10px] rounded-md border num transition-all ${
                  rate === pr ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)] font-bold" : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-hover)]"
                }`}
              >
                {short(pr)}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-3)] mt-1.5 leading-tight">
            سناریوهای صعود تتر تا ۵۵۰ هزار تومان (در نرخ‌های بالا تتر بسیار کمتری فروخته می‌شود).
          </p>
        </div>
      </div>

      {/* ── پنل محاسباتی تعاملی و نتایج تبدیل ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* ستون راست: تنظیمات افق زمانی و هزینه‌ها (7 ستون) */}
        <div className="lg:col-span-7 space-y-4">
          <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
              <Icon name="overview" size={16} />
              تنظیمات افق زمانی و هزینه‌های زندگی
            </h3>

            {/* انتخاب افق زمانی */}
            <div>
              <label className="block text-xs font-medium text-[var(--text-2)] mb-1.5">افق زمانی برنامه‌ریزی نقدینگی:</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { key: 1, label: "۱ ماهه (۳۰ روز)" },
                  { key: 2, label: "۲ ماهه (۶۰ روز)" },
                  { key: 3, label: "۳ ماهه (فصلی)" },
                  { key: 6, label: "۶ ماهه (پیش‌فرض)" },
                ].map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setHorizon(item.key as Horizon)}
                    className={`py-2 px-1 text-xs rounded-xl font-semibold border transition-all ${
                      horizon === item.key
                        ? "bg-[var(--action)] text-[var(--on-ink)] border-[var(--action)] shadow-sm"
                        : "bg-[var(--sunken)] text-[var(--text-2)] border-[var(--border)] hover:bg-[var(--surface-hover)]"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* هزینه ماهانه زندگی */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">
                  مخارج ماهانه زندگی (تومان):
                </label>
                <input
                  type="number"
                  step="1000000"
                  value={monthlyExpense}
                  onChange={(e) => setMonthlyExpense(Math.max(0, Number(e.target.value) || 0))}
                  className="w-full bg-[var(--sunken)] border border-[var(--border)] rounded-xl px-3 py-2 text-sm text-[var(--text)] num font-bold focus:border-[var(--action)] outline-none"
                />
                <span className="text-[11px] text-[var(--text-3)] mt-1 block">
                  میانگین واقعی سیستم: {short(defaultMonthlyExpense)} تومان
                </span>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--text-2)] mb-1">
                  حاشیه اطمینان نوسان و فورس‌ماژور:
                </label>
                <div className="grid grid-cols-4 gap-1.5">
                  {[0, 5, 10, 15].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setBufferPct(pct)}
                      className={`py-2 text-xs rounded-xl font-semibold border ${
                        bufferPct === pct
                          ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]"
                          : "bg-[var(--sunken)] text-[var(--text-3)] border-[var(--border)]"
                      }`}
                    >
                      {toFaDigits(String(pct))}٪
                    </button>
                  ))}
                </div>
                <span className="text-[11px] text-[var(--text-3)] mt-1 block">
                  مبلغ حاشیه: {short(bufferToman)} تومان
                </span>
              </div>
            </div>

            {/* خلاصه ریز تعهدات در افق انتخابی */}
            <div className="pt-2 border-t border-[var(--border)] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-[var(--text)]">
                  اقساط قطعی در افق {toFaDigits(String(horizon))} ماهه ({toFaDigits(String(obligationsInWindow.length))} مورد):
                </span>
                <span className="font-black text-[var(--negative)] num">{full(scheduledInstallmentsToman)}</span>
              </div>

              {obligationsInWindow.length > 0 && (
                <ul className="space-y-1.5 max-h-36 overflow-y-auto pr-1 text-xs">
                  {obligationsInWindow.map((o, idx) => (
                    <li
                      key={`${o.date}-${o.title}-${idx}`}
                      className="flex items-center justify-between p-2 rounded-lg bg-[var(--sunken)] border border-[var(--border)]"
                    >
                      <div className="flex items-center gap-2">
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-[var(--surface)] text-[var(--text-2)] num">
                          {formatShortDate(o.date)}
                        </span>
                        <span className="font-medium text-[var(--text)]">{o.title}</span>
                      </div>
                      <span className="font-semibold text-[var(--text)] num">{full(o.toman)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </div>

        {/* ستون چپ: خروجی حسابگر و تعداد تتر لازم برای انتقال (5 ستون) */}
        <div className="lg:col-span-5 space-y-4">
          <section className="card p-5 border-2 border-[var(--action)] rounded-2xl bg-[var(--surface)] shadow-md space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--action)] uppercase tracking-wider">
                نتیجه نهایی محاسبات {isJobActive ? (jobScenario === "contract_3m" ? "(سناریوی قرارداد ۳ ماهه)" : "(سناریوی اشتغال)") : "(سناریوی بدون شغل)"}
              </span>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-[var(--sunken)] text-[var(--text-3)] font-semibold">
                افق {toFaDigits(String(horizon))} ماهه
              </span>
            </div>

            <div className="space-y-2 text-xs text-[var(--text-2)]">
              <div className="flex justify-between">
                <span>مخارج زندگی ({toFaDigits(String(horizon))} ماه):</span>
                <span className="font-semibold text-[var(--text)] num">{full(totalLivingToman)}</span>
              </div>
              <div className="flex justify-between">
                <span>
                  {debtStrategy === "full" ? "تسویه کامل کل بدهی‌ها:" : `اقساط دوره (${toFaDigits(String(horizon))} ماه):`}
                </span>
                <span className="font-semibold text-[var(--negative)] num">{full(activeDebtBurdenToman)}</span>
              </div>
              {includePurchases && totalSelectedPurchasesToman > 0 && (
                <div className="flex justify-between text-[var(--accent)] font-semibold">
                  <span>خریدهای آینده (عقد، عروسی و خانه):</span>
                  <span className="num">+{full(totalSelectedPurchasesToman)}</span>
                </div>
              )}
              {bufferPct > 0 && (
                <div className="flex justify-between text-[var(--text-3)]">
                  <span>حاشیه اطمینان ({toFaDigits(String(bufferPct))}٪):</span>
                  <span className="num">+{short(bufferToman)} تومان</span>
                </div>
              )}
              <div className="flex justify-between pt-2 border-t border-[var(--border)] font-bold text-sm text-[var(--text)]">
                <span>کل خروجی نقدی مورد نیاز:</span>
                <span className="num">{full(grossNeedToman)}</span>
              </div>
              <div className="flex justify-between text-[var(--positive)]">
                <span>موجودی تومان نقد (بانک + صرافی):</span>
                <span className="num font-semibold">−{full(readyToman)}</span>
              </div>
              {isJobActive && totalSalaryInHorizon > 0 && (
                <div className="flex justify-between text-[var(--positive)] font-bold">
                  <span>درآمد حقوقی در این افق ({toFaDigits(String(activeSalaryMonths))} ماه):</span>
                  <span className="num">−{full(totalSalaryInHorizon)}</span>
                </div>
              )}
            </div>

            {/* کادر کسری یا مازاد نقدینگی و تتر لازم */}
            <div
              className={`p-4 rounded-xl border ${
                activeDeficitToman > 0
                  ? "bg-[var(--negative-soft)] border-[var(--negative)] text-[var(--negative)]"
                  : "bg-[var(--positive-soft)] border-[var(--positive)] text-[var(--positive)]"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold">
                  {activeDeficitToman > 0 ? "کسری نقدینگی ریالی نهایی" : "پوشش کامل ریالی (بدون نیاز به تتر)"}
                </span>
                <span className="text-sm font-black num">
                  {activeDeficitToman > 0
                    ? full(activeDeficitToman)
                    : `${full(readyToman + totalSalaryInHorizon - grossNeedToman)} مازاد`}
                </span>
              </div>

              {activeDeficitToman > 0 ? (
                <div className="mt-3 pt-3 border-t border-black/10 dark:border-white/10">
                  <p className="text-xs text-[var(--text-2)] mb-1">تتر مورد نیاز جهت فروش در بیت‌پین:</p>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-black text-[var(--text)] num">{num(activeNeededUsdt)}</span>
                    <span className="text-sm font-bold text-[var(--text)]">تتر</span>
                    {isJobActive && savedUsdtWithJob > 0 && (
                      <span className="text-xs text-[var(--positive)] mr-auto font-bold">
                        ({num(savedUsdtWithJob)} تتر کمتر از حالت بدون شغل)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--text-3)] mt-2">
                    مانده تتر پس از تبدیل: <strong className="num text-[var(--text)]">{num(activeRemainingUsdt)} تتر</strong>
                  </p>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-2)] mt-2">
                  {isJobActive
                    ? "با درآمد حاصل از شغل یا قرارداد، تمام هزینه‌ها، اقساط و خریدهای آینده پوشش داده می‌شود و نیازی به فروش تتر ندارید!"
                    : "موجودی تومان در بانک و بیت‌پین برای کل این دوره کافی است و نیازی به تبدیل تتر ندارید."}
                </p>
              )}
            </div>

            {/* دکمه ارسال به دستیار هوشمند */}
            <button
              type="button"
              onClick={askAssistantWithScenario}
              className="w-full py-2.5 px-3 rounded-xl bg-[var(--action)] text-[var(--on-ink)] font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 transition-opacity"
            >
              <Icon name="sparkle" size={14} />
              تحلیل تخصصی این سناریو و فازبندی هزینه‌ها با دستیار
            </button>
          </section>
        </div>
      </div>

      {/* ── جدول ماتریس تحلیل حساسیت نرخ تتر (FX Sensitivity Analysis) ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
              <Icon name="reports" size={16} />
              ماتریس تحلیل حساسیت: اگر قیمت دلار تغییر کند، چند تتر باید بفروشید؟
            </h3>
            <p className="text-xs text-[var(--text-3)] mt-0.5">
              مهندسی سناریوهای نوسان و صعود نرخ تتر (۳۲۰ تا ۵۵۰ هزار تومان) برای کسری نقدینگی {short(activeDeficitToman)} تومان:
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-right border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-3)] bg-[var(--sunken)]">
                <th className="py-2.5 px-3">سناریوی نرخ تتر</th>
                <th className="py-2.5 px-3">نرخ هر تتر (تومان)</th>
                <th className="py-2.5 px-3">تتر لازم جهت فروش</th>
                <th className="py-2.5 px-3">مانده تتر پس از فروش</th>
                <th className="py-2.5 px-3">درصد حفظ سرمایه</th>
                <th className="py-2.5 px-3">صرفه‌جویی و ارزیابی فنی</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {sensitivityRates.map((r) => {
                const req = activeDeficitToman > 0 ? Math.ceil(activeDeficitToman / r) : 0;
                const rem = Math.max(0, totalUsdt - req);
                const preservedPct = totalUsdt > 0 ? Math.round((rem / totalUsdt) * 100) : 100;
                const isCurrent = r === rate;

                const label =
                  r === Math.round(baseRate)
                    ? "نرخ روز بازار"
                    : r === 320_000
                      ? "جهش تورمی ۳۲۰ ه.ت"
                      : r === 370_000
                        ? "جهش تورمی ۳۷۰ ه.ت"
                        : r === 420_000
                          ? "جهش تورمی ۴۲۰ ه.ت"
                          : r === 450_000
                            ? "جهش تورمی ۴۵۰ ه.ت"
                            : r === 500_000
                              ? "جهش تورمی ۵۰۰ ه.ت"
                              : r === 550_000
                                ? "جهش تورمی ۵۵۰ ه.ت"
                                : isCurrent
                                  ? "نرخ انتخابی فعلی"
                                  : r > rate
                                    ? `صعود به ${short(r)}`
                                    : `افت به ${short(r)}`;

                const savedComparedToBase =
                  baseRate > 0 && activeDeficitToman > 0
                    ? Math.max(0, Math.ceil(activeDeficitToman / baseRate) - req)
                    : 0;

                return (
                  <tr
                    key={r}
                    className={`transition-colors ${
                      isCurrent
                        ? "bg-[var(--accent-soft)]/40 font-bold"
                        : "hover:bg-[var(--sunken)]"
                    }`}
                  >
                    <td className="py-2.5 px-3 flex items-center gap-1.5">
                      {isCurrent && <span className="w-1.5 h-1.5 rounded-full bg-[var(--action)]" />}
                      <span>{label}</span>
                    </td>
                    <td className="py-2.5 px-3 num font-semibold">{num(r)} تومان</td>
                    <td className="py-2.5 px-3 num text-[var(--negative)] font-black">
                      {num(req)} تتر
                    </td>
                    <td className="py-2.5 px-3 num text-[var(--positive)] font-semibold">
                      {num(rem)} تتر
                    </td>
                    <td className="py-2.5 px-3 num">{toFaDigits(String(preservedPct))}٪</td>
                    <td className="py-2.5 px-3 text-[var(--text-3)]">
                      {r >= 320_000 ? (
                        <span className="text-[var(--positive)] font-semibold">
                          صرفه‌جویی {num(savedComparedToBase)} تتر نسبت به نرخ روز
                        </span>
                      ) : r > rate ? (
                        "صرفه‌جویی در تتر با افزایش نرخ"
                      ) : r < rate ? (
                        "نیاز به تبدیل تتر بیشتر"
                      ) : (
                        "مبنای فعلی محاسبات شما"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── گفتگوی مستقیم و سوالات تخصصی با دستیار هوشمند ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4 shadow-xs">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Icon name="sparkle" size={18} />
            </span>
            <div>
              <h3 className="font-bold text-base text-[var(--text)]">
                گفتگوی مستقیم و مشاوره تخصصی با دستیار هوشمند
              </h3>
              <p className="text-xs text-[var(--text-3)] mt-0.5">
                پرسش‌های تخصصی متناسب با شرایط قرارداد ۳ ماهه، صعود تتر تا ۵۵۰ هزار تومان، و به‌روزرسانی تحلیل‌ها
              </p>
            </div>
          </div>
        </div>

        {/* پیشنهادهای سریع سوال تخصصی بر اساس پارامترهای زنده */}
        <div>
          <label className="block text-xs font-semibold text-[var(--text-2)] mb-2">
            پیشنهادهای سوال تخصصی بر اساس پارامترهای فعال شما:
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ASSISTANT_QUICK_QUESTIONS.map((q) => (
              <button
                key={q.title}
                type="button"
                onClick={() => askAssistantQuestion(q.prompt)}
                className="p-3 text-right rounded-xl border border-[var(--border)] bg-[var(--sunken)] hover:bg-[var(--surface-hover)] hover:border-[var(--border-strong)] transition-all flex flex-col gap-1 text-xs"
              >
                <div className="flex items-center justify-between">
                  <strong className="text-[var(--text)] font-bold">{q.title}</strong>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--surface)] text-[var(--text-3)] border border-[var(--border)]">
                    {q.badge}
                  </span>
                </div>
                <p className="text-[11px] text-[var(--text-3)] line-clamp-2 leading-relaxed">
                  {q.desc}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* کادر ورودی سوال دلخواه از دستیار */}
        <div className="space-y-2 pt-2 border-t border-[var(--border)]">
          <label className="block text-xs font-semibold text-[var(--text-2)]">
            یا سوال اختصاصی و شرایط خود را مستقیماً از دستیار بپرسید:
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              rows={2}
              value={customQuestion}
              onChange={(e) => setCustomQuestion(e.target.value)}
              placeholder="مثال: اگر قراردادم تمدید نشد و تتر تا ۴۵۰ هزار بالا رفت، قسط‌ها و خرید جهیزیه را چطور هماهنگ کنم؟"
              className="flex-1 bg-[var(--sunken)] border border-[var(--border)] rounded-xl p-3 text-xs text-[var(--text)] placeholder:text-[var(--text-3)] outline-none focus:border-[var(--action)] resize-none"
            />
            <button
              type="button"
              onClick={() => {
                if (customQuestion.trim()) {
                  askAssistantQuestion(customQuestion.trim());
                  setCustomQuestion("");
                }
              }}
              disabled={!customQuestion.trim()}
              className="py-2.5 px-4 rounded-xl bg-[var(--action)] text-[var(--on-ink)] font-bold text-xs flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 transition-opacity disabled:opacity-50 shrink-0 sm:self-stretch"
            >
              <Icon name="sparkle" size={14} />
              ارسال سوال به دستیار
            </button>
          </div>
        </div>

        {/* دکمه ارسال گزارش کامل سناریو */}
        <div className="pt-2 flex justify-end">
          <button
            type="button"
            onClick={askAssistantWithScenario}
            className="text-xs text-[var(--text-2)] hover:text-[var(--text)] flex items-center gap-1.5 underline decoration-dotted"
          >
            <Icon name="reports" size={13} />
            ارسال کل اطلاعات و اعداد این سناریو به گفتگوی دستیار
          </button>
        </div>
      </section>

      {/* ── مراحل ۳ گانه تأمین نقدینگی (بیت‌پین → بانک → اقساط و خریدها) ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <Icon name="swap" size={16} />
            مراحل اجرایی تأمین نقدینگی (بیت‌پین → بانک → اقساط و خریدها)
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1">
            برای جلوگیری از اتلاف کارمزد و استرس سررسید، مراحل تبدیل و انتقال را دقیقاً در سه گام زیر اجرا کنید:
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {/* گام ۱ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[var(--action)] text-[var(--on-ink)] text-xs font-black flex items-center justify-center num">
                ۱
              </span>
              <span className="text-xs font-bold text-[var(--text)]">فروش تتر در بیت‌پین</span>
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              تعداد <strong className="num text-[var(--text)]">{num(activeNeededUsdt)} تتر</strong> را در بازار تتر/تومان صرافی بیت‌پین به صورت سفارش عادی (Maker) برای کاهش کارمزد بفروشید.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              ارزش تومانی حاصل: <strong className="num text-[var(--text)]">{short(activeNeededUsdt * rate)} تومان</strong>
            </div>
          </div>

          {/* گام ۲ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[var(--action)] text-[var(--on-ink)] text-xs font-black flex items-center justify-center num">
                ۲
              </span>
              <span className="text-xs font-bold text-[var(--text)]">تسویه پایا به حساب بانکی</span>
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              مبلغ <strong className="num text-[var(--text)]">{short(activeDeficitToman)} تومان</strong> را از کیف پول ریالی بیت‌پین به حساب بانکی اصلی خود (مثلاً سامان یا بلوبانک) ثبت برداشت کنید.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              زمان تسویه: سیکل‌های پایا (حدود ساعت ۳:۴۵ یا ۱۳:۴۵ کاری)
            </div>
          </div>

          {/* گام ۳ */}
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-[var(--positive)] text-[var(--on-ink)] text-xs font-black flex items-center justify-center num">
                ۳
              </span>
              <span className="text-xs font-bold text-[var(--text)]">پرداخت اقساط و اجرای خریدها</span>
            </div>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              اقساط ۶ ماه آینده را در موعد سررسید تسویه کنید و مبالغ خرید لوازم خانه، عقد یا جهیزیه را طبق فازبندی اجرا نمایید.
            </p>
            <div className="text-[11px] text-[var(--text-3)] pt-1 border-t border-[var(--border)]">
              آرامش فکری: استرس روزمره از معاملات ترید کاملاً حذف می‌شود.
            </div>
          </div>
        </div>
      </section>

      {/* ── فازبندی مهندسی‌شده خریدهای بزرگ زندگی و مدیریت ترید ── */}
      <section className="card p-5 border border-[var(--border)] rounded-2xl bg-[var(--surface)] space-y-4">
        <div>
          <h3 className="font-bold text-base text-[var(--text)] flex items-center gap-2">
            <Icon name="shield" size={16} />
            نقشه راه مهندسی مالی: فازبندی ۳ مرحله‌ای خریدهای زندگی و مدیریت ریسک
          </h3>
          <p className="text-xs text-[var(--text-3)] mt-1">
            چگونه خرید لوازم خانه، طلا و مراسم عقد/عروسی را بدون شوک به ثروت مدیریت کنیم؟
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <span className="text-xs font-bold text-[var(--accent)] flex items-center gap-1.5">
              <Icon name="sparkle" size={14} /> فاز ۱: مراسم عقد و محضر
            </span>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              هزینه‌های کم‌حجم‌تر اما ضروری (لباس، آرایش، حلقه، محضر، عکاسی). این فاز اولویت زمانی دارد و باید از ریال نقد و تبدیل پله‌ای تتر تأمین شود.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <span className="text-xs font-bold text-[var(--action)] flex items-center gap-1.5">
              <Icon name="overview" size={14} /> فاز ۲: خرید تجهیزات ضروری خانه
            </span>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              جاروبرقی، بخاری، پرده‌ها، اتو و سرویس خواب. خریدها را به تدریج و در حراج‌ها یا با کارت‌های اقساطی انجام دهید تا نقدینگی یکجا خارج نشود.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--sunken)] space-y-2">
            <span className="text-xs font-bold text-[var(--positive)] flex items-center gap-1.5">
              <Icon name="trend-up" size={14} /> فاز ۳: طلای عروس و تالار عروسی
            </span>
            <p className="text-xs text-[var(--text-2)] leading-relaxed">
              سنگین‌ترین بخش بودجه. طلا خود یک دارایی سرمایه‌ای ضد تورم است؛ اما برای تالار و شام، در صورت یافتن شغل یا پس از تثبیت سود تریدها اقدام کنید.
            </p>
          </div>
        </div>

        {/* اسلایدر تخصیص سرمایه به ترید */}
        <div className="p-4 rounded-xl bg-[var(--sunken)] border border-[var(--border)] flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-xs font-bold text-[var(--text)]">سهم سرمایه اختصاص‌یافته به ترید فعال:</p>
            <p className="text-[11px] text-[var(--text-3)]">
              از کل {num(totalUsdt)} تتر: معادل <strong className="num text-[var(--text)]">{num(safeTradingUsdt)} تتر</strong> درگیر در ترید و <strong className="num text-[var(--positive)]">{num(emergencyReserveUsdt)} تتر</strong> در صندوق امنیت دست‌نخورده
            </p>
          </div>
          <div className="flex items-center gap-2">
            {[5, 10, 15, 20].map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setTradingPortionPct(p)}
                className={`py-1 px-3 text-xs rounded-lg font-bold border transition-colors ${
                  tradingPortionPct === p
                    ? "bg-[var(--action)] text-[var(--on-ink)] border-[var(--action)]"
                    : "bg-[var(--surface)] text-[var(--text-2)] border-[var(--border)]"
                }`}
              >
                {toFaDigits(String(p))}٪
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
