-- Supabase cutover. Hosted Supabase provides the auth schema and JWT helpers;
-- disposable migration tests receive minimal compatibility objects below.
DO $$
BEGIN
  IF to_regnamespace('auth') IS NULL THEN
    -- Minimal compatibility objects for disposable migration tests only.
    -- Hosted Supabase already owns this schema and these roles.
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text,
      email_confirmed_at timestamptz,
      raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS 'SELECT NULL::uuid';
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  END IF;

  -- Retire all application-owned credentials. Supabase Auth is the sole
  -- password/session authority after this point.
  UPDATE public.users SET pin_hash = NULL, password_hash = NULL, google_id = NULL;
  DROP TABLE IF EXISTS public.sessions;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_auth_user_fk') THEN
    ALTER TABLE public.users ADD CONSTRAINT users_auth_user_fk
      FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;

  EXECUTE 'CREATE SCHEMA IF NOT EXISTS private';
END $$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION public.sync_auth_user_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE requested_username text;
BEGIN
  requested_username := lower(left(coalesce(NEW.raw_user_meta_data ->> 'username', ''), 64));
  IF requested_username !~ '^[a-z0-9_.-]{3,64}$' THEN requested_username := NULL; END IF;
  INSERT INTO public.users (id, name, username, email, email_verified, role, created_at, updated_at)
  VALUES (
    NEW.id,
    left(coalesce(nullif(NEW.raw_user_meta_data ->> 'name', ''), nullif(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(NEW.email, ''), '@', 1), 'کاربر'), 120),
    requested_username,
    lower(NEW.email),
    NEW.email_confirmed_at IS NOT NULL,
    'user',
    coalesce(NEW.created_at, now()),
    now()
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    email_verified = EXCLUDED.email_verified,
    updated_at = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS on_auth_user_sync ON auth.users;--> statement-breakpoint
CREATE TRIGGER on_auth_user_sync
AFTER INSERT OR UPDATE OF email, email_confirmed_at, raw_user_meta_data ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.sync_auth_user_profile();--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.is_pwos_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = (SELECT auth.uid()) AND role IN ('owner', 'admin')
  );
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.is_pwos_admin() FROM PUBLIC;--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.is_pwos_admin() TO authenticated;--> statement-breakpoint

DO $$
DECLARE t text;
BEGIN
  IF to_regnamespace('auth') IS NULL THEN RETURN; END IF;

  -- Start closed: no table is anonymously reachable through the Data API.
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
  END LOOP;

  -- Read-only shared catalogs used by authenticated clients.
  FOREACH t IN ARRAY ARRAY[
    'currencies','asset_classes','networks','institutions','cities',
    'neighborhoods','property_types','vehicle_brands','coingecko_asset_catalog'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS catalog_read ON public.%I', t);
      EXECUTE format('CREATE POLICY catalog_read ON public.%I FOR SELECT TO authenticated USING (true)', t);
    END IF;
  END LOOP;

  -- Direct tenant tables are closed to NULL/orphan rows. Shared catalog data
  -- receives a deliberately narrow policy below instead of a blanket escape.
  FOREACH t IN ARRAY ARRAY[
    'wallets','expense_categories','accounts','journal_entries','lots',
    'portfolio_valuations','portfolio_snapshots','wealth_performance_snapshots',
    'asset_performance_analysis','portfolio_risk_metrics','analytics_runs',
    'benchmark_results',
    'snapshots','goals','events','budgets','planned_transactions','debts',
    'obligations','funds','real_estate_properties','real_estate_valuation_snapshots',
    'vehicle_assets','rwa_ownership_records','rwa_valuation_events',
    'commodity_categories','commodity_items','commodity_price_records',
    'user_fx_settings','user_preferences','user_setup_state'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      -- Financial writes stay behind trusted Server Actions/APIs so validation,
      -- row locks, ledger invariants and audit cannot be bypassed via Data API.
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_select ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_insert ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_update ON public.%I', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_delete ON public.%I', t);
      EXECUTE format('CREATE POLICY tenant_select ON public.%I FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id)', t);
    END IF;
  END LOOP;

  -- Child tables derive their tenant from the protected parent.
  FOR t IN SELECT child_table FROM (VALUES
    ('postings'),('entry_reviews'),('entry_fx_snapshots'),('lot_consumptions'),
    ('snapshot_lines'),('goal_contributions'),('event_items'),('installments')
  ) AS x(child_table) LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO authenticated', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_parent ON public.%I', t);
    END IF;
  END LOOP;
END $$;--> statement-breakpoint

-- System expense categories are the only NULL-owned records intentionally
-- shared through the Data API. They remain read-only because all mutation
-- policies still require user_id = auth.uid().
DROP POLICY IF EXISTS expense_categories_shared_select ON public.expense_categories;--> statement-breakpoint
CREATE POLICY expense_categories_shared_select ON public.expense_categories FOR SELECT TO authenticated
USING (user_id IS NULL);--> statement-breakpoint

CREATE POLICY tenant_parent ON public.postings FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries p WHERE p.id = postings.entry_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.entry_reviews FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries p WHERE p.id = entry_reviews.entry_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.entry_fx_snapshots FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.journal_entries p WHERE p.id = entry_fx_snapshots.entry_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.lot_consumptions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.lots p WHERE p.id = lot_consumptions.lot_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.snapshot_lines FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.snapshots p WHERE p.id = snapshot_lines.snapshot_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.goal_contributions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.goals p WHERE p.id = goal_contributions.goal_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.event_items FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.events p WHERE p.id = event_items.event_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint
CREATE POLICY tenant_parent ON public.installments FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.debts p WHERE p.id = installments.debt_id AND p.user_id = (SELECT auth.uid())));--> statement-breakpoint

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.users FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE public.users TO authenticated;--> statement-breakpoint
GRANT UPDATE (name, username, updated_at) ON TABLE public.users TO authenticated;--> statement-breakpoint
DROP POLICY IF EXISTS users_read_self_or_admin ON public.users;--> statement-breakpoint
CREATE POLICY users_read_self_or_admin ON public.users FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()) OR (SELECT private.is_pwos_admin()));--> statement-breakpoint
DROP POLICY IF EXISTS users_update_self ON public.users;--> statement-breakpoint
CREATE POLICY users_update_self ON public.users FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid())) WITH CHECK (id = (SELECT auth.uid()));--> statement-breakpoint

-- Audit history is append-only from trusted server code. Browser/Data API
-- clients may read their own events (or all events when their DB profile is
-- privileged) but receive no INSERT/UPDATE/DELETE grant.
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE public.audit_log FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE public.audit_log TO authenticated;--> statement-breakpoint
DROP POLICY IF EXISTS audit_read_self_or_admin ON public.audit_log;--> statement-breakpoint
CREATE POLICY audit_read_self_or_admin ON public.audit_log FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT private.is_pwos_admin()));
