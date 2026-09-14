-- 0030_forward_market_price_tracking.sql
--
-- FORWARD-ONLY MARKET PRICE TRACKING.
-- Replaces the historical-dataset design of 0029. From the day tracking starts,
-- an admin records the reference price per m² of a neighborhood + property
-- type + size band. The USD rate of that date is frozen on the row, so Toman
-- AND dollar growth over 1m / 3m / 6m / 1y / 2y / … are computed only from
-- real forward observations — nothing is back-filled from past data.
--
-- Shared reference data (like cities/neighborhoods), never tenant data and
-- never accounting: no ledger link, no price row, no net-worth write.

CREATE TABLE IF NOT EXISTS "market_price_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"city_id" uuid NOT NULL,
	"neighborhood_id" uuid NOT NULL,
	"property_type_id" uuid NOT NULL,
	"area_band" text DEFAULT 'all' NOT NULL,
	"observed_on" date NOT NULL,
	"price_per_sqm_toman" numeric(38, 18) NOT NULL,
	"low_ppsqm_toman" numeric(38, 18),
	"high_ppsqm_toman" numeric(38, 18),
	"sample_count" integer,
	"usd_rate" numeric(38, 18) NOT NULL,
	"usd_rate_source" text,
	"usd_rate_date" date,
	"price_per_sqm_usd" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"recorded_by" uuid
);--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_property_type_id_property_types_id_fk" FOREIGN KEY ("property_type_id") REFERENCES "public"."property_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_price_snapshots" ADD CONSTRAINT "market_price_snapshots_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_price_segment_date_uq" ON "market_price_snapshots" USING btree ("neighborhood_id","property_type_id","area_band","observed_on");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_price_city_type_idx" ON "market_price_snapshots" USING btree ("city_id","property_type_id");--> statement-breakpoint

-- Closed-by-default like 0017/0029: server-side reads/writes only.
DO $$
BEGIN
  ALTER TABLE public.market_price_snapshots ENABLE ROW LEVEL SECURITY;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE public.market_price_snapshots FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE public.market_price_snapshots FROM authenticated;
  END IF;
END $$;--> statement-breakpoint

-- Retire the 0029 historical-dataset tables — ONLY when nothing was imported.
-- If rows exist they are kept untouched (unused) instead of being destroyed.
DO $$
BEGIN
  IF to_regclass('public.market_listing_observations') IS NOT NULL
     AND to_regclass('public.market_segment_snapshots') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.market_listing_observations)
     AND NOT EXISTS (SELECT 1 FROM public.market_segment_snapshots) THEN
    DROP TABLE public.market_segment_snapshots;
    DROP TABLE public.market_listing_observations;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'cities' AND column_name = 'market_slug')
     AND NOT EXISTS (SELECT 1 FROM public.cities WHERE market_slug IS NOT NULL) THEN
    ALTER TABLE public.cities DROP COLUMN market_slug;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'neighborhoods' AND column_name = 'market_slug')
     AND NOT EXISTS (SELECT 1 FROM public.neighborhoods WHERE market_slug IS NOT NULL) THEN
    ALTER TABLE public.neighborhoods DROP COLUMN market_slug;
  END IF;
END $$;
