-- Production schema hardening (structural, idempotent).
--
-- Everything in this migration is DATABASE STRUCTURE (append-only guards).
-- It deliberately contains NO data migration: no recalculation, no rewrites,
-- and no touching of journal_entries / postings / lots / lot_consumptions /
-- accounts / transactions. Accounting data is never migrated or re-derived.
--
-- These guards mirror the application-layer immutability contracts as a
-- second line of defence, and are required in production the same way they
-- are applied during local development.

-- ─── Analytics snapshots are append-only ───────────────────────────────────
CREATE OR REPLACE RULE prevent_update_analytics_runs AS ON UPDATE TO analytics_runs DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_delete_analytics_runs AS ON DELETE TO analytics_runs DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_update_wealth_performance AS ON UPDATE TO wealth_performance_snapshots DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_delete_wealth_performance AS ON DELETE TO wealth_performance_snapshots DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_update_asset_performance AS ON UPDATE TO asset_performance_analysis DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_delete_asset_performance AS ON DELETE TO asset_performance_analysis DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_update_risk_metrics AS ON UPDATE TO portfolio_risk_metrics DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_delete_risk_metrics AS ON DELETE TO portfolio_risk_metrics DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_update_benchmark_results AS ON UPDATE TO benchmark_results DO INSTEAD NOTHING;--> statement-breakpoint
CREATE OR REPLACE RULE prevent_delete_benchmark_results AS ON DELETE TO benchmark_results DO INSTEAD NOTHING;--> statement-breakpoint

-- ─── Vehicle valuation snapshots are immutable (trigger guard) ─────────────
CREATE OR REPLACE FUNCTION vehicle_valuation_snapshots_immutable()
   RETURNS trigger AS $$
 BEGIN
   RAISE EXCEPTION 'vehicle_valuation_snapshots is append-only: snapshots are immutable';
 END;
 $$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS vehicle_valuation_snapshots_no_update ON vehicle_valuation_snapshots;--> statement-breakpoint
CREATE TRIGGER vehicle_valuation_snapshots_no_update
   BEFORE UPDATE ON vehicle_valuation_snapshots
   FOR EACH ROW EXECUTE FUNCTION vehicle_valuation_snapshots_immutable();
