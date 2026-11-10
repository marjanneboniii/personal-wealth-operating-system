DO $$ BEGIN
  ALTER TABLE public.trading_account_links DROP CONSTRAINT IF EXISTS trading_account_links_venue_check;
  ALTER TABLE public.trading_account_marks DROP CONSTRAINT IF EXISTS trading_account_marks_source_check;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
