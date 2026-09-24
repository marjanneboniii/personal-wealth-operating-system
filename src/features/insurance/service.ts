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
 */
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, expenseCategories, insurancePolicies, plannedTransactions, realEstateProperties, vehicleAssets } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { registerMoneyAccount } from "@/features/accounts/service";
import { addJalaliMonths } from "@/features/income/recurring";
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
  payAccountId: string;
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

async function tomanMoneyAccount(tx: any, userId: string, accountId: string) {
  const [acc] = await tx
    .select({ userId: accounts.userId, type: accounts.type, deletedAt: accounts.deletedAt, symbol: assets.symbol })
    .from(accounts)
    .leftJoin(assets, eq(assets.id, accounts.assetId))
    .where(eq(accounts.id, accountId))
    .limit(1);
  if (!acc || acc.userId !== userId || acc.type !== "asset" || acc.deletedAt || acc.symbol !== "IRT") {
    throw new Error("حق بیمه را از یک حساب تومانیِ خودتان انتخاب کنید.");
  }
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
  const withSavings = kind === "life" && !!input.withSavings;

  return db.transaction(async (tx) => {
    await tomanMoneyAccount(tx, userId, input.payAccountId);

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
        premiumFrequency: frequency,
        payAccountId: input.payAccountId,
        coverageToman: coverage ? coverage.toFixed(0) : null,
        insuredPropertyId: propertyId,
        insuredVehicleId: vehicleId,
        savingsAccountId,
        renewedFromId: input.renewedFromId ?? null,
        note: clean(input.note, 500),
      })
      .returning({ id: insurancePolicies.id });

    const first = nextPremiumDate(input.startDate, frequency, today, endDate);
    if (first) {
      await tx.insert(plannedTransactions).values(
        premiumPlanRow({
          userId,
          policyId: policy.id,
          title,
          date: first,
          premiumToman: premium.toFixed(0),
          frequency,
          payAccountId: input.payAccountId,
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
  input: { startDate?: string | null; endDate: string; premiumToman: string; coverageToman?: string | null },
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
    payAccountId: old.payAccountId,
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
  if (!policy || policy.status !== "active") return;
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
      payAccountId: policy.payAccountId,
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
  payAccountId: string;
  payAccountName: string | null;
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
           n.planned_date::text as "nextPremiumDate", n.id as "nextPlanId"
    from insurance_policies p
      left join accounts pa on pa.id = p.pay_account_id
      left join real_estate_properties rep on rep.id = p.insured_property_id
      left join vehicle_assets v on v.id = p.insured_vehicle_id
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
