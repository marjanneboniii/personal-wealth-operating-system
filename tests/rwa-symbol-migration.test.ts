import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildRwaSymbol } from "../src/features/rwa/symbol";
import { toFaDigits } from "../src/lib/format";

test("compact RWA symbols store ASCII and render Persian digits", () => {
  assert.equal(buildRwaSymbol(1), "001");
  assert.equal(buildRwaSymbol(999), "999");
  assert.equal(buildRwaSymbol(1000), "1000");
  assert.equal(toFaDigits(buildRwaSymbol(1)), "۰۰۱");
  assert.throws(() => buildRwaSymbol(0), /positive integer/);
});

test("0013 enforces assets.symbol uniqueness only for active rows", async () => {
  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

  await client.exec(`
    INSERT INTO asset_classes (id, code, name)
    VALUES ('00000000-0000-0000-0000-000000000301', 'RWA-ACTIVE-UQ', 'RWA Active Unique');

    INSERT INTO assets (id, created_at, deleted_at, symbol, name, class_id) VALUES
      ('00000000-0000-0000-0000-000000000401', '2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '001', 'Deleted tombstone', '00000000-0000-0000-0000-000000000301'),
      ('00000000-0000-0000-0000-000000000402', '2026-01-03T00:00:00Z', NULL, '001', 'Live replacement', '00000000-0000-0000-0000-000000000301');
  `);

  await assert.rejects(
    () =>
      client.exec(`
        INSERT INTO assets (id, created_at, symbol, name, class_id)
        VALUES ('00000000-0000-0000-0000-000000000403', '2026-01-04T00:00:00Z', '001', 'Duplicate live row', '00000000-0000-0000-0000-000000000301');
      `),
    /assets_symbol_active_unique|unique/i,
  );

  await client.close();
});

test("0008 renames existing property/vehicle symbols globally and records before/after audit", async () => {
  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

  // `001` belongs to an unrelated active asset, so the RWA migration must
  // safely use the next two free values rather than violating active-symbol
  // uniqueness.
  await client.exec(`
    INSERT INTO asset_classes (id, code, name)
    VALUES ('00000000-0000-0000-0000-000000000101', 'RWA-TEST', 'RWA Test');

    INSERT INTO assets (id, created_at, symbol, name, class_id) VALUES
      ('00000000-0000-0000-0000-000000000201', '2026-01-01T00:00:00Z', '001', 'Reserved', '00000000-0000-0000-0000-000000000101'),
      ('00000000-0000-0000-0000-000000000202', '2026-01-02T00:00:00Z', 'RE-AHZ-KPE-APT-0001', 'Property', '00000000-0000-0000-0000-000000000101'),
      ('00000000-0000-0000-0000-000000000203', '2026-01-03T00:00:00Z', 'VEH-0001', 'Vehicle', '00000000-0000-0000-0000-000000000101');

    INSERT INTO real_estate_properties (asset_id)
    VALUES ('00000000-0000-0000-0000-000000000202');

    INSERT INTO vehicle_assets (asset_id, brand, model, year)
    VALUES ('00000000-0000-0000-0000-000000000203', 'Test', 'Car', 1405);
  `);

  const migrationSql = readFileSync("drizzle/0008_rwa_short_numeric_symbols.sql", "utf8");
  // Re-run the data migration explicitly after arranging legacy fixtures. The
  // migrator already ran it once against the initially empty target set.
  await client.exec(`BEGIN;\n${migrationSql}\nCOMMIT;`);

  const renamed = await client.query<{ id: string; symbol: string }>(`
    SELECT id::text, symbol
    FROM assets
    WHERE id IN (
      '00000000-0000-0000-0000-000000000202',
      '00000000-0000-0000-0000-000000000203'
    )
    ORDER BY created_at
  `);
  assert.deepEqual(renamed.rows.map((row) => row.symbol), ["002", "003"]);

  const audit = await client.query<{ before_data: string; after_data: string }>(`
    SELECT before_data, after_data
    FROM audit_log
    WHERE action = 'MIGRATE_RWA_SHORT_SYMBOL'
    ORDER BY created_at, entity_id
  `);
  assert.equal(audit.rows.length, 2);
  assert.deepEqual(
    audit.rows.map((row) => [JSON.parse(row.before_data).symbol, JSON.parse(row.after_data).symbol]),
    [
      ["RE-AHZ-KPE-APT-0001", "002"],
      ["VEH-0001", "003"],
    ],
  );

  await client.close();
});
