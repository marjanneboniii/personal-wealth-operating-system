-- خودرو: the hashtag its running costs are recorded under (stable once set,
-- so renaming a car never unlinks its history), and its due dates —
-- technical inspection, annual municipal toll, service — as reminders.
ALTER TABLE public.vehicle_assets ADD COLUMN IF NOT EXISTS expense_tag text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.vehicle_due_dates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 vehicle_id uuid NOT NULL REFERENCES public.vehicle_assets(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('inspection','toll','service','other')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 80),
 due_date date NOT NULL,
 repeat_months integer CHECK (repeat_months IS NULL OR repeat_months BETWEEN 1 AND 60),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
 done_at timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS vehicle_due_dates_user_idx ON public.vehicle_due_dates(user_id, status, due_date);
--> statement-breakpoint
ALTER TABLE public.vehicle_due_dates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.vehicle_due_dates FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.vehicle_due_dates FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
