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
};

/**
 * The single write path into the ledger. Everything else in the system
 * (transfers, buys, sells, installments, executed plans) funnels through here
 * so the double-entry invariant can never be bypassed.
 */
export async function postEntry(input: PostEntryInput, txClient?: any): Promise<{ id: string }> {
  assertBalanced(input.postings);

  const runTx = async (tx: any) => {
    const [entry] = await tx
      .insert(journalEntries)
      .values({
        entryDate: input.entryDate,
        type: input.type,
        description: input.description,
        reference: input.reference ?? null,
        source: input.source ?? "manual",
        status: "posted",
      })
      .returning();

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
        });
      }
    }

    if (input.closeLot && D(input.closeLot.quantity).gt(0)) {
      const open = await tx
        .select({
          id: lots.id,
          openedAt: lots.openedAt,
          qtyRemaining: lots.qtyRemaining,
          unitCostBase: lots.unitCostBase,
        })
        .from(lots)
        .where(and(eq(lots.assetId, input.closeLot.assetId), sql`${lots.qtyRemaining} > 0`))
        .orderBy(lots.openedAt);

      const result = consumeFifo(open, input.closeLot.quantity, input.closeLot.proceedsBase);
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
      payload: JSON.stringify({ type: input.type, lines: input.postings.length }),
    });

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
  return postEntry({ ...cmd, type: "transfer", postings: lines }, txClient);
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
    },
    txClient,
  );
}

export async function recordSell(cmd: TradeCmd & { pnlAccountId: string }, txClient?: any) {
  const proceeds = D(cmd.baseValue);
  const fee = D(cmd.feeBase ?? "0");
  const dbClient = txClient ?? db;
  const open = await dbClient
    .select({
      id: lots.id,
      openedAt: lots.openedAt,
      qtyRemaining: lots.qtyRemaining,
      unitCostBase: lots.unitCostBase,
    })
    .from(lots)
    .where(and(eq(lots.assetId, cmd.assetId), sql`${lots.qtyRemaining} > 0`))
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
    },
    txClient,
  );
}
