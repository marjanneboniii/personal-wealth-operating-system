/**
 * THE 190,000 PLACEHOLDER IS NEVER FROZEN.
 *
 * Pins the audit finding: a sign-up wrote `user_fx_settings.current_rate =
 * 190000` for every new user, and every read then returned it as that user's
 * own rate («user_settings»). A transaction, a debt or a property purchase
 * booked before the first market refresh froze 190,000 into its permanent FX
 * snapshot, silently.
 *
 * Now: sign-up writes no rate row at all, migration 0037 deletes the
 * placeholder rows already stored, the display fallback stays for «≈ دلار»
 * hints, and every write refuses it after trying the market once.
 */
import assert from "node:assert/strict";
import { test, mock } from "node:test";

// The live market: unreachable until a test says otherwise.
let marketQuote: { rate: string; observedAt: string } | null = null;
mock.module("@/features/fx/liveRate", {
  namedExports: { fetchLiveUsdtRate: async () => marketQuote },
});

let db: any, createSchemaIfNotExists: any, users: any, userFxSettings: any, eq: any, sql: any;
let fx: any, resolveUsdRateForDateToFreeze: any;
const ready = (async () => {
  ({ db } = await import("../src/db"));
  ({ createSchemaIfNotExists } = await import("../src/db/init-schema"));
  ({ users, userFxSettings } = await import("../src/db/schema"));
  ({ eq, sql } = await import("drizzle-orm"));
  fx = await import("../src/lib/fx");
  ({ resolveUsdRateForDateToFreeze } = await import("../src/features/rwa/vehicle/fx"));
})();

let userId = "";

test("migration 0037 deletes the sign-up placeholder, and nobody's real rate", async () => {
  await ready;
  await createSchemaIfNotExists();
  const [placeholderUser] = await db
    .insert(users)
    .values({ name: "New user", email: "new@example.com", role: "user" })
    .returning();
  userId = placeholderUser.id;
  const [realUser] = await db.insert(users).values({ name: "Old user", email: "old@example.com", role: "user" }).returning();
  // Exactly what the old sign-up wrote: the default rate, never updated.
  await db.insert(userFxSettings).values({ userId, currentRate: "190000" });
  // A rate this user actually has — same number, but fetched/chosen.
  await db.insert(userFxSettings).values({ userId: realUser.id, currentRate: "190000", lastUpdatedAt: new Date() });

  const { readFile } = await import("node:fs/promises");
  const migration = await readFile(new URL("../drizzle/0037_drop_placeholder_fx_rate.sql", import.meta.url), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await db.execute(sql.raw(statement));
  }

  const rows = await db.select().from(userFxSettings);
  assert.equal(rows.length, 1, "only the placeholder row is gone");
  assert.equal(rows[0].userId, realUser.id);
});

test("a user with no rate row gets the display fallback, not a rate", async () => {
  const snap = await fx.getLatestUsdIrtRateForUser(userId);
  assert.equal(snap.source, "fallback");
  assert.equal(fx.isPlaceholderRate(snap), true);
  // Pages can still draw their «≈ دلار» hints.
  assert.equal(snap.rate, fx.FALLBACK_DISPLAY_RATE);
});

test("a write refuses the placeholder when the market is unreachable", async () => {
  marketQuote = null;
  await assert.rejects(fx.getWritableUsdIrtRateForUser(userId), { message: fx.MISSING_RATE_MESSAGE });
  assert.throws(() => fx.assertRealUsdIrtRate({ source: "fallback", rate: "190000" }), { message: fx.MISSING_RATE_MESSAGE });
});

test("a property/vehicle value is not frozen at the placeholder either", async () => {
  // A date the built-in historical table does not cover (it ends in the past),
  // so the resolution falls through to the user's rate — the placeholder.
  const today = new Date().toISOString().slice(0, 10);
  await assert.rejects(resolveUsdRateForDateToFreeze(today, userId), /نرخ دلار همان تاریخ را در فرم وارد کنید/);
});

test("an old date still resolves from the built-in historical rates", async () => {
  const resolved = await resolveUsdRateForDateToFreeze("2020-01-01", userId);
  assert.equal(resolved.source, "historical");
  assert.ok(Number(resolved.rate) > 0);
});

test("a write fetches the market once and freezes the real rate", async () => {
  marketQuote = { rate: "1030000", observedAt: new Date().toISOString() };
  const snap = await fx.getWritableUsdIrtRateForUser(userId);
  assert.equal(Number(snap.rate), 1030000);
  assert.equal(snap.source, "user_settings");
  const [row] = await db.select().from(userFxSettings).where(eq(userFxSettings.userId, userId));
  assert.ok(row.lastUpdatedAt, "the fetched rate is stored as a real rate");
});
