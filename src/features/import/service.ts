import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  accounts,
  assets,
  auditLog,
  importJobs,
  importRecords,
  journalEntries,
  postings,
} from "@/db/schema";
import { ParsedRow, parseImportText } from "./parser";
import {
  postEntry,
  recordBuy,
  recordExpense,
  recordIncome,
  recordSell,
  recordTransfer,
} from "@/features/ledger/service";
import { D } from "@/domain/decimal";
import { todayIso } from "@/lib/format";

export type ValidatedRecord = {
  lineIndex: number;
  rawData: ParsedRow;
  status: "valid" | "invalid";
  errorMessage?: string;
  warningMessage?: string;
  assetId?: string;
  assetAccountId?: string;
  cashAccountId?: string;
  pnlAccountId?: string;
};

export type ImportJobSummary = {
  jobId: string;
  source: string;
  status: string;
  rowCount: number;
  validCount: number;
  errorCount: number;
  records: ValidatedRecord[];
};

/**
 * Validates parsed import rows against current database state (known assets, accounts, dates, quantities)
 */
export async function validateImportRows(parsedRows: ParsedRow[]): Promise<ValidatedRecord[]> {
  const [knownAssets, knownAccounts] = await Promise.all([
    db.select().from(assets).where(sql`${assets.deletedAt} is null`),
    db.select().from(accounts).where(sql`${accounts.deletedAt} is null`),
  ]);

  const assetMap = new Map(knownAssets.map((a) => [a.symbol.toUpperCase(), a]));
  const defaultCash = knownAccounts.find((a) => a.code === "1010" || a.type === "asset");
  const pnlAccount = knownAccounts.find((a) => a.code === "4100" || a.type === "income");
  const equityAccount = knownAccounts.find((a) => a.code === "3010" || a.type === "equity");

  const validated: ValidatedRecord[] = [];

  for (const row of parsedRows) {
    let status: "valid" | "invalid" = "valid";
    let errorMessage: string | undefined;
    let warningMessage: string | undefined;

    // 1. Validate Date
    if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) {
      status = "invalid";
      errorMessage = `تاریخ نامعتبر است: "${row.date || "خالی"}" (فرمت معتبر YYYY-MM-DD)`;
    }

    // 2. Validate Asset Symbol
    const matchedAsset = assetMap.get(row.asset.toUpperCase());
    if (!matchedAsset) {
      status = "invalid";
      errorMessage = `دارایی نامشخص یا تعریف‌نشده در سیستم: "${row.asset}"`;
    }

    // 3. Validate Quantity
    if (D(row.quantity).lte(0)) {
      status = "invalid";
      errorMessage = `مقدار دارایی باید بزرگ‌تر از صفر باشد: ${row.quantity}`;
    }

    // 4. Validate Price
    if (D(row.price).lt(0)) {
      status = "invalid";
      errorMessage = `قیمت دارایی نمی‌تواند منفی باشد: ${row.price}`;
    }

    // 5. Validate Fee
    if (D(row.fee).lt(0)) {
      status = "invalid";
      errorMessage = `کارمزد نمی‌تواند منفی باشد: ${row.fee}`;
    }

    // Find account for this asset
    const assetAccount = knownAccounts.find(
      (a) => a.assetId === matchedAsset?.id && a.type === "asset",
    );

    // Duplicate Check Warning
    if (status === "valid" && matchedAsset) {
      const existing = await db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.entryDate, row.date),
            eq(journalEntries.type, row.type),
            eq(journalEntries.description, row.description),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        warningMessage = "احتمال وجود تراکنش تکراری در همان تاریخ با همین شرح";
      }
    }

    validated.push({
      lineIndex: row.lineIndex,
      rawData: row,
      status,
      errorMessage,
      warningMessage,
      assetId: matchedAsset?.id,
      assetAccountId: assetAccount?.id ?? defaultCash?.id,
      cashAccountId: defaultCash?.id,
      pnlAccountId: pnlAccount?.id,
    });
  }

  return validated;
}

/**
 * Parses, validates, and registers a new import job in `import_jobs` and `import_records` tables.
 */
export async function createImportJob(
  rawInput: string,
  source = "csv",
  userId?: string,
): Promise<ImportJobSummary> {
  const parsedRows = parseImportText(rawInput);
  const validatedRecords = await validateImportRows(parsedRows);

  const rowCount = parsedRows.length;
  const validCount = validatedRecords.filter((r) => r.status === "valid").length;
  const errorCount = rowCount - validCount;

  return db.transaction(async (tx) => {
    const [job] = await tx
      .insert(importJobs)
      .values({
        userId: userId ?? null,
        source,
        status: "pending",
        rowCount,
        validCount,
        errorCount,
      })
      .returning();

    if (validatedRecords.length > 0) {
      await tx.insert(importRecords).values(
        validatedRecords.map((r) => ({
          importJobId: job.id,
          rawData: JSON.stringify(r.rawData),
          status: r.status,
          errorMessage: r.errorMessage ?? null,
        })),
      );
    }

    return {
      jobId: job.id,
      source,
      status: "pending",
      rowCount,
      validCount,
      errorCount,
      records: validatedRecords,
    };
  });
}

/**
 * Executes a pending import job.
 * Maps validated import records to existing domain services (`recordBuy`, `recordSell`, `postEntry`)
 * guaranteeing double-entry balance, FIFO lots, and audit logs without bypassing the ledger.
 */
export async function executeImportJob(jobId: string): Promise<{
  success: boolean;
  executedCount: number;
  message: string;
}> {
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job) throw new Error("جاب درون‌ریزی یافت نشد.");
  if (job.status === "completed") throw new Error("این جاب درون‌ریزی قبلاً اجرا شده است.");

  const records = await db
    .select()
    .from(importRecords)
    .where(and(eq(importRecords.importJobId, jobId), eq(importRecords.status, "valid")));

  if (!records.length) {
    throw new Error("سطر معتبری برای درون‌ریزی وجود ندارد.");
  }

  // Fetch reference assets and accounts for mapping
  const [allAssets, allAccounts] = await Promise.all([
    db.select().from(assets).where(sql`${assets.deletedAt} is null`),
    db.select().from(accounts).where(sql`${accounts.deletedAt} is null`),
  ]);

  const assetMap = new Map(allAssets.map((a) => [a.symbol.toUpperCase(), a]));
  const defaultCash = allAccounts.find((a) => a.code === "1010" || a.type === "asset");
  const usdAsset = allAssets.find((a) => a.symbol === "USD") ?? allAssets[0];
  const pnlAccount = allAccounts.find((a) => a.code === "4100" || a.type === "income");
  const equityAccount = allAccounts.find((a) => a.code === "3010" || a.type === "equity");

  let executedCount = 0;

  await db.transaction(async (tx) => {
    for (const record of records) {
      const row: ParsedRow = JSON.parse(record.rawData);
      const matchedAsset = assetMap.get(row.asset.toUpperCase());
      if (!matchedAsset || !defaultCash) continue;

      const assetAccount =
        allAccounts.find((a) => a.assetId === matchedAsset.id && a.type === "asset") ?? defaultCash;

      let entryResult: { id: string } | undefined;

      const qty = D(row.quantity);
      const price = D(row.price);
      const valueBase = qty.mul(price);

      if (row.type === "buy") {
        entryResult = await recordBuy(
          {
            entryDate: row.date,
            description: row.description || `درون‌ریزی خرید ${row.asset}`,
            assetAccountId: assetAccount.id,
            cashAccountId: defaultCash.id,
            assetId: matchedAsset.id,
            quantity: row.quantity,
            cashAssetId: defaultCash.assetId ?? usdAsset.id,
            cashQuantity: valueBase.toString(),
            baseValue: valueBase.toString(),
            feeBase: row.fee,
            feeAccountId: allAccounts.find((a) => a.code === "5040")?.id,
          },
          tx,
        );
      } else if (row.type === "sell" && pnlAccount) {
        entryResult = await recordSell(
          {
            entryDate: row.date,
            description: row.description || `درون‌ریزی فروش ${row.asset}`,
            assetAccountId: assetAccount.id,
            cashAccountId: defaultCash.id,
            assetId: matchedAsset.id,
            quantity: row.quantity,
            cashAssetId: defaultCash.assetId ?? usdAsset.id,
            cashQuantity: valueBase.toString(),
            baseValue: valueBase.toString(),
            feeBase: row.fee,
            pnlAccountId: pnlAccount.id,
          },
          tx,
        );
      } else if (row.type === "income") {
        const categoryAccount =
          allAccounts.find((a) => a.code === "4010") ?? pnlAccount ?? defaultCash;
        entryResult = await recordIncome(
          {
            entryDate: row.date,
            description: row.description || `درون‌ریزی درآمد ${row.asset}`,
            cashAccountId: defaultCash.id,
            categoryAccountId: categoryAccount.id,
            assetId: matchedAsset.id,
            quantity: row.quantity,
            baseValue: valueBase.toString(),
          },
          tx,
        );
      } else if (row.type === "expense") {
        const categoryAccount =
          allAccounts.find((a) => a.code === "5010") ?? defaultCash;
        entryResult = await recordExpense(
          {
            entryDate: row.date,
            description: row.description || `درون‌ریزی هزینه ${row.asset}`,
            cashAccountId: defaultCash.id,
            categoryAccountId: categoryAccount.id,
            assetId: matchedAsset.id,
            quantity: row.quantity,
            baseValue: valueBase.toString(),
          },
          tx,
        );
      } else if (row.type === "opening" && equityAccount) {
        // Opening Holdings: Balance against Opening Equity (3010) — NO fake trades!
        entryResult = await postEntry(
          {
            entryDate: row.date,
            type: "opening",
            description: row.description || `افتتاحیه درون‌ریزی‌شده — ${row.asset}`,
            postings: [
              {
                accountId: assetAccount.id,
                assetId: matchedAsset.id,
                quantity: qty.toString(),
                baseValue: valueBase.toString(),
              },
              {
                accountId: equityAccount.id,
                assetId: defaultCash.assetId ?? usdAsset.id,
                quantity: valueBase.neg().toString(),
                baseValue: valueBase.neg().toString(),
              },
            ],
            openLot: {
              accountId: assetAccount.id,
              assetId: matchedAsset.id,
              quantity: qty.toString(),
              costBase: valueBase.toString(),
            },
          },
          tx,
        );
      }

      if (entryResult) {
        executedCount++;
        await tx
          .update(importRecords)
          .set({ mappedTransactionId: entryResult.id, status: "valid" })
          .where(eq(importRecords.id, record.id));
      }
    }

    await tx
      .update(importJobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(importJobs.id, jobId));

    await tx.insert(auditLog).values({
      action: "execute_import_job",
      entityType: "import_job",
      entityId: jobId,
      payload: JSON.stringify({ executedCount, jobId }),
    });
  });

  return {
    success: true,
    executedCount,
    message: `${executedCount} تراکنش با موفقیت درون‌ریزی و در دفترکل ثبت شد.`,
  };
}
