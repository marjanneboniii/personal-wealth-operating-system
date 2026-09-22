-- دفتر چک: cheques the user wrote or holds. A pending cheque is a plan (it
-- moves the forecast, never the ledger); it posts only when cleared through
-- the transaction form, which links cleared_entry_id atomically.
CREATE TABLE IF NOT EXISTS public.cheques (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 direction text NOT NULL CHECK (direction IN ('issued','received')),
 counterparty text NOT NULL CHECK (char_length(counterparty) BETWEEN 1 AND 120),
 amount_toman numeric(38,18) NOT NULL CHECK (amount_toman > 0),
 due_date date NOT NULL,
 account_id uuid REFERENCES public.accounts(id),
 sayad_id text CHECK (sayad_id ~ '^[0-9]{16}$'),
 serial text CHECK (char_length(serial) <= 40),
 bank_name text CHECK (char_length(bank_name) <= 60),
 installment_id uuid REFERENCES public.installments(id) ON DELETE SET NULL,
 note text CHECK (char_length(note) <= 500),
 status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','bounced','cancelled')),
 status_changed_at timestamptz,
 cleared_entry_id uuid REFERENCES public.journal_entries(id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS cheques_user_due_idx ON public.cheques(user_id, status, due_date);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS cheques_user_sayad_uq ON public.cheques(user_id, sayad_id) WHERE sayad_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.cheques ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.cheques FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.cheques FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
