/**
 * Wallet Identity Layer — Separate Identity Domain
 * CRITICAL RULES:
 * - Stores blockchain wallet address, network/chain, ownership relationship, user association, optional link to internal asset accounts
 * - MUST NOT create accounting transactions, journal entries, lots, cost basis
 * - MUST NOT import postEntry, recordBuy, recordSell
 * - Optional linkedAccountId is soft link SET NULL, never creates accounting movement, only reference
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { accounts, networks, walletIdentities } from "@/db/schema";
import { createWalletIdentitySchema } from "./validators";
import type { CreateWalletIdentityInput, WalletIdentity } from "./types";

export async function createWalletIdentity(input: CreateWalletIdentityInput): Promise<{ id: string }> {
  const parsed = createWalletIdentitySchema.parse(input);

  // Validate linkedAccountId exists if provided — but do NOT create accounting movement
  if (parsed.linkedAccountId) {
    const [acct] = await db.select().from(accounts).where(eq(accounts.id, parsed.linkedAccountId)).limit(1);
    if (!acct) throw new Error(`Linked account not found: ${parsed.linkedAccountId}`);
  }

  // Validate network exists if provided
  if (parsed.networkId) {
    const [net] = await db.select().from(networks).where(eq(networks.id, parsed.networkId)).limit(1);
    if (!net) throw new Error(`Network not found: ${parsed.networkId}`);
  }

  const [inserted] = await db
    .insert(walletIdentities)
    .values({
      userId: parsed.userId ?? null,
      address: parsed.address.toLowerCase(),
      networkId: parsed.networkId ?? null,
      chainId: parsed.chainId ?? null,
      label: parsed.label ?? null,
      walletType: parsed.walletType ?? "personal",
      ownershipCategory: parsed.ownershipCategory ?? "self_custody",
      isVerified: parsed.isVerified ?? false,
      linkedAccountId: parsed.linkedAccountId ?? null,
      notes: parsed.notes ?? null,
    })
    .returning();

  return { id: inserted.id };
}

export async function getWalletIdentity(id: string): Promise<WalletIdentity | null> {
  const rows = await db
    .select({
      id: walletIdentities.id,
      userId: walletIdentities.userId,
      address: walletIdentities.address,
      networkId: walletIdentities.networkId,
      networkCode: networks.code,
      networkName: networks.name,
      chainId: walletIdentities.chainId,
      label: walletIdentities.label,
      walletType: walletIdentities.walletType,
      ownershipCategory: walletIdentities.ownershipCategory,
      isVerified: walletIdentities.isVerified,
      linkedAccountId: walletIdentities.linkedAccountId,
      linkedAccountCode: accounts.code,
      notes: walletIdentities.notes,
      createdAt: walletIdentities.createdAt,
      updatedAt: walletIdentities.updatedAt,
    })
    .from(walletIdentities)
    .leftJoin(networks, eq(networks.id, walletIdentities.networkId))
    .leftJoin(accounts, eq(accounts.id, walletIdentities.linkedAccountId))
    .where(eq(walletIdentities.id, id))
    .limit(1);

  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    userId: r.userId,
    address: r.address,
    networkId: r.networkId,
    networkCode: r.networkCode ?? undefined,
    networkName: r.networkName ?? undefined,
    chainId: r.chainId,
    label: r.label,
    walletType: r.walletType as any,
    ownershipCategory: r.ownershipCategory as any,
    isVerified: r.isVerified,
    linkedAccountId: r.linkedAccountId,
    linkedAccountCode: r.linkedAccountCode ?? null,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  };
}

export async function listWalletIdentities(filter: {
  userId?: string;
  walletType?: string;
  ownershipCategory?: string;
}): Promise<WalletIdentity[]> {
  const rows = await db
    .select({
      id: walletIdentities.id,
      userId: walletIdentities.userId,
      address: walletIdentities.address,
      networkId: walletIdentities.networkId,
      networkCode: networks.code,
      networkName: networks.name,
      chainId: walletIdentities.chainId,
      label: walletIdentities.label,
      walletType: walletIdentities.walletType,
      ownershipCategory: walletIdentities.ownershipCategory,
      isVerified: walletIdentities.isVerified,
      linkedAccountId: walletIdentities.linkedAccountId,
      linkedAccountCode: accounts.code,
      notes: walletIdentities.notes,
      createdAt: walletIdentities.createdAt,
      updatedAt: walletIdentities.updatedAt,
    })
    .from(walletIdentities)
    .leftJoin(networks, eq(networks.id, walletIdentities.networkId))
    .leftJoin(accounts, eq(accounts.id, walletIdentities.linkedAccountId))
    .orderBy(walletIdentities.createdAt);

  let filtered = rows;
  if (filter.userId) filtered = filtered.filter((r) => r.userId === filter.userId);
  if (filter.walletType) filtered = filtered.filter((r) => r.walletType === filter.walletType);
  if (filter.ownershipCategory)
    filtered = filtered.filter((r) => r.ownershipCategory === filter.ownershipCategory);

  return filtered.map((r) => ({
    id: r.id,
    userId: r.userId,
    address: r.address,
    networkId: r.networkId,
    networkCode: r.networkCode ?? undefined,
    networkName: r.networkName ?? undefined,
    chainId: r.chainId,
    label: r.label,
    walletType: r.walletType as any,
    ownershipCategory: r.ownershipCategory as any,
    isVerified: r.isVerified,
    linkedAccountId: r.linkedAccountId,
    linkedAccountCode: r.linkedAccountCode ?? null,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}

export async function deleteWalletIdentity(id: string): Promise<void> {
  await db.delete(walletIdentities).where(eq(walletIdentities.id, id));
}

/**
 * Find wallet identities by address (case-insensitive) — used for ownership resolution without FK to ledger
 */
export async function findByAddress(address: string, userId?: string): Promise<WalletIdentity[]> {
  const lower = address.toLowerCase();
  const rows = await db
    .select({
      id: walletIdentities.id,
      userId: walletIdentities.userId,
      address: walletIdentities.address,
      networkId: walletIdentities.networkId,
      networkCode: networks.code,
      networkName: networks.name,
      chainId: walletIdentities.chainId,
      label: walletIdentities.label,
      walletType: walletIdentities.walletType,
      ownershipCategory: walletIdentities.ownershipCategory,
      isVerified: walletIdentities.isVerified,
      linkedAccountId: walletIdentities.linkedAccountId,
      linkedAccountCode: accounts.code,
      notes: walletIdentities.notes,
      createdAt: walletIdentities.createdAt,
      updatedAt: walletIdentities.updatedAt,
    })
    .from(walletIdentities)
    .leftJoin(networks, eq(networks.id, walletIdentities.networkId))
    .leftJoin(accounts, eq(accounts.id, walletIdentities.linkedAccountId))
    .where(sql`lower(${walletIdentities.address}) = ${lower}`);

  let filtered = rows;
  if (userId) filtered = filtered.filter((r) => r.userId === userId);

  return filtered.map((r) => ({
    id: r.id,
    userId: r.userId,
    address: r.address,
    networkId: r.networkId,
    networkCode: r.networkCode ?? undefined,
    networkName: r.networkName ?? undefined,
    chainId: r.chainId,
    label: r.label,
    walletType: r.walletType as any,
    ownershipCategory: r.ownershipCategory as any,
    isVerified: r.isVerified,
    linkedAccountId: r.linkedAccountId,
    linkedAccountCode: r.linkedAccountCode ?? null,
    notes: r.notes,
    createdAt: r.createdAt?.toISOString() ?? new Date().toISOString(),
    updatedAt: r.updatedAt?.toISOString() ?? null,
  }));
}
