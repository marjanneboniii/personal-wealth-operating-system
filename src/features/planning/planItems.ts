/**
 * Edit, close and delete for the planning entities (goal, fund, event, debt),
 * money set aside for a goal, and debts / receivables with no due date.
 *
 * Deletes are soft (`deleted_at`): every list already filters on it, and
 * nothing that posted to the ledger is ever removed.
 */
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { budgets, debts, events, goalContributions, goals, installments, undatedObligations } from "@/db/schema";
import { D } from "@/domain/decimal";
import { normalizeTag } from "@/features/tags/normalize";
import { todayIso } from "@/lib/format";
import { readReferenceQuotes } from "@/features/pricing/referenceQuotes";
import { REFERENCE_QUOTE_REFS } from "@/features/pricing/referenceMarketRows";

type Owner = string | null;
const owned = (col: PgColumn, userId: Owner): SQL => (userId ? eq(col, userId) : isNull(col));
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function cleanName(v: string, max = 80): string {
  const s = v.trim().replace(/\s+/g, " ");
  if (s.length < 2 || s.length > max) throw new Error("نام را وارد کنید.");
  return s;
}
function positive(v: string, msg = "مبلغ معتبر نیست."): string {
  let n;
  try {
    n = D(v);
  } catch {
    throw new Error(msg);
  }
  if (!n.gt(0)) throw new Error(msg);
  return n.toString();
}
function date(v: string | null | undefined): string | null {
  if (!v) return null;
  if (!ISO.test(v)) throw new Error("تاریخ معتبر نیست.");
  return v;
}
async function ensureOne(res: { id: string }[]) {
  if (!res.length) throw new Error("پیدا نشد.");
}

/* ── Goal ── */
export async function updateGoal(userId: Owner, id: string, input: { name: string; targetToman: string; targetDate?: string | null }) {
  const res = await db
    .update(goals)
    .set({ name: cleanName(input.name), targetBase: positive(input.targetToman), targetDate: date(input.targetDate), updatedAt: new Date() })
    .where(and(eq(goals.id, id), owned(goals.userId, userId), isNull(goals.deletedAt)))
    .returning({ id: goals.id });
  await ensureOne(res);
}
export async function setGoalStatus(userId: Owner, id: string, status: "active" | "reached" | "archived") {
  const res = await db
    .update(goals)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(goals.id, id), owned(goals.userId, userId), isNull(goals.deletedAt)))
    .returning({ id: goals.id });
  await ensureOne(res);
}
export async function deleteGoal(userId: Owner, id: string) {
  const res = await db
    .update(goals)
    .set({ deletedAt: new Date() })
    .where(and(eq(goals.id, id), owned(goals.userId, userId), isNull(goals.deletedAt)))
    .returning({ id: goals.id });
  await ensureOne(res);
}

/**
 * «کنار گذاشتم» — money earmarked for a goal. Planning only: no posting. A
 * negative amount takes some back. The goal's progress is the sum of these
 * once it has any, and the cash forecast treats them as spoken for.
 */
export async function addGoalContribution(userId: Owner, goalId: string, amountToman: string, occurredAt: string, note?: string | null) {
  const [g] = await db
    .select({ id: goals.id })
    .from(goals)
    .where(and(eq(goals.id, goalId), owned(goals.userId, userId), isNull(goals.deletedAt)))
    .limit(1);
  if (!g) throw new Error("هدف پیدا نشد.");
  let amount;
  try {
    amount = D(amountToman);
  } catch {
    throw new Error("مبلغ معتبر نیست.");
  }
  if (amount.isZero()) throw new Error("مبلغ معتبر نیست.");
  if (amount.isNegative()) {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${goalContributions.amountBase}), 0)::text` })
      .from(goalContributions)
      .where(eq(goalContributions.goalId, goalId));
    if (D(row?.total ?? "0").add(amount).isNegative()) throw new Error("بیشتر از مبلغ کنارگذاشته است.");
  }
  await db.insert(goalContributions).values({
    goalId,
    amountBase: amount.toString(),
    occurredAt: date(occurredAt) ?? todayIso(),
    note: note?.trim().slice(0, 200) || null,
  });
}

/** Sum set aside per goal (only goals that have any). */
export async function contributionTotals(goalIds: string[]): Promise<Map<string, string>> {
  if (!goalIds.length) return new Map();
  const rows = await db
    .select({ goalId: goalContributions.goalId, total: sql<string>`sum(${goalContributions.amountBase})::text` })
    .from(goalContributions)
    .where(inArray(goalContributions.goalId, goalIds))
    .groupBy(goalContributions.goalId);
  return new Map(rows.map((r) => [r.goalId, r.total]));
}

/** Toman set aside for this user's active goals — what the forecast must not spend. */
export async function earmarkedToman(userId: Owner): Promise<string> {
  try {
    const [row] = await db
      .select({ total: sql<string>`coalesce(sum(${goalContributions.amountBase}), 0)::text` })
      .from(goalContributions)
      .innerJoin(goals, eq(goals.id, goalContributions.goalId))
      .where(and(owned(goals.userId, userId), isNull(goals.deletedAt), eq(goals.status, "active")));
    return D(row?.total ?? "0").toFixed(0);
  } catch {
    return "0";
  }
}

/* ── Fund — a goal of kind emergency | reserve | family_support ── */
const FUND_KINDS = ["emergency", "reserve", "family_support"];
const isFund = sql`${goals.kind} <> 'goal'`;

export async function createFund(userId: Owner, input: { name: string; kind: string; targetToman: string; accountId?: string | null; note?: string | null }) {
  await db.insert(goals).values({
    userId,
    name: cleanName(input.name),
    kind: FUND_KINDS.includes(input.kind) ? input.kind : "reserve",
    targetBase: positive(input.targetToman),
    fundAccountId: input.accountId || null,
    description: input.note?.trim().slice(0, 200) || null,
  });
}
export async function updateFund(userId: Owner, id: string, input: { name: string; targetToman: string }) {
  const res = await db
    .update(goals)
    .set({ name: cleanName(input.name), targetBase: positive(input.targetToman), updatedAt: new Date() })
    .where(and(eq(goals.id, id), isFund, owned(goals.userId, userId), isNull(goals.deletedAt)))
    .returning({ id: goals.id });
  await ensureOne(res);
}
export async function deleteFund(userId: Owner, id: string) {
  const res = await db
    .update(goals)
    .set({ deletedAt: new Date() })
    .where(and(eq(goals.id, id), isFund, owned(goals.userId, userId), isNull(goals.deletedAt)))
    .returning({ id: goals.id });
  await ensureOne(res);
}

/* ── Event ── */
/** The tag an event's budget tracks: its name, as a hashtag. */
export function eventTag(name: string): string | null {
  return normalizeTag(name.replace(/\s+/g, "_").slice(0, 32));
}

/**
 * A new event gets its own tag budget: expenses carrying the tag count as
 * spent, and the forecast counts only what is left of the event's amount.
 */
export async function createEventWithBudget(userId: Owner, input: { name: string; eventDate: string; budgetToman: string; category: string; today: string }) {
  const name = cleanName(input.name);
  const eventDate = date(input.eventDate)!;
  const amount = positive(input.budgetToman);
  await db.transaction(async (tx) => {
    const [ev] = await tx
      .insert(events)
      .values({ userId, name, eventDate, budgetBase: amount, category: input.category || "other" })
      .returning({ id: events.id });
    const tag = eventTag(name);
    if (!tag) return;
    await tx.insert(budgets).values({
      userId,
      name,
      tag,
      amountBase: amount,
      periodStart: input.today < eventDate ? input.today : eventDate,
      periodEnd: eventDate,
      eventId: ev.id,
    });
  });
}
export async function updateEvent(userId: Owner, id: string, input: { name: string; eventDate: string; budgetToman: string }) {
  const name = cleanName(input.name);
  const amount = positive(input.budgetToman);
  const eventDate = date(input.eventDate)!;
  const res = await db
    .update(events)
    .set({ name, eventDate, budgetBase: amount, updatedAt: new Date() })
    .where(and(eq(events.id, id), owned(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });
  await ensureOne(res);
  // Keep the linked budget's ceiling and end date in step; its tag stays.
  await db
    .update(budgets)
    .set({ amountBase: amount, periodEnd: eventDate, updatedAt: new Date() })
    .where(and(eq(budgets.eventId, id), isNull(budgets.deletedAt), sql`${budgets.periodStart} <= ${eventDate}`))
    .catch(() => undefined);
}
export async function setEventStatus(userId: Owner, id: string, status: "planned" | "done" | "cancelled") {
  const res = await db
    .update(events)
    .set({ status, updatedAt: new Date() })
    .where(and(eq(events.id, id), owned(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });
  await ensureOne(res);
}
/** The budget and the expenses it tracked stay; only the event goes. */
export async function deleteEvent(userId: Owner, id: string) {
  const res = await db
    .update(events)
    .set({ deletedAt: new Date() })
    .where(and(eq(events.id, id), owned(events.userId, userId), isNull(events.deletedAt)))
    .returning({ id: events.id });
  await ensureOne(res);
}

/** Spent so far per event, from its linked budget. Empty before migration 0056. */
export async function eventBudgetLinks(userId: Owner): Promise<Map<string, { budgetId: string; tag: string | null }>> {
  try {
    const rows = await db
      .select({ id: budgets.id, eventId: budgets.eventId, tag: budgets.tag })
      .from(budgets)
      .where(and(owned(budgets.userId, userId), isNull(budgets.deletedAt), sql`${budgets.eventId} is not null`));
    return new Map(rows.map((r) => [r.eventId!, { budgetId: r.id, tag: r.tag }]));
  } catch {
    return new Map();
  }
}

/* ── Debt ── */
async function ownedDebt(userId: Owner, id: string) {
  const [d] = await db
    .select({ id: debts.id, status: debts.status })
    .from(debts)
    .where(and(eq(debts.id, id), owned(debts.userId, userId), isNull(debts.deletedAt)))
    .limit(1);
  if (!d) throw new Error("بدهی پیدا نشد.");
  return d;
}
export async function updateDebtMeta(userId: Owner, id: string, input: { title: string; creditor: string }) {
  await ownedDebt(userId, id);
  await db
    .update(debts)
    .set({ title: cleanName(input.title, 120), creditor: cleanName(input.creditor, 120), updatedAt: new Date() })
    .where(eq(debts.id, id));
}
/** True when any installment has money against it — such a debt can only be cancelled. */
export async function debtHasPayments(id: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(installments)
    .where(and(eq(installments.debtId, id), sql`(${installments.status} in ('paid','partial') or coalesce(${installments.paidToman}, 0) > 0)`));
  return Number(row?.n ?? 0) > 0;
}
export async function deleteDebt(userId: Owner, id: string) {
  await ownedDebt(userId, id);
  if (await debtHasPayments(id)) throw new Error("این بدهی پرداخت دارد؛ فقط لغو می‌شود.");
  await db.update(debts).set({ deletedAt: new Date() }).where(eq(debts.id, id));
}
/** Paid installments and their entries stay; the rest leave the forecast. */
export async function cancelDebt(userId: Owner, id: string) {
  const d = await ownedDebt(userId, id);
  if (d.status !== "active") throw new Error("این بدهی فعال نیست.");
  await db.update(debts).set({ status: "cancelled", updatedAt: new Date() }).where(eq(debts.id, id));
}

/* ── Undated debt / receivable ── */
export const UNDATED_UNITS = ["toman", "EMAMI", "BAHAR", "NIM", "ROB"] as const;
export type UndatedUnit = (typeof UNDATED_UNITS)[number];

export async function createUndated(
  userId: Owner,
  input: { direction: string; title: string; unit: string; quantity: string; note?: string | null; startDate?: string | null; inflationPct?: string | null },
) {
  if (!(UNDATED_UNITS as readonly string[]).includes(input.unit)) throw new Error("واحد معتبر نیست.");
  const quantity = positive(input.quantity, "مقدار معتبر نیست.");
  if (input.unit !== "toman" && !/^\d+(\.\d+)?$/.test(quantity)) throw new Error("تعداد سکه معتبر نیست.");
  // Inflation applies to a Toman amount only, and needs the date it runs from.
  const toman = input.unit === "toman";
  const startDate = toman ? date(input.startDate) : null;
  let inflationPct: string | null = null;
  if (toman && input.inflationPct) {
    const r = Number(input.inflationPct);
    if (!Number.isFinite(r) || r < 0 || r > 200) throw new Error("نرخ تورم معتبر نیست.");
    if (!startDate) throw new Error("تاریخ شروع را وارد کنید.");
    inflationPct = String(r);
  }
  await db.insert(undatedObligations).values({
    userId,
    direction: input.direction === "receivable" ? "receivable" : "payable",
    title: cleanName(input.title),
    unit: input.unit,
    quantity,
    note: input.note?.trim().slice(0, 300) || null,
    startDate,
    inflationPct,
  });
}

/** amount × (1 + r)^years, years from `start` to `today` — an estimate, never a legal figure. PURE. */
export function inflate(amount: string, pct: string, start: string, today: string): string {
  const years = Math.max(0, (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / (365.25 * 86_400_000));
  const factor = Math.pow(1 + Number(pct) / 100, years);
  return D(amount).mul(factor.toFixed(12)).toFixed(0);
}
export async function deleteUndated(userId: Owner, id: string) {
  const res = await db
    .update(undatedObligations)
    .set({ deletedAt: new Date() })
    .where(and(eq(undatedObligations.id, id), owned(undatedObligations.userId, userId), isNull(undatedObligations.deletedAt)))
    .returning({ id: undatedObligations.id });
  await ensureOne(res);
}

/** Toman per one coin of `unit`, from the stored reference quotes; null when none. */
async function coinPrices(): Promise<Record<string, string | null>> {
  const quotes = await readReferenceQuotes();
  const out: Record<string, string | null> = {};
  for (const unit of UNDATED_UNITS) {
    if (unit === "toman") continue;
    out[unit] = null;
    for (const ref of REFERENCE_QUOTE_REFS[unit] ?? []) {
      const q = quotes.get(`${ref.source}|${ref.ref}`);
      if (!q || q.currency === "USD") continue;
      const per = D(q.price).div(D(q.sourceUnitQuantity || "1"));
      out[unit] = (q.currency === "IRR" ? per.div(10) : per).toFixed(0);
      break;
    }
  }
  return out;
}

export type UndatedRow = {
  id: string;
  direction: "payable" | "receivable";
  title: string;
  unit: UndatedUnit;
  quantity: string;
  note: string | null;
  /** Today's value in Toman (inflation estimate when set); null when the coin has no price yet. */
  valueToman: string | null;
  /** Toman as written, when `valueToman` is an inflation estimate. */
  nominalToman: string | null;
  inflationPct: string | null;
};

/** Empty before migration 0056 — never throws. */
export async function listUndated(userId: Owner, today = todayIso()): Promise<UndatedRow[]> {
  try {
    const rows = await db
      .select()
      .from(undatedObligations)
      .where(and(owned(undatedObligations.userId, userId), isNull(undatedObligations.deletedAt)))
      .orderBy(undatedObligations.createdAt);
    if (!rows.length) return [];
    const prices = rows.some((r) => r.unit !== "toman") ? await coinPrices().catch(() => ({}) as Record<string, string | null>) : {};
    return rows.map((r) => {
      const price = r.unit === "toman" ? "1" : prices[r.unit];
      const estimated = r.unit === "toman" && r.inflationPct && r.startDate ? inflate(r.quantity, r.inflationPct, r.startDate, today) : null;
      return {
        id: r.id,
        direction: r.direction === "receivable" ? "receivable" : "payable",
        title: r.title,
        unit: r.unit as UndatedUnit,
        quantity: D(r.quantity).toString(),
        note: r.note,
        valueToman: estimated ?? (price ? D(r.quantity).mul(price).toFixed(0) : null),
        nominalToman: estimated ? D(r.quantity).toFixed(0) : null,
        inflationPct: estimated ? D(r.inflationPct!).toString() : null,
      };
    });
  } catch {
    return [];
  }
}
