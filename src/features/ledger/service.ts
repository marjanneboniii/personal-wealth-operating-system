import crypto from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  auditLog,
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

export type PostEntryInput = {
  entryDate: string;
  type: EntryType;
  description: string;
  source?: "manual" | "plan" | "import";
  reference?: string | null;
  postings: DraftPosting[];
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

  // Fallback for standalone single-user test environments
  try {
    const res = await tx.execute(sql`select id from users limit 2`);
    if (res.rows.length === 1) {
      return (res.rows[0] as { id?: string })?.id;
    }
  } catch {}

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
      for (const p of input.postings) {
        if (D(p.baseValue).isNegative()) {
          const balRes = await tx.execute(sql`
            select coalesce(sum(p2.base_value), 0)::text as bal
            from postings p2 join journal_entries je on je.id = p2.entry_id
            where p2.account_id = ${p.accountId} and je.status = 'posted'
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
        throw new Error("موجودی دارایی برای فروش کافی نیست (FIFO insufficient open lots)");
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
    const original = await tx
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entryId))
      .limit(1);
    if (!original.length) throw new Error("سند یافت نشد");
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

    // Mark original entry as void
    await tx
      .update(journalEntries)
      .set({ status: "void" })
      .where(eq(journalEntries.id, entryId));

    await tx.insert(auditLog).values({
      action: "reverse_entry",
      entityType: "journal_entry",
      entityId: entryId,
      payload: JSON.stringify({ reversalEntryId: reversalEntry.id }),
    });

    return { id: reversalEntry.id };
  });
}

export async function accountByCode(code: string) {
  const found = await db.select().from(accounts).where(eq(accounts.code, code)).limit(1);
  return found[0] ?? null;
}

/**
 * Convert a base-currency amount into the asset units of a given account,
 * using the latest known unit price. Keeps the quantity ledger truthful for
 * non-base assets (IRT, USDT, …) while base values stay balanced.
 */
export async function unitsFor(
  accountId: string,
  baseAmount: string,
): Promise<{ assetId: string; quantity: string }> {
  const row = await db
    .select({ assetId: accounts.assetId })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .limit(1);
  const assetId = row[0]?.assetId;
  if (!assetId) throw new Error("حساب انتخاب‌شده به هیچ دارایی متصل نیست");
  const price = await db.execute(
    sql`select price_base::text as p from prices where asset_id = ${assetId} order by as_of desc limit 1`,
  );
  const unit = (price.rows[0] as { p?: string } | undefined)?.p ?? "1";
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

export async function recordTransfer(cmd: TransferCmd, txClient?: any) {
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

export async function recordBuy(cmd: TradeCmd, txClient?: any) {
  const value = D(cmd.baseValue);
  const fee = D(cmd.feeBase ?? "0");
  const dbClient = txClient ?? db;

  const cashUnit = D(cmd.cashQuantity).isZero()
    ? Decimal.zero()
    : value.add(fee).div(cmd.cashQuantity);

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
      quantity: D(cmd.cashQuantity).neg().toString(),
      baseValue: value.add(fee).neg().toString(),
    },
  ];

  if (fee.gt(0)) {
    const feeAcctId =
      cmd.feeAccountId ??
      (await dbClient.select().from(accounts).where(eq(accounts.code, "5040")).limit(1))[0]?.id;

    if (feeAcctId) {
      lines.push({
        accountId: feeAcctId,
        assetId: cmd.cashAssetId,
        quantity: cashUnit.isZero() ? fee.toString() : fee.div(cashUnit).toString(),
        baseValue: fee.toString(),
        memo: "کارمزد معامله",
      });
    }
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
        costBase: value.add(fee).toString(),
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

  const preview = consumeFifo(open, cmd.quantity, proceeds.sub(fee).toString());
  const costBasis = D(preview.totalCost);
  const netProceeds = proceeds.sub(fee);
  const realized = netProceeds.sub(costBasis);

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
      quantity: cmd.cashQuantity,
      baseValue: netProceeds.toString(),
    },
  ];

  if (!realized.isZero()) {
    lines.push({
      accountId: cmd.pnlAccountId,
      assetId: cmd.cashAssetId,
      quantity: realized.neg().toString(),
      baseValue: realized.neg().toString(),
      memo: "سود/زیان تحقق‌یافته",
    });
  }
  if (fee.gt(0)) {
    const feeAcctId =
      cmd.feeAccountId ??
      (await dbClient.select().from(accounts).where(eq(accounts.code, "5040")).limit(1))[0]?.id;

    if (feeAcctId) {
      lines.push({
        accountId: feeAcctId,
        assetId: cmd.cashAssetId,
        quantity: fee.toString(),
        baseValue: fee.toString(),
        memo: "کارمزد معامله",
      });
      lines.push({
        accountId: cmd.cashAccountId,
        assetId: cmd.cashAssetId,
        quantity: fee.neg().toString(),
        baseValue: fee.neg().toString(),
        memo: "کسر کارمزد",
      });
    }
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

export type FlowCmd = {
  entryDate: string;
  description: string;
  cashAccountId: string;
  categoryAccountId: string;
  assetId: string;
  quantity: string;
  baseValue: string;
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
