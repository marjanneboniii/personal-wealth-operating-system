-- سوابق پیش از توازن: money movements from before the user started the app,
-- kept for the story only. Not a journal entry — no account, asset or posting —
-- so nothing here can move a balance, net worth, a budget or a report.
--
-- Additive: one new table. No existing table, column or row is touched.
CREATE TABLE IF NOT EXISTS public.history_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 occurred_on date NOT NULL,
 kind text NOT NULL CHECK (kind IN ('expense','income','transfer','buy','sell','borrow','repay','other')),
 title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
 amount numeric(38,18) NOT NULL CHECK (amount > 0),
 unit text NOT NULL DEFAULT 'IRT' CHECK (unit IN ('IRT','USD','USDT','EUR','GOLD','COIN')),
 counterparty text CHECK (char_length(counterparty) <= 120),
 account_label text CHECK (char_length(account_label) <= 120),
 note text CHECK (char_length(note) <= 500)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS history_records_user_date_idx ON public.history_records(user_id, occurred_on);
--> statement-breakpoint
ALTER TABLE public.history_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.history_records FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.history_records FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
