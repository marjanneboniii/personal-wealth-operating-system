import "dotenv/config";
import dns from "node:dns/promises";
import { Client } from "pg";

/**
 * Database connectivity doctor.
 *
 *   npm run db:check
 *
 * Diagnoses the four layers where a DATABASE_URL can fail — URL syntax, DNS,
 * TCP/TLS/auth, and schema — and prints one actionable hint per failure so a
 * generic "Failed query" in the browser never has to be decoded by hand.
 * The password is never printed.
 */

function fail(hint: string): never {
  console.error(`\n✗ ${hint}\n`);
  process.exit(1);
}

async function main() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    fail(
      "DATABASE_URL is not set. Create a .env file (see .env.example). " +
        "For zero-setup embedded mode use: DATABASE_URL=memory://",
    );
  }
  if (raw.startsWith("memory://")) {
    console.log("✓ DATABASE_URL=memory:// — embedded PGlite database, no network check needed.");
    return;
  }

  /* 1 ── URL syntax ------------------------------------------------------ */
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail(
      "DATABASE_URL is not a valid URL. Make sure it is one plain line like " +
        "postgresql://user:password@host:5432/dbname — copied as raw text, not from an " +
        "email/messenger that may have turned it into a mailto: link.",
    );
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    fail(`DATABASE_URL must start with postgresql:// (got "${url.protocol}//").`);
  }
  const redacted = raw.replace(/\/\/([^:]+):[^@]*@/, "//$1:***@");
  if (/\s/.test(raw.trim()) || /mailto:/i.test(raw)) {
    fail(
      `DATABASE_URL looks corrupted (whitespace or a 'mailto:' fragment inside): ${redacted}\n` +
        "   Re-copy the connection string as plain text from the Neon dashboard.",
    );
  }
  console.log(`✓ URL syntax (password hidden): ${redacted}`);

  /* 2 ── DNS -------------------------------------------------------------- */
  try {
    const { address } = await dns.lookup(url.hostname);
    console.log(`✓ DNS ${url.hostname} → ${address}`);
  } catch {
    fail(
      `Hostname "${url.hostname}" does not resolve (ENOTFOUND).\n` +
        "   The host in your connection string is wrong or mangled — Neon hosts look like " +
        "ep-xxx-yyy.<region>.aws.neon.tech. Copy a fresh string from console.neon.tech → " +
        "your project → Connection Details.",
    );
  }

  /* 3 ── Connect + auth ---------------------------------------------------- */
  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
    console.log("✓ Connected (TCP + TLS + authentication)");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let hint = `Connection failed: ${msg}`;
    if (/password authentication failed/i.test(msg)) {
      hint +=
        "\n   The password is wrong. Reset it in the Neon dashboard (your project's Roles) " +
        "and update .env. If the password contains @ : / # ? &, percent-encode it in the URL.";
    } else if (/does not exist/i.test(msg) && /database/i.test(msg)) {
      hint += `\n   The database "${url.pathname.slice(1)}" does not exist on this server — create it or fix the name.`;
    } else if (/timeout|ETIMEDOUT|timed out/i.test(msg)) {
      hint +=
        "\n   No answer from the server: a firewall/VPN/ISP may be blocking port 5432, or the " +
        "Neon compute took too long to wake from idle. Try again, or try from another network.";
    } else if (/terminated|ECONNRESET|socket/i.test(msg)) {
      hint +=
        "\n   The server accepted TCP then dropped the connection: check Neon 'IP Allow' " +
        "restrictions on your project, and that the endpoint name in the host is exactly right.";
    } else if (/certificate|self-signed|ssl/i.test(msg)) {
      hint += "\n   TLS problem: use sslmode=verify-full (recommended) or sslmode=require in the URL.";
    }
    fail(hint);
  }

  /* 4 ── Schema ------------------------------------------------------------ */
  try {
    const who = await client.query("select current_user as u, current_database() as d");
    const tables = await client.query(
      "select count(*)::int as c from information_schema.tables where table_schema = 'public'",
    );
    const inst = await client.query("select to_regclass('public.institutions') as t");
    const mig = await client.query("select to_regclass('public.__drizzle_migrations') as t");
    console.log(`✓ Logged in as ${who.rows[0].u} on database ${who.rows[0].d}`);
    console.log(`✓ Public tables: ${tables.rows[0].c} — institutions: ${inst.rows[0].t ?? "MISSING"}`);
    if (!inst.rows[0].t) {
      console.log("  → Schema is not migrated yet. Run: npm run db:migrate");
    } else if (!mig.rows[0].t) {
      console.log("  → Tables exist but there is no migration history. Run: npm run db:migrate to record the baseline.");
    }
  } finally {
    await client.end().catch(() => {});
  }
  console.log("\nAll good — start the app with: npm run dev\n");
}

main().catch((err) => {
  console.error("db:check crashed:", err);
  process.exit(1);
});
