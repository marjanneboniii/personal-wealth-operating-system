DO $$ BEGIN
  UPDATE public.accounts
  SET name = regexp_replace(name, 'Dollar\s+Global|Global\s+Dollar', 'یو اس دی جی', 'gi')
  WHERE name ~* 'Dollar\s+Global|Global\s+Dollar';

  UPDATE public.assets
  SET name = regexp_replace(name, 'Dollar\s+Global|Global\s+Dollar', 'یو اس دی جی', 'gi')
  WHERE name ~* 'Dollar\s+Global|Global\s+Dollar';

  UPDATE public.journal_entries
  SET description = regexp_replace(description, 'Dollar\s+Global|Global\s+Dollar', 'یو اس دی جی', 'gi')
  WHERE description ~* 'Dollar\s+Global|Global\s+Dollar';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
