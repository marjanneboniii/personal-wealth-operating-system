import { sql } from "drizzle-orm";
import { db } from "@/db";

export async function migrateLegacyFinancialData(txDb: any = db): Promise<{
  migrated: boolean;
  rowsMigrated: number;
  strategy: string;
}> {
  const tables = [
    "accounts",
    "journal_entries",
    "lots",
    "wallets",
    "goals",
    "events",
    "budgets",
    "planned_transactions",
    "debts",
    "obligations",
    "funds",
    "snapshots",
  ];

  let unownedCount = 0;
  for (const table of tables) {
    try {
      const res = await txDb.execute(sql.raw(`SELECT count(*)::int as cnt FROM ${table} WHERE user_id IS NULL`));
      unownedCount += Number(res.rows[0]?.cnt || 0);
    } catch {
      // table might not exist yet during early init
    }
  }

  if (unownedCount === 0) {
    return { migrated: false, rowsMigrated: 0, strategy: "no_unowned_data" };
  }

  // Check existing users
  let usersRows: any[] = [];
  try {
    const usersRes = await txDb.execute(sql.raw(`SELECT id, role FROM users`));
    usersRows = usersRes.rows;
  } catch {
    return { migrated: false, rowsMigrated: 0, strategy: "users_table_missing" };
  }

  const ownerUsers = usersRows.filter((u: any) => u.role === "owner");

  if (usersRows.length === 1 && ownerUsers.length === 1) {
    const ownerId = ownerUsers[0].id;
    let rowsMigrated = 0;
    for (const table of tables) {
      try {
        const res = await txDb.execute(
          sql.raw(`UPDATE ${table} SET user_id = '${ownerId}' WHERE user_id IS NULL`)
        );
        rowsMigrated += Number(res.rowCount ?? (res as { affectedRows?: number }).affectedRows ?? 0);
      } catch {}
    }
    return {
      migrated: true,
      rowsMigrated,
      strategy: `claimed_to_single_owner_${ownerId}`,
    };
  } else if (usersRows.length > 1 && unownedCount > 0) {
    throw new Error(
      "Migration failed: Multiple users exist but legacy financial data has no owner. Cannot automatically assign data."
    );
  }

  return { migrated: false, rowsMigrated: 0, strategy: "no_users_found" };
}
