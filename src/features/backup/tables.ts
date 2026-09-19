import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";

/**
 * The table list for backup and restore, DERIVED from the schema.
 *
 * WHY DERIVED: the two endpoints used to carry their own hand-written lists.
 * Every new table (bank SMS, vehicles, real-asset valuations, FX snapshots, …)
 * had to be added to both, in the right order, and 19 of them never were — a
 * restore then deleted their parents while leaving them behind. Reading the
 * list and the order from `src/db/schema.ts` means a new table is backed up
 * and restored the moment it exists.
 */

/** Current backup format. A restore accepts exactly this version. */
export const BACKUP_SCHEMA_VERSION = "2.0";

/** Session secrets never leave the server; the backup-run log is operational. */
const NEVER_EXPORTED = new Set(["sessions", "backup_runs"]);
/**
 * Identities are never overwritten by a restore — restored tenant data must keep
 * referencing the accounts that exist now. `backup_runs` holds the pre-restore
 * marker, which has to survive the restore it describes.
 */
const NEVER_RESTORED = new Set(["users", "sessions", "backup_runs"]);

/**
 * Credential secrets/hashes must never leave the server (audit M-01): for these
 * tables only the listed columns are exported.
 */
const EXPORT_COLUMN_WHITELIST: Record<string, string[]> = {
  users: ["id", "created_at", "updated_at", "deleted_at", "name", "role", "username", "email", "google_id", "email_verified"],
};

type TableInfo = {
  name: string;
  columns: { name: string; sqlType: string }[];
  /** Tables this one references through a foreign key (itself excluded). */
  deps: string[];
};

function readSchema(): Map<string, TableInfo> {
  const out = new Map<string, TableInfo>();
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const config = getTableConfig(value);
    const deps = new Set<string>();
    for (const fk of config.foreignKeys) {
      const target = getTableConfig(fk.reference().foreignTable).name;
      if (target !== config.name) deps.add(target);
    }
    out.set(config.name, {
      name: config.name,
      columns: config.columns.map((c) => ({ name: c.name, sqlType: c.getSQLType() })),
      deps: [...deps].sort(),
    });
  }
  return out;
}

/** Parents before children; ties broken by name so the order is stable. */
function dependencyOrder(tables: Map<string, TableInfo>): string[] {
  const ordered: string[] = [];
  const placed = new Set<string>();
  const remaining = new Set(tables.keys());
  while (remaining.size) {
    const ready = [...remaining]
      .filter((name) => tables.get(name)!.deps.every((dep) => placed.has(dep) || !tables.has(dep)))
      .sort();
    if (!ready.length) throw new Error(`Foreign-key cycle between: ${[...remaining].sort().join(", ")}`);
    for (const name of ready) {
      ordered.push(name);
      placed.add(name);
      remaining.delete(name);
    }
  }
  return ordered;
}

const TABLES = readSchema();
const ORDER = dependencyOrder(TABLES);

/** Every exported table, parents first. */
export const BACKUP_TABLES: readonly string[] = ORDER.filter((t) => !NEVER_EXPORTED.has(t));
/** Every restored table, parents first. Delete in reverse, insert in this order. */
export const RESTORE_TABLES: readonly string[] = ORDER.filter((t) => !NEVER_RESTORED.has(t));

/** Columns a backup exports for `table`, with the SQL type of each. */
export function exportColumns(table: string): { name: string; sqlType: string }[] {
  const info = TABLES.get(table);
  if (!info) throw new Error(`Unknown table: ${table}`);
  const whitelist = EXPORT_COLUMN_WHITELIST[table];
  return whitelist ? info.columns.filter((c) => whitelist.includes(c.name)) : info.columns;
}

/** The columns a restore may write for `table`: name → SQL type. */
export function restorableColumns(table: string): Map<string, string> {
  const info = TABLES.get(table);
  if (!info) throw new Error(`Unknown table: ${table}`);
  return new Map(info.columns.map((c) => [c.name, c.sqlType]));
}
