/**
 * حساب معاملاتی — a margin account at a perp venue (هایپرلیکوئید، لایتر…).
 *
 * THE MODEL (see the design notes in features/trading/venues.ts)
 *   • Money moves in and out by ordinary transfers from a wallet.
 *   • An update records the two numbers the venue prints: account value and
 *     the P&L of positions still OPEN. Their difference is the realized
 *     balance — trades closed, fees, funding. When it differs from the ledger,
 *     ONE balanced adjustment entry against 4100 «سود و زیان سرمایه‌گذاری»
 *     brings the books to it: an investment result, never income or spending,
 *     so cash flow, budgets and the savings rate are untouched.
 *   • The open P&L is never an entry. It is a mark (like a price) that the
 *     valuation adds to the account's asset while it is the latest one, so a
 *     loss that recovers — or deepens — needs no correcting entries.
 *   • Automatic updates never record a zero account value: a mistyped address
 *     reads as an empty account, and wiping the balance out as a loss must be
 *     a deliberate, manual act.
 */
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { entryFxSnapshots, entryReviews, tradingAccountLinks, tradingAccountMarks } from "@/db/schema";
import { D, Decimal } from "@/domain/decimal";
import { ensureRealizedPnlAccount } from "@/features/accounts/systemAccounts";
import { postEntry } from "@/features/ledger/service";
import { nativeUnitPriceUsd } from "@/features/fx/unitPrice";
import { getWritableUsdIrtRateForUser } from "@/lib/fx";
import { todayIso } from "@/lib/format";
import { decryptSensitive, encryptSensitive } from "@/lib/fieldEncryption";
import { fetchVenueReading } from "./sync";
import { isEvmAddress, perpVenueOf, type PerpVenue, type SyncVenue, type VenueReading } from "./venues";

const ADDRESS_CONTEXT = "trading_account_links.address";
/** After this many days the shown value is labelled an estimate and a reminder is due. */
export const TRADING_STALE_DAYS = 7;
/** A cent of margin is not a realized result. */
const TOLERANCE = D("0.01");

const rows = async <T>(q: ReturnType<typeof sql>, client: any = db): Promise<T[]> =>
  ((await client.execute(q)) as { rows: T[] }).rows;

export type TradingAccount = {
  accountId: string;
  name: string;
  symbol: string;
  assetId: string;
  venue: PerpVenue;
  /** Realized balance in the books, native units (USDC). */
  ledgerBalance: string;
  mark: { asOf: string; accountValue: string; unrealizedPnl: string; source: string } | null;
  /** Shown value: the latest mark's account value, else the ledger balance. */
  accountValue: string;
  unrealizedPnl: string;
  /** Net transfers in minus out — the money the user put in. */
  netDeposited: string;
  staleDays: number | null;
  /** A wallet address is linked for an automatic update. */
  linked: boolean;
};

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** The user's active asset accounts held at a perp venue. */
export async function listTradingAccounts(userId: string, today = todayIso()): Promise<TradingAccount[]> {
  const list = await rows<{ id: string; name: string; symbol: string; assetId: string; walletName: string | null }>(sql`
    select a.id, a.name, ast.symbol, a.asset_id as "assetId", w.name as "walletName"
    from accounts a
      join assets ast on ast.id = a.asset_id and ast.deleted_at is null
      join wallets w on w.id = a.wallet_id
    where a.user_id = ${userId}::uuid and a.type = 'asset' and a.deleted_at is null and a.is_active = true
    order by a.code
  `);
  const perp = list.flatMap((a) => {
    const venue = perpVenueOf(a.walletName);
    return venue ? [{ ...a, venue }] : [];
  });
  if (!perp.length) return [];
  const ids = perp.map((a) => a.id);

  const [ledger, marks, links] = await Promise.all([
    rows<{ accountId: string; balance: string; deposited: string }>(sql`
      select p.account_id as "accountId",
             coalesce(sum(p.quantity), 0)::text as balance,
             -- transfers only: what the user moved in or out, not results
             coalesce(sum(p.quantity) filter (where je.type <> 'adjustment'), 0)::text as deposited
      from postings p join journal_entries je on je.id = p.entry_id and je.status = 'posted'
      where p.account_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      group by p.account_id
    `),
    rows<{ accountId: string; asOf: string; accountValue: string; unrealizedPnl: string; source: string }>(sql`
      select distinct on (m.account_id) m.account_id as "accountId", m.as_of::text as "asOf",
             m.account_value::text as "accountValue", m.unrealized_pnl::text as "unrealizedPnl", m.source
      from trading_account_marks m
      where m.user_id = ${userId}::uuid and m.account_id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      order by m.account_id, m.created_at desc
    `),
    db.select({ accountId: tradingAccountLinks.accountId }).from(tradingAccountLinks).where(eq(tradingAccountLinks.userId, userId)),
  ]);
  const ledgerBy = new Map(ledger.map((r) => [r.accountId, r]));
  const markBy = new Map(marks.map((m) => [m.accountId, m]));
  const linked = new Set(links.map((l) => l.accountId));

  return perp.map((a) => {
    const l = ledgerBy.get(a.id);
    const mark = markBy.get(a.id) ?? null;
    const balance = D(l?.balance ?? "0");
    const upnl = mark ? D(mark.unrealizedPnl) : D(0);
    return {
      accountId: a.id,
      name: a.name,
      symbol: a.symbol,
      assetId: a.assetId,
      venue: a.venue,
      ledgerBalance: balance.toString(),
      mark,
      accountValue: balance.add(upnl).toString(),
      unrealizedPnl: upnl.toString(),
      netDeposited: D(l?.deposited ?? "0").toString(),
      staleDays: mark ? daysBetween(mark.asOf, today) : null,
      linked: linked.has(a.id),
    };
  });
}

async function ownedPerpAccount(userId: string, accountId: string, client: any = db) {
  const [row] = await rows<{ id: string; name: string; symbol: string; assetId: string; walletName: string | null }>(
    sql`
      select a.id, a.name, ast.symbol, a.asset_id as "assetId", w.name as "walletName"
      from accounts a
        join assets ast on ast.id = a.asset_id
        left join wallets w on w.id = a.wallet_id
      where a.id = ${accountId}::uuid and a.user_id = ${userId}::uuid and a.type = 'asset' and a.deleted_at is null
    `,
    client,
  );
  const venue = row ? perpVenueOf(row.walletName) : null;
  if (!row || !venue) throw new Error("این حساب، حساب معاملاتی یک پلتفرم پرپ نیست.");
  return { ...row, venue };
}

/**
 * Records what the venue shows. Posts the realized difference against 4100
 * when there is one, then stores the mark. Returns the realized change.
 */
export async function recordTradingMark(
  userId: string,
  accountId: string,
  input: VenueReading & { asOf?: string; source?: "manual" | SyncVenue },
): Promise<{ realizedChange: string; entryId: string | null }> {
  const value = D(input.accountValue);
  const upnl = D(input.unrealizedPnl);
  if (value.isNegative()) throw new Error("ارزش حساب نمی‌تواند منفی باشد.");
  // The realized balance is the collateral itself: it cannot be below zero.
  if (value.sub(upnl).lt(TOLERANCE.neg())) throw new Error("سود و زیان باز از ارزش حساب بیشتر است؛ عددها را دوباره از پلتفرم ببینید.");
  const source = input.source ?? "manual";
  if (source !== "manual" && value.isZero()) {
    throw new Error("پلتفرم برای این آدرس ارزش صفر نشان می‌دهد. اگر آدرس درست است و حساب واقعاً خالی یا لیکویید شده، آن را دستی ثبت کنید.");
  }
  const asOf = input.asOf ?? todayIso();
  const account = await ownedPerpAccount(userId, accountId);
  // Read outside the write transaction: a single-connection driver deadlocks on `db` inside it.
  const fx = await getWritableUsdIrtRateForUser(userId);
  const rate = D(fx.rate);

  return db.transaction(async (tx) => {
    const [{ q }] = await rows<{ q: string }>(
      sql`select coalesce(sum(p.quantity), 0)::text as q
          from postings p join journal_entries je on je.id = p.entry_id and je.status = 'posted'
          where p.account_id = ${accountId}::uuid`,
      tx,
    );
    const realized = value.sub(upnl);
    const diff = realized.sub(q);
    let entryId: string | null = null;

    if (diff.abs().gte(TOLERANCE)) {
      const unitUsd = D(await nativeUnitPriceUsd(account.assetId, userId, tx));
      const baseValue = diff.mul(unitUsd);
      const pnlAccount = await ensureRealizedPnlAccount(userId, tx);
      if (!pnlAccount) throw new Error("حساب «سود و زیان سرمایه‌گذاری» ساخته نشد.");
      const entry = await postEntry(
        {
          entryDate: asOf,
          type: "adjustment",
          description: `${diff.isNegative() ? "زیان" : "سود"} معاملات ${account.venue.place}`,
          source: "manual",
          postings: [
            { accountId, assetId: account.assetId, quantity: diff.toString(), baseValue: baseValue.toString() },
            { accountId: pnlAccount.id, assetId: account.assetId, quantity: diff.neg().toString(), baseValue: baseValue.neg().toString() },
          ],
          userId,
        },
        tx,
      );
      entryId = entry.id;
      await tx
        .insert(entryFxSnapshots)
        .values({
          entryId: entry.id,
          irtAmount: baseValue.abs().mul(rate).toFixed(0),
          usdAmount: baseValue.abs().toString(),
          fxRate: rate.toString(),
          rateSource: fx.source,
          rateDate: fx.effectiveDate,
        })
        .onConflictDoNothing();
      await tx.insert(entryReviews).values({ entryId: entry.id }).onConflictDoNothing();
    }

    await tx.insert(tradingAccountMarks).values({
      userId,
      accountId,
      asOf,
      accountValue: value.toString(),
      unrealizedPnl: upnl.toString(),
      source,
      entryId,
    });
    return { realizedChange: diff.abs().gte(TOLERANCE) ? diff.toString() : "0", entryId };
  });
}

/** Links (or replaces) the public wallet address of a syncable venue account. */
export async function linkTradingAccount(userId: string, accountId: string, address: string): Promise<void> {
  const account = await ownedPerpAccount(userId, accountId);
  if (!account.venue.sync) throw new Error(`${account.venue.place} بروزرسانی خودکار ندارد؛ عددها را دستی وارد کنید.`);
  if (!isEvmAddress(address)) throw new Error("آدرس کیف پول معتبر نیست (0x و ۴۰ کاراکتر).");
  const addressEnc = encryptSensitive(address.trim().toLowerCase(), ADDRESS_CONTEXT);
  if (!addressEnc) throw new Error("آدرس ذخیره نشد.");
  await db
    .insert(tradingAccountLinks)
    .values({ accountId, userId, venue: account.venue.sync, addressEnc })
    .onConflictDoUpdate({ target: tradingAccountLinks.accountId, set: { venue: account.venue.sync, addressEnc, updatedAt: new Date() } });
}

export async function unlinkTradingAccount(userId: string, accountId: string): Promise<void> {
  await db.delete(tradingAccountLinks).where(and(eq(tradingAccountLinks.accountId, accountId), eq(tradingAccountLinks.userId, userId)));
}

/** Reads the venue for a linked account and records the result. */
export async function syncTradingAccount(userId: string, accountId: string) {
  const account = await ownedPerpAccount(userId, accountId);
  const [link] = await db
    .select()
    .from(tradingAccountLinks)
    .where(and(eq(tradingAccountLinks.accountId, accountId), eq(tradingAccountLinks.userId, userId)))
    .limit(1);
  if (!link || !account.venue.sync) throw new Error("برای این حساب آدرس کیف پول ثبت نشده است.");
  const address = decryptSensitive(link.addressEnc, ADDRESS_CONTEXT);
  if (!address) throw new Error("آدرس ذخیره‌شده خوانده نشد؛ دوباره ثبتش کنید.");
  const reading = await fetchVenueReading(account.venue.sync, address);
  return recordTradingMark(userId, accountId, { ...reading, source: account.venue.sync });
}

/**
 * The open P&L of each perp account as of `asOf` — the latest mark on or
 * before that day — for the valuation to add to the account's asset.
 * Reads nothing when the table does not exist yet (migration not applied).
 */
export async function openPositionMarks(userId: string, asOf: string): Promise<{ accountId: string; assetId: string; unrealizedPnl: Decimal }[]> {
  try {
    const marks = await rows<{ accountId: string; assetId: string; unrealizedPnl: string }>(sql`
      select distinct on (m.account_id) m.account_id as "accountId", a.asset_id as "assetId", m.unrealized_pnl::text as "unrealizedPnl"
      from trading_account_marks m join accounts a on a.id = m.account_id and a.deleted_at is null
      where m.user_id = ${userId}::uuid and m.as_of <= ${asOf}::date
      order by m.account_id, m.as_of desc, m.created_at desc
    `);
    return marks.map((m) => ({ ...m, unrealizedPnl: D(m.unrealizedPnl) })).filter((m) => !m.unrealizedPnl.isZero());
  } catch {
    return [];
  }
}
