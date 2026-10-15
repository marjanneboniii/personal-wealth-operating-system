-- Planning links: an event's budget, and debts/receivables with no due date.
-- Additive only: one nullable column and one new table.
ALTER TABLE public.budgets ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS budgets_event_idx ON public.budgets(event_id) WHERE event_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.undated_obligations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 deleted_at timestamptz,
 user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
 direction text NOT NULL DEFAULT 'payable' CHECK (direction IN ('payable','receivable')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
 unit text NOT NULL CHECK (unit IN ('toman','EMAMI','BAHAR','NIM','ROB')),
 quantity numeric(38,18) NOT NULL CHECK (quantity > 0),
 note text CHECK (char_length(note) <= 300)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS undated_obligations_user_idx ON public.undated_obligations(user_id);
--> statement-breakpoint
ALTER TABLE public.undated_obligations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.undated_obligations FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.undated_obligations FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
