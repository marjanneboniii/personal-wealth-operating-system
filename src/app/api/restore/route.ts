import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";

export const dynamic = "force-dynamic";

const ORDER = [
  "currencies",
  "asset_classes",
  "networks",
  "institutions",
  "assets",
  "wallets",
  "accounts",
  "journal_entries",
  "postings",
  "lots",
  "lot_consumptions",
  "prices",
  "snapshots",
  "snapshot_lines",
  "goals",
  "goal_contributions",
  "events",
  "event_items",
  "budgets",
  "planned_transactions",
  "debts",
  "installments",
  "obligations",
  "funds",
  "users",
  "settings",
  "notifications",
  "audit_log",
];

/** Transactional restore: all-or-nothing, schema-version checked. */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      schemaVersion?: string;
      data?: Record<string, Record<string, unknown>[]>;
    };
    if (body.schemaVersion !== "1.0" || !body.data) {
      return NextResponse.json({ ok: false, error: "نسخه پشتیبان پشتیبانی نمی‌شود" }, { status: 400 });
    }

    let inserted = 0;
    await db.transaction(async (tx) => {
      for (const t of [...ORDER].reverse()) {
        await tx.execute(sql.raw(`delete from ${t}`));
      }
      for (const t of ORDER) {
        const rows = body.data?.[t] ?? [];
        for (const row of rows) {
          const cols = Object.keys(row);
          if (!cols.length) continue;
          const values = cols.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return "null";
            return `'${String(v).replace(/'/g, "''")}'`;
          });
          await tx.execute(
            sql.raw(`insert into ${t} (${cols.map((c) => `"${c}"`).join(",")}) values (${values.join(",")})`),
          );
          inserted++;
        }
      }
    });

    return NextResponse.json({ ok: true, inserted });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "خطای بازیابی" },
      { status: 500 },
    );
  }
}
