/**
 * اصلاح اقساطِ پرداخت‌شده‌ای که از حساب بانکی کم نشده‌اند.
 *
 * Until 2026-09-27 (6ed60f1) Quick Pay did not ask which account paid: it
 * silently posted the cash leg to the user's lowest-coded asset account. The
 * installment turned `paid`, but the bank the money really left never moved.
 * Two other shapes end the same way — a `paid` row with no entry at all, and
 * one whose entry was later voided (reversing an entry does not reopen the
 * installment).
 *
 * The repair never edits a posted entry. A wrong-account payment is REVERSED
 * through the ledger's own `reverseEntry` and posted again, same date, same
 * contra leg, same USD value, with the cash leg on the Toman bank the user
 * names; a missing or voided payment is posted fresh. `paid_entry_id` then
 * points at the new entry — all in one transaction.
 */
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, assets, installments, postings, wallets } from "@/db/schema";
import { D, type Decimal } from "@/domain/decimal";
import { postEntry, reverseEntry, unitsFor } from "@/features/ledger/service";
import { ensureInstallmentPaymentAccount, ensureReceivableCollectionAccount } from "@/features/accounts/systemAccounts";
import { isTomanBankAccount } from "@/features/accounts/classification";
import { assertRealUsdIrtRate, getLatestUsdIrtRateForUser } from "@/lib/fx";
import { todayIso } from "@/lib/format";
import { INSTALLMENT_PARTIAL, isReceivable, settlementSign } from "@/features/planning/obligations";

export type PaymentProblem = "wrong-account" | "void-entry" | "no-entry";

export type UnsettledPayment = {
  installmentId: string;
  debtId: string;
  title: string;
  seq: number;
  direction: string;
  status: string;
  paidAt: string | null;
  /** Toman the repair moves: the linked settlement, or everything paid when nothing is linked. */
  amountToman: string;
  problem: PaymentProblem;
  /** The account the money was taken from instead (wrong-account only). */
  fromAccountName: string | null;
};

type Row = {
  installmentId: string;
  debtId: string;
  title: string;
  seq: number;
  direction: string;
  status: string;
  paidAt: string | null;
  amountToman: string | null;
  paidToman: string | null;
  paidUsd: string | null;
  paidFxRate: string | null;
  entryId: string | null;
  entryStatus: string | null;
  cashAccountName: string | null;
  cashSymbol: string | null;
  cashWalletKind: string | null;
  cashQuantity: string | null;
};

async function loadRows(client: any, userId: string, installmentId?: string): Promise<Row[]> {
  const res = await client.execute(sql`
    select i.id as "installmentId", d.id as "debtId", d.title, i.seq, d.direction, i.status,
           i.paid_at::text as "paidAt", i.amount_toman::text as "amountToman", i.paid_toman::text as "paidToman",
           i.paid_usd::text as "paidUsd", i.paid_fx_rate::text as "paidFxRate",
           je.id as "entryId", je.status as "entryStatus",
           c.name as "cashAccountName", c.symbol as "cashSymbol", c.kind as "cashWalletKind", c.quantity::text as "cashQuantity"
    from installments i
      join debts d on d.id = i.debt_id
      left join journal_entries je on je.id = i.paid_entry_id
      left join lateral (
        select a.name, s.symbol, w.kind, p.quantity
        from postings p
          join accounts a on a.id = p.account_id
          left join assets s on s.id = a.asset_id
          left join wallets w on w.id = a.wallet_id
        where p.entry_id = je.id and a.type = 'asset'
        order by abs(p.base_value) desc
        limit 1
      ) c on true
    where d.user_id = ${userId}::uuid and d.deleted_at is null
      and i.status in ('paid', ${INSTALLMENT_PARTIAL})
      ${installmentId ? sql`and i.id = ${installmentId}::uuid` : sql``}
    order by i.paid_at desc nulls last, d.title, i.seq
  `);
  return res.rows as Row[];
}

function problemOf(r: Row): PaymentProblem | null {
  if (!r.entryId) return "no-entry";
  if (r.entryStatus === "void") return "void-entry";
  if (!r.cashAccountName) return "wrong-account";
  return isTomanBankAccount({ symbol: r.cashSymbol, walletKind: r.cashWalletKind }) ? null : "wrong-account";
}

/**
 * Toman of the settlement being repaired. With no live entry it is everything
 * recorded as paid. A linked entry is the LAST settlement: exact when its cash
 * leg was Toman / Rial, else rebuilt from the frozen USD × rate — and snapped
 * to `paid_toman` when that is the only settlement on the row.
 */
function tomanOf(r: Row, problem: PaymentProblem): Decimal {
  const paidSoFar = D(r.paidToman ?? r.amountToman ?? "0");
  if (problem === "no-entry") return paidSoFar;
  const unit = (r.cashSymbol ?? "").toUpperCase();
  if (problem === "wrong-account" && r.cashQuantity && (unit === "IRT" || unit === "IRR")) {
    const q = D(r.cashQuantity).abs();
    return unit === "IRR" ? D(q.div(10).toFixed(0)) : q;
  }
  if (!r.paidUsd || !r.paidFxRate) return paidSoFar;
  const last = D(D(r.paidUsd).mul(r.paidFxRate).toFixed(0));
  const tolerance = paidSoFar.mul("0.001");
  return last.sub(paidSoFar).abs().lte(tolerance.gt(1) ? tolerance : 1) ? paidSoFar : last;
}

export async function listUnsettledInstallmentPayments(userId: string, client: any = db): Promise<UnsettledPayment[]> {
  const rows = await loadRows(client, userId);
  const out: UnsettledPayment[] = [];
  for (const r of rows) {
    const problem = problemOf(r);
    if (!problem) continue;
    const toman = tomanOf(r, problem);
    if (!toman.gt(0)) continue;
    out.push({
      installmentId: r.installmentId,
      debtId: r.debtId,
      title: r.title,
      seq: Number(r.seq),
      direction: r.direction,
      status: r.status,
      paidAt: r.paidAt,
      amountToman: toman.toFixed(0),
      problem,
      fromAccountName: problem === "wrong-account" ? r.cashAccountName : null,
    });
  }
  return out;
}

/** Posts the payment of one installment from `cashAccountId` (a Toman bank account of this user). */
export async function repostInstallmentPayment(installmentId: string, cashAccountId: string, userId: string) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM installments WHERE id = ${installmentId} FOR UPDATE`);
    const [r] = await loadRows(tx, userId, installmentId);
    if (!r) throw new Error("قسط یافت نشد یا متعلق به شما نیست.");
    const problem = problemOf(r);
    if (!problem) throw new Error("پرداخت این قسط از قبل از یک حساب بانکی ثبت شده است.");
    const toman = tomanOf(r, problem);
    if (!toman.gt(0)) throw new Error("مبلغ پرداخت‌شده این قسط معلوم نیست.");

    const [cash] = await tx
      .select({ assetId: accounts.assetId, type: accounts.type, userId: accounts.userId, symbol: assets.symbol, walletKind: wallets.kind })
      .from(accounts)
      .leftJoin(assets, eq(assets.id, accounts.assetId))
      .leftJoin(wallets, eq(wallets.id, accounts.walletId))
      .where(and(eq(accounts.id, cashAccountId), isNull(accounts.deletedAt)))
      .limit(1);
    if (!cash || cash.type !== "asset" || cash.userId !== userId || !cash.assetId || !isTomanBankAccount(cash)) {
      throw new Error("یکی از حساب‌های بانکی تومانی خودتان را انتخاب کنید.");
    }
    const cashQty = (cash.symbol ?? "").toUpperCase() === "IRR" ? toman.mul(10) : toman;

    const receivable = isReceivable(r.direction);
    let entry: { type: string; description: string; entryDate: string };
    let cashBase: Decimal;
    let contra: { accountId: string; assetId: string | null; quantity: string; baseValue: string; memo?: string | null }[];

    if (problem === "wrong-account") {
      // Keep everything of the original but the account the cash left.
      const [orig] = (
        await tx.execute(sql`select type, description, entry_date::text as "entryDate" from journal_entries where id = ${r.entryId}`)
      ).rows as { type: string; description: string; entryDate: string }[];
      const legs = await tx
        .select({ accountId: postings.accountId, assetId: postings.assetId, quantity: postings.quantity, baseValue: postings.baseValue, memo: postings.memo, accountType: accounts.type })
        .from(postings)
        .innerJoin(accounts, eq(accounts.id, postings.accountId))
        .where(eq(postings.entryId, r.entryId!));
      const cashLegs = legs.filter((l) => l.accountType === "asset");
      contra = legs.filter((l) => l.accountType !== "asset").map(({ accountType: _t, ...l }) => ({ ...l, quantity: String(l.quantity), baseValue: String(l.baseValue) }));
      if (!cashLegs.length || !contra.length) throw new Error("سند این پرداخت شکل مورد انتظار را ندارد؛ آن را از «سوابق» بررسی کنید.");
      cashBase = cashLegs.reduce((s, l) => s.add(D(String(l.baseValue))), D(0));
      entry = orig;
      await reverseEntry(r.entryId!, tx);
    } else {
      const debtRow = (await tx.execute(sql`select account_id as "accountId" from debts where id = ${r.debtId}`)).rows[0] as { accountId: string | null };
      let contraAccountId = debtRow?.accountId ?? null;
      const contraIsExpense = !contraAccountId;
      if (!contraAccountId) {
        const bucket = receivable ? await ensureReceivableCollectionAccount(userId, tx) : await ensureInstallmentPaymentAccount(userId, tx);
        contraAccountId = bucket?.id ?? null;
      }
      if (!contraAccountId) throw new Error("سرفصل مقابل این پرداخت ساخته نشد.");
      const rate = r.paidFxRate && D(r.paidFxRate).gt(0) ? D(r.paidFxRate) : D(assertRealUsdIrtRate(await getLatestUsdIrtRateForUser(userId, tx)).rate);
      const usd = toman.div(rate);
      const sign = settlementSign(r.direction);
      cashBase = usd.mul(String(sign));
      const units = await unitsFor(contraAccountId, usd.toString(), tx, userId);
      contra = [{ accountId: contraAccountId, assetId: units.assetId, quantity: D(units.quantity).mul(String(-sign)).toString(), baseValue: cashBase.neg().toString(), memo: "اصلاح پرداخت قسط" }];
      entry = {
        type: contraIsExpense ? "debt_repayment" : "installment",
        description: `${receivable ? "دریافت" : "پرداخت"} قسط ${r.seq} — ${r.title}`,
        entryDate: r.paidAt ?? todayIso(),
      };
    }

    const posted = await postEntry(
      {
        entryDate: entry.entryDate,
        type: entry.type as never,
        description: entry.description,
        userId,
        postings: [
          {
            accountId: cashAccountId,
            assetId: cash.assetId,
            quantity: (cashBase.isNegative() ? cashQty.neg() : cashQty).toFixed(0),
            baseValue: cashBase.toString(),
            memo: "اصلاح حساب پرداخت قسط",
          },
          ...contra,
        ],
      } as never,
      tx,
    );
    await tx.update(installments).set({ paidEntryId: posted.id }).where(eq(installments.id, installmentId));
    return { id: posted.id, toman: toman.toFixed(0), problem };
  });
}
