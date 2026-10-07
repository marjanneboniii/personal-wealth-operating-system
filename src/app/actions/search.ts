"use server";
import { getSetupReadyUser } from "@/lib/authGuard";

import { z } from "zod";
import { searchEverything, type SearchHit } from "@/features/search/service";

/** Command-palette data search — read-only, the caller's own records only. */
export async function searchEverythingAction(query: unknown): Promise<SearchHit[]> {
  const parsed = z.string().max(80).safeParse(query);
  if (!parsed.success) return [];
  try {
    const user = await getSetupReadyUser();
    if (!user?.id) return [];
    return await searchEverything(user.id, parsed.data);
  } catch {
    return [];
  }
}
