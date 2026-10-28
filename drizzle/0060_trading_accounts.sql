-- حساب معاملاتی (perp venues): the account value and open P&L the venue
-- reported, as of a day; and the public wallet address its read-only API is
-- asked about. Additive only.
CREATE TABLE IF NOT EXISTS public.trading_account_marks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT now(),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
 as_of date NOT NULL,
 account_value numeric(38,18) NOT NULL,
 unrealized_pnl numeric(38,18) NOT NULL,
 source text NOT NULL CHECK (source IN ('manual','hyperliquid','lighter','lighter_rh')),
 entry_id uuid REFERENCES public.journal_entries(id) ON DELETE SET NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS trading_account_marks_account_idx ON public.trading_account_marks(user_id, account_id, created_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.trading_account_links (
 account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 venue text NOT NULL CHECK (venue IN ('hyperliquid','lighter','lighter_rh')),
 address_enc text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz
);
--> statement-breakpoint
ALTER TABLE public.trading_account_marks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.trading_account_links ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.trading_account_marks FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.trading_account_links FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.trading_account_marks FROM %I', role_name);
   EXECUTE format('REVOKE ALL ON public.trading_account_links FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
