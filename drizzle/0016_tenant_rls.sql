-- Defence in depth for deployments that use a non-owner runtime role.
-- Set app.user_id within a transaction before accessing tenant data.
-- Table owners bypass RLS unless FORCE is used; production should use a
-- dedicated non-owner runtime role and a separate migration/maintenance role.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'wallets','expense_categories','accounts','journal_entries','lots',
    'portfolio_valuations','portfolio_snapshots',
    'wealth_performance_snapshots','asset_performance_analysis',
    'portfolio_risk_metrics','analytics_runs','snapshots','goals','events',
    'budgets','planned_transactions','debts','obligations','funds',
    'real_estate_properties','real_estate_valuation_snapshots','vehicle_assets',
    'rwa_ownership_records','rwa_valuation_events','commodity_categories',
    'commodity_items','commodity_price_records','user_fx_settings',
    'user_preferences','user_setup_state','audit_log'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_select ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_update ON %I', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_select ON %I FOR SELECT USING (user_id::text = nullif(current_setting(''app.user_id'', true), '''') OR user_id IS NULL)', t
      );
      EXECUTE format(
        'CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))', t
      );
      EXECUTE format(
        'CREATE POLICY tenant_update ON %I FOR UPDATE USING (user_id::text = nullif(current_setting(''app.user_id'', true), '''')) WITH CHECK (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))', t
      );
      EXECUTE format(
        'CREATE POLICY tenant_delete ON %I FOR DELETE USING (user_id::text = nullif(current_setting(''app.user_id'', true), ''''))', t
      );
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- Authentication tables never grant direct browser/public access.
REVOKE ALL ON TABLE users, sessions, asset_performance FROM PUBLIC;--> statement-breakpoint

-- Child tables inherit the tenant boundary through their parent.
DO $$
DECLARE item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('postings','entry_id','journal_entries'),
    ('entry_reviews','entry_id','journal_entries'),
    ('entry_fx_snapshots','entry_id','journal_entries'),
    ('lot_consumptions','lot_id','lots'),
    ('snapshot_lines','snapshot_id','snapshots'),
    ('goal_contributions','goal_id','goals'),
    ('event_items','event_id','events'),
    ('installments','debt_id','debts')
  ) AS x(child_table, parent_column, parent_table)
  LOOP
    IF to_regclass('public.' || item.child_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', item.child_table);
      EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC', item.child_table);
      EXECUTE format('DROP POLICY IF EXISTS tenant_parent ON %I', item.child_table);
      EXECUTE format(
        'CREATE POLICY tenant_parent ON %I FOR ALL USING (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p.user_id::text = nullif(current_setting(''app.user_id'', true), ''''))) WITH CHECK (EXISTS (SELECT 1 FROM %I p WHERE p.id = %I.%I AND p.user_id::text = nullif(current_setting(''app.user_id'', true), '''')))',
        item.child_table, item.parent_table, item.child_table, item.parent_column,
        item.parent_table, item.child_table, item.parent_column
      );
    END IF;
  END LOOP;
END $$;
