import { sql } from "drizzle-orm";
import { db } from "@/db";

/** Run tenant work with the PostgreSQL RLS identity scoped to one transaction. */
export async function withTenant<T>(userId: string, work: (tx: any) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) throw new Error("Invalid tenant identity");
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);
    return work(tx);
  });
}
