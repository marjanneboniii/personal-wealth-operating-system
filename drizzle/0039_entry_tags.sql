-- Free-form hashtags on journal entries (#سفر, #تعمیر_خانه): a reporting
-- dimension beside the immutable entry, like entry_reviews. Tenancy follows
-- journal_entries.user_id; the app reads and writes through the server role.
CREATE TABLE IF NOT EXISTS public.entry_tags (
 entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
 tag text NOT NULL CHECK (char_length(tag) BETWEEN 1 AND 32),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (entry_id, tag)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS entry_tags_tag_idx ON public.entry_tags(tag);
--> statement-breakpoint
ALTER TABLE public.entry_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.entry_tags FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.entry_tags FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
