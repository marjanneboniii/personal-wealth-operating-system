/**
 * تطبیق موجودی — does the ledger agree with the bank?
 *
 * A balance is never stored in this system; every figure is SUM(postings).
 * That makes a silently missed transaction invisible: the books stay balanced
 * and every report is simply wrong. The bank is the one outside witness, and
 * it speaks in two ways — the «مانده» line of a bank SMS (captured when the
 * message is confirmed, see confirmBankImportAction) and a number the user
 * reads off their banking app.
 *
 * THE RULES
 *   • A checkpoint records what the bank said: account, day, balance in the
 *     account's own unit. It is never edited and never overwrites anything.
 *   • Agreement is DERIVED, on every read: the latest checkpoint of an account
 *     against the posted ledger up to the end of its day. Recording the missed
 *     transaction therefore resolves the difference by itself — no status to
 *     keep in sync.
 *   • When the user does not know what the difference was, it can be closed
 *     with one balanced `adjustment` entry against 3020 «اختلاف تطبیق حساب‌ها»
 *     (equity). Equity, not income or expense: an unexplained difference is not
 *     spending, so it moves net worth and leaves cash flow, budgets and the
 *     savings rate untouched.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, balanceCheckpoints, entryFxSnapshots, entryReviews } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { ensureSystemAccount } from "@/features/accounts/systemAccounts";
import { isLiquidAccount } from "@/features/accounts/classification";
import { postEntry } from "@/features/ledger/service";
import { nativeUnitPriceUsd } from "@/features/fx/unitPrice";
import { getWritableUsdIrtRateForUser } from "@/lib/fx";
import { todayIso } from "@/lib/format";

export const RECONCILE_EQUITY_CODE = "3020";
export const RECONCILE_EQUITY_NAME = "اختلاف تطبیق حساب‌ها";
/** A checkpoint older than this no longer says much about today's balance. */
export const RECONCILE_STALE_DAYS = 30;

export type ReconcileState = "matched" | "mismatch" | "unchecked";

export type AccountReconciliation = {
  accountId: string;
  name: string;
  symbol: string;
  /** Posted balance today, native units. */
  ledgerNow: string;
  checkpoint: {
    id: string;
    asOf: string;
    observedAt: string;
    balance: string;
    source: "sms" | "manual";
    resolutionEntryId: string | null;
  } | null;
  /** Posted balance at the end of the checkpoint's day. */
  ledgerAtCheckpoint: string | null;
  /** bank − ledger, native units: positive = the bank holds more than the books. */
  difference: string | null;
  state: ReconcileState;
  stale: boolean;
};

const rows = async <T>(q: ReturnType<typeof sql>, client: any = db): Promise<T[]> =>
  ((await client.execute(q)) as { rows: T[] }).rows;

/** Rounding a Rial figure to Toman, or a dollar leg to cents, is not a difference. */
export function reconcileTolerance(symbol: string | null | undefined): string {
  const s = (symbol ?? "").toUpperCase();
  return s === "IRT" || s === "IRR" ? "1" : "0.01";
}

export function isWithinTolerance(difference: string, symbol: string | null | undefined): boolean {
  return D(difference).abs().lt(reconcileTolerance(symbol));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

type MoneyAccountRow = { id: string; name: string; symbol: string; classCode: string | null; className: string | null; walletKind: string | null };

/** The user's own money accounts (bank, cash, fund, stablecoin wallet). */
async function moneyAccounts(userId: string, client: any = db): Promise<MoneyAccountRow[]> {
  const list = await rows<MoneyAccountRow>(
    sql`
      select a.id, a.name, ast.symbol, ac.code as "classCode", ac.name as "className", w.kind as "walletKind"
      from accounts a
        join assets ast on ast.id = a.asset_id and ast.deleted_at is null
        left join asset_classes ac on ac.id = ast.class_id
        left join wallets w on w.id = a.wallet_id
      where a.user_id = ${userId}::uuid and a.type = 'asset' and a.deleted_at is null and a.is_active = true
      order by a.code
    `,
    client,
  );
  return list.filter((a) => isLiquidAccount(a));
}

async function assertMoneyAccount(userId: string, accountId: string, client: any = db): Promise<MoneyAccountRow> {
  const found = (await moneyAccounts(userId, client)).find((a) => a.id === accountId);
  if (!found) throw new Error("فقط حساب‌های پول فعالِ خودتان را می‌توان با بانک تطبیق داد.");
  return found;
}

/** Posted balance of one account at the end of `asOf`, native units. */
export async function ledgerBalanceAsOf(userId: string, accountId: string, asOf: string, client: any = db): Promise<string> {
  const [row] = await rows<{ q: string }>(
    sql`
      select coalesce(sum(p.quantity), 0)::text as q
      from postings p join journal_entries je on je.id = p.entry_id
      where p.account_id = ${accountId}::uuid and je.status = 'posted'
        and (je.user_id = ${userId}::uuid or je.user_id is null)
        and je.entry_date <= ${asOf}::date
    `,
    client,
  );
  return row?.q ?? "0";
}

export type CheckpointInput = {
  userId: string;
  accountId: string;
  asOf: string;
  balance: string;
  source: "sms" | "manual";
  observedAt?: Date;
  entryId?: string | null;
};

export async function recordBalanceCheckpoint(input: CheckpointInput, client: any = db): Promise<{ id: string }> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOf) || input.asOf > todayIso() || input.asOf < "1900-01-01") {
    throw new Error("تاریخ موجودی باید امروز یا گذشته باشد.");
  }
  if (!/^-?\d{1,20}(?:\.\d{1,18})?$/.test(input.balance)) throw new Error("موجودی را به عدد وارد کنید.");
  await assertMoneyAccount(input.userId, input.accountId, client);
  const [row] = await client
    .insert(balanceCheckpoints)
    .values({
      userId: input.userId,
      accountId: input.accountId,
      asOf: input.asOf,
      observedAt: input.observedAt ?? new Date(),
      balance: D(input.balance).toString(),
      source: input.source,
      entryId: input.entryId ?? null,
    })
    .returning({ id: balanceCheckpoints.id });
  return row;
}

type LatestRow = {
  id: string;
  accountId: string;
  asOf: string;
  observedAt: string;
  balance: string;
  source: "sms" | "manual";
  resolutionEntryId: string | null;
  ledger: string;
};

/** Latest checkpoint per account, with the ledger balance at the end of its day. */
async function latestCheckpoints(userId: string, client: any = db): Promise<Map<string, LatestRow>> {
  const list = await rows<LatestRow>(
    sql`
      select distinct on (c.account_id)
        c.id, c.account_id as "accountId", c.as_of::text as "asOf", c.observed_at::text as "observedAt",
        c.balance::text as balance, c.source, c.resolution_entry_id as "resolutionEntryId",
        (select coalesce(sum(p.quantity), 0) from postings p join journal_entries je on je.id = p.entry_id
          where p.account_id = c.account_id and je.status = 'posted'
            and (je.user_id = ${userId}::uuid or je.user_id is null)
            and je.entry_date <= c.as_of)::text as ledger
      from balance_checkpoints c
      where c.user_id = ${userId}::uuid
      order by c.account_id, c.as_of desc, c.observed_at desc, c.created_at desc
    `,
    client,
  );
  return new Map(list.map((r) => [r.accountId, r]));
}

export async function listReconciliation(userId: string, today = todayIso()): Promise<AccountReconciliation[]> {
  const [list, latest, current] = await Promise.all([
    moneyAccounts(userId),
    latestCheckpoints(userId),
    rows<{ accountId: string; q: string }>(sql`
      select p.account_id as "accountId", coalesce(sum(p.quantity), 0)::text as q
      from postings p join journal_entries je on je.id = p.entry_id
      where je.status = 'posted' and (je.user_id = ${userId}::uuid or je.user_id is null)
        and p.account_id in (select id from accounts where user_id = ${userId}::uuid)
      group by p.account_id
    `),
  ]);
  const now = new Map(current.map((r) => [r.accountId, r.q]));
  return list.map((a) => {
    const c = latest.get(a.id) ?? null;
    const difference = c ? D(c.balance).sub(c.ledger).toString() : null;
    const state: ReconcileState = !c ? "unchecked" : isWithinTolerance(difference!, a.symbol) ? "matched" : "mismatch";
    return {
      accountId: a.id,
      name: a.name,
      symbol: a.symbol,
      ledgerNow: now.get(a.id) ?? "0",
      checkpoint: c
        ? { id: c.id, asOf: c.asOf, observedAt: c.observedAt, balance: c.balance, source: c.source, resolutionEntryId: c.resolutionEntryId }
        : null,
      ledgerAtCheckpoint: c?.ledger ?? null,
      difference,
      state,
      stale: !c || daysBetween(c.asOf, today) > RECONCILE_STALE_DAYS,
    };
  });
}

/** Accounts whose latest bank balance disagrees with the books — the reminder feed. */
export async function reconcileMismatches(userId: string): Promise<AccountReconciliation[]> {
  return (await listReconciliation(userId)).filter((r) => r.state === "mismatch");
}

/**
 * Close the difference of an account's LATEST checkpoint with one balanced
 * adjustment entry dated on the checkpoint's day. Refused when the account
 * already agrees, when a newer checkpoint superseded this one, or when the
 * checkpoint was already adjusted — so a double tap can never post twice.
 */
export async function adjustToReported(userId: string, checkpointId: string): Promise<{ entryId: string; difference: string }> {
  // Ownership first: a foreign or unknown id must not even trigger a rate refresh.
  const [owned] = await db
    .select({ id: balanceCheckpoints.id })
    .from(balanceCheckpoints)
    .where(and(eq(balanceCheckpoints.id, checkpointId), eq(balanceCheckpoints.userId, userId)))
    .limit(1);
  if (!owned) throw new Error("این موجودی پیدا نشد.");
  // Read outside the write transaction: a single-connection driver deadlocks on `db` inside it.
  const fx = await getWritableUsdIrtRateForUser(userId);
  const rate = D(fx.rate);

  return db.transaction(async (tx) => {
    const locked = await tx.execute(
      sql`select id from balance_checkpoints where id = ${checkpointId}::uuid and user_id = ${userId}::uuid for update`,
    );
    if (!locked.rows.length) throw new Error("این موجودی پیدا نشد.");
    const [cp] = await tx.select().from(balanceCheckpoints).where(eq(balanceCheckpoints.id, checkpointId)).limit(1);
    if (cp.resolutionEntryId) throw new Error("این اختلاف قبلاً اصلاح شده است.");
    const latest = (await latestCheckpoints(userId, tx)).get(cp.accountId);
    if (latest?.id !== cp.id) throw new Error("موجودی تازه‌تری برای این حساب ثبت شده است؛ صفحه را تازه کنید.");

    const account = await assertMoneyAccount(userId, cp.accountId, tx);
    const ledger = await ledgerBalanceAsOf(userId, cp.accountId, cp.asOf, tx);
    const diff = D(cp.balance).sub(ledger);
    if (isWithinTolerance(diff.toString(), account.symbol)) throw new Error("این حساب با بانک یکی است؛ اصلاحی لازم نیست.");

    const [acc] = await tx.select({ assetId: accounts.assetId }).from(accounts).where(eq(accounts.id, cp.accountId)).limit(1);
    const unitUsd = D(await nativeUnitPriceUsd(acc.assetId!, userId, tx));
    const baseValue = diff.mul(unitUsd);
    const equity = await ensureSystemAccount({ code: RECONCILE_EQUITY_CODE, name: RECONCILE_EQUITY_NAME, type: "equity", userId, client: tx });
    if (!equity) throw new Error("حساب «اختلاف تطبیق» ساخته نشد.");

    const entry = await postEntry(
      {
        entryDate: cp.asOf,
        type: "adjustment",
        description: `تطبیق موجودی «${account.name}» با بانک`,
        source: "manual",
        postings: [
          { accountId: cp.accountId, assetId: acc.assetId!, quantity: diff.toString(), baseValue: baseValue.toString() },
          { accountId: equity.id, assetId: acc.assetId!, quantity: diff.neg().toString(), baseValue: baseValue.neg().toString() },
        ],
        userId,
        idempotencyKey: `reconcile:${cp.id}`,
      },
      tx,
    );

    const symbol = account.symbol.toUpperCase();
    const toman: Decimal = symbol === "IRT" ? diff.abs() : symbol === "IRR" ? diff.abs().div(10) : baseValue.abs().mul(rate);
    await tx
      .insert(entryFxSnapshots)
      .values({
        entryId: entry.id,
        irtAmount: toman.toFixed(0),
        usdAmount: baseValue.abs().toString(),
        fxRate: rate.toString(),
        rateSource: fx.source,
        rateDate: fx.effectiveDate,
      })
      .onConflictDoNothing();
    await tx.insert(entryReviews).values({ entryId: entry.id }).onConflictDoNothing();
    await tx
      .update(balanceCheckpoints)
      .set({ resolutionEntryId: entry.id })
      .where(and(eq(balanceCheckpoints.id, cp.id), eq(balanceCheckpoints.userId, userId)));
    return { entryId: entry.id, difference: diff.toString() };
  });
}
