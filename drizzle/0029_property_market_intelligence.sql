-- 0029_property_market_intelligence.sql
--
-- PROPERTY MARKET INTELLIGENCE — analytics layer only.
-- Sanitised public market evidence (asking prices) and robust segment
-- statistics. No user id, no ledger link, no price row: nothing here can move a
-- balance, a lot, a journal entry or net worth. A market estimate reaches a
-- property only through a valuation the user records.
--
-- Data minimisation: no phone, name, description, images or raw listing token
-- columns exist — only a sha256 of the source id.

ALTER TABLE "cities" ADD COLUMN IF NOT EXISTS "market_slug" text;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD COLUMN IF NOT EXISTS "market_slug" text;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "market_listing_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"source_ref_hash" text,
	"fingerprint" text NOT NULL,
	"city_slug" text NOT NULL,
	"neighborhood_slug" text,
	"property_type" text NOT NULL,
	"area_sqm" numeric(10, 2) NOT NULL,
	"construction_year" integer,
	"price_toman" numeric(38, 18) NOT NULL,
	"price_per_sqm_toman" numeric(38, 18) NOT NULL,
	"observed_month" date NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_obs_fingerprint_uq" ON "market_listing_observations" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_obs_source_idx" ON "market_listing_observations" USING btree ("source");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_obs_segment_idx" ON "market_listing_observations" USING btree ("city_slug","property_type","observed_month");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "market_segment_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"segment_key" text NOT NULL,
	"level" integer NOT NULL,
	"city_slug" text NOT NULL,
	"neighborhood_slug" text,
	"property_type" text NOT NULL,
	"area_band" text NOT NULL,
	"year_band" text NOT NULL,
	"period_end" date NOT NULL,
	"window_months" integer NOT NULL,
	"sample_raw" integer NOT NULL,
	"sample_valid" integer NOT NULL,
	"median_ppsqm" numeric(38, 18) NOT NULL,
	"mean_ppsqm" numeric(38, 18) NOT NULL,
	"p25_ppsqm" numeric(38, 18) NOT NULL,
	"p75_ppsqm" numeric(38, 18) NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "market_snap_segment_period_uq" ON "market_segment_snapshots" USING btree ("source","segment_key","period_end","window_months");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_snap_key_idx" ON "market_segment_snapshots" USING btree ("segment_key");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "market_snap_city_type_idx" ON "market_segment_snapshots" USING btree ("city_slug","property_type","level");--> statement-breakpoint

-- Same closed-by-default posture as 0017: the tables are read by the server
-- only; the Supabase Data API gets no access and no policy.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['market_listing_observations','market_segment_snapshots'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM authenticated', t);
    END IF;
  END LOOP;
END $$;
