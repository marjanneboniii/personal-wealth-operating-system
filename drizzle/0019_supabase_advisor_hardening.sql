-- The immutable-snapshot trigger does not resolve any database objects, but a
-- fixed search path prevents future edits from introducing object-shadowing.
ALTER FUNCTION public.vehicle_valuation_snapshots_immutable() SET search_path = '';--> statement-breakpoint

-- Migration 0016 installed application-context policies before the Supabase
-- cutover. Browser roles have no write grants, but leaving those policies in
-- place adds redundant permissive policy work and obscures the final model.
DROP POLICY IF EXISTS tenant_select ON public.audit_log;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_insert ON public.audit_log;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_update ON public.audit_log;--> statement-breakpoint
DROP POLICY IF EXISTS tenant_delete ON public.audit_log;--> statement-breakpoint

-- A single policy is cheaper and easier to audit than two permissive SELECT
-- policies. User-owned categories and deliberately shared system categories
-- remain read-only through the Data API.
DROP POLICY IF EXISTS tenant_select ON public.expense_categories;--> statement-breakpoint
DROP POLICY IF EXISTS expense_categories_shared_select ON public.expense_categories;--> statement-breakpoint
CREATE POLICY expense_categories_select ON public.expense_categories
FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR user_id IS NULL);--> statement-breakpoint

-- PostgreSQL does not create indexes for foreign keys automatically. Add an
-- index when a single-column FK is not already the leading column of a valid
-- index. This keeps joins and ON DELETE checks bounded as tenant data grows.
DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT
      namespace.nspname AS schema_name,
      relation.relname AS table_name,
      attribute.attname AS column_name
    FROM pg_constraint constraint_record
    JOIN pg_class relation ON relation.oid = constraint_record.conrelid
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    JOIN pg_attribute attribute
      ON attribute.attrelid = constraint_record.conrelid
     AND attribute.attnum = constraint_record.conkey[1]
    WHERE constraint_record.contype = 'f'
      AND namespace.nspname = 'public'
      AND cardinality(constraint_record.conkey) = 1
      AND NOT EXISTS (
        SELECT 1
        FROM pg_index index_record
        WHERE index_record.indrelid = constraint_record.conrelid
          AND index_record.indisvalid
          AND index_record.indkey[0] = constraint_record.conkey[1]
      )
  LOOP
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)',
      left(item.table_name || '_' || item.column_name || '_fk_idx', 63),
      item.schema_name,
      item.table_name,
      item.column_name
    );
  END LOOP;
END $$;
