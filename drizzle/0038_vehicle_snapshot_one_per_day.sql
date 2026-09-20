-- "One valuation snapshot per model per day, and per car per day" is already a
-- rule of this system: src/features/rwa/vehicle/valuation.ts selects for an
-- existing row on the same date and refuses the write with a Persian error.
--
-- It was never enforced by the database, though. The check and the insert are
-- two separate statements with no transaction between them, so two concurrent
-- requests both see no existing row and both write one. Snapshots are
-- append-only by contract — nothing ever corrects the result — so the
-- duplicates accumulate and every later read picks between them by whatever
-- order the plan happens to produce.
--
-- The indexes exist in src/db/init-schema.ts, which is how tests get them, so
-- the suite has been rejecting duplicates that production accepts. This closes
-- that gap in the direction that makes the promise true.

-- Collapse any row that already violates the rule before the constraint is
-- created, or the migration would fail on exactly the databases that need it.
-- The surviving row is the newest one written for that day: a later snapshot
-- is a correction of an earlier one, and it is what the read paths in
-- src/features/portfolio/service.ts already prefer
-- (ORDER BY snapshot_date DESC, created_at DESC).
DELETE FROM vehicle_valuation_snapshots a
 USING vehicle_valuation_snapshots b
 WHERE a.snapshot_date = b.snapshot_date
   AND a.user_vehicle_id IS NOT NULL
   AND a.user_vehicle_id = b.user_vehicle_id
   AND (a.created_at, a.id) < (b.created_at, b.id);--> statement-breakpoint

DELETE FROM vehicle_valuation_snapshots a
 USING vehicle_valuation_snapshots b
 WHERE a.snapshot_date = b.snapshot_date
   AND a.user_vehicle_id IS NULL
   AND b.user_vehicle_id IS NULL
   AND a.vehicle_catalog_id = b.vehicle_catalog_id
   AND (a.created_at, a.id) < (b.created_at, b.id);--> statement-breakpoint

-- Two partial indexes rather than one: a row is EITHER a market-level snapshot
-- of a model (user_vehicle_id IS NULL) or one user's specific car. A single
-- index over both columns would not constrain the market-level rows at all,
-- because NULL is never equal to NULL in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS vehicle_valuation_catalog_date_uq
    ON vehicle_valuation_snapshots (vehicle_catalog_id, snapshot_date)
 WHERE user_vehicle_id IS NULL;--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_valuation_vehicle_date_uq
    ON vehicle_valuation_snapshots (user_vehicle_id, snapshot_date)
 WHERE user_vehicle_id IS NOT NULL;
