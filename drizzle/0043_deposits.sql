-- سپرده‌ها: bank term deposits and income funds paying monthly. Metadata
-- over money already in the ledger; the monthly interest is a recurring
-- income reminder linked by planned_transactions.deposit_id.
CREATE TABLE IF NOT EXISTS public.deposits (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('bank','fund')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
 institution text CHECK (char_length(institution) <= 80),
 account_id uuid NOT NULL REFERENCES public.accounts(id),
 payout_account_id uuid NOT NULL REFERENCES public.accounts(id),
 principal_toman numeric(38,18) NOT NULL CHECK (principal_toman > 0),
 annual_rate numeric(7,4) NOT NULL CHECK (annual_rate > 0 AND annual_rate <= 100),
 start_date date NOT NULL,
 maturity_date date CHECK (maturity_date IS NULL OR maturity_date > start_date),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
 closed_at timestamptz,
 note text CHECK (char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS deposits_user_idx ON public.deposits(user_id, status);
--> statement-breakpoint
ALTER TABLE public.planned_transactions ADD COLUMN IF NOT EXISTS deposit_id uuid REFERENCES public.deposits(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.deposits FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.deposits FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
