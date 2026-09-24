/**
 * بیمه‌نامه‌ها — what is insured, until when, for how much, at what premium.
 *
 * A policy is metadata, like a deposit: registering, renewing or cancelling it
 * posts nothing. Money moves only when the user records a premium, from the
 * reminder, as an ordinary transaction:
 *   • an EXPENSE in the policy's insurance category (third-party and body
 *     cover live under «خودرو و حمل‌ونقل», health under «بیمه درمان تکمیلی»,
 *     the rest under «سایر بیمه‌ها» — the catalogue's own rules), or
 *   • a TRANSFER into the policy's savings account, for a life policy with a
 *     cash value (اندوخته): that money is still the user's, so it must stay in
 *     net worth instead of vanishing as spending. The statement's cash value is
 *     then checked like any bank balance (تطبیق با بانک), and the difference is
 *     the policy's profit or cost.
 *
 * One premium is pending at a time (planned_transactions.insurance_policy_id),
 * exactly like a deposit's interest: it reaches the reminder centre and the
 * cash-flow forecast, and recording it schedules the next one until the term
 * ends.
 *
 * HOW IT IS PAID (paymentMode) — three shapes, one rule: money leaves once.
 *   • cash         premiums from a Toman BANK account (no Tether, fund, exchange
 *                  or cash box), each one a reminder as above.
 *   • installments bought on credit: a debt (بدهی‌ها) is created for the part
 *                  not paid up front, and its schedule — not premium reminders —
 *                  carries the payments. A down payment, if any, is one premium
 *                  reminder from a Toman bank account.
 *   • debt         the user already registered that debt in «بدهی‌ها» (before
 *                  this section existed): the policy only points at it
 *                  (debt_id). Nothing new is scheduled, so an installment
 *                  already paid is never asked for again.
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, debts, expenseCategories, insurancePolicies, plannedTransactions, realEstateProperties, vehicleAssets, wallets } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { registerMoneyAccount } from "@/features/accounts/service";
import { addJalaliMonths } from "@/features/income/recurring";
import { createDebtRecord } from "@/features/planning/createDebt";
import { isTomanBankAccount } from "@/features/trade/rules";
import { todayIso, toJalali } from "@/lib/format";

export const INSURANCE_KINDS = ["third_party", "car_body", "fire", "life", "health", "travel", "liability", "other"] as const;
export type InsuranceKind = (typeof INSURANCE_KINDS)[number];
export const PREMIUM_FREQUENCIES = ["once", "monthly", "quarterly", "annual"] as const;
export type PremiumFrequency = (typeof PREMIUM_FREQUENCIES)[number];

export const INSURANCE_KIND_META: Record<InsuranceKind, { label: string; insured: "vehicle" | "property" | "none"; category: string }> = {
  third_party: { label: "شخص ثالث خودرو", insured: "vehicle", category: "TRN-INS-TP" },
  car_body: { label: "بدنه خودرو", insured: "vehicle", category: "TRN-INS-BODY" },
  fire: { label: "آتش‌سوزی و زلزله", insured: "property", category: "INS-OTHER" },
  life: { label: "عمر", insured: "none", category: "INS-OTHER" },
  health: { label: "درمان تکمیلی", insured: "none", category: "INS-HEALTH" },
  travel: { label: "مسافرتی", insured: "none", category: "INS-OTHER" },
  liability: { label: "مسئولیت", insured: "property", category: "INS-OTHER" },
  other: { label: "سایر", insured: "none", category: "INS-OTHER" },
};

export const PAYMENT_MODES = ["cash", "installments", "debt"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

/** Down payment of a policy bought on installments, rounded to the Toman. PURE. */
export function downPaymentToman(totalToman: string, percent: string | number): string {
  const pct = D(String(percent || "0"));
  if (pct.isNegative() || pct.gte(100)) throw new Error("پیش‌پرداخت باید کمتر از ۱۰۰ درصد باشد.");
  return D(totalToman).mul(pct).div(100).toFixed(0);
}

export const PREMIUM_FREQUENCY_LABEL: Record<PremiumFrequency, string> = {
  once: "یک‌جا",
  monthly: "ماهانه",
  quarterly: "سه‌ماهه",
  annual: "سالانه",
};

const PERIOD_MONTHS: Record<PremiumFrequency, number> = { once: 0, monthly: 1, quarterly: 3, annual: 12 };

/** An expiry this close (or this recently passed, unrenewed) is a reminder. */
export const RENEWAL_HORIZON_DAYS = 30;

export { addJalaliMonths };

/**
 * The first premium due on or after `today`, stepping from the policy's start
 * on its Jalali day — or null (a single premium already behind us, or a term
 * that ends before the next one). Premiums before `today` count as paid: a
 * policy registered mid-term does not invent arrears. PURE.
 */
export function nextPremiumDate(start: string, frequency: PremiumFrequency, today: string, end?: string | null): string | null {
  if (frequency === "once") return start >= today ? start : null;
  const period = PERIOD_MONTHS[frequency];
  const day = toJalali(start).d;
  let next = start;
  for (let k = 1; next < today && k < 1200; k++) next = addJalaliMonths(start, k * period, day);
  if (end && next >= end) return null;
  return next;
}

/** The premium after `from`, or null past the end of the term. PURE. */
export function followingPremiumDate(start: string, frequency: PremiumFrequency, from: string, end?: string | null): string | null {
  if (frequency === "once") return null;
  const period = PERIOD_MONTHS[frequency];
  const day = toJalali(start).d;
  let next = start;
  for (let k = 1; next <= from && k < 1200; k++) next = addJalaliMonths(start, k * period, day);
  if (end && next >= end) return null;
  return next;
}

/** A year of premiums in Toman — the figure people compare policies by. PURE. */
export function annualPremium(premiumToman: string, frequency: PremiumFrequency): string {
  const perYear = frequency === "monthly" ? 12 : frequency === "quarterly" ? 4 : 1;
  return D(premiumToman).mul(perYear).toFixed(0);
}

export type PolicyInput = {
  kind: string;
  title: string;
  insurer?: string | null;
  policyNumber?: string | null;
  startDate: string;
  endDate?: string | null;
  premiumToman: string;
  premiumFrequency: string;
  /** A Toman bank account. Not needed when the policy is paid through a debt with no down payment. */
  payAccountId?: string | null;
  /** How it is paid — cash (default), a new installment plan, or a debt already in «بدهی‌ها». */
  paymentMode?: string | null;
  /** paymentMode "debt": the existing debt that pays for it. */
  debtId?: string | null;
  /** paymentMode "installments": share paid up front, 0–99. */
  downPaymentPercent?: string | null;
  installmentCount?: number | null;
  /** Months between installments (1 = monthly). */
  intervalMonths?: number | null;
  firstDueDate?: string | null;
  /** paymentMode "installments": the live USD→IRT rate, for the debt's audit snapshot only. */
  usdIrtRate?: string | null;
  coverageToman?: string | null;
  insuredPropertyId?: string | null;
  insuredVehicleId?: string | null;
  /** Life only: open a savings account for the policy's cash value. */
  withSavings?: boolean;
  note?: string | null;
  /** Renewal: the term this one continues. */
  renewedFromId?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const clean = (v: string | null | undefined, max: number) => {
  const t = (v ?? "").trim();
  if (t.length > max) throw new Error("یکی از متن‌ها بیش از حد طولانی است.");
  return t || null;
};

/** Premiums leave from a Toman BANK account only — never Tether, a fund, an exchange or the cash box. */
async function tomanBankAccount(tx: any, userId: string, accountId: string | null | undefined) {
  const [acc] = accountId
    ? await tx
        .select({
          userId: accounts.userId,
          type: accounts.type,
          deletedAt: accounts.deletedAt,
          symbol: assets.symbol,
          name: accounts.name,
          code: accounts.code,
          walletKind: wallets.kind,
        })
        .from(accounts)
        .leftJoin(assets, eq(assets.id, accounts.assetId))
        .leftJoin(wallets, eq(wallets.id, accounts.walletId))
        .where(eq(accounts.id, accountId))
        .limit(1)
    : [];
  if (!acc || acc.userId !== userId || acc.type !== "asset" || acc.deletedAt || !isTomanBankAccount(acc)) {
    throw new Error("حق بیمه را از یکی از حساب‌های بانکی تومانیِ خودتان انتخاب کنید.");
  }
}

/** Toman bank accounts the premium can leave from — what the forms offer. */
export async function listPremiumAccounts(userId: string, client: any = db): Promise<{ id: string; name: string }[]> {
  const rows = await client
    .select({ id: accounts.id, name: accounts.name, code: accounts.code, symbol: assets.symbol, walletKind: wallets.kind })
    .from(accounts)
    .innerJoin(assets, eq(assets.id, accounts.assetId))
    .leftJoin(wallets, eq(wallets.id, accounts.walletId))
    .where(and(eq(accounts.userId, userId), eq(accounts.type, "asset"), isNull(accounts.deletedAt), eq(assets.symbol, "IRT")))
    .orderBy(asc(accounts.code));
  return rows.filter((r: any) => isTomanBankAccount(r)).map((r: any) => ({ id: r.id, name: r.name }));
}

export type LinkableDebt = {
  id: string;
  title: string;
  creditor: string;
  startDate: string;
  totalToman: string;
  paidToman: string;
  remainingToman: string;
  paidCount: number;
  totalCount: number;
  nextDueDate: string | null;
  nextDueToman: string | null;
  /** Looks like an insurance debt by its title or creditor — listed first. */
  suggested: boolean;
};

/**
 * Debts a policy can be paid through: this user's active «بدهی من» rows not
 * already paying for another active policy. `paidToman` is a running total on
 * every installment (partial payments included), so what is left is exactly
 * what the «اقساط» page shows.
 */
export async function listLinkableDebts(userId: string, client: any = db): Promise<LinkableDebt[]> {
  const res = await client.execute(sql`
    select d.id, d.title, d.creditor, d.start_date::text as "startDate",
           coalesce(nullif(s.total, 0), d.principal_toman, 0)::text as "totalToman",
           coalesce(s.paid, 0)::text as "paidToman",
           coalesce(s.paid_count, 0)::int as "paidCount",
           coalesce(s.total_count, 0)::int as "totalCount",
           n.due_date::text as "nextDueDate",
           (n.amount_toman - coalesce(n.paid_toman, 0))::text as "nextDueToman"
    from debts d
      left join lateral (
        select sum(i.amount_toman) as total,
               sum(case when i.paid_toman is not null then i.paid_toman when i.status = 'paid' then i.amount_toman else 0 end) as paid,
               count(*) filter (where i.status = 'paid') as paid_count,
               count(*) as total_count
        from installments i where i.debt_id = d.id
      ) s on true
      left join lateral (
        select i.due_date, i.amount_toman, i.paid_toman from installments i
        where i.debt_id = d.id and i.status <> 'paid'
        order by i.due_date asc limit 1
      ) n on true
    where d.user_id = ${userId}::uuid and d.deleted_at is null and d.status = 'active' and d.direction = 'payable'
      and not exists (select 1 from insurance_policies p where p.debt_id = d.id and p.status = 'active')
    order by d.start_date desc, d.created_at desc
  `);
  return (res.rows as any[]).map((r) => {
    const total = D(r.totalToman || "0");
    const paid = D(r.paidToman || "0");
    const left = total.sub(paid);
    return {
      ...r,
      totalToman: total.toFixed(0),
      paidToman: paid.toFixed(0),
      remainingToman: (left.isNegative() ? D("0") : left).toFixed(0),
      nextDueToman: r.nextDueToman != null ? D(r.nextDueToman).toFixed(0) : null,
      suggested: /بیمه|ثالث|بدنه|insurance/i.test(`${r.title} ${r.creditor}`),
    } as LinkableDebt;
  }).sort((a: LinkableDebt, b: LinkableDebt) => Number(b.suggested) - Number(a.suggested));
}

function premiumPlanRow(input: {
  userId: string;
  policyId: string;
  title: string;
  date: string;
  premiumToman: string;
  frequency: PremiumFrequency;
  payAccountId: string;
  savingsAccountId: string | null;
  irtAssetId: string | null;
}) {
  return {
    userId: input.userId,
    title: `حق بیمه «${input.title}»`,
    plannedDate: input.date,
    direction: "outflow",
    // planned_transactions.amount_base is contractual Toman — what the forecast reads.
    amountBase: D(input.premiumToman).toFixed(0),
    amountNative: D(input.premiumToman).toFixed(0),
    fromAccountId: input.payAccountId,
    toAccountId: input.savingsAccountId,
    assetId: input.irtAssetId,
    recurrence: input.frequency === "once" ? "none" : input.frequency === "annual" ? "yearly" : "monthly",
    status: "pending",
    insurancePolicyId: input.policyId,
  };
}

export async function createPolicy(userId: string, input: PolicyInput, today = todayIso()): Promise<string> {
  if (!INSURANCE_KINDS.includes(input.kind as InsuranceKind)) throw new Error("نوع بیمه را انتخاب کنید.");
  const kind = input.kind as InsuranceKind;
  if (!PREMIUM_FREQUENCIES.includes(input.premiumFrequency as PremiumFrequency)) throw new Error("دوره‌ی پرداخت حق بیمه را انتخاب کنید.");
  const frequency = input.premiumFrequency as PremiumFrequency;
  const title = clean(input.title, 120);
  if (!title) throw new Error("نام بیمه‌نامه را وارد کنید.");
  if (!ISO.test(input.startDate)) throw new Error("تاریخ شروع را وارد کنید.");
  const endDate = input.endDate ? input.endDate : null;
  if (endDate && (!ISO.test(endDate) || endDate <= input.startDate)) throw new Error("تاریخ پایان باید بعد از شروع باشد.");
  let premium: Decimal;
  let coverage: Decimal | null = null;
  try {
    premium = D(input.premiumToman || "0");
    coverage = input.coverageToman ? D(input.coverageToman) : null;
  } catch {
    throw new Error("مبلغ‌ها را به عدد وارد کنید.");
  }
  if (!premium.gt(0)) throw new Error("مبلغ حق بیمه را وارد کنید.");
  if (coverage && !coverage.gt(0)) coverage = null;
  const meta = INSURANCE_KIND_META[kind];
  const mode = (input.paymentMode || "cash") as PaymentMode;
  if (!PAYMENT_MODES.includes(mode)) throw new Error("نحوه‌ی پرداخت را انتخاب کنید.");
  // A policy bought on credit is paid through its debt — never also as a life policy's savings.
  const withSavings = kind === "life" && mode === "cash" && !!input.withSavings;
  const down = mode === "installments" ? D(downPaymentToman(premium.toFixed(0), input.downPaymentPercent || "0")) : D("0");
  const payAccountId = mode === "cash" || down.gt(0) ? input.payAccountId || null : null;

  return db.transaction(async (tx) => {
    if (mode === "cash" || down.gt(0)) await tomanBankAccount(tx, userId, payAccountId);

    let debtId: string | null = null;
    if (mode === "debt") {
      if (!input.debtId) throw new Error("بدهیِ این بیمه‌نامه را انتخاب کنید.");
      const [d] = await tx
        .select({ id: debts.id, direction: debts.direction, status: debts.status, deletedAt: debts.deletedAt })
        .from(debts)
        .where(and(eq(debts.id, input.debtId), eq(debts.userId, userId)))
        .limit(1);
      if (!d || d.deletedAt || d.status !== "active" || d.direction !== "payable") throw new Error("بدهی انتخاب‌شده پیدا نشد یا تسویه شده است.");
      const [taken] = await tx
        .select({ id: insurancePolicies.id })
        .from(insurancePolicies)
        .where(and(eq(insurancePolicies.debtId, d.id), eq(insurancePolicies.status, "active")))
        .limit(1);
      if (taken) throw new Error("این بدهی از قبل به بیمه‌نامه‌ی دیگری وصل است.");
      debtId = d.id;
    } else if (mode === "installments") {
      const count = Number(input.installmentCount ?? 0);
      if (!Number.isInteger(count) || count < 1 || count > 60) throw new Error("تعداد اقساط را بین ۱ تا ۶۰ انتخاب کنید.");
      if (!input.usdIrtRate) throw new Error("نرخ تبدیل دلار به تومان برای ثبت بدهی موجود نیست.");
      debtId = await createDebtRecord(
        {
          userId,
          title: `بیمه «${title}»`,
          creditor: clean(input.insurer, 80) || "شرکت بیمه",
          principalIrt: premium.sub(down).toFixed(0),
          startDate: input.startDate,
          direction: "payable",
          installmentCount: count,
          intervalMonths: Number(input.intervalMonths || 1),
          firstDueDate: input.firstDueDate || addJalaliMonths(input.startDate, Number(input.intervalMonths || 1)),
        },
        { usdIrtRate: input.usdIrtRate, tx: tx as unknown as typeof db },
      );
    }

    let propertyId: string | null = null;
    let vehicleId: string | null = null;
    if (input.insuredPropertyId && meta.insured === "property") {
      const [p] = await tx
        .select({ id: realEstateProperties.id })
        .from(realEstateProperties)
        .where(and(eq(realEstateProperties.id, input.insuredPropertyId), eq(realEstateProperties.userId, userId)))
        .limit(1);
      if (!p) throw new Error("ملک انتخاب‌شده متعلق به شما نیست.");
      propertyId = p.id;
    }
    if (input.insuredVehicleId && meta.insured === "vehicle") {
      const [v] = await tx
        .select({ id: vehicleAssets.id })
        .from(vehicleAssets)
        .where(and(eq(vehicleAssets.id, input.insuredVehicleId), eq(vehicleAssets.userId, userId)))
        .limit(1);
      if (!v) throw new Error("خودروی انتخاب‌شده متعلق به شما نیست.");
      vehicleId = v.id;
    }

    const [irt] = await tx.select({ id: assets.id }).from(assets).where(and(eq(assets.symbol, "IRT"), isNull(assets.deletedAt))).limit(1);
    let savingsAccountId: string | null = null;
    if (withSavings) {
      if (!irt) throw new Error("ارز تومان تعریف نشده است.");
      const created = await registerMoneyAccount(
        { name: `اندوخته بیمه عمر «${title}»`, kind: "insurance", assetId: irt.id, userId, note: "ارزش بازخرید بیمه‌نامه عمر" },
        tx,
      );
      savingsAccountId = created.accountId ?? null;
      if (!savingsAccountId) throw new Error("حساب اندوخته ساخته نشد.");
    }

    const [policy] = await tx
      .insert(insurancePolicies)
      .values({
        userId,
        kind,
        title,
        insurer: clean(input.insurer, 80),
        policyNumber: clean(input.policyNumber, 60),
        startDate: input.startDate,
        endDate,
        premiumToman: premium.toFixed(0),
        // Bought on credit: one price for the term; the debt's schedule carries the payments.
        premiumFrequency: mode === "cash" ? frequency : "once",
        payAccountId,
        debtId,
        coverageToman: coverage ? coverage.toFixed(0) : null,
        insuredPropertyId: propertyId,
        insuredVehicleId: vehicleId,
        savingsAccountId,
        renewedFromId: input.renewedFromId ?? null,
        note: clean(input.note, 500),
      })
      .returning({ id: insurancePolicies.id });

    // cash: the premium schedule. installments: only the down payment. debt: nothing — the debt already reminds.
    const first = mode === "debt" || (mode === "installments" && !down.gt(0)) ? null : nextPremiumDate(input.startDate, mode === "cash" ? frequency : "once", today, endDate);
    if (first && payAccountId) {
      await tx.insert(plannedTransactions).values(
        premiumPlanRow({
          userId,
          policyId: policy.id,
          title,
          date: first,
          premiumToman: mode === "cash" ? premium.toFixed(0) : down.toFixed(0),
          frequency: mode === "cash" ? frequency : "once",
          payAccountId,
          savingsAccountId,
          irtAssetId: irt?.id ?? null,
        }) as any,
      );
    }
    return policy.id;
  });
}

/**
 * Renew: a NEW term (new dates, possibly a new premium) continuing `id`. The
 * old term is marked renewed and its pending premium cancelled; the savings
 * account of a life policy carries over — it is the same money.
 */
export async function renewPolicy(
  userId: string,
  id: string,
  input: { startDate?: string | null; endDate: string; premiumToman: string; coverageToman?: string | null; payAccountId?: string | null },
): Promise<string> {
  const [old] = await db
    .select()
    .from(insurancePolicies)
    .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)))
    .limit(1);
  if (!old || old.status !== "active") throw new Error("بیمه‌نامه‌ی فعال پیدا نشد.");
  const startDate = input.startDate || old.endDate || todayIso();
  const newId = await createPolicy(userId, {
    kind: old.kind,
    title: old.title,
    insurer: old.insurer,
    policyNumber: null,
    startDate,
    endDate: input.endDate,
    premiumToman: input.premiumToman,
    premiumFrequency: old.premiumFrequency,
    // A term paid through a debt had no account: the renewal names one (cash).
    payAccountId: input.payAccountId || old.payAccountId,
    coverageToman: input.coverageToman ?? old.coverageToman,
    insuredPropertyId: old.insuredPropertyId,
    insuredVehicleId: old.insuredVehicleId,
    note: old.note,
    renewedFromId: old.id,
  });
  await db.transaction(async (tx) => {
    if (old.savingsAccountId) {
      await tx.update(insurancePolicies).set({ savingsAccountId: old.savingsAccountId }).where(eq(insurancePolicies.id, newId));
      await tx
        .update(plannedTransactions)
        .set({ toAccountId: old.savingsAccountId })
        .where(and(eq(plannedTransactions.insurancePolicyId, newId), eq(plannedTransactions.status, "pending")));
    }
    await tx
      .update(insurancePolicies)
      .set({ status: "renewed", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(insurancePolicies.id, old.id), eq(insurancePolicies.userId, userId)));
    await cancelPendingPremiums(tx, userId, [old.id]);
  });
  return newId;
}

/** Cancel: the pending premium goes, nothing posts. Recorded premiums stay in the ledger. */
export async function cancelPolicy(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    const res = await tx
      .update(insurancePolicies)
      .set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, "active")))
      .returning({ id: insurancePolicies.id });
    if (!res.length) throw new Error("بیمه‌نامه پیدا نشد یا قبلاً بسته شده است.");
    await cancelPendingPremiums(tx, userId, [id]);
  });
}

/** Delete a policy registered by mistake. Its savings account (real money) is kept. */
export async function deletePolicy(userId: string, id: string): Promise<void> {
  await db.transaction(async (tx) => {
    await cancelPendingPremiums(tx, userId, [id]);
    await tx
      .update(insurancePolicies)
      .set({ renewedFromId: null })
      .where(and(eq(insurancePolicies.renewedFromId, id), eq(insurancePolicies.userId, userId)));
    const res = await tx
      .delete(insurancePolicies)
      .where(and(eq(insurancePolicies.id, id), eq(insurancePolicies.userId, userId)))
      .returning({ id: insurancePolicies.id });
    if (!res.length) throw new Error("بیمه‌نامه پیدا نشد.");
  });
}

async function cancelPendingPremiums(tx: any, userId: string, policyIds: string[]) {
  await tx
    .update(plannedTransactions)
    .set({ status: "cancelled", recurrence: "none", updatedAt: new Date() })
    .where(
      and(
        inArray(plannedTransactions.insurancePolicyId, policyIds),
        eq(plannedTransactions.userId, userId),
        eq(plannedTransactions.status, "pending"),
      ),
    );
}

export type PremiumPlan = {
  id: string;
  policyId: string;
  title: string;
  plannedDate: string;
  premiumToman: string;
  payAccountId: string;
  savingsAccountId: string | null;
  kind: InsuranceKind;
  /** Leaf category the expense belongs in; null for a transfer into savings. */
  categoryId: string | null;
};

/** A pending premium of this user (the reminder a payment is recorded from), or null. */
export async function getPremiumPlan(planId: string, userId: string, client: any = db): Promise<PremiumPlan | null> {
  const [row] = await client
    .select({
      id: plannedTransactions.id,
      policyId: insurancePolicies.id,
      title: insurancePolicies.title,
      plannedDate: plannedTransactions.plannedDate,
      premiumToman: plannedTransactions.amountBase,
      payAccountId: plannedTransactions.fromAccountId,
      savingsAccountId: plannedTransactions.toAccountId,
      kind: insurancePolicies.kind,
    })
    .from(plannedTransactions)
    .innerJoin(insurancePolicies, eq(insurancePolicies.id, plannedTransactions.insurancePolicyId))
    .where(
      and(
        eq(plannedTransactions.id, planId),
        eq(plannedTransactions.userId, userId),
        eq(insurancePolicies.userId, userId),
        eq(plannedTransactions.status, "pending"),
        isNull(plannedTransactions.deletedAt),
      ),
    )
    .limit(1);
  if (!row) return null;
  const kind = row.kind as InsuranceKind;
  let categoryId: string | null = null;
  if (!row.savingsAccountId) {
    const [cat] = await client
      .select({ id: expenseCategories.id })
      .from(expenseCategories)
      .where(and(eq(expenseCategories.code, INSURANCE_KIND_META[kind].category), isNull(expenseCategories.userId)))
      .limit(1);
    categoryId = cat?.id ?? null;
  }
  return {
    id: row.id,
    policyId: row.policyId,
    title: row.title,
    plannedDate: row.plannedDate,
    premiumToman: D(row.premiumToman).toFixed(0),
    payAccountId: row.payAccountId!,
    savingsAccountId: row.savingsAccountId ?? null,
    kind,
    categoryId,
  };
}

/**
 * Close the premium a transaction was recorded from, inside that transaction,
 * and schedule the next one until the term ends. Refused — rolling the whole
 * entry back — when the reminder is not this user's pending premium, so one
 * reminder can never be paid twice.
 */
export async function closePremiumOccurrence(input: { planId: string; userId: string; entryId: string }, client: any = db): Promise<void> {
  const plan = await getPremiumPlan(input.planId, input.userId, client);
  if (!plan) throw new Error("یادآور حق بیمه پیدا نشد یا قبلاً پرداخت شده است.");
  await client
    .update(plannedTransactions)
    .set({ status: "executed", executedEntryId: input.entryId, updatedAt: new Date() })
    .where(eq(plannedTransactions.id, plan.id));
  const [policy] = await client.select().from(insurancePolicies).where(eq(insurancePolicies.id, plan.policyId)).limit(1);
  if (!policy || policy.status !== "active" || !policy.payAccountId) return;
  const next = followingPremiumDate(policy.startDate, policy.premiumFrequency as PremiumFrequency, plan.plannedDate, policy.endDate);
  if (!next) return;
  const [irt] = await client.select({ id: assets.id }).from(assets).where(and(eq(assets.symbol, "IRT"), isNull(assets.deletedAt))).limit(1);
  await client.insert(plannedTransactions).values(
    premiumPlanRow({
      userId: input.userId,
      policyId: policy.id,
      title: policy.title,
      date: next,
      premiumToman: policy.premiumToman,
      frequency: policy.premiumFrequency as PremiumFrequency,
      payAccountId: policy.payAccountId!,
      savingsAccountId: policy.savingsAccountId,
      irtAssetId: irt?.id ?? null,
    }) as any,
  );
}

export type PolicyRow = {
  id: string;
  kind: InsuranceKind;
  title: string;
  insurer: string | null;
  policyNumber: string | null;
  startDate: string;
  endDate: string | null;
  premiumToman: string;
  premiumFrequency: PremiumFrequency;
  annualPremiumToman: string;
  payAccountId: string | null;
  payAccountName: string | null;
  /** Paid through this debt (بدهی‌ها), with its progress. */
  debtId: string | null;
  debtTitle: string | null;
  debtPaidCount: number | null;
  debtTotalCount: number | null;
  debtRemainingToman: string | null;
  debtNextDueDate: string | null;
  coverageToman: string | null;
  insuredPropertyId: string | null;
  insuredVehicleId: string | null;
  insuredLabel: string | null;
  /** Current market value of the insured property (Toman), for the cover check. */
  insuredValueToman: string | null;
  savingsAccountId: string | null;
  savingsBalanceToman: string | null;
  status: "active" | "renewed" | "cancelled";
  note: string | null;
  nextPremiumDate: string | null;
  nextPlanId: string | null;
};

export async function listPolicies(userId: string): Promise<PolicyRow[]> {
  const res = await db.execute(sql`
    select p.id, p.kind, p.title, p.insurer, p.policy_number as "policyNumber",
           p.start_date::text as "startDate", p.end_date::text as "endDate",
           p.premium_toman::text as "premiumToman", p.premium_frequency as "premiumFrequency",
           p.pay_account_id as "payAccountId", pa.name as "payAccountName",
           p.coverage_toman::text as "coverageToman",
           p.insured_property_id as "insuredPropertyId", p.insured_vehicle_id as "insuredVehicleId",
           coalesce(nullif(concat_ws('، ', rep.area, rep.city), ''), case when v.id is not null then concat(v.brand, ' ', v.model, ' ', v.year) end) as "insuredLabel",
           rep.current_value_toman::text as "insuredValueToman",
           p.savings_account_id as "savingsAccountId",
           (select coalesce(sum(po.quantity), 0)::text from postings po join journal_entries je on je.id = po.entry_id
             where po.account_id = p.savings_account_id and je.status = 'posted' and je.user_id = ${userId}::uuid) as "savingsBalanceToman",
           p.status, p.note,
           n.planned_date::text as "nextPremiumDate", n.id as "nextPlanId",
           p.debt_id as "debtId", dt.title as "debtTitle",
           ds.paid_count as "debtPaidCount", ds.total_count as "debtTotalCount",
           ds.remaining::text as "debtRemainingToman", ds.next_due::text as "debtNextDueDate"
    from insurance_policies p
      left join accounts pa on pa.id = p.pay_account_id
      left join real_estate_properties rep on rep.id = p.insured_property_id
      left join vehicle_assets v on v.id = p.insured_vehicle_id
      left join debts dt on dt.id = p.debt_id
      left join lateral (
        select count(*) filter (where i.status = 'paid')::int as paid_count, count(*)::int as total_count,
               sum(case when i.status = 'paid' then 0 else i.amount_toman - coalesce(i.paid_toman, 0) end) as remaining,
               min(i.due_date) filter (where i.status <> 'paid') as next_due
        from installments i where i.debt_id = p.debt_id
      ) ds on p.debt_id is not null
      left join lateral (
        select id, planned_date from planned_transactions pt
        where pt.insurance_policy_id = p.id and pt.status = 'pending' and pt.deleted_at is null
        order by pt.planned_date asc limit 1
      ) n on true
    where p.user_id = ${userId}::uuid
    order by (p.status = 'active') desc, p.end_date asc nulls last, p.created_at asc
  `);
  return (res.rows as Omit<PolicyRow, "annualPremiumToman">[]).map((r) => ({
    ...r,
    savingsBalanceToman: r.savingsAccountId ? r.savingsBalanceToman : null,
    annualPremiumToman: annualPremium(r.premiumToman, r.premiumFrequency),
  }));
}

export type CoverageGap = {
  kind: "vehicle_no_third_party" | "property_uninsured" | "property_underinsured";
  title: string;
  detail: string;
  /** Pre-fills the new-policy form. */
  suggestKind: InsuranceKind;
  vehicleId?: string;
  propertyId?: string;
};

/** The new-policy form, pre-filled for this gap (kind + the car or home). */
export function gapHref(g: Pick<CoverageGap, "suggestKind" | "vehicleId" | "propertyId">): string {
  const q = new URLSearchParams({ kind: g.suggestKind, ...(g.vehicleId ? { vehicle: g.vehicleId } : {}), ...(g.propertyId ? { property: g.propertyId } : {}) });
  return `/insurance?${q.toString()}#new-policy`;
}

/**
 * What the user owns that is not covered. Third-party cover is compulsory for
 * a car on the road in Iran; fire cover is not, so an uninsured home is a
 * quiet note, and cover below the home's own current value is flagged with
 * the ratio — the gap is what the owner would carry after a loss.
 */
export async function coverageGaps(userId: string, today = todayIso()): Promise<CoverageGap[]> {
  const [vehicles, properties, active] = await Promise.all([
    db
      .select({ id: vehicleAssets.id, brand: vehicleAssets.brand, model: vehicleAssets.model, year: vehicleAssets.year })
      .from(vehicleAssets)
      .innerJoin(assets, eq(assets.id, vehicleAssets.assetId))
      .where(and(eq(vehicleAssets.userId, userId), sql`${vehicleAssets.status} <> 'sold'`, isNull(assets.deletedAt))),
    db
      .select({ id: realEstateProperties.id, area: realEstateProperties.area, city: realEstateProperties.city, value: realEstateProperties.currentValueToman })
      .from(realEstateProperties)
      .innerJoin(assets, eq(assets.id, realEstateProperties.assetId))
      .where(and(eq(realEstateProperties.userId, userId), isNull(assets.deletedAt))),
    db
      .select({ kind: insurancePolicies.kind, vehicleId: insurancePolicies.insuredVehicleId, propertyId: insurancePolicies.insuredPropertyId, coverage: insurancePolicies.coverageToman, endDate: insurancePolicies.endDate })
      .from(insurancePolicies)
      .where(and(eq(insurancePolicies.userId, userId), eq(insurancePolicies.status, "active"))),
  ]);
  const live = active.filter((p) => !p.endDate || p.endDate >= today);
  const gaps: CoverageGap[] = [];
  for (const v of vehicles) {
    if (!live.some((p) => p.kind === "third_party" && p.vehicleId === v.id)) {
      gaps.push({
        kind: "vehicle_no_third_party",
        title: `${v.brand} ${v.model} بیمه‌ی شخص ثالث فعال ندارد`,
        detail: "رانندگی بدون بیمه‌ی ثالث جریمه دارد و خسارت طرف مقابل از جیب شما پرداخت می‌شود.",
        suggestKind: "third_party",
        vehicleId: v.id,
      });
    }
  }
  for (const p of properties) {
    const label = [p.area, p.city].filter(Boolean).join("، ") || "ملک";
    const cover = live.filter((x) => x.kind === "fire" && x.propertyId === p.id);
    if (!cover.length) {
      gaps.push({ kind: "property_uninsured", title: `${label} بیمه‌ی آتش‌سوزی ندارد`, detail: "حق بیمه‌ی آتش‌سوزی و زلزله معمولاً کسر کوچکی از ارزش ملک است.", suggestKind: "fire", propertyId: p.id });
      continue;
    }
    const sum = Decimal.sum(cover.map((c) => c.coverage ?? "0"));
    if (p.value && D(p.value).gt(0) && sum.gt(0) && sum.lt(D(p.value).mul("0.8"))) {
      const pct = sum.mul(100).div(p.value).toFixed(0);
      gaps.push({
        kind: "property_underinsured",
        title: `${label} فقط ${Number(pct).toLocaleString("fa-IR")}٪ ارزش روزش بیمه شده است`,
        detail: "در خسارت، بیمه‌گر معمولاً به نسبت سرمایه‌ی بیمه‌شده به ارزش واقعی پرداخت می‌کند؛ هنگام تمدید سرمایه را به‌روز کنید.",
        suggestKind: "fire",
        propertyId: p.id,
      });
    }
  }
  return gaps;
}

/** For reminders: pending premiums due before `until`, and terms ending soon or just ended. */
export async function insuranceReminders(userId: string, until: string, today = todayIso()) {
  const renewalUntil = new Date(`${today}T00:00:00Z`);
  renewalUntil.setUTCDate(renewalUntil.getUTCDate() + RENEWAL_HORIZON_DAYS);
  const renewalSince = new Date(`${today}T00:00:00Z`);
  renewalSince.setUTCDate(renewalSince.getUTCDate() - RENEWAL_HORIZON_DAYS);
  const [premiums, expiring] = await Promise.all([
    db
      .select({
        id: plannedTransactions.id,
        plannedDate: plannedTransactions.plannedDate,
        amountBase: plannedTransactions.amountBase,
        title: insurancePolicies.title,
        savingsAccountId: plannedTransactions.toAccountId,
      })
      .from(plannedTransactions)
      .innerJoin(insurancePolicies, eq(insurancePolicies.id, plannedTransactions.insurancePolicyId))
      .where(
        and(
          eq(plannedTransactions.userId, userId),
          eq(plannedTransactions.status, "pending"),
          isNull(plannedTransactions.deletedAt),
          sql`${plannedTransactions.plannedDate} <= ${until}`,
        ),
      )
      .orderBy(asc(plannedTransactions.plannedDate)),
    db
      .select({ id: insurancePolicies.id, title: insurancePolicies.title, kind: insurancePolicies.kind, endDate: insurancePolicies.endDate })
      .from(insurancePolicies)
      .where(
        and(
          eq(insurancePolicies.userId, userId),
          eq(insurancePolicies.status, "active"),
          sql`${insurancePolicies.endDate} is not null and ${insurancePolicies.endDate} <= ${renewalUntil.toISOString().slice(0, 10)} and ${insurancePolicies.endDate} >= ${renewalSince.toISOString().slice(0, 10)}`,
        ),
      )
      .orderBy(asc(insurancePolicies.endDate)),
  ]);
  return { premiums, expiring };
}
