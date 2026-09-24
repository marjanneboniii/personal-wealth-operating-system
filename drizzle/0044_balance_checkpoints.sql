-- تطبیق موجودی: a balance the bank reported for one of the user's accounts
-- (from a confirmed bank SMS, or typed in by hand). The ledger is never
-- overwritten; the difference is DERIVED by comparing this number with
-- SUM(postings) up to as_of, and a correction is an ordinary balanced
-- adjustment entry linked back through resolution_entry_id.
CREATE TABLE IF NOT EXISTS public.balance_checkpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 as_of date NOT NULL,
 observed_at timestamptz NOT NULL,
 balance numeric(38,18) NOT NULL,
 source text NOT NULL CHECK (source IN ('sms','manual')),
 entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL,
 resolution_entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS balance_checkpoints_account_idx ON public.balance_checkpoints(user_id, account_id, as_of, observed_at);
--> statement-breakpoint
ALTER TABLE public.balance_checkpoints ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.balance_checkpoints FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.balance_checkpoints FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
