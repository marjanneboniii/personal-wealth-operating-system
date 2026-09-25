-- 0052_market_reference_quotes.sql
--
-- PUBLIC MARKET DATA ONLY. Reference prices for gold, coins, currencies,
-- global commodities and the Tehran exchange, and the shared state that keeps
-- every app instance under ONE request budget per source. No user id, no
-- holding, no transaction, no accounting value: nothing here can move a
-- balance, a lot, a cost basis or a journal entry, and no manual price is
-- touched.
--
-- market_reference_quotes — the last VALID price per (source, instrument).
-- `price` is per ONE `quantity_unit` in `currency` (IRT | IRR | USD);
-- `observed_at` is the source's own time and only moves forward.
--
-- market_source_status — per source: the lease one instance holds while
-- fetching, the last success and failure (as a code — never an upstream
-- message, which could echo an API key), back-off and the day's request count.
--
-- Additive: two new tables. No existing table, column or row is touched.

CREATE TABLE IF NOT EXISTS public.market_reference_quotes (
  source text NOT NULL,
  ref text NOT NULL,
  instrument_id text NOT NULL,
  price numeric(38,18) NOT NULL,
  currency text NOT NULL,
  quantity_unit text NOT NULL,
  source_unit_quantity text NOT NULL DEFAULT '1',
  basis text NOT NULL,
  observed_at timestamptz NOT NULL,
  observed_at_inferred boolean NOT NULL DEFAULT false,
  fetched_at timestamptz NOT NULL,
  extra jsonb,
  CONSTRAINT market_reference_quotes_source_ref_pk PRIMARY KEY (source, ref)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS market_reference_quotes_source_idx ON public.market_reference_quotes(source);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS public.market_source_status (
  source text PRIMARY KEY,
  lease_until timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error_code text,
  consecutive_failures integer NOT NULL DEFAULT 0,
  backoff_until timestamptz,
  quota_day text,
  requests_today integer NOT NULL DEFAULT 0,
  quota_exhausted_until timestamptz,
  last_quote_count integer,
  last_rejected_count integer
);
--> statement-breakpoint
ALTER TABLE public.market_reference_quotes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.market_source_status ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.market_reference_quotes FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON public.market_source_status FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.market_reference_quotes FROM %I', role_name);
   EXECUTE format('REVOKE ALL ON public.market_source_status FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
