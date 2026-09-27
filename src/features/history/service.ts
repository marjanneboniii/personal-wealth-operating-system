/**
 * سوابق پیش از توازن — the user's money story from before the app.
 *
 * A history record is a NOTE ABOUT THE PAST, never a ledger movement: this
 * module does not import the ledger, and nothing in the ledger, the balances,
 * net worth, budgets, cash-flow or forecasts reads `history_records`. The
 * opening balances already contain the result of these movements, so posting
 * them would count them twice.
 *
 * Every function takes the owner's id and scopes by it; there is no NULL-owner
 * record.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { historyRecords, journalEntries, users } from "@/db/schema";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";

export const HISTORY_KINDS = ["expense", "income", "transfer", "buy", "sell", "borrow", "repay", "other"] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

export const HISTORY_UNITS = ["IRT", "USD", "USDT", "EUR", "GOLD", "COIN"] as const;
export type HistoryUnit = (typeof HISTORY_UNITS)[number];

/** Which way the money went, for the summary only: +1 in, −1 out, 0 neither. */
export const HISTORY_KIND_SIGN: Record<HistoryKind, -1 | 0 | 1> = {
  expense: -1,
  income: 1,
  transfer: 0,
  buy: -1,
  sell: 1,
  borrow: 1,
  repay: -1,
  other: 0,
};

export type HistoryInput = {
  occurredOn: string;
  kind: string;
  title: string;
  amount: string;
  unit?: string | null;
  counterparty?: string | null;
  accountLabel?: string | null;
  note?: string | null;
};

export type HistoryRow = {
  id: string;
  occurredOn: string;
  kind: HistoryKind;
  title: string;
  amount: string;
  unit: HistoryUnit;
  counterparty: string | null;
  accountLabel: string | null;
  note: string | null;
};

export type HistorySummary = {
  count: number;
  /** Toman records only — other units are never converted into a total. */
  inToman: string;
  outToman: string;
  first: string | null;
  last: string | null;
};

const clean = (v: string | null | undefined, max: number, label: string) => {
  const t = (v ?? "").trim().replace(/\s+/g, " ");
  if (t.length > max) throw new Error(`${label} حداکثر ${max} نویسه است.`);
  return t || null;
};

/** The only thing this module refuses on purpose: a record from the ledger's own time. */
export const HISTORY_AFTER_START_MESSAGE =
  "سوابق گذشته فقط برای تاریخ‌های قبل از اولین تراکنش ثبت‌شده است. تراکنش‌های فعلی و آینده را از «ثبت تراکنش» وارد کنید تا در موجودی حساب‌ها اثر بگذارند.";

function validate(input: HistoryInput, start: string | null) {
  const kind = input.kind as HistoryKind;
  if (!HISTORY_KINDS.includes(kind)) throw new Error("نوع سابقه را انتخاب کنید.");
  const unit = (input.unit || "IRT").toUpperCase() as HistoryUnit;
  if (!HISTORY_UNITS.includes(unit)) throw new Error("واحد مبلغ نامعتبر است.");
  const title = clean(input.title, 120, "عنوان");
  if (!title) throw new Error("عنوان سابقه را بنویسید؛ مثلاً «خرید لپ‌تاپ».");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn ?? "")) throw new Error("تاریخ را انتخاب کنید.");
  // A movement on or after «آغاز توازن» belongs to the ledger, not here — and
  // the boundary is never later than today, so no future date passes either.
  const limit = start && start < todayIso() ? start : todayIso();
  if (input.occurredOn >= limit) throw new Error(HISTORY_AFTER_START_MESSAGE);
  let amount;
  try {
    amount = D(input.amount || "0");
  } catch {
    throw new Error("مبلغ نامعتبر است.");
  }
  if (!amount.gt(0)) throw new Error("مبلغ باید بیشتر از صفر باشد.");
  return {
    kind,
    unit,
    title,
    occurredOn: input.occurredOn,
    amount: amount.toString(),
    counterparty: clean(input.counterparty, 120, "طرف حساب"),
    accountLabel: clean(input.accountLabel, 120, "نام حساب"),
    note: clean(input.note, 500, "یادداشت"),
  };
}

function toRow(r: typeof historyRecords.$inferSelect): HistoryRow {
  return {
    id: r.id,
    occurredOn: String(r.occurredOn),
    kind: r.kind as HistoryKind,
    title: r.title,
    amount: D(r.amount).toString(),
    unit: r.unit as HistoryUnit,
    counterparty: r.counterparty,
    accountLabel: r.accountLabel,
    note: r.note,
  };
}

export async function listHistoryRecords(userId: string): Promise<HistoryRow[]> {
  const rows = await db
    .select()
    .from(historyRecords)
    .where(eq(historyRecords.userId, userId))
    .orderBy(desc(historyRecords.occurredOn), desc(historyRecords.createdAt));
  return rows.map(toRow);
}

export function summarizeHistory(rows: HistoryRow[]): HistorySummary {
  let inT = D("0");
  let outT = D("0");
  for (const r of rows) {
    if (r.unit !== "IRT") continue;
    const sign = HISTORY_KIND_SIGN[r.kind];
    if (sign > 0) inT = inT.add(r.amount);
    else if (sign < 0) outT = outT.add(r.amount);
  }
  const dates = rows.map((r) => r.occurredOn).sort();
  return {
    count: rows.length,
    inToman: inT.toFixed(0),
    outToman: outT.toFixed(0),
    first: dates[0] ?? null,
    last: dates[dates.length - 1] ?? null,
  };
}

/**
 * True when the database has not been migrated to 0053 yet (no
 * `history_records` table, SQLSTATE 42P01). Pages use it to show a clear
 * «update the database» state instead of the generic error page.
 */
export function isHistoryTableMissing(e: unknown): boolean {
  for (let cur: any = e, i = 0; cur && i < 5; cur = cur.cause, i++) {
    if (cur.code === "42P01") return true;
    if (typeof cur.message === "string" && /history_records/.test(cur.message) && /does not exist|no such table/i.test(cur.message)) return true;
  }
  return false;
}

export async function countHistoryRecords(userId: string): Promise<number> {
  const [r] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(historyRecords)
    .where(eq(historyRecords.userId, userId));
  return Number(r?.c ?? 0);
}

/**
 * When the user's life «in توازن» began: the date of their first recorded
 * transaction (opening balances included), else the day they joined. History
 * records must be dated strictly BEFORE it; the timeline draws its boundary
 * here.
 */
export async function getTavazonStart(userId: string): Promise<string | null> {
  const [first] = await db
    .select({ d: journalEntries.entryDate })
    .from(journalEntries)
    .where(eq(journalEntries.userId, userId))
    .orderBy(asc(journalEntries.entryDate))
    .limit(1);
  if (first?.d) return String(first.d);
  const [u] = await db.select({ c: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1);
  return u?.c ? new Date(u.c).toISOString().slice(0, 10) : null;
}

export async function createHistoryRecord(userId: string, input: HistoryInput): Promise<HistoryRow> {
  const v = validate(input, await getTavazonStart(userId));
  const [row] = await db
    .insert(historyRecords)
    .values({ ...v, userId })
    .returning();
  return toRow(row);
}

export async function updateHistoryRecord(userId: string, id: string, input: HistoryInput): Promise<HistoryRow> {
  const v = validate(input, await getTavazonStart(userId));
  const [row] = await db
    .update(historyRecords)
    .set({ ...v, updatedAt: new Date() })
    .where(and(eq(historyRecords.id, id), eq(historyRecords.userId, userId)))
    .returning();
  if (!row) throw new Error("سابقه یافت نشد.");
  return toRow(row);
}

export async function deleteHistoryRecord(userId: string, id: string): Promise<void> {
  const gone = await db
    .delete(historyRecords)
    .where(and(eq(historyRecords.id, id), eq(historyRecords.userId, userId)))
    .returning({ id: historyRecords.id });
  if (!gone.length) throw new Error("سابقه یافت نشد.");
}
