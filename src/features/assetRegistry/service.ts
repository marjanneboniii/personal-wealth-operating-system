/**
 * Asset Registry Service — Identity-Focused
 * Owns the asset-class hierarchy used to categorize assets.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { assetClasses } from "@/db/schema";
import type { AssetClassNode, CreateAssetClassInput } from "./types";

export async function createAssetClass(input: CreateAssetClassInput): Promise<{ id: string }> {
  if (input.parentId) {
    const [parent] = await db.select().from(assetClasses).where(eq(assetClasses.id, input.parentId)).limit(1);
    if (!parent) throw new Error(`Parent asset class not found: ${input.parentId}`);
  }

  const [inserted] = await db
    .insert(assetClasses)
    .values({
      code: input.code,
      name: input.name,
      color: input.color ?? "#64748b",
      sortOrder: input.sortOrder ?? 0,
      parentId: input.parentId ?? null,
      level: input.level ?? (input.parentId ? 1 : 0),
      attributesSchema: input.attributesSchema ?? null,
    })
    .returning();

  return { id: inserted.id };
}

export async function getAssetClassTree(): Promise<AssetClassNode[]> {
  const rows = await db.select().from(assetClasses).orderBy(assetClasses.sortOrder);

  const map = new Map<string, AssetClassNode>();
  for (const r of rows) {
    map.set(r.id, {
      id: r.id,
      code: r.code,
      name: r.name,
      color: r.color,
      sortOrder: r.sortOrder,
      parentId: r.parentId ?? null,
      level: r.level ?? 0,
      attributesSchema: r.attributesSchema ?? null,
      children: [],
    });
  }

  const roots: AssetClassNode[] = [];
  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export async function listAssetClasses(): Promise<AssetClassNode[]> {
  const rows = await db.select().from(assetClasses).orderBy(assetClasses.sortOrder);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    color: r.color,
    sortOrder: r.sortOrder,
    parentId: r.parentId ?? null,
    level: r.level ?? 0,
    attributesSchema: r.attributesSchema ?? null,
  }));
}
