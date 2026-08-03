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
    sort_order integer NOT NULL DEFAULT 0
  );`,
  `CREATE TABLE IF NOT EXISTS networks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    deleted_at timestamptz,
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    chain_type text
  );`,
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
  /* Scenario Engine — isolated tables */
  `CREATE TABLE IF NOT EXISTS scenario_simulations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz,
    user_id uuid REFERENCES users(id),
    name text NOT NULL,
    description text,
    asset_id uuid NOT NULL REFERENCES assets(id),
    initial_capital numeric(38,18) NOT NULL,
    capital_currency_id uuid REFERENCES currencies(id),
    start_date date NOT NULL,
    initial_price numeric(38,18) NOT NULL,
    initial_quantity numeric(38,18) NOT NULL,
    status text NOT NULL DEFAULT 'active',
    notes text
  );`,
  `CREATE INDEX IF NOT EXISTS scenario_simulations_asset_idx ON scenario_simulations(asset_id);`,
  `CREATE INDEX IF NOT EXISTS scenario_simulations_user_idx ON scenario_simulations(user_id);`,
  `CREATE INDEX IF NOT EXISTS scenario_simulations_start_date_idx ON scenario_simulations(start_date);`,
  `CREATE TABLE IF NOT EXISTS scenario_evaluation_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    scenario_id uuid NOT NULL REFERENCES scenario_simulations(id) ON DELETE CASCADE,
    evaluation_date date NOT NULL,
    current_price numeric(38,18) NOT NULL,
    current_value numeric(38,18) NOT NULL,
    profit_loss numeric(38,18) NOT NULL,
    roi_percentage numeric(38,18) NOT NULL,
    annualized_return_percentage numeric(38,18),
    benchmark_comparisons text,
    CONSTRAINT scenario_eval_scenario_date_uq UNIQUE (scenario_id, evaluation_date)
  );`,
  `CREATE INDEX IF NOT EXISTS scenario_eval_scenario_idx ON scenario_evaluation_runs(scenario_id);`,
];

export async function createSchemaIfNotExists() {
  for (const stmt of STATEMENTS) {
    await db.execute(sql.raw(stmt));
  }
}
