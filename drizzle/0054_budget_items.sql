-- ریز اقلام بودجه: a tag budget (a wedding, a car change) split into lines —
-- ring, dress, hall… — each with its own Toman ceiling and its own tag.
-- Planning only: no account, no posting, nothing here moves a balance.
--
-- Additive: one nullable column on budgets and one new table.
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS template text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.budget_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 budget_id uuid NOT NULL REFERENCES public.budgets(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 60),
 amount_toman numeric(38,18) NOT NULL DEFAULT 0 CHECK (amount_toman >= 0),
 tag text NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 32),
 sort integer NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS budget_items_budget_idx ON public.budget_items(budget_id, sort);
--> statement-breakpoint
ALTER TABLE public.budget_items ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.budget_items FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.budget_items FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
