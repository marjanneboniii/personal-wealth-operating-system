/**
 * BACKUP → RESTORE ROUND TRIP — the restore must give back exactly what the
 * backup took.
 *
 * Pins the bug the audit found: restore filtered column names with
 * `/^[a_z0_9_]+$/i` (a typo for `a-z`), which rejects every real column, so it
 * deleted every table and inserted nothing — and still answered 200. The old
 * tests only checked the status code. This one compares the database before
 * and after, table by table.
 *
 * `date` columns: the production driver (node-postgres) parses a DATE into a
 * JS Date at LOCAL midnight, which JSON writes a day earlier on a server east
 * of UTC (Tehran: 2026-09-19 → "2026-09-18T20:30:00.000Z"). The embedded test
 * database returns DATE as text, so it cannot reproduce that shift; the last
 * test here pins the part that can be checked — that the backup recognises
 * every `date` column, which is what makes it export them as text.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { db } from "../src/db";
import { createSchemaIfNotExists } from "../src/db/init-schema";
import { runSeed } from "../src/db/seed";
import { currencies, entryFxSnapshots, journalEntries, users } from "../src/db/schema";
import { createSession } from "../src/lib/auth";
import { GET as backupApi } from "../src/app/api/backup/route";
import { POST as restoreApi } from "../src/app/api/restore/route";
import { BACKUP_TABLES, RESTORE_TABLES, exportColumns } from "../src/features/backup/tables";

async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of RESTORE_TABLES) {
    const res = await db.execute(sql`select count(*)::int as c from ${sql.identifier(t)}`);
    out[t] = Number((res.rows[0] as { c: number }).c);
  }
  return out;
}

async function fingerprint() {
  const dates = await db.execute(sql`select id, entry_date::text as d from journal_entries order by id`);
  const money = await db.execute(sql`select coalesce(sum(base_value), 0)::text as s from postings`);
  return { dates: dates.rows, postingsSum: (money.rows[0] as { s: string }).s };
}

let cookie = "";
let backup: { schemaVersion: string; data: Record<string, Record<string, unknown>[]> };

async function restore(body: unknown) {
  return restoreApi(
    new Request("http://localhost/api/restore", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `pwos_session=${cookie}` },
      body: JSON.stringify(body),
    }),
  );
}

async function login() {
  const [admin] = await db
    .select()
    .from(users)
    .where(sql`${users.username} = 'restore_admin'`)
    .limit(1);
  cookie = (await createSession(admin.id)).token;
}

test("setup — demo ledger, an FX snapshot, an admin", async () => {
  await createSchemaIfNotExists();
  await runSeed();
  const [entry] = await db.select().from(journalEntries).limit(1);
  // The table the old restore list forgot entirely.
  await db.insert(entryFxSnapshots).values({
    entryId: entry.id,
    irtAmount: "24938110",
    usdAmount: "131.253210526315789474",
    fxRate: "190000",
    rateSource: "settings",
    rateDate: "2026-09-19",
  });
  await db.insert(users).values({ name: "Admin", username: "restore_admin", role: "owner" } as any);
  await login();
  assert.ok((await counts()).journal_entries > 0, "the seed wrote a ledger");
});

test("backup exports every schema table (minus sessions) at version 2.0", async () => {
  const res = await backupApi(new Request("http://localhost/api/backup", { headers: { cookie: `pwos_session=${cookie}` } }));
  assert.equal(res.status, 200);
  backup = await res.json();
  assert.equal(backup.schemaVersion, "2.0");
  for (const t of BACKUP_TABLES) assert.ok(Array.isArray(backup.data[t]), `${t} is in the backup`);
  assert.equal(backup.data.sessions, undefined, "sessions never leave the server");
  assert.equal(backup.data.entry_fx_snapshots.length, 1);
  assert.ok(backup.data.users.every((u) => !("password_hash" in u) && !("pin_hash" in u)), "no credential hash");
  // `date` columns travel as their literal text, never as a shifted instant.
  assert.match(String(backup.data.entry_fx_snapshots[0].rate_date), /^2026-09-19$/);
});

test("restore gives back every row, exact dates and exact amounts", async () => {
  const before = await counts();
  const beforePrint = await fingerprint();
  // Noise the restore must remove, and a loss it must repair.
  await db.insert(currencies).values({ code: "ZZZ", name: "noise", symbol: "z", decimals: 0, isFiat: true });
  await db.delete(entryFxSnapshots);

  const res = await restore({ app: "PWOS", schemaVersion: "2.0", confirmToken: "RESTORE_DATABASE_OVERWRITE", data: backup.data });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));

  const expected = RESTORE_TABLES.reduce((sum, t) => sum + backup.data[t].length, 0);
  assert.ok(expected > 0);
  assert.equal(json.inserted, expected, "every row of the file was inserted");
  assert.deepEqual(await counts(), before, "each table holds exactly what it held at backup time");
  assert.deepEqual(await fingerprint(), beforePrint, "no date moved, no amount changed");
});

test("an old 1.0 backup is refused before anything is deleted", async () => {
  await login();
  const before = await counts();
  const res = await restore({ app: "PWOS", schemaVersion: "1.0", confirmToken: "RESTORE_DATABASE_OVERWRITE", data: backup.data });
  assert.equal(res.status, 400);
  assert.deepEqual(await counts(), before);
});

test("an incomplete backup is refused before anything is deleted", async () => {
  const before = await counts();
  const { postings: _dropped, ...partial } = backup.data;
  const res = await restore({ app: "PWOS", schemaVersion: "2.0", confirmToken: "RESTORE_DATABASE_OVERWRITE", data: partial });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /postings/);
  assert.deepEqual(await counts(), before);
});

test("the backup recognises `date` columns, so it exports them as literal text", () => {
  const types = new Map(exportColumns("journal_entries").map((c) => [c.name, c.sqlType]));
  assert.equal(types.get("entry_date"), "date");
  assert.equal(new Map(exportColumns("entry_fx_snapshots").map((c) => [c.name, c.sqlType])).get("rate_date"), "date");
});
