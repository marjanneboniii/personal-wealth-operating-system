-- Seen-markers for derived reminders (features/notifications). The reminders
-- are computed on read and never stored; only "this user has seen key K" is.
CREATE TABLE IF NOT EXISTS public.notification_reads (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 200),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (user_id, key)
);
--> statement-breakpoint
ALTER TABLE public.notification_reads ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.notification_reads FROM PUBLIC;
--> statement-breakpoint
DO $$ DECLARE role_name text; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
   EXECUTE format('REVOKE ALL ON public.notification_reads FROM %I', role_name);
  END IF;
 END LOOP;
END $$;
