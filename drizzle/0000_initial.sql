CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" uuid,
	"asset_id" uuid,
	"wallet_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"run_type" text DEFAULT 'dashboard' NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"calculation_version" text DEFAULT 'v1.0' NOT NULL,
	"source_snapshot_reference" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_classes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#64748b' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"parent_id" uuid,
	"level" integer DEFAULT 0 NOT NULL,
	"attributes_schema" text,
	CONSTRAINT "asset_classes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "asset_performance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asset_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"starting_value" numeric(38, 18) NOT NULL,
	"ending_value" numeric(38, 18) NOT NULL,
	"absolute_change" numeric(38, 18) NOT NULL,
	"percentage_change" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_performance_analysis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"asset_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"starting_value" numeric(38, 18) NOT NULL,
	"ending_value" numeric(38, 18) NOT NULL,
	"absolute_change" numeric(38, 18) NOT NULL,
	"percentage_change" numeric(38, 18) NOT NULL,
	"contribution_percentage" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"class_id" uuid NOT NULL,
	"network_id" uuid,
	"currency_id" uuid,
	"decimals" integer DEFAULT 8 NOT NULL,
	"price_source" text DEFAULT 'manual' NOT NULL,
	"pricing_method" text DEFAULT 'manual' NOT NULL,
	"coingecko_id" text,
	"logo_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "assets_symbol_unique" UNIQUE("symbol"),
	CONSTRAINT "assets_coingecko_id_unique" UNIQUE("coingecko_id")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text,
	"result" text DEFAULT 'SUCCESS' NOT NULL,
	"request_id" text,
	"before_data" text,
	"after_data" text,
	"payload" text,
	"metadata" text
);
--> statement-breakpoint
CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text DEFAULT 'export' NOT NULL,
	"schema_version" text DEFAULT '1.0' NOT NULL,
	"row_count" integer DEFAULT 0 NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "benchmark_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"type" text DEFAULT 'crypto' NOT NULL,
	"description" text,
	CONSTRAINT "benchmark_definitions_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "benchmark_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"benchmark_asset_symbol" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"portfolio_return" numeric(38, 18) NOT NULL,
	"benchmark_return" numeric(38, 18) NOT NULL,
	"difference" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"benchmark_id" uuid NOT NULL,
	"snapshot_date" date NOT NULL,
	"price" numeric(38, 18) NOT NULL,
	"currency_id" uuid
);
--> statement-breakpoint
CREATE TABLE "budgets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"name" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"account_id" uuid,
	"amount_base" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "cities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "coingecko_asset_catalog" (
	"coingecko_id" text PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"logo_url" text NOT NULL,
	"market_cap_rank" integer,
	"kind" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commodity_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commodity_categories_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "commodity_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid,
	"default_unit" text DEFAULT 'piece' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commodity_items_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "commodity_price_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commodity_id" uuid NOT NULL,
	"unit_price" numeric(38, 18) NOT NULL,
	"unit" text DEFAULT 'piece' NOT NULL,
	"quantity" numeric(38, 18) DEFAULT '1' NOT NULL,
	"total_amount" numeric(38, 18) NOT NULL,
	"purchased_at" timestamp with time zone DEFAULT now() NOT NULL,
	"merchant_name" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" integer DEFAULT 2 NOT NULL,
	"is_fiat" boolean DEFAULT true NOT NULL,
	CONSTRAINT "currencies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "debts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"creditor" text NOT NULL,
	"title" text NOT NULL,
	"principal_base" numeric(38, 18) NOT NULL,
	"interest_rate" numeric(8, 4) DEFAULT '0' NOT NULL,
	"start_date" date NOT NULL,
	"account_id" uuid,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entry_fx_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entry_id" uuid NOT NULL,
	"irt_amount" numeric(38, 18) NOT NULL,
	"usd_amount" numeric(38, 18) NOT NULL,
	"fx_rate" numeric(38, 18) NOT NULL,
	"rate_source" text DEFAULT 'settings' NOT NULL,
	"rate_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entry_fx_snapshots_entry_id_unique" UNIQUE("entry_id")
);
--> statement-breakpoint
CREATE TABLE "entry_reviews" (
	"entry_id" uuid PRIMARY KEY NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_base" numeric(38, 18) NOT NULL,
	"is_paid" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"name" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"event_date" date NOT NULL,
	"budget_base" numeric(38, 18) NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "exchange_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"effective_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"parent_id" uuid,
	"level" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"nature" text DEFAULT 'cash' NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "funds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"target_base" numeric(38, 18) NOT NULL,
	"account_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "goal_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"goal_id" uuid NOT NULL,
	"entry_id" uuid,
	"amount_base" numeric(38, 18) NOT NULL,
	"occurred_at" date NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"name" text NOT NULL,
	"description" text,
	"target_base" numeric(38, 18) NOT NULL,
	"target_date" date,
	"priority" integer DEFAULT 2 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"fund_account_id" uuid
);
--> statement-breakpoint
CREATE TABLE "installments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"debt_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"due_date" date NOT NULL,
	"amount_base" numeric(38, 18) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_entry_id" uuid,
	"paid_at" date
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"country" text
);
--> statement-breakpoint
CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"entry_date" date NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"reference" text,
	"status" text DEFAULT 'posted' NOT NULL,
	"reversal_of" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"idempotency_key" text,
	"idempotency_hash" text,
	"category_id" uuid
);
--> statement-breakpoint
CREATE TABLE "lot_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lot_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"cost_base" numeric(38, 18) NOT NULL,
	"proceeds_base" numeric(38, 18) NOT NULL,
	"realized_pnl" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"open_entry_id" uuid NOT NULL,
	"opened_at" date NOT NULL,
	"qty_opened" numeric(38, 18) NOT NULL,
	"qty_remaining" numeric(38, 18) NOT NULL,
	"unit_cost_base" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "neighborhoods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"city_id" uuid NOT NULL,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "networks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"chain_type" text,
	"chain_id" integer,
	"rpc_url" text,
	"explorer_url" text,
	"is_evm" boolean DEFAULT true NOT NULL,
	"is_testnet" boolean DEFAULT false NOT NULL,
	CONSTRAINT "networks_code_unique" UNIQUE("code"),
	CONSTRAINT "networks_chain_id_unique" UNIQUE("chain_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"level" text DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"title" text NOT NULL,
	"amount_base" numeric(38, 18) NOT NULL,
	"due_date" date NOT NULL,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "planned_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"title" text NOT NULL,
	"planned_date" date NOT NULL,
	"direction" text NOT NULL,
	"amount_base" numeric(38, 18) NOT NULL,
	"from_account_id" uuid,
	"to_account_id" uuid,
	"asset_id" uuid,
	"recurrence" text DEFAULT 'none' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"executed_entry_id" uuid,
	"goal_id" uuid,
	"event_id" uuid,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "portfolio_risk_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"snapshot_date" date NOT NULL,
	"largest_asset_symbol" text,
	"largest_asset_percentage" numeric(38, 18) NOT NULL,
	"crypto_exposure_percentage" numeric(38, 18) NOT NULL,
	"max_drawdown_percentage" numeric(38, 18) NOT NULL,
	"risk_score" text DEFAULT 'moderate' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"snapshot_date" date NOT NULL,
	"total_portfolio_value" numeric(38, 18) NOT NULL,
	"base_currency_id" uuid
);
--> statement-breakpoint
CREATE TABLE "portfolio_valuations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"asset_id" uuid NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"market_price" numeric(38, 18) NOT NULL,
	"market_currency_id" uuid,
	"total_value" numeric(38, 18) NOT NULL,
	"valuation_date" date NOT NULL
);
--> statement-breakpoint
CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"base_value" numeric(38, 18) NOT NULL,
	"memo" text
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asset_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"price_base" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "property_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"name_fa" text NOT NULL,
	"name_en" text NOT NULL,
	"code" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "property_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "real_estate_properties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"asset_id" uuid NOT NULL,
	"user_id" uuid,
	"property_type" text DEFAULT 'apartment' NOT NULL,
	"city" text DEFAULT 'Ahvaz' NOT NULL,
	"area" text,
	"city_id" uuid,
	"neighborhood_id" uuid,
	"property_type_id" uuid,
	"address" text,
	"size_sqm" numeric(10, 2),
	"floor" integer,
	"year_built" integer,
	"deed_number" text,
	"notes" text,
	"acquisition_date" date,
	"acquisition_date_persian" text,
	"valuation_date" date,
	"valuation_date_persian" text,
	"system_entry_date" date,
	"is_historical" boolean DEFAULT false NOT NULL,
	"purchase_price_toman" numeric(38, 18),
	"purchase_fx_rate" numeric(38, 18),
	"purchase_fx_rate_source" text,
	"purchase_fx_rate_date" date,
	"purchase_value_usd" numeric(38, 18),
	"current_value_toman" numeric(38, 18),
	"valuation_fx_rate" numeric(38, 18),
	"valuation_fx_rate_source" text,
	"valuation_fx_rate_date" date,
	"current_value_usd" numeric(38, 18),
	"ledger_entry_id" uuid,
	CONSTRAINT "real_estate_properties_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "rwa_ownership_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"asset_id" uuid NOT NULL,
	"user_id" uuid,
	"ownership_percentage" numeric(5, 2) DEFAULT '100' NOT NULL,
	"ownership_type" text DEFAULT 'full' NOT NULL,
	"acquisition_date" date NOT NULL,
	"acquisition_price_irr" numeric(38, 18),
	"acquisition_price_usd" numeric(38, 18),
	"acquisition_currency_id" uuid,
	"debt_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "rwa_valuation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asset_id" uuid NOT NULL,
	"user_id" uuid,
	"valuation_date" date NOT NULL,
	"price_irr" numeric(38, 18),
	"price_usd" numeric(38, 18),
	"price_base" numeric(38, 18),
	"currency_id" uuid,
	"valuation_source" text DEFAULT 'manual' NOT NULL,
	"appraiser" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "snapshot_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"quantity" numeric(38, 18) NOT NULL,
	"price_base" numeric(38, 18) NOT NULL,
	"value_base" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"as_of" date NOT NULL,
	"base_currency" text DEFAULT 'USD' NOT NULL,
	"total_assets" numeric(38, 18) NOT NULL,
	"total_liabilities" numeric(38, 18) NOT NULL,
	"net_worth" numeric(38, 18) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_fx_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"current_rate" numeric(38, 18) DEFAULT '190000' NOT NULL,
	"last_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "user_fx_settings_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_setup_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"completed" boolean DEFAULT false NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"name" text NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"pin_hash" text,
	"username" text,
	"email" text,
	"password_hash" text,
	"google_id" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"asset_id" uuid NOT NULL,
	"user_id" uuid,
	"catalog_id" uuid,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"year" integer NOT NULL,
	"ownership_date" date,
	"purchase_price_toman" numeric(38, 18),
	"purchase_usd_rate" numeric(38, 18),
	"purchase_value_usd" numeric(38, 18),
	"license_plate" text,
	"chassis_number" text,
	"mileage" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"sale_date" date,
	"sale_price_toman" numeric(38, 18),
	"sale_usd_rate" numeric(38, 18),
	"sale_value_usd" numeric(38, 18),
	"notes" text,
	CONSTRAINT "vehicle_assets_asset_id_unique" UNIQUE("asset_id")
);
--> statement-breakpoint
CREATE TABLE "vehicle_brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"name" text NOT NULL,
	"brand_key" text NOT NULL,
	"name_en" text,
	"origin" text DEFAULT 'imported' NOT NULL,
	"allows_custom_model" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"brand_id" uuid NOT NULL,
	"model_name" text NOT NULL,
	"model_key" text NOT NULL,
	"model_year" integer,
	"manufacturer" text,
	"category" text,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "vehicle_valuation_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"vehicle_catalog_id" uuid NOT NULL,
	"user_vehicle_id" uuid,
	"snapshot_date" date NOT NULL,
	"current_value_toman" numeric(38, 18) NOT NULL,
	"usd_rate" numeric(38, 18) NOT NULL,
	"current_value_usd" numeric(38, 18) NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text,
	"created_by_user_id" uuid
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"user_id" uuid,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"institution_id" uuid,
	"network_id" uuid,
	"address" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "wealth_performance_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" uuid,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"starting_value" numeric(38, 18) NOT NULL,
	"ending_value" numeric(38, 18) NOT NULL,
	"absolute_change" numeric(38, 18) NOT NULL,
	"percentage_change" numeric(38, 18) NOT NULL,
	"currency_id" uuid
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_runs" ADD CONSTRAINT "analytics_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_performance" ADD CONSTRAINT "asset_performance_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_performance_analysis" ADD CONSTRAINT "asset_performance_analysis_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_performance_analysis" ADD CONSTRAINT "asset_performance_analysis_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_class_id_asset_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."asset_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_results" ADD CONSTRAINT "benchmark_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_snapshots" ADD CONSTRAINT "benchmark_snapshots_benchmark_id_benchmark_definitions_id_fk" FOREIGN KEY ("benchmark_id") REFERENCES "public"."benchmark_definitions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_snapshots" ADD CONSTRAINT "benchmark_snapshots_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_items" ADD CONSTRAINT "commodity_items_category_id_commodity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."commodity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commodity_price_records" ADD CONSTRAINT "commodity_price_records_commodity_id_commodity_items_id_fk" FOREIGN KEY ("commodity_id") REFERENCES "public"."commodity_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "debts" ADD CONSTRAINT "debts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_fx_snapshots" ADD CONSTRAINT "entry_fx_snapshots_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entry_reviews" ADD CONSTRAINT "entry_reviews_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_items" ADD CONSTRAINT "event_items_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_categories" ADD CONSTRAINT "expense_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "funds" ADD CONSTRAINT "funds_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_contributions" ADD CONSTRAINT "goal_contributions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_fund_account_id_accounts_id_fk" FOREIGN KEY ("fund_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "installments" ADD CONSTRAINT "installments_paid_entry_id_journal_entries_id_fk" FOREIGN KEY ("paid_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_lot_id_lots_id_fk" FOREIGN KEY ("lot_id") REFERENCES "public"."lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lots" ADD CONSTRAINT "lots_open_entry_id_journal_entries_id_fk" FOREIGN KEY ("open_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "neighborhoods" ADD CONSTRAINT "neighborhoods_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "obligations" ADD CONSTRAINT "obligations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_from_account_id_accounts_id_fk" FOREIGN KEY ("from_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_to_account_id_accounts_id_fk" FOREIGN KEY ("to_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_executed_entry_id_journal_entries_id_fk" FOREIGN KEY ("executed_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "planned_transactions" ADD CONSTRAINT "planned_transactions_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_risk_metrics" ADD CONSTRAINT "portfolio_risk_metrics_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_snapshots" ADD CONSTRAINT "portfolio_snapshots_base_currency_id_currencies_id_fk" FOREIGN KEY ("base_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_valuations" ADD CONSTRAINT "portfolio_valuations_market_currency_id_currencies_id_fk" FOREIGN KEY ("market_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_properties" ADD CONSTRAINT "real_estate_properties_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_properties" ADD CONSTRAINT "real_estate_properties_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_properties" ADD CONSTRAINT "real_estate_properties_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_properties" ADD CONSTRAINT "real_estate_properties_neighborhood_id_neighborhoods_id_fk" FOREIGN KEY ("neighborhood_id") REFERENCES "public"."neighborhoods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_properties" ADD CONSTRAINT "real_estate_properties_property_type_id_property_types_id_fk" FOREIGN KEY ("property_type_id") REFERENCES "public"."property_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "real_estate_properties" ADD CONSTRAINT "real_estate_properties_ledger_entry_id_journal_entries_id_fk" FOREIGN KEY ("ledger_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_ownership_records" ADD CONSTRAINT "rwa_ownership_records_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_ownership_records" ADD CONSTRAINT "rwa_ownership_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_ownership_records" ADD CONSTRAINT "rwa_ownership_records_acquisition_currency_id_currencies_id_fk" FOREIGN KEY ("acquisition_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_ownership_records" ADD CONSTRAINT "rwa_ownership_records_debt_id_debts_id_fk" FOREIGN KEY ("debt_id") REFERENCES "public"."debts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_valuation_events" ADD CONSTRAINT "rwa_valuation_events_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_valuation_events" ADD CONSTRAINT "rwa_valuation_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rwa_valuation_events" ADD CONSTRAINT "rwa_valuation_events_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_lines" ADD CONSTRAINT "snapshot_lines_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_lines" ADD CONSTRAINT "snapshot_lines_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_fx_settings" ADD CONSTRAINT "user_fx_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_setup_state" ADD CONSTRAINT "user_setup_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assets" ADD CONSTRAINT "vehicle_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assets" ADD CONSTRAINT "vehicle_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assets" ADD CONSTRAINT "vehicle_assets_catalog_id_vehicle_catalog_id_fk" FOREIGN KEY ("catalog_id") REFERENCES "public"."vehicle_catalog"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_catalog" ADD CONSTRAINT "vehicle_catalog_brand_id_vehicle_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."vehicle_brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_catalog" ADD CONSTRAINT "vehicle_catalog_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_valuation_snapshots" ADD CONSTRAINT "vehicle_valuation_snapshots_vehicle_catalog_id_vehicle_catalog_id_fk" FOREIGN KEY ("vehicle_catalog_id") REFERENCES "public"."vehicle_catalog"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_valuation_snapshots" ADD CONSTRAINT "vehicle_valuation_snapshots_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_network_id_networks_id_fk" FOREIGN KEY ("network_id") REFERENCES "public"."networks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wealth_performance_snapshots" ADD CONSTRAINT "wealth_performance_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wealth_performance_snapshots" ADD CONSTRAINT "wealth_performance_snapshots_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_user_code_uq" ON "accounts" USING btree ("user_id","code");--> statement-breakpoint
CREATE INDEX "accounts_user_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_user_type_idx" ON "accounts" USING btree ("user_id","type");--> statement-breakpoint
CREATE INDEX "accounts_type_idx" ON "accounts" USING btree ("type");--> statement-breakpoint
CREATE INDEX "accounts_asset_idx" ON "accounts" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "assets_class_idx" ON "assets" USING btree ("class_id");--> statement-breakpoint
CREATE INDEX "assets_coingecko_idx" ON "assets" USING btree ("coingecko_id");--> statement-breakpoint
CREATE INDEX "audit_log_user_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "benchmark_snapshots_uq" ON "benchmark_snapshots" USING btree ("benchmark_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "budgets_user_idx" ON "budgets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "cities_active_idx" ON "cities" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "coingecko_catalog_symbol_idx" ON "coingecko_asset_catalog" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "coingecko_catalog_kind_rank_idx" ON "coingecko_asset_catalog" USING btree ("kind","market_cap_rank");--> statement-breakpoint
CREATE INDEX "commodity_categories_name_idx" ON "commodity_categories" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commodity_items_name_idx" ON "commodity_items" USING btree ("name");--> statement-breakpoint
CREATE INDEX "commodity_items_category_idx" ON "commodity_items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "commodity_price_commodity_idx" ON "commodity_price_records" USING btree ("commodity_id");--> statement-breakpoint
CREATE INDEX "commodity_price_purchased_idx" ON "commodity_price_records" USING btree ("purchased_at");--> statement-breakpoint
CREATE INDEX "commodity_price_merchant_idx" ON "commodity_price_records" USING btree ("merchant_name");--> statement-breakpoint
CREATE INDEX "debts_user_idx" ON "debts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entry_fx_snap_entry_idx" ON "entry_fx_snapshots" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "events_user_idx" ON "events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "exchange_rates_pair_date_unique" ON "exchange_rates" USING btree ("base_currency","quote_currency","effective_date");--> statement-breakpoint
CREATE UNIQUE INDEX "expense_categories_user_code_uq" ON "expense_categories" USING btree ("user_id","code");--> statement-breakpoint
CREATE INDEX "expense_categories_parent_idx" ON "expense_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "expense_categories_user_idx" ON "expense_categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "funds_user_idx" ON "funds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "installments_due_idx" ON "installments" USING btree ("due_date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_user_idemp_uq" ON "journal_entries" USING btree ("user_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX "entries_date_idx" ON "journal_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "entries_type_idx" ON "journal_entries" USING btree ("type");--> statement-breakpoint
CREATE INDEX "entries_user_idx" ON "journal_entries" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "entries_user_date_idx" ON "journal_entries" USING btree ("user_id","entry_date");--> statement-breakpoint
CREATE INDEX "entries_category_idx" ON "journal_entries" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "lots_lookup_idx" ON "lots" USING btree ("asset_id","opened_at");--> statement-breakpoint
CREATE INDEX "lots_user_idx" ON "lots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "lots_user_asset_idx" ON "lots" USING btree ("user_id","asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "neighborhoods_city_code_uq" ON "neighborhoods" USING btree ("city_id","code");--> statement-breakpoint
CREATE INDEX "neighborhoods_city_active_idx" ON "neighborhoods" USING btree ("city_id","is_active");--> statement-breakpoint
CREATE INDEX "obligations_user_idx" ON "obligations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "planned_date_idx" ON "planned_transactions" USING btree ("planned_date","status");--> statement-breakpoint
CREATE INDEX "planned_user_idx" ON "planned_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_snapshots_asof_uq" ON "portfolio_snapshots" USING btree ("user_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "portfolio_valuations_date_idx" ON "portfolio_valuations" USING btree ("valuation_date");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_valuations_user_asset_date_uq" ON "portfolio_valuations" USING btree ("user_id","asset_id","valuation_date");--> statement-breakpoint
CREATE INDEX "postings_account_idx" ON "postings" USING btree ("account_id","entry_id");--> statement-breakpoint
CREATE INDEX "postings_asset_idx" ON "postings" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prices_asset_date_uq" ON "prices" USING btree ("asset_id","as_of");--> statement-breakpoint
CREATE INDEX "property_types_active_idx" ON "property_types" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "real_estate_properties_user_idx" ON "real_estate_properties" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "real_estate_properties_city_area_idx" ON "real_estate_properties" USING btree ("city","area");--> statement-breakpoint
CREATE INDEX "real_estate_properties_city_idx" ON "real_estate_properties" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "real_estate_properties_neighborhood_idx" ON "real_estate_properties" USING btree ("neighborhood_id");--> statement-breakpoint
CREATE INDEX "real_estate_properties_type_idx" ON "real_estate_properties" USING btree ("property_type_id");--> statement-breakpoint
CREATE INDEX "real_estate_properties_ledger_idx" ON "real_estate_properties" USING btree ("ledger_entry_id");--> statement-breakpoint
CREATE INDEX "rwa_ownership_asset_idx" ON "rwa_ownership_records" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "rwa_ownership_user_idx" ON "rwa_ownership_records" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "rwa_valuation_asset_date_idx" ON "rwa_valuation_events" USING btree ("asset_id","valuation_date");--> statement-breakpoint
CREATE INDEX "rwa_valuation_user_idx" ON "rwa_valuation_events" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rwa_valuation_user_asset_date_source_uq" ON "rwa_valuation_events" USING btree ("user_id","asset_id","valuation_date","valuation_source");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_token_idx" ON "sessions" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "snapshots_user_asof_uq" ON "snapshots" USING btree ("user_id","as_of");--> statement-breakpoint
CREATE INDEX "snapshots_user_idx" ON "snapshots" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_fx_settings_user_idx" ON "user_fx_settings" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_assets_user_idx" ON "vehicle_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "vehicle_assets_catalog_idx" ON "vehicle_assets" USING btree ("catalog_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_brands_key_uq" ON "vehicle_brands" USING btree ("brand_key");--> statement-breakpoint
CREATE INDEX "vehicle_catalog_brand_idx" ON "vehicle_catalog" USING btree ("brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_catalog_brand_model_uq" ON "vehicle_catalog" USING btree ("brand_id","model_key");--> statement-breakpoint
CREATE INDEX "vehicle_valuation_catalog_date_idx" ON "vehicle_valuation_snapshots" USING btree ("vehicle_catalog_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "vehicle_valuation_user_vehicle_idx" ON "vehicle_valuation_snapshots" USING btree ("user_vehicle_id");--> statement-breakpoint
CREATE INDEX "wallets_user_idx" ON "wallets" USING btree ("user_id");