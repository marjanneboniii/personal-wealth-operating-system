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

test("0024 numbers existing properties and vehicles per user, and relabels system-named property assets", async () => {
  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, {
    migrationsFolder: "./drizzle",
    migrationsTable: "__drizzle_migrations",
    migrationsSchema: "public",
  });

  // Production shape before 0024: one global counter, so user B's first property is "002"
  // and user C's is "005". user_seq is NULL on every pre-existing row.
  await client.exec(`
    INSERT INTO auth.users (id) VALUES
      ('00000000-0000-0000-0000-00000000a001'),
      ('00000000-0000-0000-0000-00000000b001'),
      ('00000000-0000-0000-0000-00000000c001');
    INSERT INTO users (id, name) VALUES
      ('00000000-0000-0000-0000-00000000a001', 'A'),
      ('00000000-0000-0000-0000-00000000b001', 'B'),
      ('00000000-0000-0000-0000-00000000c001', 'C')
    ON CONFLICT (id) DO NOTHING;
    INSERT INTO asset_classes (id, code, name) VALUES ('00000000-0000-0000-0000-000000000901', 'RWA-0024', 'RWA');
    INSERT INTO assets (id, symbol, name, class_id) VALUES
      ('00000000-0000-0000-0000-000000000911', '001', '001', '00000000-0000-0000-0000-000000000901'),
      ('00000000-0000-0000-0000-000000000912', '002', '002', '00000000-0000-0000-0000-000000000901'),
      ('00000000-0000-0000-0000-000000000913', '003', 'Peugeot 206', '00000000-0000-0000-0000-000000000901'),
      ('00000000-0000-0000-0000-000000000914', '004', 'Pride', '00000000-0000-0000-0000-000000000901'),
      ('00000000-0000-0000-0000-000000000915', '005', '005', '00000000-0000-0000-0000-000000000901'),
      ('00000000-0000-0000-0000-000000000916', '006', 'ویلای شمال', '00000000-0000-0000-0000-000000000901');
    INSERT INTO real_estate_properties (asset_id, user_id, created_at) VALUES
      ('00000000-0000-0000-0000-000000000911', '00000000-0000-0000-0000-00000000a001', '2026-01-01T00:00:00Z'),
      ('00000000-0000-0000-0000-000000000912', '00000000-0000-0000-0000-00000000b001', '2026-01-02T00:00:00Z'),
      ('00000000-0000-0000-0000-000000000915', '00000000-0000-0000-0000-00000000c001', '2026-01-05T00:00:00Z'),
      ('00000000-0000-0000-0000-000000000916', '00000000-0000-0000-0000-00000000a001', '2026-01-06T00:00:00Z');
    INSERT INTO vehicle_assets (asset_id, user_id, brand, model, year, created_at) VALUES
      ('00000000-0000-0000-0000-000000000913', '00000000-0000-0000-0000-00000000a001', 'Peugeot', '206', 1400, '2026-01-03T00:00:00Z'),
      ('00000000-0000-0000-0000-000000000914', '00000000-0000-0000-0000-00000000b001', 'Saipa', 'Pride', 1390, '2026-01-04T00:00:00Z');
  `);

  // Re-run 0024 over that data (it is idempotent: IF NOT EXISTS + WHERE user_seq IS NULL).
  for (const statement of readFileSync("drizzle/0024_rwa_per_user_sequence.sql", "utf8").split("--> statement-breakpoint")) {
    if (statement.replace(/--.*$/gm, "").trim()) await client.exec(statement);
  }

  const properties = await client.query<{ user_id: string; user_seq: number; name: string }>(`
    SELECT p.user_id::text, p.user_seq, a.name
    FROM real_estate_properties p JOIN assets a ON a.id = p.asset_id
    ORDER BY p.user_id, p.user_seq
  `);
  assert.deepEqual(
    properties.rows.map((r) => [r.user_id.slice(-4), r.user_seq, r.name]),
    [
      ["a001", 1, "ملک ۱"],
      ["a001", 2, "ویلای شمال"],
      ["b001", 1, "ملک ۱"],
      ["c001", 1, "ملک ۱"],
    ],
    "each user's properties start at 1; only system-generated names are relabelled",
  );

  const vehicles = await client.query<{ user_id: string; user_seq: number }>(
    `SELECT user_id::text, user_seq FROM vehicle_assets ORDER BY user_id`,
  );
  assert.deepEqual(vehicles.rows.map((r) => [r.user_id.slice(-4), r.user_seq]), [["a001", 1], ["b001", 1]]);

  await assert.rejects(
    () => client.exec(`UPDATE real_estate_properties SET user_seq = 1 WHERE asset_id = '00000000-0000-0000-0000-000000000916'`),
    /real_estate_properties_user_seq_unique|unique/i,
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
