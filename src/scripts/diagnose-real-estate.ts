import "dotenv/config";
import { isMemoryUrl } from "@/db/config";
import { buildVisibilityReport, renderReport, type QueryRunner } from "@/features/rwa/realEstate/visibility";

/**
 * CLI for the real-estate visibility diagnosis.
 *
 *   npm run db:diagnose-realestate                     # every account
 *   npm run db:diagnose-realestate -- --user=marjan    # one account (username / email / uuid)
 *   npm run db:diagnose-realestate -- --json           # machine-readable output
 *
 * STRICTLY READ-ONLY: the session is opened with `default_transaction_read_only=on`
 * and a statement timeout, so the server itself rejects any write; every statement
 * in the underlying module is a SELECT. Nothing here repairs data — it explains
 * which read-path filter is hiding it and what the sanctioned remediation is.
 */

function redact(raw: string): string {
  return raw.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@");
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const userIdentity = args.find((a) => a.startsWith("--user="))?.slice("--user=".length) ?? null;
  const raw = process.env.DATABASE_URL;

  if (isMemoryUrl(raw)) {
    console.error(
      "\n✗ این ابزار بانک جاسازی‌شده (memory://) را بررسی نمی‌کند: آن داده فقط در حافظهٔ یک پروسهٔ زنده است و\n" +
        "  از یک اسکریپت جداگانه دیده نمی‌شود. برای تشخیص، DATABASE_URL واقعی (Neon یا local) را در .env بگذارید.\n",
    );
    process.exit(1);
  }

  const { Client } = await import("pg");
  const client = new Client({
    connectionString: raw,
    ssl: /sslmode=(require|verify-full)/.test(raw ?? "") ? { rejectUnauthorized: false } : undefined,
    options: "-c default_transaction_read_only=on -c statement_timeout=30000",
  });

  try {
    await client.connect();
  } catch (err) {
    console.error(
      `\n✗ اتصال برقرار نشد: ${err instanceof Error ? err.message : String(err)}\n` +
        `  هدف: ${redact(raw ?? "")}\n  برای عیب‌یابی اتصال: npm run db:check\n`,
    );
    process.exit(1);
  }

  if (!json) {
    console.log(`\nپیوند به: ${redact(raw ?? "")}`);
    console.log("✓ نشست فقط‌خواندنی است (default_transaction_read_only=on).");
  }

  try {
    const q: QueryRunner = async (sqlText) => (await client.query(sqlText)).rows;
    const report = await buildVisibilityReport(q, { userIdentity });
    if (json) console.log(JSON.stringify(report, null, 2));
    else console.log(`\n${renderReport(report)}\n`);
  } finally {
    await client.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error("diagnose-real-estate crashed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
