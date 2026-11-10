DO $$ BEGIN
  UPDATE public.trading_account_marks SET entry_id = NULL WHERE entry_id IS NOT NULL;
  DELETE FROM public.entry_fx_snapshots WHERE entry_id IN (
    SELECT id FROM public.journal_entries
    WHERE type = 'adjustment' AND description ~* 'معاملات'
  );
  DELETE FROM public.entry_reviews WHERE entry_id IN (
    SELECT id FROM public.journal_entries
    WHERE type = 'adjustment' AND description ~* 'معاملات'
  );
  DELETE FROM public.postings WHERE entry_id IN (
    SELECT id FROM public.journal_entries
    WHERE type = 'adjustment' AND description ~* 'معاملات'
  );
  DELETE FROM public.journal_entries WHERE type = 'adjustment' AND description ~* 'معاملات';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
