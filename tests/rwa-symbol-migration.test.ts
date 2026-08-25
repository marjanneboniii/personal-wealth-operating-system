import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { buildRwaSymbol } from "../src/features/rwa/symbol";

test("shortest RWA symbols are compact ASCII with no zero padding", () => {
  assert.equal(buildRwaSymbol(1), "1");
  assert.equal(buildRwaSymbol(9), "9");
  assert.equal(buildRwaSymbol(1000), "1000");
  assert.throws(() => buildRwaSymbol(0), /positive integer/);
});

test("0008 renames existing property/vehicle symbols globally and records before/after audit", async () => {
  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

  // `001` belongs to an unrelated asset, so the RWA migration must safely use
  // the next two free values rather than violating assets_symbol_unique.
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

test("0009 shortens RWA symbols and sets the compact property name without touching amounts", async () => {
  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

  // An unrelated asset already owns `001` (same situation the real migration
  // guard must survive); a property and a vehicle use zero-padded RWA ids.
  await client.exec(`
    INSERT INTO asset_classes (id, code, name)
    VALUES ('00000000-0000-0000-0000-000000000101', 'RWA-TEST', 'RWA Test');

    INSERT INTO assets (id, created_at, symbol, name, class_id) VALUES
      ('00000000-0000-0000-0000-000000000301', '2026-01-01T00:00:00Z', '001', 'Reserved', '00000000-0000-0000-0000-000000000101'),
      ('00000000-0000-0000-0000-000000000302', '2026-01-02T00:00:00Z', '002', 'آپارتمان — اهواز — شهرک دانشگاه', '00000000-0000-0000-0000-000000000101'),
      ('00000000-0000-0000-0000-000000000303', '2026-01-03T00:00:00Z', '003', 'Vehicle', '00000000-0000-0000-0000-000000000101');

    INSERT INTO real_estate_properties (asset_id, purchase_price_toman, current_value_toman)
    VALUES ('00000000-0000-0000-0000-000000000302', '4500000000', '7000000000');

    INSERT INTO vehicle_assets (asset_id, brand, model, year)
    VALUES ('00000000-0000-0000-0000-000000000303', 'Test', 'Car', 1405);
  `);

  const migrationSql = readFileSync("drizzle/0009_compact_property_identity.sql", "utf8");
  await client.exec(`BEGIN;\n${migrationSql}\nCOMMIT;`);

  const rows = await client.query<{ id: string; symbol: string; name: string }>(`
    SELECT id::text, symbol, name
    FROM assets
    WHERE id IN (
      '00000000-0000-0000-0000-000000000301',
      '00000000-0000-0000-0000-000000000302',
      '00000000-0000-0000-0000-000000000303'
    )
    ORDER BY created_at
  `);
  // Unrelated `001` must NOT move; the property becomes `1`, the vehicle `2`.
  assert.deepEqual(
    rows.rows.map((r) => [r.id, r.symbol, r.name]),
    [
      ["00000000-0000-0000-0000-000000000301", "001", "Reserved"],
      ["00000000-0000-0000-0000-000000000302", "1", "سرای"],
      ["00000000-0000-0000-0000-000000000303", "2", "Vehicle"],
    ],
  );

  // Financial values are untouched by the identity migration.
  const prop = await client.query<{ purchase_price_toman: string; current_value_toman: string }>(`
    SELECT purchase_price_toman, current_value_toman
    FROM real_estate_properties
    WHERE asset_id = '00000000-0000-0000-0000-000000000302'
  `);
  assert.equal(Number(prop.rows[0].purchase_price_toman), 4500000000);
  assert.equal(Number(prop.rows[0].current_value_toman), 7000000000);

  await client.close();
});
