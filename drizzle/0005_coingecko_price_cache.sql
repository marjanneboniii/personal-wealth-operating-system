CREATE TABLE "coingecko_price_cache" (
	"coingecko_id" text PRIMARY KEY NOT NULL,
	"price_usd" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "coingecko_price_cache_updated_idx" ON "coingecko_price_cache" USING btree ("updated_at");