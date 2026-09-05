import { sql } from "drizzle-orm";
import { db } from "@/db";
import { isMemoryUrl } from "@/db/config";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    role text NOT NULL DEFAULT 'user',
    pin_hash text
  );`,
  `CREATE TABLE IF NOT EXISTS currencies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    symbol text NOT NULL,
    decimals integer NOT NULL DEFAULT 2,
    is_fiat boolean NOT NULL DEFAULT true
  );`,
  `CREATE TABLE IF NOT EXISTS asset_classes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    color text NOT NULL DEFAULT '#8b8da6',
    sort_order integer NOT NULL DEFAULT 0,
    parent_id uuid,
    level integer NOT NULL DEFAULT 0,
    attributes_schema text
  );`,
  `CREATE TABLE IF NOT EXISTS networks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    chain_type text,
    chain_id integer UNIQUE,
    rpc_url text,
    explorer_url text,
    is_evm boolean NOT NULL DEFAULT true,
    is_testnet boolean NOT NULL DEFAULT false
  );`,
  `ALTER TABLE asset_classes ADD COLUMN IF NOT EXISTS parent_id uuid;`,
  `ALTER TABLE asset_classes ADD COLUMN IF NOT EXISTS level integer NOT NULL DEFAULT 0;`,
  `ALTER TABLE asset_classes ADD COLUMN IF NOT EXISTS attributes_schema text;`,
  `ALTER TABLE networks ADD COLUMN IF NOT EXISTS chain_id integer UNIQUE;`,
  `ALTER TABLE networks ADD COLUMN IF NOT EXISTS rpc_url text;`,
  `ALTER TABLE networks ADD COLUMN IF NOT EXISTS explorer_url text;`,
  `ALTER TABLE networks ADD COLUMN IF NOT EXISTS is_evm boolean NOT NULL DEFAULT true;`,
  `ALTER TABLE networks ADD COLUMN IF NOT EXISTS is_testnet boolean NOT NULL DEFAULT false;`,
  `CREATE TABLE IF NOT EXISTS institutions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    kind text NOT NULL,
    name text NOT NULL,
    country text
  );`,
  `CREATE TABLE IF NOT EXISTS assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    symbol text NOT NULL UNIQUE,
    name text NOT NULL,
    class_id uuid NOT NULL REFERENCES asset_classes(id),
    network_id uuid REFERENCES networks(id),
    currency_id uuid REFERENCES currencies(id),
    decimals integer NOT NULL DEFAULT 8,
    price_source text NOT NULL DEFAULT 'manual',
    pricing_method text NOT NULL DEFAULT 'manual',
    coingecko_id text UNIQUE,
    logo_url text,
    is_active boolean NOT NULL DEFAULT true
  );`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS pricing_method text NOT NULL DEFAULT 'manual';`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS coingecko_id text;`,
  `ALTER TABLE assets ADD COLUMN IF NOT EXISTS logo_url text;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS assets_coingecko_uq ON assets(coingecko_id) WHERE coingecko_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS assets_coingecko_idx ON assets(coingecko_id);`,
  // Existing canonical assets receive identity mappings only. Historical
  // prices, transactions, lots and cost basis are not touched.
  `UPDATE assets SET pricing_method='coingecko', coingecko_id='bitcoin' WHERE symbol='BTC' AND coingecko_id IS NULL;`,
  `UPDATE assets SET pricing_method='coingecko', coingecko_id='ethereum' WHERE symbol='ETH' AND coingecko_id IS NULL;`,
  `UPDATE assets SET pricing_method='coingecko', coingecko_id='tether' WHERE symbol='USDT' AND coingecko_id IS NULL;`,
  `UPDATE assets SET pricing_method='coingecko', coingecko_id='solana' WHERE symbol='SOL' AND coingecko_id IS NULL;`,
  `CREATE TABLE IF NOT EXISTS wallets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    kind text NOT NULL,
    institution_id uuid REFERENCES institutions(id),
    network_id uuid REFERENCES networks(id),
    address text,
    note text
  );`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    code text NOT NULL,
    name text NOT NULL,
    type text NOT NULL,
    parent_id uuid,
    asset_id uuid REFERENCES assets(id),
    wallet_id uuid REFERENCES wallets(id),
    is_active boolean NOT NULL DEFAULT true
  );`,
  // Parent/header Chart-of-Accounts rows (1000, 2000, 3000, 4000, 5000) carry
  // no instrument or wallet, so asset_id/wallet_id must remain nullable.
  `ALTER TABLE accounts ALTER COLUMN asset_id DROP NOT NULL;`,
  `ALTER TABLE accounts ALTER COLUMN wallet_id DROP NOT NULL;`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    entry_date date NOT NULL,
    type text NOT NULL,
    description text NOT NULL,
    reference text,
    status text NOT NULL DEFAULT 'posted',
    reversal_of uuid,
    source text NOT NULL DEFAULT 'manual'
  );`,
  `CREATE TABLE IF NOT EXISTS postings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES accounts(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    quantity numeric(38,18) NOT NULL,
    base_value numeric(38,18) NOT NULL,
    memo text
  );`,
  `CREATE TABLE IF NOT EXISTS lots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    account_id uuid NOT NULL REFERENCES accounts(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    open_entry_id uuid NOT NULL REFERENCES journal_entries(id),
    opened_at date NOT NULL,
    qty_opened numeric(38,18) NOT NULL,
    qty_remaining numeric(38,18) NOT NULL,
    unit_cost_base numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS lot_consumptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    lot_id uuid NOT NULL REFERENCES lots(id),
    entry_id uuid NOT NULL REFERENCES journal_entries(id),
    quantity numeric(38,18) NOT NULL,
    cost_base numeric(38,18) NOT NULL,
    proceeds_base numeric(38,18) NOT NULL,
    realized_pnl numeric(38,18) NOT NULL
  );`,
    `CREATE TABLE IF NOT EXISTS entry_fx_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id uuid NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE UNIQUE,
    irt_amount numeric(38,18) NOT NULL,
    usd_amount numeric(38,18) NOT NULL,
    fx_rate numeric(38,18) NOT NULL,
    rate_source text NOT NULL DEFAULT 'settings',
    rate_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS entry_fx_snap_entry_idx ON entry_fx_snapshots(entry_id);`,

  `CREATE TABLE IF NOT EXISTS prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    asset_id uuid NOT NULL REFERENCES assets(id),
    as_of date NOT NULL,
    price_base numeric(38,18) NOT NULL,
    source text NOT NULL DEFAULT 'manual',
    CONSTRAINT prices_asset_date_uq UNIQUE (asset_id, as_of)
  );`,
  `CREATE TABLE IF NOT EXISTS portfolio_valuations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    quantity numeric(38,18) NOT NULL,
    market_price numeric(38,18) NOT NULL,
    market_currency_id uuid REFERENCES currencies(id),
    total_value numeric(38,18) NOT NULL,
    valuation_date date NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portfolio_valuations_user_asset_date_uq ON portfolio_valuations(user_id, asset_id, valuation_date);`,
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    snapshot_date date NOT NULL,
    total_portfolio_value numeric(38,18) NOT NULL,
    base_currency_id uuid REFERENCES currencies(id)
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portfolio_snapshots_asof_uq ON portfolio_snapshots(user_id, snapshot_date);`,
  `CREATE TABLE IF NOT EXISTS asset_performance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    asset_id uuid NOT NULL REFERENCES assets(id),
    period_start date NOT NULL,
    period_end date NOT NULL,
    starting_value numeric(38,18) NOT NULL,
    ending_value numeric(38,18) NOT NULL,
    absolute_change numeric(38,18) NOT NULL,
    percentage_change numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS wealth_performance_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    period_start date NOT NULL,
    period_end date NOT NULL,
    starting_value numeric(38,18) NOT NULL,
    ending_value numeric(38,18) NOT NULL,
    absolute_change numeric(38,18) NOT NULL,
    percentage_change numeric(38,18) NOT NULL,
    currency_id uuid REFERENCES currencies(id)
  );`,
  `CREATE TABLE IF NOT EXISTS asset_performance_analysis (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    period_start date NOT NULL,
    period_end date NOT NULL,
    starting_value numeric(38,18) NOT NULL,
    ending_value numeric(38,18) NOT NULL,
    absolute_change numeric(38,18) NOT NULL,
    percentage_change numeric(38,18) NOT NULL,
    contribution_percentage numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS portfolio_risk_metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    snapshot_date date NOT NULL,
    largest_asset_symbol text,
    largest_asset_percentage numeric(38,18) NOT NULL,
    crypto_exposure_percentage numeric(38,18) NOT NULL,
    max_drawdown_percentage numeric(38,18) NOT NULL,
    risk_score text NOT NULL DEFAULT 'moderate'
  );`,
  `CREATE TABLE IF NOT EXISTS benchmark_definitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL,
    symbol text NOT NULL UNIQUE,
    type text NOT NULL DEFAULT 'crypto',
    description text
  );`,
  `CREATE TABLE IF NOT EXISTS benchmark_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    benchmark_id uuid NOT NULL REFERENCES benchmark_definitions(id) ON DELETE CASCADE,
    snapshot_date date NOT NULL,
    price numeric(38,18) NOT NULL,
    currency_id uuid REFERENCES currencies(id),
    CONSTRAINT benchmark_snapshots_uq UNIQUE (benchmark_id, snapshot_date)
  );`,
  `CREATE TABLE IF NOT EXISTS benchmark_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    benchmark_asset_symbol text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    portfolio_return numeric(38,18) NOT NULL,
    benchmark_return numeric(38,18) NOT NULL,
    difference numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS analytics_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    run_type text NOT NULL DEFAULT 'dashboard',
    period_start date NOT NULL,
    period_end date NOT NULL,
    calculation_version text NOT NULL DEFAULT 'v1.0',
    source_snapshot_reference text,
    generated_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE OR REPLACE RULE prevent_update_analytics_runs AS ON UPDATE TO analytics_runs DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_delete_analytics_runs AS ON DELETE TO analytics_runs DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_update_wealth_performance AS ON UPDATE TO wealth_performance_snapshots DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_delete_wealth_performance AS ON DELETE TO wealth_performance_snapshots DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_update_asset_performance AS ON UPDATE TO asset_performance_analysis DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_delete_asset_performance AS ON DELETE TO asset_performance_analysis DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_update_risk_metrics AS ON UPDATE TO portfolio_risk_metrics DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_delete_risk_metrics AS ON DELETE TO portfolio_risk_metrics DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_update_benchmark_results AS ON UPDATE TO benchmark_results DO INSTEAD NOTHING;`,
  `CREATE OR REPLACE RULE prevent_delete_benchmark_results AS ON DELETE TO benchmark_results DO INSTEAD NOTHING;`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    as_of date NOT NULL UNIQUE,
    base_currency text NOT NULL DEFAULT 'USD',
    total_assets numeric(38,18) NOT NULL,
    total_liabilities numeric(38,18) NOT NULL,
    net_worth numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS snapshot_lines (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    snapshot_id uuid NOT NULL REFERENCES snapshots(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL REFERENCES assets(id),
    quantity numeric(38,18) NOT NULL,
    price_base numeric(38,18) NOT NULL,
    value_base numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS goals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    description text,
    target_base numeric(38,18) NOT NULL,
    target_date date,
    priority integer NOT NULL DEFAULT 2,
    status text NOT NULL DEFAULT 'active',
    fund_account_id uuid REFERENCES accounts(id)
  );`,
  `CREATE TABLE IF NOT EXISTS goal_contributions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    goal_id uuid NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    entry_id uuid REFERENCES journal_entries(id),
    amount_base numeric(38,18) NOT NULL,
    occurred_at date NOT NULL,
    note text
  );`,
  `CREATE TABLE IF NOT EXISTS events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    category text NOT NULL DEFAULT 'other',
    event_date date NOT NULL,
    budget_base numeric(38,18) NOT NULL,
    status text NOT NULL DEFAULT 'planned',
    note text
  );`,
  `CREATE TABLE IF NOT EXISTS event_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title text NOT NULL,
    amount_base numeric(38,18) NOT NULL,
    is_paid boolean NOT NULL DEFAULT false
  );`,
  `CREATE TABLE IF NOT EXISTS budgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    account_id uuid REFERENCES accounts(id),
    amount_base numeric(38,18) NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS planned_transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    title text NOT NULL,
    planned_date date NOT NULL,
    direction text NOT NULL,
    amount_base numeric(38,18) NOT NULL,
    from_account_id uuid REFERENCES accounts(id),
    to_account_id uuid REFERENCES accounts(id),
    asset_id uuid REFERENCES assets(id),
    recurrence text NOT NULL DEFAULT 'none',
    status text NOT NULL DEFAULT 'pending',
    executed_entry_id uuid REFERENCES journal_entries(id),
    goal_id uuid REFERENCES goals(id),
    event_id uuid REFERENCES events(id),
    note text
  );`,
  `CREATE TABLE IF NOT EXISTS debts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    creditor text NOT NULL,
    title text NOT NULL,
    principal_base numeric(38,18) NOT NULL,
    interest_rate numeric(8,4) NOT NULL DEFAULT 0,
    start_date date NOT NULL,
    account_id uuid REFERENCES accounts(id),
    status text NOT NULL DEFAULT 'active'
  );`,
  `CREATE TABLE IF NOT EXISTS installments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    debt_id uuid NOT NULL REFERENCES debts(id) ON DELETE CASCADE,
    seq integer NOT NULL,
    due_date date NOT NULL,
    amount_base numeric(38,18) NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    paid_entry_id uuid REFERENCES journal_entries(id),
    paid_at date
  );`,
  `CREATE TABLE IF NOT EXISTS obligations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    title text NOT NULL,
    amount_base numeric(38,18) NOT NULL,
    due_date date NOT NULL,
    recurrence text NOT NULL DEFAULT 'none',
    status text NOT NULL DEFAULT 'pending',
    note text
  );`,
  `CREATE TABLE IF NOT EXISTS funds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    kind text NOT NULL,
    target_base numeric(38,18) NOT NULL,
    account_id uuid REFERENCES accounts(id),
    note text
  );`,
  `CREATE TABLE IF NOT EXISTS settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    key text NOT NULL UNIQUE,
    value text NOT NULL
  );`,
  `CREATE TABLE IF NOT EXISTS notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    title text NOT NULL,
    body text,
    level text NOT NULL DEFAULT 'info',
    read_at timestamptz
  );`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    payload text
  );`,
  `CREATE TABLE IF NOT EXISTS entry_reviews (
    entry_id uuid PRIMARY KEY REFERENCES journal_entries(id) ON DELETE CASCADE,
    reviewed_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS user_setup_state (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id),
    completed boolean NOT NULL DEFAULT false,
    current_step integer NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE TABLE IF NOT EXISTS backup_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    kind text NOT NULL DEFAULT 'export',
    schema_version text NOT NULL DEFAULT '1.0',
    row_count integer NOT NULL DEFAULT 0,
    note text
  );`,
  /* Scenario Engine — isolated tables *//* Asset Registry Extension — Multi-Chain */

  /* Wallet Identity Layer — Separate from accounting wallets *//* External Asset Discovery — Quarantine *//* Observation Layer — DeBank, Zerion, RPC Read-Only Cache *//* Reconciliation Engine — Reporting Only *//* RWA Domain — Identity, Ownership, Valuation Separation */
  /* Real Estate Master Data — extensible reference tables (not hard-coded) */
  `CREATE TABLE IF NOT EXISTS cities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name_fa text NOT NULL,
    name_en text NOT NULL,
    code text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
  );`,
  `CREATE INDEX IF NOT EXISTS cities_active_idx ON cities(is_active);`,

  `CREATE TABLE IF NOT EXISTS neighborhoods (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
    name_fa text NOT NULL,
    name_en text NOT NULL,
    code text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS neighborhoods_city_code_uq ON neighborhoods(city_id, code);`,
  `CREATE INDEX IF NOT EXISTS neighborhoods_city_active_idx ON neighborhoods(city_id, is_active);`,

  `CREATE TABLE IF NOT EXISTS property_types (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name_fa text NOT NULL,
    name_en text NOT NULL,
    code text NOT NULL UNIQUE,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
  );`,
  `CREATE INDEX IF NOT EXISTS property_types_active_idx ON property_types(is_active);`,

  `CREATE TABLE IF NOT EXISTS real_estate_properties (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE UNIQUE,
    user_id uuid REFERENCES users(id),
    property_type text NOT NULL DEFAULT 'apartment',
    city text NOT NULL DEFAULT 'Ahvaz',
    area text,
    address text,
    size_sqm numeric(10,2),
    floor integer,
    year_built integer,
    deed_number text,
    notes text
  );`,
  `CREATE INDEX IF NOT EXISTS real_estate_properties_user_idx ON real_estate_properties(user_id);`,
  `CREATE INDEX IF NOT EXISTS real_estate_properties_city_area_idx ON real_estate_properties(city, area);`,
  /* Real estate module — additive migration (master data FKs, financials, ledger link) */
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS city_id uuid REFERENCES cities(id);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS neighborhood_id uuid REFERENCES neighborhoods(id);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS property_type_id uuid REFERENCES property_types(id);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS acquisition_date date;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS acquisition_date_persian text;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS valuation_date date;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS valuation_date_persian text;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS system_entry_date date;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS purchase_price_toman numeric(38,18);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS purchase_fx_rate numeric(38,18);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS purchase_fx_rate_source text;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS purchase_fx_rate_date date;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS purchase_value_usd numeric(38,18);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS current_value_toman numeric(38,18);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS valuation_fx_rate numeric(38,18);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS valuation_fx_rate_source text;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS valuation_fx_rate_date date;`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS current_value_usd numeric(38,18);`,
  `ALTER TABLE real_estate_properties ADD COLUMN IF NOT EXISTS ledger_entry_id uuid REFERENCES journal_entries(id);`,
  `CREATE INDEX IF NOT EXISTS real_estate_properties_city_idx ON real_estate_properties(city_id);`,
  `CREATE INDEX IF NOT EXISTS real_estate_properties_neighborhood_idx ON real_estate_properties(neighborhood_id);`,
  `CREATE INDEX IF NOT EXISTS real_estate_properties_type_idx ON real_estate_properties(property_type_id);`,
  `CREATE INDEX IF NOT EXISTS real_estate_properties_ledger_idx ON real_estate_properties(ledger_entry_id);`,

  /* Real estate valuation snapshots — IMMUTABLE append-only history of every
     valuation (Toman value + frozen USD rate + USD value per snapshot date).
     Mirrors vehicle_valuation_snapshots; one snapshot per property per day,
     enforced by a unique index. Existing snapshots are never updated. */
  `CREATE TABLE IF NOT EXISTS real_estate_valuation_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    property_id uuid NOT NULL REFERENCES real_estate_properties(id) ON DELETE CASCADE,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id),
    snapshot_date date NOT NULL,
    snapshot_date_persian text,
    current_value_toman numeric(38,18) NOT NULL,
    usd_rate numeric(38,18) NOT NULL,
    usd_rate_source text,
    usd_rate_date date,
    current_value_usd numeric(38,18) NOT NULL,
    source text NOT NULL DEFAULT 'manual',
    note text
  );`,
  `CREATE INDEX IF NOT EXISTS real_estate_valuation_property_date_idx ON real_estate_valuation_snapshots(property_id, snapshot_date);`,
  `CREATE INDEX IF NOT EXISTS real_estate_valuation_user_idx ON real_estate_valuation_snapshots(user_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS real_estate_valuation_property_date_uq ON real_estate_valuation_snapshots(property_id, snapshot_date);`,

  /* Vehicle module — Catalog (Brand -> Model), immutable valuation snapshots,
     and the user's own vehicle (kept in the pre-existing vehicle_assets table
     so existing asset ids, portfolio links and routes stay valid). */
  `CREATE TABLE IF NOT EXISTS vehicle_brands (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    name text NOT NULL,
    brand_key text NOT NULL,
    name_en text,
    origin text NOT NULL DEFAULT 'imported',
    allows_custom_model boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    sort_order integer NOT NULL DEFAULT 0
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vehicle_brands_key_uq ON vehicle_brands(brand_key);`,

  `CREATE TABLE IF NOT EXISTS vehicle_catalog (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    brand_id uuid NOT NULL REFERENCES vehicle_brands(id) ON DELETE CASCADE,
    model_name text NOT NULL,
    model_key text NOT NULL,
    model_year integer,
    manufacturer text,
    category text,
    description text,
    is_active boolean NOT NULL DEFAULT true,
    created_by_user_id uuid REFERENCES users(id)
  );`,
  `CREATE INDEX IF NOT EXISTS vehicle_catalog_brand_idx ON vehicle_catalog(brand_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vehicle_catalog_brand_model_uq ON vehicle_catalog(brand_id, model_key);`,

  `CREATE TABLE IF NOT EXISTS vehicle_valuation_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    vehicle_catalog_id uuid NOT NULL REFERENCES vehicle_catalog(id) ON DELETE CASCADE,
    user_vehicle_id uuid,
    snapshot_date date NOT NULL,
    current_value_toman numeric(38,18) NOT NULL,
    usd_rate numeric(38,18) NOT NULL,
    current_value_usd numeric(38,18) NOT NULL,
    source text NOT NULL DEFAULT 'manual',
    note text,
    created_by_user_id uuid REFERENCES users(id)
  );`,
  `CREATE INDEX IF NOT EXISTS vehicle_valuation_catalog_date_idx ON vehicle_valuation_snapshots(vehicle_catalog_id, snapshot_date);`,
  `CREATE INDEX IF NOT EXISTS vehicle_valuation_user_vehicle_idx ON vehicle_valuation_snapshots(user_vehicle_id);`,
  /* One snapshot per model per day (market level) and per car per day (vehicle level). */
  `CREATE UNIQUE INDEX IF NOT EXISTS vehicle_valuation_catalog_date_uq
     ON vehicle_valuation_snapshots(vehicle_catalog_id, snapshot_date)
     WHERE user_vehicle_id IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vehicle_valuation_vehicle_date_uq
     ON vehicle_valuation_snapshots(user_vehicle_id, snapshot_date)
     WHERE user_vehicle_id IS NOT NULL;`,

  `CREATE TABLE IF NOT EXISTS vehicle_assets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE UNIQUE,
    user_id uuid REFERENCES users(id),
    brand text NOT NULL,
    model text NOT NULL,
    year integer NOT NULL,
    license_plate text,
    chassis_number text,
    mileage integer,
    notes text
  );`,
  `CREATE INDEX IF NOT EXISTS vehicle_assets_user_idx ON vehicle_assets(user_id);`,
  /* Vehicle investment fields — additive migration on the existing table. */
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS catalog_id uuid REFERENCES vehicle_catalog(id);`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS ownership_date date;`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS purchase_price_toman numeric(38,18);`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS purchase_usd_rate numeric(38,18);`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS purchase_value_usd numeric(38,18);`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS sale_date date;`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS sale_price_toman numeric(38,18);`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS sale_usd_rate numeric(38,18);`,
  `ALTER TABLE vehicle_assets ADD COLUMN IF NOT EXISTS sale_value_usd numeric(38,18);`,
  `CREATE INDEX IF NOT EXISTS vehicle_assets_catalog_idx ON vehicle_assets(catalog_id);`,

  `CREATE TABLE IF NOT EXISTS rwa_ownership_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id),
    ownership_percentage numeric(5,2) NOT NULL DEFAULT 100,
    ownership_type text NOT NULL DEFAULT 'full',
    acquisition_date date NOT NULL,
    acquisition_price_irr numeric(38,18),
    acquisition_price_usd numeric(38,18),
    acquisition_currency_id uuid REFERENCES currencies(id),
    debt_id uuid REFERENCES debts(id) ON DELETE SET NULL,
    is_active boolean NOT NULL DEFAULT true,
    notes text
  );`,
  `CREATE INDEX IF NOT EXISTS rwa_ownership_asset_idx ON rwa_ownership_records(asset_id);`,
  `CREATE INDEX IF NOT EXISTS rwa_ownership_user_idx ON rwa_ownership_records(user_id);`,

  `CREATE TABLE IF NOT EXISTS rwa_valuation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    valuation_date date NOT NULL,
    price_irr numeric(38,18),
    price_usd numeric(38,18),
    price_base numeric(38,18),
    currency_id uuid REFERENCES currencies(id),
    valuation_source text NOT NULL DEFAULT 'manual',
    appraiser text,
    note text,
    CONSTRAINT rwa_valuation_user_asset_date_source_uq UNIQUE (user_id, asset_id, valuation_date, valuation_source)
  );`,
  `ALTER TABLE rwa_valuation_events ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE rwa_valuation_events DROP CONSTRAINT IF EXISTS rwa_valuation_events_source_id_fkey;`,
  `ALTER TABLE rwa_valuation_events DROP CONSTRAINT IF EXISTS rwa_valuation_asset_date_source_uq;`,
  `DROP INDEX IF EXISTS rwa_valuation_asset_date_source_uq;`,
  `CREATE INDEX IF NOT EXISTS rwa_valuation_asset_date_idx ON rwa_valuation_events(asset_id, valuation_date);`,
  `CREATE INDEX IF NOT EXISTS rwa_valuation_user_idx ON rwa_valuation_events(user_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS rwa_valuation_user_asset_date_source_uq ON rwa_valuation_events(user_id, asset_id, valuation_date, valuation_source);`,
  // Safely assign only unambiguous legacy valuation rows. Ambiguous/ownerless
  // rows remain NULL and are not visible to authenticated tenants.
  `UPDATE rwa_valuation_events v
     SET user_id = o.user_id
    FROM rwa_ownership_records o
   WHERE v.user_id IS NULL
     AND o.asset_id = v.asset_id
     AND o.user_id IS NOT NULL
     AND o.is_active = true
     AND 1 = (SELECT count(DISTINCT o2.user_id) FROM rwa_ownership_records o2 WHERE o2.asset_id = v.asset_id AND o2.user_id IS NOT NULL);`,

  /* CoinGecko identity catalog — current prices are never persisted here. */
  `CREATE TABLE IF NOT EXISTS coingecko_asset_catalog (
    coingecko_id text PRIMARY KEY,
    symbol text NOT NULL,
    name text NOT NULL,
    logo_url text NOT NULL,
    market_cap_rank integer,
    kind text NOT NULL,
    is_active boolean NOT NULL DEFAULT true,
    synced_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS coingecko_catalog_symbol_idx ON coingecko_asset_catalog(symbol);`,
  `CREATE INDEX IF NOT EXISTS coingecko_catalog_kind_rank_idx ON coingecko_asset_catalog(kind, market_cap_rank);`,

  /*
   * Last-known CoinGecko market price cache (additive price resilience).
   * Market-level public price data only — no user or accounting rows. Used by
   * the valuation/picker layer to show a "stale" last-known price instead of
   * "unavailable" when the live CoinGecko request fails or is rate-limited.
   */
  `CREATE TABLE IF NOT EXISTS coingecko_price_cache (
    coingecko_id text PRIMARY KEY,
    price_usd text NOT NULL,
    observed_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS coingecko_price_cache_updated_idx ON coingecko_price_cache(updated_at);`,

  /* Commodities Domain — Dynamic Price Tracking & Inflation Analytics — Isolated, No FK to Financial Core
     0012 tenancy: user_id NULL = shared/global row (legacy + suggested catalog),
     set = owned by one tenant. Legacy UNIQUE(name) replaced by partial uniques. */
  `CREATE TABLE IF NOT EXISTS commodity_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `ALTER TABLE commodity_categories ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE commodity_categories DROP CONSTRAINT IF EXISTS commodity_categories_name_unique;`,
  `ALTER TABLE commodity_categories DROP CONSTRAINT IF EXISTS commodity_categories_name_key;`,
  `DROP INDEX IF EXISTS commodity_categories_name_unique;`,
  `CREATE INDEX IF NOT EXISTS commodity_categories_name_idx ON commodity_categories(name);`,
  `CREATE INDEX IF NOT EXISTS commodity_categories_user_idx ON commodity_categories(user_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commodity_categories_shared_name_uq ON commodity_categories(name) WHERE user_id IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commodity_categories_user_name_uq ON commodity_categories(user_id, name) WHERE user_id IS NOT NULL;`,

  `CREATE TABLE IF NOT EXISTS commodity_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    name text NOT NULL,
    category_id uuid REFERENCES commodity_categories(id) ON DELETE SET NULL,
    default_unit text NOT NULL DEFAULT 'piece',
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `ALTER TABLE commodity_items ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE commodity_items DROP CONSTRAINT IF EXISTS commodity_items_name_unique;`,
  `ALTER TABLE commodity_items DROP CONSTRAINT IF EXISTS commodity_items_name_key;`,
  `DROP INDEX IF EXISTS commodity_items_name_unique;`,
  `CREATE INDEX IF NOT EXISTS commodity_items_name_idx ON commodity_items(name);`,
  `CREATE INDEX IF NOT EXISTS commodity_items_category_idx ON commodity_items(category_id);`,
  `CREATE INDEX IF NOT EXISTS commodity_items_user_idx ON commodity_items(user_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commodity_items_shared_name_uq ON commodity_items(name) WHERE user_id IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS commodity_items_user_name_uq ON commodity_items(user_id, name) WHERE user_id IS NOT NULL;`,

  `CREATE TABLE IF NOT EXISTS commodity_price_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    commodity_id uuid NOT NULL REFERENCES commodity_items(id) ON DELETE CASCADE,
    unit_price numeric(38,18) NOT NULL,
    unit text NOT NULL DEFAULT 'piece',
    quantity numeric(38,18) NOT NULL DEFAULT 1,
    total_amount numeric(38,18) NOT NULL,
    purchased_at timestamptz NOT NULL DEFAULT now(),
    merchant_name text,
    region text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `ALTER TABLE commodity_price_records ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE commodity_price_records ADD COLUMN IF NOT EXISTS region text;`,
  `CREATE INDEX IF NOT EXISTS commodity_price_commodity_idx ON commodity_price_records(commodity_id);`,
  `CREATE INDEX IF NOT EXISTS commodity_price_purchased_idx ON commodity_price_records(purchased_at);`,
  `CREATE INDEX IF NOT EXISTS commodity_price_merchant_idx ON commodity_price_records(merchant_name);`,
  `CREATE INDEX IF NOT EXISTS commodity_price_user_idx ON commodity_price_records(user_id);`,

  /* FX Engine & Display Layer (Phase 2.6) — valuation reference data only */
  `CREATE TABLE IF NOT EXISTS exchange_rates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    base_currency text NOT NULL,
    quote_currency text NOT NULL,
    rate numeric(38,18) NOT NULL,
    source text NOT NULL DEFAULT 'manual',
    effective_date date NOT NULL
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS exchange_rates_pair_date_unique ON exchange_rates(base_currency, quote_currency, effective_date);`,

  /* External Market Data Provider Layer (Phase 2.7) — reference data only, no ledger FK */

  // ───────────── Auth & Per-User FX (new) ─────────────
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS username text UNIQUE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email text UNIQUE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id text UNIQUE;`,
  `ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified boolean NOT NULL DEFAULT false;`,
  `CREATE TABLE IF NOT EXISTS sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);`,
  `CREATE INDEX IF NOT EXISTS sessions_token_idx ON sessions(token);`,
  `CREATE TABLE IF NOT EXISTS user_fx_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    current_rate numeric(38,18) NOT NULL DEFAULT '190000',
    last_updated_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz
  );`,
  `CREATE INDEX IF NOT EXISTS user_fx_settings_user_idx ON user_fx_settings(user_id);`,
  // Per-user UI preferences — Global Pro Mode toggle (Directive §2).
  // One row per user; default is the SIMPLE (non-accounting) view.
  `CREATE TABLE IF NOT EXISTS user_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    pro_mode boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS user_preferences_user_idx ON user_preferences(user_id);`,

  // ───────────── STAGE 2: Multi-User Financial Data Isolation ─────────────
  `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE lots ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE wallets ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE goals ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE budgets ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE planned_transactions ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE debts ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  // Phase 3 — Debt/Installment contractual Toman amount (additive; nullable).
  `ALTER TABLE debts ADD COLUMN IF NOT EXISTS principal_toman numeric(38,18);`,
  `ALTER TABLE debts ADD COLUMN IF NOT EXISTS principal_usd_created numeric(38,18);`,
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS amount_toman numeric(38,18);`,
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS amount_usd_created numeric(38,18);`,
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS paid_toman numeric(38,18);`,
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS paid_usd numeric(38,18);`,
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS paid_fx_rate numeric(38,18);`,
  // Phase 6 — creation-time FX snapshot for a PENDING installment (additive;
  // nullable). Historical: it is never rewritten by a later rate.
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS original_fx_rate numeric(38,18);`,
  `ALTER TABLE installments ADD COLUMN IF NOT EXISTS original_fx_rate_captured_at timestamptz;`,
  // Deterministic, non-destructive backfill: the creation rate is recovered
  // from the two frozen creation-time figures already stored on the row
  // (amount_toman ÷ amount_usd_created). The CURRENT rate is never used, and
  // rows that already carry a value are left untouched.
  `UPDATE installments
     SET original_fx_rate = amount_toman / amount_usd_created,
         original_fx_rate_captured_at = created_at
   WHERE original_fx_rate IS NULL
     AND amount_toman IS NOT NULL
     AND amount_usd_created IS NOT NULL
     AND amount_usd_created > 0;`,
  `ALTER TABLE obligations ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE funds ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `ALTER TABLE snapshots ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,

  // Convert leftover global UNIQUE(code) to per-tenant UNIQUE(user_id, code).
  // Production Neon names the drizzle `.unique()` leftover `accounts_code_unique`;
  // raw SQL `code text UNIQUE` names it `accounts_code_key`. Drop both forms
  // (constraint and standalone index) so a second tenant can insert 1000.
  `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_code_key;`,
  `ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_code_unique;`,
  `DROP INDEX IF EXISTS accounts_code_key;`,
  `DROP INDEX IF EXISTS accounts_code_unique;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_code_uq ON accounts(user_id, code);`,
  `ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_as_of_key;`,
  `ALTER TABLE snapshots DROP CONSTRAINT IF EXISTS snapshots_asof_uq;`,
  `DROP INDEX IF EXISTS snapshots_asof_uq;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS snapshots_user_asof_uq ON snapshots(user_id, as_of);`,

  // Create indexes for per-user queries
  `CREATE INDEX IF NOT EXISTS accounts_user_idx ON accounts(user_id);`,
  `CREATE INDEX IF NOT EXISTS accounts_user_type_idx ON accounts(user_id, type);`,
  `CREATE INDEX IF NOT EXISTS entries_user_idx ON journal_entries(user_id);`,
  `CREATE INDEX IF NOT EXISTS entries_user_date_idx ON journal_entries(user_id, entry_date);`,
  `CREATE INDEX IF NOT EXISTS lots_user_idx ON lots(user_id);`,
  `CREATE INDEX IF NOT EXISTS lots_user_asset_idx ON lots(user_id, asset_id);`,
  `CREATE INDEX IF NOT EXISTS wallets_user_idx ON wallets(user_id);`,
  `CREATE INDEX IF NOT EXISTS goals_user_idx ON goals(user_id);`,
  `CREATE INDEX IF NOT EXISTS events_user_idx ON events(user_id);`,
  `CREATE INDEX IF NOT EXISTS budgets_user_idx ON budgets(user_id);`,
  `CREATE INDEX IF NOT EXISTS planned_user_idx ON planned_transactions(user_id);`,
  `CREATE INDEX IF NOT EXISTS debts_user_idx ON debts(user_id);`,
  `CREATE INDEX IF NOT EXISTS obligations_user_idx ON obligations(user_id);`,
  `CREATE INDEX IF NOT EXISTS funds_user_idx ON funds(user_id);`,
  `CREATE INDEX IF NOT EXISTS snapshots_user_idx ON snapshots(user_id);`,

  // ───────────── STAGE 3: Idempotency & Concurrency Safety ─────────────
  `ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS idempotency_key text;`,
  `ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS idempotency_hash text;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_user_idemp_uq ON journal_entries(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;`,

  // ───────────── STAGE 4: Audit Trail, Validation & Data Integrity ─────────────
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE SET NULL;`,
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS result text NOT NULL DEFAULT 'SUCCESS';`,
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS request_id text;`,
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS before_data text;`,
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS after_data text;`,
  `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS metadata text;`,
  `CREATE INDEX IF NOT EXISTS audit_log_user_idx ON audit_log(user_id);`,
  `CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log(action);`,
  `CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log(created_at);`,

  // ───────────── STAGE 5: Hierarchical Expense Category System ─────────────
  // Standard, extensible classification of expense entries (Parent-Child).
  // System catalog rows are shared (user_id NULL); users can add their own
  // sub-categories. Journal entries gain an OPTIONAL category_id reporting
  // dimension — the double-entry ledger is untouched by classification.
  `CREATE TABLE IF NOT EXISTS expense_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    code text NOT NULL,
    name text NOT NULL,
    name_en text,
    parent_id uuid,
    level integer NOT NULL DEFAULT 0,
    sort_order integer NOT NULL DEFAULT 0,
    nature text NOT NULL DEFAULT 'cash',
    description text,
    is_system boolean NOT NULL DEFAULT true,
    is_active boolean NOT NULL DEFAULT true
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_user_code_uq ON expense_categories(user_id, code);`,
  `CREATE INDEX IF NOT EXISTS expense_categories_parent_idx ON expense_categories(parent_id);`,
  `CREATE INDEX IF NOT EXISTS expense_categories_user_idx ON expense_categories(user_id);`,
  `ALTER TABLE journal_entries ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES expense_categories(id) ON DELETE SET NULL;`,
  `CREATE INDEX IF NOT EXISTS entries_category_idx ON journal_entries(category_id);`,

  // ───────────── FINAL SECURITY REMEDIATION: Portfolio Snapshot Isolation & Role Default ─────────────
  // Migrate portfolio_snapshots from single-date unique to (user_id, snapshot_date)
  `ALTER TABLE portfolio_snapshots DROP CONSTRAINT IF EXISTS portfolio_snapshots_snapshot_date_key;`,
  `ALTER TABLE portfolio_snapshots DROP CONSTRAINT IF EXISTS portfolio_snapshots_asof_uq;`,
  `DROP INDEX IF EXISTS portfolio_snapshots_snapshot_date_key;`,
  `DROP INDEX IF EXISTS portfolio_snapshots_asof_uq_old;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS portfolio_snapshots_asof_uq ON portfolio_snapshots(user_id, snapshot_date);`,
  // Portfolio valuations: ensure per-user isolation
  `CREATE UNIQUE INDEX IF NOT EXISTS portfolio_valuations_user_asset_date_uq ON portfolio_valuations(user_id, asset_id, valuation_date);`,
  // Role default: change DB default from owner to user (existing rows untouched)
  `ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`,

  /*
   * Legacy Market Data retirement (non-destructive production migration).
   *
   * Active names disappear from the runtime schema, but any production rows
   * are retained under explicit *_archive names. Row counts are emitted as
   * PostgreSQL NOTICEs before rename. No accounting table is included here.
   */
  `DO $$
   BEGIN
     IF to_regclass('public.valuation_events') IS NOT NULL THEN
       ALTER TABLE valuation_events DROP CONSTRAINT IF EXISTS valuation_events_source_id_fkey;
     END IF;
   END $$;`,
  `DO $$
   DECLARE
     source_name text;
     archive_name text;
     row_count bigint;
     legacy_names text[] := ARRAY[
       'market_prices',
       'market_snapshots',
       'market_price_sources',
       'coingecko_asset_mappings',
       'valuation_sources',
       'valuation_events',
       'external_price_history',
       'asset_provider_mappings',
       'external_providers',
       'wallet_observations',
       'user_display_preferences',
       'asset_networks',
       'asset_token_metadata',
       'import_records',
       'import_jobs'
     ];
   BEGIN
     FOREACH source_name IN ARRAY legacy_names LOOP
       archive_name := 'legacy_' || source_name || '_archive';
       IF to_regclass('public.' || source_name) IS NOT NULL
          AND to_regclass('public.' || archive_name) IS NULL THEN
         EXECUTE format('SELECT count(*) FROM %I', source_name) INTO row_count;
         RAISE NOTICE 'PWOS legacy market retirement: table=%, rows=%, action=archive', source_name, row_count;
         EXECUTE format('ALTER TABLE %I RENAME TO %I', source_name, archive_name);
       END IF;
     END LOOP;
   END $$;`,
];

/**
 * Transient network/connection failures (socket reset mid-query, serverless
 * cold starts, admin shutdowns). Drizzle wraps driver errors, so the real
 * code usually lives on `err.cause`. All schema statements are idempotent
 * (IF NOT EXISTS), so retrying them is safe.
 */
const TRANSIENT_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "08000", // connection_exception
  "08001", // sqlclient_unable_to_establish_sqlconnection
  "08003", // connection_does_not_exist
  "08006", // connection_failure
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
]);

function isTransientDbError(err: unknown): boolean {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { code?: string; errno?: string; message?: string; cause?: unknown };
    if (e.code && TRANSIENT_CODES.has(String(e.code))) return true;
    if (e.errno && TRANSIENT_CODES.has(String(e.errno))) return true;
    if (e.message && /connection (terminated|reset|refused)|socket hang up|read econnreset/i.test(e.message)) {
      return true;
    }
    cur = e.cause;
  }
  return false;
}

/**
 * Walk the `.cause` chain (Drizzle wraps driver errors in a generic
 * "Failed query: …" error) and return the deepest, most specific error —
 * that is what actually tells you WHY the query failed (connection refused,
 * missing database, auth failure, …).
 */
export function rootCauseOf(err: unknown): { message: string; code?: string } {
  const seen = new Set<unknown>();
  let cur: unknown = err;
  let last: { message?: string; code?: string } = {};
  while (cur && typeof cur === "object" && !seen.has(cur)) {
    seen.add(cur);
    const e = cur as { message?: string; code?: string; errno?: string; cause?: unknown };
    last = { message: e.message ?? last.message, code: e.code ?? e.errno ?? last.code };
    cur = e.cause;
  }
  return { message: last.message ?? String(err), code: last.code };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX_ATTEMPTS = 5;

/**
 * Best-effort hardening statements. They are applied when the database
 * supports them and silently skipped otherwise — never fatal for boot.
 *
 * Vehicle valuation snapshots are IMMUTABLE by contract (application layer)
 * and, where the engine allows it, by a database trigger as a second line of
 * defence: a stored snapshot can never be rewritten by an FX-rate change.
 */
const OPTIONAL_STATEMENTS = [
  `CREATE OR REPLACE FUNCTION vehicle_valuation_snapshots_immutable()
     RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION 'vehicle_valuation_snapshots is append-only: snapshots are immutable';
   END;
   $$ LANGUAGE plpgsql;`,
  `DROP TRIGGER IF EXISTS vehicle_valuation_snapshots_no_update ON vehicle_valuation_snapshots;`,
  `CREATE TRIGGER vehicle_valuation_snapshots_no_update
     BEFORE UPDATE ON vehicle_valuation_snapshots
     FOR EACH ROW EXECUTE FUNCTION vehicle_valuation_snapshots_immutable();`,
];

export async function createSchemaIfNotExists() {
  for (const stmt of STATEMENTS) {
    for (let attempt = 1; ; attempt++) {
      try {
        await db.execute(sql.raw(stmt));
        break;
      } catch (err) {
        if (attempt >= MAX_ATTEMPTS || !isTransientDbError(err)) throw err;
        console.warn(
          `[db] transient connection error during schema init (attempt ${attempt}/${MAX_ATTEMPTS}); retrying…`,
        );
        await sleep(400 * attempt);
      }
    }
  }
  for (const stmt of OPTIONAL_STATEMENTS) {
    try {
      await db.execute(sql.raw(stmt));
    } catch {
      // Hardening only — the application layer already guarantees immutability.
    }
  }
}

/**
 * Process-wide memoised schema bootstrap for the EMBEDDED database only.
 *
 * A real PostgreSQL database is migrated explicitly with `npm run db:migrate`
 * (see `drizzle/`) — the request lifecycle must never execute DDL or
 * migrations. Therefore `ensureSchemaOnce()` only ever bootstraps the in-
 * memory `memory://` database used by local development and tests, and is a
 * no-op for any real PostgreSQL URL.
 *
 * `createSchemaIfNotExists()` remains exported for the development/test
 * bootstrap path and is what the test suite invokes directly.
 */
let schemaOncePromise: Promise<void> | null = null;

export function ensureSchemaOnce(): Promise<void> {
  if (!isMemoryUrl(process.env.DATABASE_URL)) {
    return Promise.resolve();
  }
  schemaOncePromise ??= createSchemaIfNotExists().catch((err) => {
    schemaOncePromise = null;
    throw err;
  });
  return schemaOncePromise;
}
