import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Initial setup is mandatory: a signed-in user enters the app only after the
 * setup wizard. A user counts as set up when the wizard is completed, or when
 * they already own accounts or entries (users who started before setup became
 * mandatory) — they must never be pushed through a second opening entry.
 *
 * Fail-closed: database errors propagate to the caller.
 */
export async function isSetupRequired(userId: string): Promise<boolean> {
  const result = await db.execute(sql`
    select (
      exists (select 1 from user_setup_state s where s.user_id = ${userId} and s.completed)
      or exists (select 1 from accounts a where a.user_id = ${userId} and a.deleted_at is null)
      or exists (select 1 from journal_entries je where je.user_id = ${userId})
    ) as ready
  `);
  const ready = (result.rows[0] as { ready?: boolean | string } | undefined)?.ready;
  return !(ready === true || ready === "t" || ready === "true");
}
