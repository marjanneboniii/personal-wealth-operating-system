import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
  entryFxSnapshots,
  journalEntries,
  lotConsumptions,
  lots,
  postings,
} from "@/db/schema";
import { assertBalanced, type DraftPosting, type EntryType } from "@/domain/accounting";
import { consumeFifo } from "@/domain/fifo";
import { D, Decimal } from "@/domain/decimal";
import { todayIso } from "@/lib/format";
import { recordAuditEvent } from "@/lib/audit";
import { nativeUnitPriceUsd } from "@/features/fx/unitPrice";
import {
  assertSystemAccount,
  ensureFeeExpenseAccount,
  ensureRealizedPnlAccount,
  ensureSystemAccount,
  FEE_EXPENSE_CODE,
  OPENING_EQUITY_CODE,
  REALIZED_PNL_CODE,
  resolveSystemAccount,
  resolveSystemAccountById,
} from "@/features/accounts/systemAccounts";

export type PostEntryInput = {
  entryDate: string;
  type: EntryType;
  description: string;
  source?: "manual" | "plan" | "import";
  reference?: string | null;
  postings: DraftPosting[];
  /**
   * Reporting dimension only: the (leaf) expense category of the entry.
   * Never participates in the double-entry balance.
   */
  categoryId?: string | null;
  /** open a FIFO lot for this asset account (buy / inbound) */
  openLot?: { accountId: string; assetId: string; quantity: string; costBase: string };
  openLots?: Array<{ accountId: string; assetId: string; quantity: string; costBase: string }>;
  /** consume FIFO lots (sell / outbound) */
  closeLot?: { assetId: string; quantity: string; proceedsBase: string };
  userId?: string;
  idempotencyKey?: string | null;
  preventOverdraft?: boolean;
};

export function canonicalizePayload(input: PostEntryInput): string {
  const sortedPostings = [...input.postings]
    .map((p) => ({
      accountId: p.accountId,
      assetId: p.assetId,
      quantity: D(p.quantity).toString(),
      baseValue: D(p.baseValue).toString(),
    }))
    .sort((a, b) => (a.accountId + a.assetId + a.quantity).localeCompare(b.accountId + b.assetId + b.quantity));

  const canonicalObj = {
    entryDate: input.entryDate,
    type: input.type,
    description: input.description,
    categoryId: input.categoryId ?? null,
    postings: sortedPostings,
    openLots: input.openLots
      ? [...input.openLots].map((l) => ({
          accountId: l.accountId,
          assetId: l.assetId,
          quantity: D(l.quantity).toString(),
          costBase: D(l.costBase).toString(),
        }))
      : input.openLot
        ? [
            {
              accountId: input.openLot.accountId,
              assetId: input.openLot.assetId,
              quantity: D(input.openLot.quantity).toString(),
              costBase: D(input.openLot.costBase).toString(),
            },
          ]
        : [],
    closeLot: input.closeLot
      ? {
          assetId: input.closeLot.assetId,
          quantity: D(input.closeLot.quantity).toString(),
          proceedsBase: D(input.closeLot.proceedsBase).toString(),
        }
      : null,
  };

  return crypto.createHash("sha256").update(JSON.stringify(canonicalObj)).digest("hex");
}

async function resolveServiceUserId(
  tx: any,
  explicitUserId?: string,
  postingAccountIds?: string[],
): Promise<string | undefined> {
  if (explicitUserId) return explicitUserId;

  // Inherit from posting accounts if userId is not explicitly provided
  if (postingAccountIds && postingAccountIds.length > 0) {
    try {
      const [acc] = await tx
        .select({ userId: accounts.userId })
        .from(accounts)
        .where(eq(accounts.id, postingAccountIds[0]))
        .limit(1);
      if (acc?.userId) return acc.userId;
    } catch {}
  }

  // Check current session
  try {
    const { getCurrentUser } = await import("@/lib/auth");
    const u = await getCurrentUser();
    if (u?.id) return u.id;
  } catch {}

  // Fallback for standalone single-user test/seed environments.
  try {
    const res = await tx.execute(sql`select id from users limit 2`);
    const rows = res.rows as { id?: string }[];
    if (rows.length === 1) {
      return rows[0]?.id;
    }
    // Multi-tenant database with no resolved identity: a write must NEVER be
    // attributed to a shared/NULL owner. Deny (fail-closed).
    if (rows.length > 1) {
      const err: any = new Error("Authentication/Database error: Access denied");
      err.code = "UNAUTHORIZED";
      err.status = 401;
      throw err;
    }
  } catch (e: any) {
    if (e?.message?.includes("Access denied") || e?.message?.includes("Authentication/Database error")) {
      throw e;
    }
    // If the identity probe itself fails, deny the write rather than post
    // an unowned entry.
    throw new Error("Authentication/Database error: Access denied");
  }

  return undefined;
}

/**
 * The single write path into the ledger. Everything else in the system
 * (transfers, buys, sells, installments, executed plans) funnels through here
 * so the double-entry invariant can never be bypassed.
 */
export async function postEntry(
  input: PostEntryInput,
  txClient?: any,
): Promise<{ id: string; idempotentReplay?: boolean }> {
  assertBalanced(input.postings);

  const runTx = async (tx: any) => {
    const resolvedUserId = await resolveServiceUserId(
      tx,
      input.userId,
      input.postings.map((p) => p.accountId),
    );

    const idempKey = input.idempotencyKey?.trim() || null;
    let computedHash: string | null = null;

    if (idempKey) {
      computedHash = canonicalizePayload(input);
      const existing = await tx
        .select()
        .from(journalEntries)
        .where(
          and(
            resolvedUserId ? eq(journalEntries.userId, resolvedUserId) : sql`user_id IS NULL`,
            eq(journalEntries.idempotencyKey, idempKey),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        const found = existing[0];
        if (found.idempotencyHash && found.idempotencyHash !== computedHash) {
          const err: any = new Error("Idempotency Conflict (409): Same idempotency key used with different payload.");
          err.status = 409;
          err.code = "IDEMPOTENCY_CONFLICT";
          throw err;
        }
        await recordAuditEvent(
          {
            action: "IDEMPOTENT_REPLAY",
            entityType: "journal_entry",
            entityId: found.id,
            userId: resolvedUserId,
            result: "IDEMPOTENT_REPLAY",
            metadata: { type: input.type, idempotencyKey: idempKey },
          },
          tx,
        );
        return { id: found.id, idempotentReplay: true };
      }
    }

    // 1. Concurrency Safety: Lock account rows FOR UPDATE in ascending ID order to prevent deadlocks
    const uniqueAccountIds = Array.from(new Set(input.postings.map((p) => p.accountId))).sort();
    for (const accId of uniqueAccountIds) {
      try {
        await tx.execute(sql`SELECT id FROM accounts WHERE id = ${accId} FOR UPDATE`);
      } catch {}
    }

    // 2. Overdraft Prevention (when explicitly enabled)
    if (input.preventOverdraft) {
      // The probe is scoped to the tenant's OWN postings (+ legacy unowned
      // ones): a SHARED system account (e.g. a global 1600/1000 row) must not
      // let another tenant's balance hide an overdraft, and — symmetrically —
      // must not block a legitimate write because a foreign tenant is short.
      const tenantScope = resolvedUserId
        ? sql`and (je.user_id = ${resolvedUserId} or je.user_id is null)`
        : sql``;
      for (const p of input.postings) {
        if (D(p.baseValue).isNegative()) {
          const balRes = await tx.execute(sql`
            select coalesce(sum(p2.base_value), 0)::text as bal
            from postings p2 join journal_entries je on je.id = p2.entry_id
            where p2.account_id = ${p.accountId} and je.status = 'posted' ${tenantScope}
          `);
          const currentBal = D((balRes.rows[0] as { bal?: string })?.bal ?? "0");
          const newBal = currentBal.add(D(p.baseValue));
          if (newBal.isNegative()) {
            const err: any = new Error("موجودی حساب کافی نیست (Overdraft prevented)");
            err.code = "INSUFFICIENT_BALANCE";
            err.status = 400;
            throw err;
          }
        }
      }
    }

    let entry: { id: string };
    try {
      const [newEntry] = await tx
        .insert(journalEntries)
        .values({
          entryDate: input.entryDate,
          type: input.type,
          description: input.description,
          reference: input.reference ?? null,
          source: input.source ?? "manual",
          status: "posted",
          userId: resolvedUserId ?? null,
          idempotencyKey: idempKey,
          idempotencyHash: computedHash,
          categoryId: input.categoryId ?? null,
        } as any)
        .returning();
      entry = newEntry;
    } catch (err: any) {
      if (
        idempKey &&
        (err.code === "23505" ||
          String(err).includes("journal_entries_user_idemp_uq") ||
          String(err).includes("idempotency"))
      ) {
        const existing = await tx
          .select()
          .from(journalEntries)
          .where(
            and(
              resolvedUserId ? eq(journalEntries.userId, resolvedUserId) : sql`user_id IS NULL`,
              eq(journalEntries.idempotencyKey, idempKey),
            ),
          )
          .limit(1);
        if (existing.length > 0) {
          const found = existing[0];
          if (found.idempotencyHash && found.idempotencyHash !== computedHash) {
            const conflictErr: any = new Error(
              "Idempotency Conflict (409): Same idempotency key used with different payload.",
            );
            conflictErr.status = 409;
            conflictErr.code = "IDEMPOTENCY_CONFLICT";
            throw conflictErr;
          }
          return { id: found.id, idempotentReplay: true };
        }
      }
      throw err;
    }

    await tx.insert(postings).values(
      input.postings.map((p) => ({
        entryId: entry.id,
        accountId: p.accountId,
        assetId: p.assetId,
        quantity: D(p.quantity).toString(),
        baseValue: D(p.baseValue).toString(),
        memo: p.memo ?? null,
      })),
    );

    const lotList = input.openLots ?? (input.openLot ? [input.openLot] : []);
    for (const lotInfo of lotList) {
      if (D(lotInfo.quantity).gt(0)) {
        const qty = D(lotInfo.quantity);
        await tx.insert(lots).values({
          accountId: lotInfo.accountId,
          assetId: lotInfo.assetId,
          openEntryId: entry.id,
          openedAt: input.entryDate,
          qtyOpened: qty.toString(),
          qtyRemaining: qty.toString(),
          unitCostBase: D(lotInfo.costBase).div(qty).toString(),
          userId: resolvedUserId ?? null,
        } as any);
      }
    }

    if (input.closeLot && D(input.closeLot.quantity).gt(0)) {
      try {
        await tx.execute(sql`
          SELECT id FROM lots
          WHERE asset_id = ${input.closeLot.assetId}
            ${resolvedUserId ? sql`AND user_id = ${resolvedUserId}` : sql``}
            AND qty_remaining > 0
          ORDER BY opened_at ASC, id ASC
          FOR UPDATE
        `);
      } catch {}

      const open = await tx
        .select({
          id: lots.id,
          openedAt: lots.openedAt,
          qtyRemaining: lots.qtyRemaining,
          unitCostBase: lots.unitCostBase,
        })
        .from(lots)
        .where(
          and(
            eq(lots.assetId, input.closeLot.assetId),
            resolvedUserId ? eq(lots.userId, resolvedUserId) : sql`1=1`,
            sql`${lots.qtyRemaining} > 0`,
          ),
        )
        .orderBy(lots.openedAt);

      const result = consumeFifo(open, input.closeLot.quantity, input.closeLot.proceedsBase);
      if (D(result.unmatchedQty).gt("0.000000001")) {
        throw new Error("موجودی دارایی برای فروش کافی نیست.");
      }
      for (const alloc of result.allocations) {
        await tx
          .update(lots)
          .set({ qtyRemaining: alloc.newQtyRemaining })
          .where(eq(lots.id, alloc.lotId));
        await tx.insert(lotConsumptions).values({
          lotId: alloc.lotId,
          entryId: entry.id,
          quantity: alloc.quantity,
          costBase: alloc.costBase,
          proceedsBase: alloc.proceedsBase,
          realizedPnl: alloc.realizedPnl,
        });
      }
    }

    await tx.insert(auditLog).values({
      action: "post_entry",
      entityType: "journal_entry",
      entityId: entry.id,
      payload: JSON.stringify({ type: input.type, lines: input.postings.length, userId: resolvedUserId ?? null }),
    });

    const auditActionName =
      input.type === "income"
        ? "CREATE_INCOME"
        : input.type === "expense"
          ? "CREATE_EXPENSE"
          : input.type === "transfer"
            ? "CREATE_TRANSFER"
            : input.type === "buy"
              ? "CREATE_ASSET_BUY"
              : input.type === "sell"
                ? "CREATE_ASSET_SELL"
                : input.type === "debt_repayment"
                  ? "CREATE_DEBT_REPAYMENT"
                  : "CREATE_TRANSACTION";

    await recordAuditEvent(
      {
        action: auditActionName,
        entityType: "journal_entry",
        entityId: entry.id,
        userId: resolvedUserId,
        result: "SUCCESS",
        payload: { type: input.type, description: input.description, lines: input.postings.length },
      },
      tx,
    );

    return { id: entry.id };
  };

  if (txClient) {
    return runTx(txClient);
  }
  return db.transaction(runTx);
}

/** Immutable ledger: corrections are made with a mirrored reversal entry and FIFO lot restoration. */
export async function reverseEntry(entryId: string): Promise<{ id: string }> {
  return db.transaction(async (tx) => {
    // SECURITY (M-04): serialize concurrent reversals of the SAME entry.
    // Lock the journal_entries row FOR UPDATE first; a concurrent reverseEntry()
    // for this entry waits here until this transaction COMMITs or ROLLBACKs,
    // so exactly one reversal is ever created. Uses only the existing
    // transaction/lock primitives — the accounting logic below is unchanged.
    await tx.execute(sql`SELECT id FROM journal_entries WHERE id = ${entryId} FOR UPDATE`);

    const original = await tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId))
      .limit(1);
    if (!original.length) throw new Error("سند یافت نشد");
    // Verified while holding the row lock: an already-voided entry is rejected.
    if (original[0].status === "void") throw new Error("این سند قبلاً ابطال شده است");

    // 1. Check open lots created by this entry (for buys)
    const openLots = await tx
      .select()
      .from(lots)
      .where(eq(lots.openEntryId, entryId));

    for (const lot of openLots) {
      if (D(lot.qtyRemaining).lt(lot.qtyOpened)) {
        throw new Error(
          "امکان ابطال این سند وجود ندارد زیرا بخشی از دارایی‌های آن در تراکنش‌های بعدی فروخته شده است. لطفاً ابتدا تراکنش‌های فروش بعدی را ابطال کنید.",
        );
      }
      // Zero out remaining quantity so it won't be consumed by future FIFO calls
      await tx
        .update(lots)
        .set({ qtyRemaining: "0" })
        .where(eq(lots.id, lot.id));
    }

    // 2. Check lot consumptions made by this entry (for sells)
    const consumptions = await tx
      .select()
      .from(lotConsumptions)
      .where(eq(lotConsumptions.entryId, entryId));

    for (const c of consumptions) {
      const [lot] = await tx
        .select()
        .from(lots)
        .where(eq(lots.id, c.lotId))
        .limit(1);

      if (lot) {
        const restored = D(lot.qtyRemaining).add(c.quantity).toString();
        await tx
          .update(lots)
          .set({ qtyRemaining: restored })
          .where(eq(lots.id, lot.id));
      }
    }

    if (consumptions.length > 0) {
      await tx
        .delete(lotConsumptions)
        .where(eq(lotConsumptions.entryId, entryId));
    }

    // 3. Post reversal entry
    const lines = await tx
      .select()
      .from(postings)
      .where(eq(postings.entryId, entryId));

    const [reversalEntry] = await tx
      .insert(journalEntries)
      .values({
        entryDate: todayIso(),
        type: "adjustment",
        description: `ابطال: ${original[0].description}`,
        reversalOf: entryId,
        source: "manual",
        status: "void",
      })
      .returning();

    await tx.insert(postings).values(
      lines.map((l) => ({
        entryId: reversalEntry.id,
        accountId: l.accountId,
        assetId: l.assetId,
        quantity: D(l.quantity).neg().toString(),
        baseValue: D(l.baseValue).neg().toString(),
        memo: "reversal",
      })),
    );

    // Mark original entry as void. The transition is conditional
    // (posted -> void): if the row is no longer "posted" the update affects 0
    // rows and the whole transaction rolls back — so even in the impossible
    // case of the initial check racing, a double reversal cannot be recorded.
    const voided = await tx
      .update(journalEntries)
      .set({ status: "void" })
      .where(and(eq(journalEntries.id, entryId), eq(journalEntries.status, "posted")))
      .returning();
    if (!voided.length) {
      throw new Error("این سند قبلاً ابطال شده است");
    }

    await tx.insert(auditLog).values({
      action: "reverse_entry",
      entityType: "journal_entry",
      entityId: entryId,
      payload: JSON.stringify({ reversalEntryId: reversalEntry.id }),
    });

    return { id: reversalEntry.id };
  });
}

/**
 * @deprecated System chart lookups must be tenant-scoped; use
 * `resolveSystemAccount(code, userId)` from `@/features/accounts/systemAccounts`
 * so a code can never resolve to ANOTHER tenant's row (audit F-03). The
 * tenant-less form below is retained only for callers that provably run in a
 * single-tenant (no-auth) deployment and is now ordered + soft-delete aware.
 */
export async function accountByCode(code: string, userId?: string | null) {
  return await resolveSystemAccount(code, userId);
}

/**
 * Convert a base-currency amount into the asset units of a given account,
 * using the single authoritative unit-price rule (`nativeUnitPriceUsd`).
 * Keeps the quantity ledger truthful for non-base assets (IRT, USDT, …) while
 * base values stay balanced.
 *
 * For IRT accounts the native unit IS the Toman: quantity = amount × user FX
 * rate (1 / unit price), never `prices.IRT`.
 */
export async function unitsFor(
  accountId: string,
  baseAmount: string,
  txClient?: any,
  userId?: string | null,
): Promise<{ assetId: string; quantity: string }> {
  // `txClient ?? db`: when the caller already holds a transaction (e.g. the
  // atomic installment payment), reference reads MUST run inside it — many
  // drivers (PGlite) hold an exclusive lock during a transaction.
  const client = txClient ?? db;
  const row = await client
    .select({ assetId: accounts.assetId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  const assetId = row[0]?.assetId;
  if (!assetId) throw new Error("حساب انتخاب‌شده به هیچ دارایی متصل نیست");
  const unit = await nativeUnitPriceUsd(assetId, userId, client);
  const unitDec = D(unit).isZero() ? D("1") : D(unit);
  return { assetId, quantity: D(baseAmount).div(unitDec).toString() };
}

/* ------------------------------------------------------------------ */
/* High-level use cases (Phase 5 accounting rules)                      */
/* ------------------------------------------------------------------ */

export type TransferCmd = {
  entryDate: string;
  description: string;
  fromAccountId: string;
  toAccountId: string;
  assetId: string;
  quantity: string;
  unitPrice: string;
  feeBase?: string;
  feeAccountId?: string | null;
  feeAssetId?: string | null;
  userId?: string;
  idempotencyKey?: string | null;
  preventOverdraft?: boolean;
};

export class CrossCurrencyTransferError extends Error {
  code = "CROSS_CURRENCY_USE_FX";
  status = 400;
  constructor() {
    super("انتقال بین حساب‌های با واحد متفاوت باید با تبدیل ارز (recordFx) ثبت شود، نه انتقال ساده.");
    this.name = "CrossCurrencyTransferError";
  }
}

const USD_FACE = new Set(["USD", "USDT", "USDC", "USDG", "USDE", "USDS"]);

/** Server-side native qty + USD book value. Client amounts are verified, never trusted as book currency. */
export function resolveFxBookLegs(input: {
  fromSymbol: string;
  toSymbol: string;
  rateIrtPerUsd: string;
  fromQuantity?: string;
  toQuantity?: string;
  irtAmount?: string;
  claimedBookValue?: string;
}): { fromQuantity: string; toQuantity: string; bookValue: string } {
  const rate = D(input.rateIrtPerUsd);
  if (!rate.gt(0)) throw new Error("نرخ تبدیل نامعتبر است.");
  const from = (input.fromSymbol || "").toUpperCase();
  const to = (input.toSymbol || "").toUpperCase();
  if (!from || !to || from === to) throw new Error("واحد مبدأ و مقصد تبدیل ارز نامعتبر است.");

  const irtHint = input.irtAmount && D(input.irtAmount).gt(0) ? D(input.irtAmount) : null;
  let fromQty = input.fromQuantity && D(input.fromQuantity).gt(0) ? D(input.fromQuantity) : null;
  let toQty = input.toQuantity && D(input.toQuantity).gt(0) ? D(input.toQuantity) : null;
  if (!fromQty && from === "IRT" && irtHint) fromQty = irtHint;
  if (!toQty && to === "IRT" && irtHint) toQty = irtHint;

  if (!fromQty && toQty) {
    fromQty = from === "IRT" ? toQty.mul(rate) : toQty;
  }
  if (!toQty && fromQty) {
    toQty = to === "IRT" ? fromQty.mul(rate) : from === "IRT" ? fromQty.div(rate) : fromQty;
  }
  if (!fromQty || !toQty) throw new Error("fromQuantity و toQuantity برای تبدیل ارز الزامی هستند.");

  let book: Decimal;
  if (USD_FACE.has(from)) book = fromQty;
  else if (USD_FACE.has(to)) book = toQty;
  else if (from === "IRT") book = fromQty.div(rate);
  else if (to === "IRT") book = toQty.div(rate);
  else throw new Error("واحد بومی برای محاسبه ارزش دفتری USD پشتیبانی نمی‌شود.");

  if (!book.gt(0)) throw new Error("ارزش دفتری باید بزرگ‌تر از صفر باشد.");
  if (input.claimedBookValue && D(input.claimedBookValue).gt(0)) {
    if (D(input.claimedBookValue).sub(book).abs().gt("0.02")) {
      throw new Error("bookValue ارسالی با نرخ سرور سازگار نیست.");
    }
  }
  return { fromQuantity: fromQty.toString(), toQuantity: toQty.toString(), bookValue: book.toString() };
}

async function accountAssetId(accountId: string, client: any): Promise<string | null> {
  const row = await client
    .select({ assetId: accounts.assetId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  return row[0]?.assetId ?? null;
}

export async function recordTransfer(cmd: TransferCmd, txClient?: any) {
  const client = txClient ?? db;
  const fromAsset = await accountAssetId(cmd.fromAccountId, client);
  const toAsset = await accountAssetId(cmd.toAccountId, client);
  if (fromAsset && toAsset && fromAsset !== toAsset) {
    throw new CrossCurrencyTransferError();
  }
  if (fromAsset && fromAsset !== cmd.assetId) {
    throw new Error("دارایی انتقال با واحد بومی حساب مبدأ یکسان نیست.");
  }

  const value = D(cmd.quantity).mul(cmd.unitPrice);
  const fee = D(cmd.feeBase ?? "0");
  const lines: DraftPosting[] = [
    {
      accountId: cmd.fromAccountId,
      assetId: cmd.assetId,
      quantity: D(cmd.quantity).add(fee.div(cmd.unitPrice || "1")).neg().toString(),
      baseValue: value.add(fee).neg().toString(),
    },
    {
      accountId: cmd.toAccountId,
      assetId: cmd.assetId,
      quantity: cmd.quantity,
      baseValue: value.toString(),
    },
  ];
  if (fee.gt(0) && cmd.feeAccountId) {
    lines.push({
      accountId: cmd.feeAccountId,
      assetId: cmd.feeAssetId ?? cmd.assetId,
      quantity: fee.div(cmd.unitPrice || "1").toString(),
      baseValue: fee.toString(),
      memo: "کارمزد انتقال",
    });
  }
  return postEntry(
    {
      ...cmd,
      type: "transfer",
      postings: lines,
      idempotencyKey: cmd.idempotencyKey,
      preventOverdraft: cmd.preventOverdraft,
    },
    txClient,
  );
}

export type FxCmd = {
  entryDate: string;
  description: string;
  fromAccountId: string;
  toAccountId: string;
  fromAssetId: string;
  toAssetId: string;
  fromQuantity: string;
  toQuantity: string;
  /** Functional / book amount in USD. Both legs use this as |base_value|. */
  bookValue: string;
  /** Optional IRT per 1 USD — when set, native amounts must match within tolerance. */
  rateIrtPerUsd?: string;
  feeBase?: string;
  feeAccountId?: string | null;
  feeAssetId?: string | null;
  userId?: string;
  idempotencyKey?: string | null;
  preventOverdraft?: boolean;
};

const FX_QTY_TOLERANCE = D("0.02");

/**
 * Cross-denomination cash conversion (e.g. Bank IRT → Cash USD).
 * Native quantities stay on each account's assetId. Book value is USD only.
 * Does not open or consume FIFO lots. Does not change assertBalanced.
 */
export async function recordFx(cmd: FxCmd, txClient?: any) {
  if (cmd.fromAssetId === cmd.toAssetId) {
    throw new Error("تبدیل ارز فقط بین دو واحد بومی متفاوت مجاز است. برای واحد یکسان از انتقال استفاده کنید.");
  }
  const client = txClient ?? db;
  const fromAsset = await accountAssetId(cmd.fromAccountId, client);
  const toAsset = await accountAssetId(cmd.toAccountId, client);
  if (fromAsset !== cmd.fromAssetId || toAsset !== cmd.toAssetId) {
    throw new Error("واحد بومی حساب با دارایی پستینگ تبدیل ارز مطابقت ندارد.");
  }

  const book = D(cmd.bookValue);
  const fromQty = D(cmd.fromQuantity);
  const toQty = D(cmd.toQuantity);
  if (!book.gt(0) || !fromQty.gt(0) || !toQty.gt(0)) {
    throw new Error("مقادیر تبدیل ارز باید بزرگ‌تر از صفر باشند.");
  }

  if (cmd.rateIrtPerUsd) {
    const rate = D(cmd.rateIrtPerUsd);
    if (!rate.gt(0)) throw new Error("نرخ تبدیل نامعتبر است.");
    const fromAsUsd = fromQty.div(rate);
    const toAsUsd = toQty.div(rate);
    const fromMatchesTo = fromAsUsd.sub(toQty).abs().lte(FX_QTY_TOLERANCE);
    const toMatchesFrom = toAsUsd.sub(fromQty).abs().lte(FX_QTY_TOLERANCE);
    if (!fromMatchesTo && !toMatchesFrom) {
      throw new Error("مقادیر بومی با نرخ تبدیل سازگار نیستند.");
    }
    const impliedBook = fromMatchesTo ? toQty : fromQty;
    if (book.sub(impliedBook).abs().gt(FX_QTY_TOLERANCE) && book.sub(fromAsUsd).abs().gt(FX_QTY_TOLERANCE)) {
      throw new Error("ارزش دفتری USD با نرخ و مقادیر بومی سازگار نیست.");
    }
  }

  const fee = D(cmd.feeBase ?? "0");
  const lines: DraftPosting[] = [
    {
      accountId: cmd.fromAccountId,
      assetId: cmd.fromAssetId,
      quantity: fromQty.neg().toString(),
      baseValue: book.add(fee).neg().toString(),
      memo: "خروج واحد بومی (تبدیل ارز)",
    },
    {
      accountId: cmd.toAccountId,
      assetId: cmd.toAssetId,
      quantity: toQty.toString(),
      baseValue: book.toString(),
      memo: "ورود واحد بومی (تبدیل ارز)",
    },
  ];
  if (fee.gt(0) && cmd.feeAccountId) {
    lines.push({
      accountId: cmd.feeAccountId,
      assetId: cmd.feeAssetId ?? cmd.fromAssetId,
      quantity: fee.toString(),
      baseValue: fee.toString(),
      memo: "کارمزد تبدیل ارز",
    });
  }

  return postEntry(
    {
      entryDate: cmd.entryDate,
      description: cmd.description,
      type: "fx",
      postings: lines,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
      preventOverdraft: cmd.preventOverdraft,
    },
    txClient,
  );
}

export type TradeCmd = {
  entryDate: string;
  description: string;
  assetAccountId: string;
  cashAccountId: string;
  assetId: string;
  quantity: string;
  cashAssetId: string;
  cashQuantity: string;
  baseValue: string;
  feeBase?: string;
  feeAccountId?: string | null;
  userId?: string;
  idempotencyKey?: string | null;
  preventOverdraft?: boolean;
};

/**
 * Native units of ONE base-currency (USD) unit of an account's denomination.
 * Used so every leg of a trade is quantified in the unit that account actually
 * carries (Toman for a bank account, USD for the fee/P&L accounts) instead of
 * inheriting the cash account's unit — the source of the mixed-unit quantities
 * the audit reported (F-09).
 */
async function nativeUnitsPerUsd(
  assetId: string | null | undefined,
  fallbackPerUsd: Decimal,
  userId: string | null | undefined,
  client: any,
): Promise<Decimal> {
  if (!assetId) return fallbackPerUsd;
  try {
    const unit = await nativeUnitPriceUsd(assetId, userId, client);
    const unitDec = D(unit);
    if (unitDec.gt(0)) return D("1").div(unitDec);
  } catch {
    /* fall through to the caller-provided rate */
  }
  return fallbackPerUsd;
}

/** A posting quantity must never be zero (`assertBalanced`); guard tiny legs. */
const safeQty = (value: Decimal, fallback: Decimal): string =>
  value.isZero() ? fallback.abs().toString() : value.toString();

/**
 * BUY — asset at trade value, commission expensed, one cash debit.
 *
 * F-01/F-05 alignment (this is the whole point of the shape below):
 *   asset account  +value            ← MUST equal the lot cost basis
 *   cash account   −(value + fee)     ← everything that actually left the wallet
 *   5040 fee       +fee              ← commission is an expense, never capitalised
 * so Σ = 0 by construction AND the FIFO cost basis of the lot equals the amount
 * the asset account is credited with. Selling the position in full therefore
 * returns the asset account to exactly zero instead of leaving a ghost balance
 * equal to the commission (the F-05 defect).
 */
export async function recordBuy(cmd: TradeCmd, txClient?: any) {
  const value = D(cmd.baseValue);
  const fee = D(cmd.feeBase ?? "0");
  const dbClient = txClient ?? db;

  // `cashQuantity` is the native-unit counterpart of `baseValue`; from it the
  // per-USD rate of the payment account is derived and reused for every leg.
  const cashUnitsPerUsd = value.isZero()
    ? Decimal.zero()
    : D(cmd.cashQuantity).div(value);

  const lines: DraftPosting[] = [
    {
      accountId: cmd.assetAccountId,
      assetId: cmd.assetId,
      quantity: cmd.quantity,
      baseValue: value.toString(),
    },
    {
      accountId: cmd.cashAccountId,
      assetId: cmd.cashAssetId,
      quantity: value.add(fee).mul(cashUnitsPerUsd).neg().toString(),
      baseValue: value.add(fee).neg().toString(),
    },
  ];

  if (fee.gt(0)) {
    // F-03: the fee account is resolved for THIS tenant (own row first, then
    // the shared global one) and F-02: it is provisioned when absent — an
    // omitted fee leg is exactly what used to produce an unbalanced entry.
    const feeAccount =
      (cmd.feeAccountId
        ? await resolveSystemAccountById(cmd.feeAccountId, cmd.userId, dbClient)
        : null) ?? (await ensureFeeExpenseAccount(cmd.userId ?? null, dbClient));
    const feeAsset = assertSystemAccount(feeAccount, FEE_EXPENSE_CODE, "کارمزد و بانک");

    // The commission is quantified in the fee account's own denomination when
    // that is known (usually USD), otherwise in the payment account's unit.
    const feeUnitsPerUsd = cashUnitsPerUsd.isZero()
      ? D("1")
      : await nativeUnitsPerUsd(feeAsset.assetId, cashUnitsPerUsd, cmd.userId, dbClient);

    lines.push({
      accountId: feeAsset.id,
      assetId: feeAsset.assetId ?? cmd.cashAssetId,
      quantity: safeQty(fee.mul(feeUnitsPerUsd), fee),
      baseValue: fee.toString(),
      memo: "کارمزد معامله",
    });
  }

  return postEntry(
    {
      ...cmd,
      type: "buy",
      postings: lines,
      openLot: {
        accountId: cmd.assetAccountId,
        assetId: cmd.assetId,
        quantity: cmd.quantity,
        // The lot basis tracks the asset-account posting exactly (F-05).
        costBase: value.toString(),
      },
      idempotencyKey: cmd.idempotencyKey,
      preventOverdraft: cmd.preventOverdraft,
    },
    txClient,
  );
}

export async function recordSell(cmd: TradeCmd & { pnlAccountId: string }, txClient?: any) {
  const proceeds = D(cmd.baseValue);
  const fee = D(cmd.feeBase ?? "0");
  const dbClient = txClient ?? db;
  const idempKey = cmd.idempotencyKey?.trim() || null;
  const resolvedUserId = await resolveServiceUserId(dbClient, cmd.userId, [cmd.assetAccountId]);

  if (idempKey) {
    const existing = await dbClient
      .select()
      .from(journalEntries)
      .where(
        and(
          resolvedUserId ? eq(journalEntries.userId, resolvedUserId) : sql`user_id IS NULL`,
          eq(journalEntries.idempotencyKey, idempKey),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const found = existing[0];
      await recordAuditEvent(
        {
          action: "IDEMPOTENT_REPLAY",
          entityType: "journal_entry",
          entityId: found.id,
          userId: resolvedUserId,
          result: "IDEMPOTENT_REPLAY",
          metadata: { type: "sell", idempotencyKey: idempKey },
        },
        dbClient,
      );
      return { id: found.id, idempotentReplay: true };
    }
  }

  const open = await dbClient
    .select({
      id: lots.id,
      openedAt: lots.openedAt,
      qtyRemaining: lots.qtyRemaining,
      unitCostBase: lots.unitCostBase,
    })
    .from(lots)
    .where(
      and(
        eq(lots.assetId, cmd.assetId),
        resolvedUserId ? eq(lots.userId, resolvedUserId) : sql`1=1`,
        sql`${lots.qtyRemaining} > 0`,
      ),
    )
    .orderBy(lots.openedAt);

  const netProceeds = proceeds.sub(fee);
  // F-01: the commission is applied EXACTLY ONCE. `netProceeds` is what the
  // wallet actually receives and it is also the figure the realized P&L is
  // measured against, so there is no second pair of "fee" legs (which used to
  // debit the cash account again and left it 2× the fee away from reality).
  const preview = consumeFifo(open, cmd.quantity, netProceeds.toString());
  const costBasis = D(preview.totalCost);
  const realized = netProceeds.sub(costBasis);

  // The cash leg is quantified in the payment account's own unit: the caller
  // supplied `cashQuantity` for the GROSS value, so it is scaled by the net.
  const cashUnitsPerUsd = proceeds.isZero() ? Decimal.zero() : D(cmd.cashQuantity).div(proceeds);
  const cashQuantity = netProceeds.mul(cashUnitsPerUsd);

  const lines: DraftPosting[] = [
    {
      accountId: cmd.assetAccountId,
      assetId: cmd.assetId,
      quantity: D(cmd.quantity).neg().toString(),
      baseValue: costBasis.neg().toString(),
      memo: "خروج به بهای تمام‌شده (FIFO)",
    },
    {
      accountId: cmd.cashAccountId,
      assetId: cmd.cashAssetId,
      quantity: safeQty(cashQuantity, netProceeds),
      baseValue: netProceeds.toString(),
      memo: fee.gt(0) ? `واریز خالص وجه (کسر کارمزد ${fee.toString()})` : "واریز وجه فروش",
    },
  ];

  if (!realized.isZero()) {
    // F-03: the realized-P&L counter is resolved for THIS tenant (own row,
    // else the shared global row) and provisioned if the chart lacks it, so a
    // foreign tenant's 4100 can never absorb the credit.
    const pnlAccount =
      (cmd.pnlAccountId
        ? await resolveSystemAccountById(cmd.pnlAccountId, resolvedUserId, dbClient)
        : null) ?? (await ensureRealizedPnlAccount(resolvedUserId, dbClient));
    const pnlAcct = assertSystemAccount(pnlAccount, REALIZED_PNL_CODE, "سود سرمایه‌ای تحقق‌یافته");

    const pnlUnitsPerUsd = cashUnitsPerUsd.isZero()
      ? D("1")
      : await nativeUnitsPerUsd(pnlAcct.assetId, cashUnitsPerUsd, resolvedUserId, dbClient);

    lines.push({
      accountId: pnlAcct.id,
      assetId: pnlAcct.assetId ?? cmd.cashAssetId,
      quantity: safeQty(realized.neg().mul(pnlUnitsPerUsd), realized),
      baseValue: realized.neg().toString(),
      memo: "سود/زیان تحقق‌یافته",
    });
  }

  return postEntry(
    {
      ...cmd,
      type: "sell",
      postings: lines,
      closeLot: { assetId: cmd.assetId, quantity: cmd.quantity, proceedsBase: netProceeds.toString() },
      idempotencyKey: cmd.idempotencyKey,
      preventOverdraft: cmd.preventOverdraft,
    },
    txClient,
  );
}

/**
 * A LIQUIDATION OF A REGISTRY-HELD POSITION (real estate / vehicle / any asset
 * tracked outside the trade flow) through the SAME write path as every other
 * transaction — `postEntry`. Audit F-08: an asset must never leave the
 * portfolio by only flipping a status column, because the ledger would then
 * disagree with the registry forever.
 *
 * Deliberately LOT-FREE: these positions were never bought through the trade
 * flow, so there is no FIFO history to consume and NOTHING here touches the lot
 * engine. The carrying value, when the position does have a ledger account, is
 * that account's own posted balance and is removed exactly; the difference to
 * the sale proceeds is the realized result (4100). When the position has no
 * ledger presence at all, the proceeds are booked against opening equity (3010)
 * instead of pretending to be income — net worth rises by the cash that
 * actually arrives, and the income statement stays clean.
 */
export type RegistryDisposalCmd = {
  entryDate: string;
  description: string;
  /** the asset that was liquidated (the registry row's `asset_id`). */
  assetId: string;
  /** optional explicit account holding the position; otherwise resolved. */
  assetAccountId?: string | null;
  /** where the sale proceeds are credited. */
  cashAccountId: string;
  cashAssetId: string;
  /** native units credited to the cash account (its own denomination). */
  cashQuantity: string;
  /** gross sale value in the USD book currency. */
  proceedsBase: string;
  feeBase?: string;
  /** Toman actually received + the rate frozen for the entry snapshot. */
  irtAmount?: string | null;
  fxRate?: string | null;
  userId?: string;
  idempotencyKey?: string | null;
  memo?: string;
};

export async function recordRegistryDisposal(cmd: RegistryDisposalCmd, txClient?: any) {
  const dbClient = txClient ?? db;
  const proceeds = D(cmd.proceedsBase);
  const fee = D(cmd.feeBase ?? "0");
  const net = proceeds.sub(fee);
  if (!net.gt(0)) throw new Error("مبلغ خالص فروش باید بزرگ‌تر از صفر باشد.");

  const resolvedUserId = await resolveServiceUserId(dbClient, cmd.userId, [cmd.cashAccountId]);

  // Carrying value: the position's own ledger account, if it has one.
  let carrying = Decimal.zero();
  let assetAccountId = cmd.assetAccountId ?? null;
  if (assetAccountId) {
    const bal = await dbClient.execute(sql`
      select coalesce(sum(p.base_value), 0)::text as v
      from postings p join journal_entries je on je.id = p.entry_id
      where p.account_id = ${assetAccountId} and je.status = 'posted'
    `);
    carrying = D((bal.rows[0] as { v?: string })?.v ?? "0");
  } else {
    const candidate = await dbClient.execute(sql`
      select a.id as "accountId", coalesce(sum(p.base_value), 0)::text as v
      from accounts a
        left join postings p on p.account_id = a.id
        left join journal_entries je on je.id = p.entry_id and je.status = 'posted'
      where a.type = 'asset' and a.deleted_at is null
        and coalesce(p.asset_id, a.asset_id) = ${cmd.assetId}
        ${resolvedUserId ? sql`and (a.user_id = ${resolvedUserId} or a.user_id is null)` : sql``}
      group by a.id
      order by abs(coalesce(sum(p.base_value), 0)) desc, a.code asc
      limit 1
    `);
    const row = candidate.rows[0] as { accountId?: string; v?: string } | undefined;
    if (row?.accountId && D(row.v ?? "0").abs().gt("0.00000001")) {
      assetAccountId = row.accountId;
      carrying = D(row.v ?? "0");
    }
  }

  const cashUnitsPerUsd = proceeds.isZero() ? Decimal.zero() : D(cmd.cashQuantity).div(proceeds);
  const lines: DraftPosting[] = [];

  if (!carrying.isZero() && assetAccountId) {
    lines.push({
      accountId: assetAccountId,
      assetId: cmd.assetId,
      quantity: carrying.neg().toString(),
      baseValue: carrying.neg().toString(),
      memo: cmd.memo ?? "خروج دارایی به بهای ثبت‌شده در دفتر",
    });
  }

  lines.push({
    accountId: cmd.cashAccountId,
    assetId: cmd.cashAssetId,
    quantity: safeQty(net.mul(cashUnitsPerUsd), net),
    baseValue: net.toString(),
    memo: fee.gt(0) ? `واریز خالص وجه (کسر کارمزد ${fee.toString()})` : "واریز وجه فروش",
  });

  const result = net.sub(carrying);
  if (!result.isZero()) {
    // The offsetting leg depends on whether the position was ever carried in
    // the ledger. With a carrying value the difference IS a realized result →
    // 4100. Without one, booking the whole proceeds as a "gain" would fabricate
    // income that never existed, so the credit goes to opening equity — the
    // same account class the registry uses when it records a historical
    // acquisition. Net worth rises by the cash either way; the income statement
    // stays honest.
    const useEquity = carrying.isZero();
    const counter = useEquity
      ? await ensureSystemAccount({
          code: OPENING_EQUITY_CODE,
          name: "سرمایه افتتاحیه",
          type: "equity",
          userId: resolvedUserId ?? null,
          client: dbClient,
        })
      : await ensureRealizedPnlAccount(resolvedUserId, dbClient);
    const counterAccount =
      counter ??
      (await ensureSystemAccount({
        code: OPENING_EQUITY_CODE,
        name: "سرمایه افتتاحیه",
        type: "equity",
        userId: resolvedUserId ?? null,
        client: dbClient,
      }));
    if (!counterAccount) {
      throw new Error("حساب سیستمی سود/زیان یا سرمایه افتتاحیه در دسترس نیست.");
    }
    lines.push({
      accountId: counterAccount.id,
      assetId: counterAccount.assetId ?? cmd.cashAssetId,
      quantity: safeQty(result.neg(), result),
      baseValue: result.neg().toString(),
      memo: useEquity
        ? "ورود دارایی ثبت‌نشده در دفتر (سرمایه افتتاحیه)"
        : "سود/زیان تحقق‌یافته از فروش دارایی",
    });
  }

  const entry = await postEntry(
    {
      entryDate: cmd.entryDate,
      type: "sell",
      description: cmd.description,
      postings: lines,
      userId: cmd.userId,
      idempotencyKey: cmd.idempotencyKey,
    },
    txClient,
  );

  // Same historical freeze the unified transaction path performs: the Toman
  // actually received and the rate that converted it, written with the entry.
  if (cmd.irtAmount && cmd.fxRate && entry?.id) {
    await dbClient
      .insert(entryFxSnapshots)
      .values({
        entryId: entry.id,
        irtAmount: D(cmd.irtAmount).toFixed(0),
        usdAmount: proceeds.toString(),
        fxRate: D(cmd.fxRate).toString(),
        rateSource: "manual",
        rateDate: cmd.entryDate,
      })
      .onConflictDoNothing();
  }

  return { ...entry, carryingBase: carrying.toString(), realizedBase: result.toString() };
}

export type FlowCmd = {
  entryDate: string;
  description: string;
  cashAccountId: string;
  categoryAccountId: string;
  assetId: string;
  quantity: string;
  baseValue: string;
  /** leaf id from the hierarchical expense category tree (reporting only) */
  categoryId?: string | null;
  userId?: string;
  idempotencyKey?: string | null;
  preventOverdraft?: boolean;
};

export async function recordIncome(cmd: FlowCmd, txClient?: any) {
  return postEntry(
    {
      ...cmd,
      type: "income",
      postings: [
        {
          accountId: cmd.cashAccountId,
          assetId: cmd.assetId,
          quantity: cmd.quantity,
          baseValue: cmd.baseValue,
        },
        {
          accountId: cmd.categoryAccountId,
          assetId: cmd.assetId,
          quantity: D(cmd.quantity).neg().toString(),
          baseValue: D(cmd.baseValue).neg().toString(),
        },
      ],
      idempotencyKey: cmd.idempotencyKey,
      preventOverdraft: cmd.preventOverdraft,
    },
    txClient,
  );
}

export async function recordExpense(cmd: FlowCmd, txClient?: any) {
  return postEntry(
    {
      ...cmd,
      type: "expense",
      postings: [
        {
          accountId: cmd.cashAccountId,
          assetId: cmd.assetId,
          quantity: D(cmd.quantity).neg().toString(),
          baseValue: D(cmd.baseValue).neg().toString(),
        },
        {
          accountId: cmd.categoryAccountId,
          assetId: cmd.assetId,
          quantity: cmd.quantity,
          baseValue: cmd.baseValue,
        },
      ],
      idempotencyKey: cmd.idempotencyKey,
      preventOverdraft: cmd.preventOverdraft,
    },
    txClient,
  );
}
