import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Initial setup is mandatory: a signed-in user enters the app only after the
 * setup wizard. Only an explicit completion receipt unlocks financial pages.
 * Existing accounts do not prove completion and must never be opened twice.
 *
 * Fail-closed: database errors propagate to the caller.
 */
export async function isSetupRequired(userId: string): Promise<boolean> {
  const result = await db.execute(sql`
    select (
      exists (select 1 from user_setup_state s where s.user_id = ${userId} and s.completed)
    ) as ready
  `);
  const ready = (result.rows[0] as { ready?: boolean | string } | undefined)?.ready;
  return !(ready === true || ready === "t" || ready === "true");
}
