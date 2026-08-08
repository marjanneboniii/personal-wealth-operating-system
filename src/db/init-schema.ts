import { sql } from "drizzle-orm";
import { db } from "@/db";

const STATEMENTS = [
`CREATE TABLE IF NOT EXISTS users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL,
    role text NOT NULL DEFAULT 'owner',
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
    color text NOT NULL DEFAULT '#64748b',
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
    is_active boolean NOT NULL DEFAULT true
  );`,
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
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    type text NOT NULL,
    parent_id uuid,
    asset_id uuid REFERENCES assets(id),
    wallet_id uuid REFERENCES wallets(id),
    is_active boolean NOT NULL DEFAULT true
  );`,
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
  `CREATE TABLE IF NOT EXISTS market_price_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    name text NOT NULL UNIQUE,
    type text NOT NULL DEFAULT 'manual',
    description text
  );`,
  `CREATE TABLE IF NOT EXISTS market_prices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    asset_id uuid NOT NULL REFERENCES assets(id),
    price numeric(38,18) NOT NULL,
    currency_id uuid REFERENCES currencies(id),
    price_timestamp timestamptz NOT NULL DEFAULT now(),
    source_id uuid REFERENCES market_price_sources(id)
  );`,
  `CREATE TABLE IF NOT EXISTS market_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    asset_id uuid NOT NULL REFERENCES assets(id),
    snapshot_date date NOT NULL,
    price numeric(38,18) NOT NULL,
    currency_id uuid REFERENCES currencies(id),
    source_id uuid REFERENCES market_price_sources(id),
    CONSTRAINT market_snapshots_uq UNIQUE (asset_id, snapshot_date, source_id)
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
  `CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    user_id uuid REFERENCES users(id),
    snapshot_date date NOT NULL UNIQUE,
    total_portfolio_value numeric(38,18) NOT NULL,
    base_currency_id uuid REFERENCES currencies(id)
  );`,
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
  `CREATE TABLE IF NOT EXISTS import_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id),
    source text NOT NULL DEFAULT 'csv',
    status text NOT NULL DEFAULT 'pending',
    row_count integer NOT NULL DEFAULT 0,
    valid_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz
  );`,
  `CREATE TABLE IF NOT EXISTS import_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_job_id uuid NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    raw_data text NOT NULL,
    status text NOT NULL DEFAULT 'valid',
    error_message text,
    mapped_transaction_id uuid REFERENCES journal_entries(id),
    created_at timestamptz NOT NULL DEFAULT now()
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
  `CREATE TABLE IF NOT EXISTS asset_networks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    network_id uuid NOT NULL REFERENCES networks(id),
    contract_address text,
    chain_id integer,
    decimals integer,
    token_standard text,
    is_primary boolean NOT NULL DEFAULT false,
    is_active boolean NOT NULL DEFAULT true,
    explorer_url text,
    logo_uri text,
    CONSTRAINT asset_networks_uq UNIQUE (asset_id, network_id, contract_address)
  );`,
  `CREATE INDEX IF NOT EXISTS asset_networks_asset_idx ON asset_networks(asset_id);`,
  `CREATE INDEX IF NOT EXISTS asset_networks_network_idx ON asset_networks(network_id);`,

  `CREATE TABLE IF NOT EXISTS asset_token_metadata (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE UNIQUE,
    underlying_asset_id uuid REFERENCES assets(id),
    logo_uri text,
    coingecko_id text,
    coinmarketcap_id text,
    website_url text,
    description text
  );`,

  /* Wallet Identity Layer — Separate from accounting wallets *//* External Asset Discovery — Quarantine *//* Observation Layer — DeBank, Zerion, RPC Read-Only Cache *//* Reconciliation Engine — Reporting Only *//* RWA Domain — Identity, Ownership, Valuation Separation */
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
    valuation_date date NOT NULL,
    price_irr numeric(38,18),
    price_usd numeric(38,18),
    price_base numeric(38,18),
    currency_id uuid REFERENCES currencies(id),
    valuation_source text NOT NULL DEFAULT 'manual',
    appraiser text,
    source_id uuid REFERENCES market_price_sources(id),
    note text,
    CONSTRAINT rwa_valuation_asset_date_source_uq UNIQUE (asset_id, valuation_date, valuation_source)
  );`,
  `CREATE INDEX IF NOT EXISTS rwa_valuation_asset_date_idx ON rwa_valuation_events(asset_id, valuation_date);`,

  /* Valuation Engine — Source -> Event -> Engine */
  `CREATE TABLE IF NOT EXISTS valuation_sources (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE UNIQUE,
    source_type text NOT NULL DEFAULT 'market_price',
    primary_provider_name text NOT NULL DEFAULT 'MANUAL',
    backup_provider_name text,
    is_active boolean NOT NULL DEFAULT true,
    config text
  );`,
  `CREATE INDEX IF NOT EXISTS valuation_sources_asset_idx ON valuation_sources(asset_id);`,

  `CREATE TABLE IF NOT EXISTS valuation_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    asset_id uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    valuation_date date NOT NULL,
    price numeric(38,18) NOT NULL,
    currency_id uuid REFERENCES currencies(id),
    source_type text NOT NULL DEFAULT 'market_price',
    provider_name text NOT NULL DEFAULT 'MANUAL',
    source_id uuid REFERENCES market_price_sources(id),
    metadata text,
    note text,
    CONSTRAINT valuation_events_asset_date_provider_uq UNIQUE (asset_id, valuation_date, provider_name)
  );`,
  `CREATE INDEX IF NOT EXISTS valuation_events_asset_date_idx ON valuation_events(asset_id, valuation_date);`,

  /* Market Data — CoinGecko Mapping */
  `CREATE TABLE IF NOT EXISTS coingecko_asset_mappings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    internal_asset_id text NOT NULL,
    coingecko_id text NOT NULL UNIQUE,
    symbol text,
    last_synced_at timestamptz
  );`,
  `CREATE INDEX IF NOT EXISTS coingecko_mappings_asset_idx ON coingecko_asset_mappings(internal_asset_id);`,
  `CREATE INDEX IF NOT EXISTS coingecko_mappings_symbol_idx ON coingecko_asset_mappings(symbol);`,

  /* Commodities Domain — Dynamic Price Tracking & Inflation Analytics — Isolated, No FK to Financial Core */
  `CREATE TABLE IF NOT EXISTS commodity_categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS commodity_categories_name_idx ON commodity_categories(name);`,

  `CREATE TABLE IF NOT EXISTS commodity_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL UNIQUE,
    category_id uuid REFERENCES commodity_categories(id) ON DELETE SET NULL,
    default_unit text NOT NULL DEFAULT 'piece',
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS commodity_items_name_idx ON commodity_items(name);`,
  `CREATE INDEX IF NOT EXISTS commodity_items_category_idx ON commodity_items(category_id);`,

  `CREATE TABLE IF NOT EXISTS commodity_price_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    commodity_id uuid NOT NULL REFERENCES commodity_items(id) ON DELETE CASCADE,
    unit_price numeric(38,18) NOT NULL,
    unit text NOT NULL DEFAULT 'piece',
    quantity numeric(38,18) NOT NULL DEFAULT 1,
    total_amount numeric(38,18) NOT NULL,
    purchased_at timestamptz NOT NULL DEFAULT now(),
    merchant_name text,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  );`,
  `CREATE INDEX IF NOT EXISTS commodity_price_commodity_idx ON commodity_price_records(commodity_id);`,
  `CREATE INDEX IF NOT EXISTS commodity_price_purchased_idx ON commodity_price_records(purchased_at);`,
  `CREATE INDEX IF NOT EXISTS commodity_price_merchant_idx ON commodity_price_records(merchant_name);`,

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

  `CREATE TABLE IF NOT EXISTS user_display_preferences (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    user_id uuid REFERENCES users(id),
    display_currency text NOT NULL DEFAULT 'USD'
  );`,
  `CREATE INDEX IF NOT EXISTS user_display_preferences_user_idx ON user_display_preferences(user_id);`,

  /* External Market Data Provider Layer (Phase 2.7) — reference data only, no ledger FK */
  `CREATE TABLE IF NOT EXISTS external_providers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    name text NOT NULL UNIQUE,
    display_name text NOT NULL,
    provider_type text NOT NULL DEFAULT 'crypto',
    base_url text,
    description text
  );`,

  `CREATE TABLE IF NOT EXISTS asset_provider_mappings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id),
    provider_id uuid NOT NULL REFERENCES external_providers(id),
    external_symbol text NOT NULL,
    external_name text,
    provider_asset_id text,
    asset_type text NOT NULL DEFAULT 'crypto',
    logo_url text,
    supported_markets text,
    metadata_json text
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS asset_provider_mappings_pair_unique ON asset_provider_mappings(asset_id, provider_id);`,

  `CREATE TABLE IF NOT EXISTS external_price_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    asset_id uuid NOT NULL REFERENCES assets(id),
    provider_id uuid NOT NULL REFERENCES external_providers(id),
    price numeric(38,18) NOT NULL,
    currency text NOT NULL DEFAULT 'USD',
    as_of_date date NOT NULL,
    "timestamp" timestamptz NOT NULL DEFAULT now(),
    is_current boolean NOT NULL DEFAULT true,
    raw_response text
  );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS external_price_history_unique ON external_price_history(asset_id, provider_id, as_of_date, currency);`,
  `CREATE INDEX IF NOT EXISTS external_price_history_asset_idx ON external_price_history(asset_id);`,

  `CREATE TABLE IF NOT EXISTS wallet_observations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    user_id uuid REFERENCES users(id),
    wallet_id uuid REFERENCES wallets(id),
    asset_id uuid NOT NULL REFERENCES assets(id),
    observed_balance numeric(38,18) NOT NULL,
    recorded_balance numeric(38,18) NOT NULL,
    discrepancy numeric(38,18) NOT NULL,
    observation_date date NOT NULL,
    source text NOT NULL DEFAULT 'manual_observation',
    notes text
  );`,
  `CREATE INDEX IF NOT EXISTS wallet_observations_asset_idx ON wallet_observations(asset_id);`,
  `CREATE INDEX IF NOT EXISTS wallet_observations_wallet_idx ON wallet_observations(wallet_id);`,
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
}
