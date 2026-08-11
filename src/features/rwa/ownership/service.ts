/**
 * RWA Ownership Records — Because ownership may be 100% owner, 50% partnership, inheritance, mortgaged, debt attached
 * Entity: ownership_records
 * Isolated from ledger — No FK to journal_entries, postings, lots — only assets, users, debts
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { assets, rwaOwnershipRecords } from "@/db/schema";
import type { CreateOwnershipInput, RWAOwnershipRecord } from "../types";
import { D } from "@/domain/decimal";

export async function createOwnershipRecord(input: CreateOwnershipInput): Promise<{ id: string }> {
  const [assetRow] = await db.select().from(assets).where(eq(assets.id, input.assetId)).limit(1);
  if (!assetRow) throw new Error(`Asset not found: ${input.assetId}`);

  if (input.ownershipPercentage) {
    const pct = D(input.ownershipPercentage);
    if (pct.lte(0) || pct.gt(100)) throw new Error("Ownership percentage must be >0 and <=100");
  }

  const [inserted] = await db
    .insert(rwaOwnershipRecords)
    .values({
      assetId: input.assetId,
      userId: input.userId ?? null,
      ownershipPercentage: input.ownershipPercentage ? D(input.ownershipPercentage).toString() : "100",
      ownershipType: input.ownershipType ?? "full",
      acquisitionDate: input.acquisitionDate,
      acquisitionPriceIRR: input.acquisitionPriceIRR ? D(input.acquisitionPriceIRR).toString() : null,
      acquisitionPriceUSD: input.acquisitionPriceUSD ? D(input.acquisitionPriceUSD).toString() : null,
      acquisitionCurrencyId: input.acquisitionCurrencyId ?? null,
      debtId: input.debtId ?? null,
      isActive: true,
      notes: input.notes ?? null,
    })
    .returning();

  return { id: inserted.id };
}

export async function getOwnershipRecords(assetId: string, userId?: string): Promise<RWAOwnershipRecord[]> {
  const rows = await db
    .select({
      id: rwaOwnershipRecords.id,
      assetId: rwaOwnershipRecords.assetId,
      assetSymbol: assets.symbol,
      userId: rwaOwnershipRecords.userId,
      ownershipPercentage: rwaOwnershipRecords.ownershipPercentage,
      ownershipType: rwaOwnershipRecords.ownershipType,
      acquisitionDate: rwaOwnershipRecords.acquisitionDate,
      acquisitionPriceIRR: rwaOwnershipRecords.acquisitionPriceIRR,
      acquisitionPriceUSD: rwaOwnershipRecords.acquisitionPriceUSD,
      acquisitionCurrencyId: rwaOwnershipRecords.acquisitionCurrencyId,
      debtId: rwaOwnershipRecords.debtId,
      isActive: rwaOwnershipRecords.isActive,
      notes: rwaOwnershipRecords.notes,
      createdAt: rwaOwnershipRecords.createdAt,
      updatedAt: rwaOwnershipRecords.updatedAt,
    })
    .from(rwaOwnershipRecords)
    .innerJoin(assets, eq(assets.id, rwaOwnershipRecords.assetId))
    // Tenant scoping is enforced in SQL. A NULL owner is never shared with an
    // authenticated tenant.
    .where(
      userId
        ? and(eq(rwaOwnershipRecords.assetId, assetId), eq(rwaOwnershipRecords.userId, userId))
        : eq(rwaOwnershipRecords.assetId, assetId),
    )
    .orderBy(desc(rwaOwnershipRecords.acquisitionDate));

  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    ownershipPercentage: r.ownershipPercentage.toString(),
    ownershipType: r.ownershipType as any,
    acquisitionDate: r.acquisitionDate,
    acquisitionPriceIRR: r.acquisitionPriceIRR ? r.acquisitionPriceIRR.toString() : null,
    acquisitionPriceUSD: r.acquisitionPriceUSD ? r.acquisitionPriceUSD.toString() : null,
    acquisitionCurrencyId: r.acquisitionCurrencyId,
    debtId: r.debtId,
    isActive: r.isActive,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}

export async function listOwnershipRecords(userId?: string): Promise<RWAOwnershipRecord[]> {
  const rows = await db
    .select({
      id: rwaOwnershipRecords.id,
      assetId: rwaOwnershipRecords.assetId,
      assetSymbol: assets.symbol,
      userId: rwaOwnershipRecords.userId,
      ownershipPercentage: rwaOwnershipRecords.ownershipPercentage,
      ownershipType: rwaOwnershipRecords.ownershipType,
      acquisitionDate: rwaOwnershipRecords.acquisitionDate,
      acquisitionPriceIRR: rwaOwnershipRecords.acquisitionPriceIRR,
      acquisitionPriceUSD: rwaOwnershipRecords.acquisitionPriceUSD,
      acquisitionCurrencyId: rwaOwnershipRecords.acquisitionCurrencyId,
      debtId: rwaOwnershipRecords.debtId,
      isActive: rwaOwnershipRecords.isActive,
      notes: rwaOwnershipRecords.notes,
      createdAt: rwaOwnershipRecords.createdAt,
      updatedAt: rwaOwnershipRecords.updatedAt,
    })
    .from(rwaOwnershipRecords)
    .innerJoin(assets, eq(assets.id, rwaOwnershipRecords.assetId))
    // SECURITY (multi-user isolation): tenant scoping at the DB query level
    // (WHERE user_id = :currentUserId), never by post-filtering in memory.
    .where(userId ? eq(rwaOwnershipRecords.userId, userId) : undefined)
    .orderBy(desc(rwaOwnershipRecords.acquisitionDate));

  return rows.map((r) => ({
    id: r.id,
    assetId: r.assetId,
    assetSymbol: r.assetSymbol,
    userId: r.userId,
    ownershipPercentage: r.ownershipPercentage.toString(),
    ownershipType: r.ownershipType as any,
    acquisitionDate: r.acquisitionDate,
    acquisitionPriceIRR: r.acquisitionPriceIRR ? r.acquisitionPriceIRR.toString() : null,
    acquisitionPriceUSD: r.acquisitionPriceUSD ? r.acquisitionPriceUSD.toString() : null,
    acquisitionCurrencyId: r.acquisitionCurrencyId,
    debtId: r.debtId,
    isActive: r.isActive,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}
