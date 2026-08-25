CREATE TABLE "real_estate_valuation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"property_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"user_id" uuid,
	"snapshot_date" date NOT NULL,
	"snapshot_date_persian" text,
	"current_value_toman" numeric(38, 18) NOT NULL,
	"usd_rate" numeric(38, 18) NOT NULL,
	"usd_rate_source" text,
	"usd_rate_date" date,
	"current_value_usd" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "real_estate_valuation_snapshots" ADD CONSTRAINT "real_estate_valuation_snapshots_property_id_real_estate_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."real_estate_properties"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_valuation_snapshots" ADD CONSTRAINT "real_estate_valuation_snapshots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_valuation_snapshots" ADD CONSTRAINT "real_estate_valuation_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "real_estate_valuation_property_date_idx" ON "real_estate_valuation_snapshots" USING btree ("property_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "real_estate_valuation_user_idx" ON "real_estate_valuation_snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "real_estate_valuation_property_date_uq" ON "real_estate_valuation_snapshots" USING btree ("property_id","snapshot_date");