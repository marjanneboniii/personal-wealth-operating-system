/**
 * Deterministic financial analysis behind the assistant dashboard.
 *
 * PURE: no database, no network, no model. Every figure the assistant states
 * as a fact comes from here or from the read services that feed it — the
 * language model only explains, combines and asks. That keeps the numbers
 * reproducible and testable, and means the dashboard works (and the most
 * important suggestion is shown) even when Gemini is not configured.
 *
 * Money is Toman, as plain numbers rounded to the Toman: these are analysis
 * figures for display and reasoning, never written back to the ledger.
 */

export type Severity = "critical" | "warning" | "opportunity" | "info";

export type Finding = {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  href?: string;
  /** Higher = more important. The top one is «مهم‌ترین پیشنهاد دستیار». */
  score: number;
};

export type BudgetInput = {
  name: string;
  limitToman: number;
  spentToman: number;
  periodStart: string;
  periodEnd: string;
};

export type BudgetForecast = BudgetInput & {
  usagePct: number;
  /** Spend at the period's end if the pace so far continues. */
  projectedToman: number;
  projectedPct: number;
  daysLeft: number;
  /** Date the ceiling is reached at the current pace, when it falls inside the period. */
  exhaustDate: string | null;
  status: "ok" | "at_risk" | "over";
};

const DAY = 86_400_000;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/** Linear pace forecast — honest about its own simplicity (it says «با همین روند»). */
export function forecastBudget(b: BudgetInput, today: string): BudgetForecast {
  const start = dayNum(b.periodStart);
  const end = dayNum(b.periodEnd);
  const now = Math.min(Math.max(dayNum(today), start), end);
  const totalDays = Math.max(1, end - start + 1);
  const elapsed = Math.max(1, now - start + 1);
  const daysLeft = Math.max(0, end - now);
  const usagePct = b.limitToman > 0 ? (b.spentToman / b.limitToman) * 100 : 0;
  const daily = b.spentToman / elapsed;
  const projectedToman = Math.round(daily * totalDays);
  const projectedPct = b.limitToman > 0 ? (projectedToman / b.limitToman) * 100 : 0;
  let exhaustDate: string | null = null;
  if (b.limitToman > 0 && b.spentToman < b.limitToman && daily > 0) {
    const at = now + Math.ceil((b.limitToman - b.spentToman) / daily);
    if (at <= end) exhaustDate = isoOf(at);
  }
  const status = b.spentToman > b.limitToman && b.limitToman > 0 ? "over" : projectedPct > 100 ? "at_risk" : "ok";
  return { ...b, usagePct, projectedToman, projectedPct, daysLeft, exhaustDate, status };
}

export type TxLite = {
  id: string;
  date: string;
  description: string;
  amountToman: number;
  category: string | null;
};

const normalizeDesc = (s: string) =>
  s
    .replace(/[0-9۰-۹٠-٩]+/g, " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/**
 * Possible double payments: same amount, same (normalised) description, at
 * most `windowDays` apart. Only a CANDIDATE — rent paid twice in a month is
 * fine — so it is reported as «احتمال», with the ids for the user to check.
 */
export function findDuplicateCandidates(txs: TxLite[], windowDays = 3): { a: TxLite; b: TxLite }[] {
  const out: { a: TxLite; b: TxLite }[] = [];
  const sorted = [...txs].filter((t) => t.amountToman > 0).sort((x, y) => x.date.localeCompare(y.date));
  const used = new Set<string>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    if (used.has(a.id)) continue;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (dayNum(b.date) - dayNum(a.date) > windowDays) break;
      if (used.has(b.id) || b.amountToman !== a.amountToman) continue;
      const da = normalizeDesc(a.description);
      if (!da || da !== normalizeDesc(b.description)) continue;
      out.push({ a, b });
      used.add(a.id);
      used.add(b.id);
      break;
    }
  }
  return out;
}

/** Small but frequent spending: groups (by category, else description) with many small payments. */
export function findSmallFrequent(
  txs: TxLite[],
  monthlyExpenseToman: number,
  opts: { minCount?: number; maxShareEach?: number } = {},
): { label: string; count: number; totalToman: number; avgToman: number }[] {
  const minCount = opts.minCount ?? 8;
  const cap = Math.max(1, monthlyExpenseToman * (opts.maxShareEach ?? 0.02));
  const groups = new Map<string, { count: number; total: number }>();
  for (const t of txs) {
    if (t.amountToman <= 0 || t.amountToman > cap) continue;
    const key = t.category || normalizeDesc(t.description) || "بدون شرح";
    const g = groups.get(key) ?? { count: 0, total: 0 };
    g.count++;
    g.total += t.amountToman;
    groups.set(key, g);
  }
  return [...groups.entries()]
    .filter(([, g]) => g.count >= minCount)
    .map(([label, g]) => ({ label, count: g.count, totalToman: Math.round(g.total), avgToman: Math.round(g.total / g.count) }))
    .sort((a, b) => b.totalToman - a.totalToman);
}

export type CategoryTrend = {
  name: string;
  currentToman: number;
  /** Current month extrapolated to a full month at today's pace. */
  paceToman: number;
  /** Average of the previous complete months (0 when none). */
  baselineToman: number;
  changePct: number | null;
};

export function categoryTrends(
  current: { name: string; toman: number }[],
  previous: { name: string; toman: number }[],
  previousMonths: number,
  monthProgress: number,
): CategoryTrend[] {
  const prev = new Map<string, number>();
  for (const p of previous) prev.set(p.name, (prev.get(p.name) ?? 0) + p.toman);
  const names = new Set([...current.map((c) => c.name), ...prev.keys()]);
  const cur = new Map<string, number>();
  for (const c of current) cur.set(c.name, (cur.get(c.name) ?? 0) + c.toman);
  const progress = Math.min(1, Math.max(0.1, monthProgress));
  return [...names]
    .map((name) => {
      const currentToman = Math.round(cur.get(name) ?? 0);
      const baselineToman = previousMonths > 0 ? Math.round((prev.get(name) ?? 0) / previousMonths) : 0;
      const paceToman = Math.round(currentToman / progress);
      return {
        name,
        currentToman,
        paceToman,
        baselineToman,
        changePct: baselineToman > 0 ? ((paceToman - baselineToman) / baselineToman) * 100 : null,
      };
    })
    .sort((a, b) => b.currentToman - a.currentToman);
}

export type AnalysisInput = {
  today: string;
  availableCashToman: number;
  /**
   * Money one exchange trade + one transfer away from the bank: stablecoins
   * and Toman sitting on Iranian exchanges. Not in the bank today, but not a
   * shortfall either — a Toman gap it covers is a timing task, not a deficit.
   */
  convertibleToman: number;
  liquidToman: number;
  avgMonthlyExpenseToman: number;
  avgMonthlyIncomeToman: number;
  /** Months of the window, oldest first. */
  months: { label: string; incomeToman: number; expenseToman: number }[];
  /** Fraction of the current month already elapsed (0..1). */
  monthProgress: number;
  budgets: BudgetForecast[];
  categoryTrends: CategoryTrend[];
  obligationsNext30Toman: number;
  overdueInstallments: { count: number; toman: number };
  debts: { title: string; outstandingToman: number; interestRatePct: number | null }[];
  projectionDeficit: { month: string; cumulativeToman: number } | null;
  duplicates: { a: TxLite; b: TxLite }[];
  smallFrequent: { label: string; count: number; totalToman: number }[];
  miscShare: number | null;
  unreviewed: number;
  reconcileMismatches: number;
  topClassShare: { name: string; pct: number } | null;
};

/** «۲۸٫۳ میلیون تومان»-style amounts: readable at a glance, and a negative reads «منفی …» (a bare minus flips in RTL text). */
export function fmtToman(n: number): string {
  const v = Math.abs(n);
  const fa = (x: number, d = 0) => x.toLocaleString("fa-IR", { maximumFractionDigits: d });
  const body = v >= 1e9 ? `${fa(v / 1e9, 1)} میلیارد` : v >= 1e6 ? `${fa(v / 1e6, 1)} میلیون` : v >= 1e3 ? `${fa(Math.round(v / 1e3))} هزار` : fa(Math.round(v));
  return `${n < 0 ? "منفی " : ""}${body} تومان`;
}
const fmt = (n: number) => fmtToman(n).replace(/ تومان$/, "");
const pct = (n: number) => `${Math.round(n).toLocaleString("fa-IR")}٪`;

/** Ranks every problem and opportunity the data supports. Nothing is invented: no data → no finding. */
export function analyze(input: AnalysisInput): Finding[] {
  const f: Finding[] = [];

  // Toman the bank accounts will be short of: the projected low point, or
  // the next 30 days of obligations, whichever is larger.
  const deficitGap = input.projectionDeficit ? Math.max(0, -input.projectionDeficit.cumulativeToman) : 0;
  const obligationGap = Math.max(0, input.obligationsNext30Toman - input.availableCashToman);
  const gap = Math.max(deficitGap, obligationGap);
  if (gap > 0 && input.convertibleToman >= gap) {
    const when = obligationGap > 0 ? "پرداخت‌های ۳۰ روز آینده" : `${input.projectionDeficit!.month}`;
    f.push({
      id: "convert_in_time",
      severity: "info",
      title: "موجودی تومانی بانک کم است؛ به‌موقع تبدیل کنید",
      detail: `برای ${when} حدود ${fmt(gap)} تومان در حساب بانکی کم می‌آید، ولی ${fmt(input.convertibleToman)} تومان استیبل‌کوین و موجودی صرافی دارید. کافی است همین مقدار را چند روز زودتر از صرافی به تومان و بعد به حساب بانکی منتقل کنید (واریز صرافی معمولاً یک تا دو روز کاری طول می‌کشد).`,
      href: "/accounts",
      score: 56,
    });
  } else if (gap > 0) {
    const missing = gap - input.convertibleToman;
    if (input.projectionDeficit && deficitGap >= obligationGap) {
      f.push({
        id: "projection_deficit",
        severity: "critical",
        title: "کسری نقدینگی در پیش‌بینی",
        detail: `با برنامه‌ها و اقساط فعلی، در ${input.projectionDeficit.month} حدود ${fmt(missing)} تومان کم می‌آید${input.convertibleToman > 0 ? ` (حتی با تبدیل ${fmt(input.convertibleToman)} تومان استیبل‌کوین و موجودی صرافی)` : ""}.`,
        href: "/planning",
        score: 100,
      });
    } else {
      f.push({
        id: "obligations_exceed_cash",
        severity: "critical",
        title: "تعهدات ۳۰ روز آینده بیش از نقدینگی است",
        detail: `تعهدات ${fmt(input.obligationsNext30Toman)} تومان است و نقد بانکی به‌همراه استیبل‌کوین و موجودی صرافی ${fmt(input.availableCashToman + input.convertibleToman)} تومان؛ حدود ${fmt(missing)} تومان کم است.`,
        href: "/recurring",
        score: 95,
      });
    }
  }

  if (input.overdueInstallments.count > 0) {
    f.push({
      id: "overdue_installments",
      severity: "critical",
      title: `${input.overdueInstallments.count.toLocaleString("fa-IR")} قسط سررسیدگذشته`,
      detail: `${fmt(input.overdueInstallments.toman)} تومان از اقساط موعدش گذشته و پرداخت نشده است؛ دیرکرد ممکن است جریمه داشته باشد.`,
      href: "/debts/installments",
      score: 92,
    });
  }

  for (const b of input.budgets) {
    if (b.status === "over") {
      f.push({
        id: `budget_over:${b.name}`,
        severity: "warning",
        title: `بودجه‌ی «${b.name}» تمام شده است`,
        detail: `${pct(b.usagePct)} مصرف شده (${fmt(b.spentToman)} از ${fmt(b.limitToman)} تومان) و ${b.daysLeft.toLocaleString("fa-IR")} روز از دوره مانده است.`,
        href: "/budgets",
        score: 70 + Math.min(15, (b.usagePct - 100) / 5),
      });
    } else if (b.status === "at_risk") {
      f.push({
        id: `budget_risk:${b.name}`,
        severity: "warning",
        title: `بودجه‌ی «${b.name}» پیش از پایان دوره تمام می‌شود`,
        detail: `با همین روند، خرج دوره به ${fmt(b.projectedToman)} تومان (${pct(b.projectedPct)} سقف) می‌رسد${b.exhaustDate ? `؛ سقف حدود ${b.exhaustDate} پر می‌شود` : ""}.`,
        href: "/budgets",
        score: 60 + Math.min(15, (b.projectedPct - 100) / 5),
      });
    }
  }

  const last = input.months.at(-1);
  const prev = input.months.at(-2);
  if (prev && prev.incomeToman > 0 && prev.expenseToman > prev.incomeToman) {
    f.push({
      id: "negative_cashflow",
      severity: "warning",
      title: "هزینه‌های ماه گذشته از درآمد بیشتر بود",
      detail: `در ${prev.label} هزینه ${fmt(prev.expenseToman)} و درآمد ${fmt(prev.incomeToman)} تومان بود (${fmt(prev.expenseToman - prev.incomeToman)} تومان کسری).`,
      href: "/cash-flow",
      score: 65,
    });
  } else if (last && last.incomeToman > 0 && input.monthProgress > 0.5 && last.expenseToman > last.incomeToman) {
    f.push({
      id: "negative_cashflow_current",
      severity: "warning",
      title: "هزینه‌های این ماه تا امروز از درآمد بیشتر است",
      detail: `هزینه ${fmt(last.expenseToman)} در برابر درآمد ${fmt(last.incomeToman)} تومان.`,
      href: "/cash-flow",
      score: 58,
    });
  }

  // Early in a month the pace is guesswork; a tiny baseline turns ordinary
  // spending into «+۱۲۰۰٪». Both are filtered, and the rest is ONE finding.
  if (input.monthProgress >= 0.3 && input.avgMonthlyExpenseToman > 0) {
    const floor = input.avgMonthlyExpenseToman * 0.03;
    const spikes = input.categoryTrends
      .filter((t) => t.changePct != null && t.changePct >= 50 && t.baselineToman >= floor && t.paceToman - t.baselineToman >= input.avgMonthlyExpenseToman * 0.05)
      .sort((a, b) => b.paceToman - b.baselineToman - (a.paceToman - a.baselineToman));
    if (spikes.length) {
      const extra = spikes.reduce((s, t) => s + (t.paceToman - t.baselineToman), 0);
      const names = spikes.slice(0, 3).map((t) => `«${t.name}»`).join("، ");
      f.push({
        id: "category_spike",
        severity: "warning",
        title: spikes.length === 1 ? `هزینه‌ی ${names} بیش از معمول است` : `هزینه‌ی ${spikes.length.toLocaleString("fa-IR")} دسته بیش از معمول است`,
        detail: `${names}${spikes.length > 3 ? " و …" : ""}: با روند این ماه حدود ${fmt(extra)} تومان بیشتر از میانگین ماه‌های قبل خرج می‌شود.`,
        href: "/cash-flow",
        score: 50 + Math.min(15, spikes.length * 3),
      });
    }
  }

  for (const d of input.duplicates.slice(0, 3)) {
    f.push({
      id: `duplicate:${d.a.id}:${d.b.id}`,
      severity: "warning",
      title: "احتمال پرداخت تکراری",
      detail: `دو پرداخت ${fmt(d.a.amountToman)} تومانی با شرح «${d.a.description.slice(0, 40)}» در ${d.a.date} و ${d.b.date}. اگر تکراری است، یکی را برگردانید.`,
      href: `/transactions?q=${encodeURIComponent(d.a.description.slice(0, 30))}`,
      score: 62,
    });
  }

  const sorted = [...input.debts].filter((d) => d.outstandingToman > 0 && d.interestRatePct != null && d.interestRatePct >= 18);
  sorted.sort((a, b) => (b.interestRatePct ?? 0) - (a.interestRatePct ?? 0));
  if (sorted[0]) {
    f.push({
      id: `high_cost_debt:${sorted[0].title}`,
      severity: "opportunity",
      title: `بدهی پرهزینه: «${sorted[0].title}»`,
      detail: `نرخ ${pct(sorted[0].interestRatePct ?? 0)} روی ${fmt(sorted[0].outstandingToman)} تومان مانده. پیش‌پرداخت این بدهی معمولاً بازده مطمئن‌تری از نگه‌داشتن نقد دارد.`,
      href: "/debts",
      score: 48,
    });
  }

  for (const s of input.smallFrequent.slice(0, 1)) {
    f.push({
      id: `small_frequent:${s.label}`,
      severity: "opportunity",
      title: `هزینه‌های کوچک پرتکرار در «${s.label}»`,
      detail: `${s.count.toLocaleString("fa-IR")} پرداخت کوچک در ۳۰ روز اخیر، مجموعاً ${fmt(s.totalToman)} تومان.`,
      href: "/transactions",
      score: 35,
    });
  }

  if (input.avgMonthlyExpenseToman > 0 && !input.projectionDeficit && input.obligationsNext30Toman <= input.availableCashToman) {
    const idle = input.availableCashToman - input.obligationsNext30Toman - input.avgMonthlyExpenseToman * 6;
    if (idle > input.avgMonthlyExpenseToman) {
      f.push({
        id: "idle_cash",
        severity: "opportunity",
        title: "نقدینگی بیش از نیاز در حساب‌ها",
        detail: `پس از کنار گذاشتن ۶ ماه هزینه و تعهدات ۳۰ روز آینده، حدود ${fmt(idle)} تومان نقد بی‌استفاده است؛ در تورم، نقد بی‌استفاده ارزش از دست می‌دهد.`,
        href: "/accounts",
        score: 40,
      });
    }
  } else if (input.avgMonthlyExpenseToman > 0 && input.liquidToman < input.avgMonthlyExpenseToman * 3) {
    f.push({
      id: "thin_buffer",
      severity: "warning",
      title: "ذخیره‌ی اضطراری کمتر از سه ماه هزینه",
      detail: `دارایی نقدشونده ${fmt(input.liquidToman)} تومان، یعنی حدود ${(input.liquidToman / input.avgMonthlyExpenseToman).toFixed(1)} ماه هزینه.`,
      href: "/accounts",
      score: 55,
    });
  }

  if (input.topClassShare && input.topClassShare.pct > 60) {
    f.push({
      id: "concentration",
      severity: "info",
      title: "تمرکز بالای دارایی",
      detail: `${pct(input.topClassShare.pct)} دارایی‌ها در «${input.topClassShare.name}» است.`,
      href: "/portfolio",
      score: 30,
    });
  }

  if (input.miscShare != null && input.miscShare > 20) {
    f.push({
      id: "misc_share",
      severity: "info",
      title: "بخش بزرگی از هزینه‌ها دسته‌بندی دقیق ندارد",
      detail: `${pct(input.miscShare)} هزینه‌های این ماه در دسته‌ی «متفرقه» است. دستیار می‌تواند برای این تراکنش‌ها دسته‌ی دقیق‌تری پیشنهاد کند.`,
      href: "/transactions",
      score: 33,
    });
  }

  if (input.reconcileMismatches > 0) {
    f.push({
      id: "reconcile",
      severity: "info",
      title: `مانده‌ی ${input.reconcileMismatches.toLocaleString("fa-IR")} حساب با بانک یکی نیست`,
      detail: "تا تطبیق نشود، تحلیل‌ها روی داده‌ی ناقص انجام می‌شوند.",
      href: "/accounts/reconcile",
      score: 45,
    });
  }

  if (input.unreviewed > 0) {
    f.push({
      id: "unreviewed",
      severity: "info",
      title: `${input.unreviewed.toLocaleString("fa-IR")} تراکنش درون‌ریزی‌شده بازبینی نشده`,
      detail: "پیش از اتکا به گزارش‌ها، دسته و مبلغ این رکوردها را تأیید کنید.",
      href: "/transactions?review=unreviewed",
      score: 25,
    });
  }

  return f.sort((a, b) => b.score - a.score);
}
