import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { auditLog } from "@/db/schema";

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
  "market_price_sources",
  "market_prices",
  "market_snapshots",
  "portfolio_valuations",
  "portfolio_snapshots",
  "asset_performance",
  "wealth_performance_snapshots",
  "asset_performance_analysis",
  "portfolio_risk_metrics",
  "benchmark_definitions",
  "benchmark_snapshots",
  "benchmark_results",
  "analytics_runs",
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
  "user_setup_state",
  "import_jobs",
  "import_records",
  "settings",
  "notifications",
  "audit_log",
];

const ALLOWED_TABLES = new Set(ORDER);

const backupPayloadSchema = z.object({
  app: z.literal("PWOS"),
  schemaVersion: z.literal("1.0"),
  confirmToken: z.literal("RESTORE_DATABASE_OVERWRITE"),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
});

function checkAuth(request: Request): boolean {
  const authToken = process.env.PWOS_AUTH_TOKEN;
  if (!authToken) return true; // Auth optional when env var is omitted
  const headerToken =
    request.headers.get("x-pwos-auth") ??
    request.headers.get("authorization")?.replace("Bearer ", "");
  return headerToken === authToken;
}

/** Transactional restore: all-or-nothing, parameterized against SQL injection, schema-version checked. */
export async function POST(request: Request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ ok: false, error: "دسترسی غیرمجاز" }, { status: 401 });
  }

  try {
    const rawBody = await request.json();
    const parseResult = backupPayloadSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          ok: false,
          error: "تأییدیه بازیابی ارائه نشده است یا ساختار فایل پشتیبان نامعتبر است",
        },
        { status: 400 },
      );
    }

    const { data } = parseResult.data;
    let inserted = 0;

    await db.transaction(async (tx) => {
      // Clear existing tables in reverse dependency order using parameterized identifiers
      for (const t of [...ORDER].reverse()) {
        await tx.execute(sql`delete from ${sql.identifier(t)}`);
      }

      // Re-insert rows in direct dependency order using fully parameterized queries
      for (const t of ORDER) {
        if (!ALLOWED_TABLES.has(t)) continue;
        const rows = data[t] ?? [];
        for (const row of rows) {
          const rawCols = Object.keys(row);
          // Strictly validate column names to allow only safe alphanumeric identifiers
          const cols = rawCols.filter((c) => /^[a_z0_9_]+$/i.test(c));
          if (!cols.length) continue;

          const colSql = cols.map((c) => sql.identifier(c));
          const valSql = cols.map((c) => sql`${row[c]}`);

          await tx.execute(
            sql`insert into ${sql.identifier(t)} (${sql.join(colSql, sql`, `)}) values (${sql.join(valSql, sql`, `)})`,
          );
          inserted++;
        }
      }

      await tx.insert(auditLog).values({
        action: "restore_database",
        entityType: "database",
        payload: JSON.stringify({ rowCount: inserted, restoredAt: new Date().toISOString() }),
      });
    });

    return NextResponse.json({ ok: true, inserted });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "خطای بازیابی" },
      { status: 500 },
    );
  }
}
